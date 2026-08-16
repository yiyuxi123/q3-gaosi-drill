import type { Question } from '../types';
import { isAutoGradableAnswer, verifyAnswer } from './answerVerifier';
import { getSyncConfig } from './webdav';

export interface AiExplanationResult {
  analysis: string;
  stepByStepSolution: string[];
  finalAnswer: string;
  teacherTips: string;
  relatedConcepts: string[];
  source: 'ai' | 'local';
  model: string;
  warning?: string;
}

export interface PhotoOcrResult {
  recognizedText: string;
  detectedStatus: 'correct' | 'wrong' | 'unknown';
  confidence: number;
  warning?: string;
}

interface CachedExplanation {
  fingerprint: string;
  result: AiExplanationResult;
}

const USE_LOCAL_DESKTOP_PROXY = import.meta.env.DEV || import.meta.env.MODE.startsWith('desktop');
const ZEN_API_BASE = USE_LOCAL_DESKTOP_PROXY
  ? '/zen-api/zen/go/v1'
  : 'https://opencode.ai/zen/go/v1';
const CHAT_ENDPOINT = `${ZEN_API_BASE}/chat/completions`;
const MESSAGES_ENDPOINT = `${ZEN_API_BASE}/messages`;
const TEXT_MODELS = ['deepseek-v4-flash', 'mimo-v2.5'] as const;
const VISION_MODEL = 'qwen3.7-plus';
const CACHE_KEY = 'strj_ai_explanation_cache_v3';
const CACHE_LIMIT = 80;
const PROMPT_REVISION = '2026-08-16-v3';
const DEFAULT_AI_TIMEOUT_MS = 30_000;
const AI_EXPLANATION_CACHE: Record<string, CachedExplanation> = {};

export async function fetchWithAiTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_AI_TIMEOUT_MS,
  fetcher: typeof fetch = globalThis.fetch
): Promise<Response> {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_AI_TIMEOUT_MS;
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = fetcher(input, {
    ...init,
    signal: controller?.signal || init.signal
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error(`AI 请求超时（已等待 ${Math.ceil(effectiveTimeoutMs / 1000)} 秒）`));
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function getApiKey(explicitKey?: string): string {
  // Development requests go through Vite's local proxy. The real key remains
  // server-side in .env.local and is never exposed to browser JavaScript.
  if (import.meta.env.DEV) return 'local-dev-proxy';
  if (explicitKey) return explicitKey.trim();
  try {
    return getSyncConfig().opencodego_api_key?.trim() || '';
  } catch {
    return '';
  }
}

function getQuestionFingerprint(question: Question): string {
  return [
    PROMPT_REVISION,
    question.content,
    question.answer,
    question.explanation,
    question.analysis,
    question.key_point,
    question.module,
    question.sub_module,
    question.needs_ai_explanation ? 'needs-ai' : '',
    question.q_slice_url,
    question.ans_slice_url
  ].join('|');
}

function hydrateCache(): void {
  if (Object.keys(AI_EXPLANATION_CACHE).length > 0) return;
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, CachedExplanation>;
    Object.assign(AI_EXPLANATION_CACHE, stored);
  } catch {}
}

function persistCache(question: Question, result: AiExplanationResult): void {
  delete AI_EXPLANATION_CACHE[question.id];
  AI_EXPLANATION_CACHE[question.id] = {
    fingerprint: getQuestionFingerprint(question),
    result
  };

  const entries = Object.entries(AI_EXPLANATION_CACHE).slice(-CACHE_LIMIT);
  Object.keys(AI_EXPLANATION_CACHE).forEach(key => delete AI_EXPLANATION_CACHE[key]);
  Object.assign(AI_EXPLANATION_CACHE, Object.fromEntries(entries));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(AI_EXPLANATION_CACHE));
  } catch {}
}

function getCachedExplanation(question: Question): AiExplanationResult | null {
  hydrateCache();
  const cached = AI_EXPLANATION_CACHE[question.id];
  if (
    cached?.fingerprint === getQuestionFingerprint(question)
    && cached.result
    && isExplanationUsable(cached.result, question)
  ) {
    return cached.result;
  }
  if (cached) delete AI_EXPLANATION_CACHE[question.id];
  return null;
}

export function shouldUseVision(question: Question): boolean {
  if (!question.q_slice_url) return false;
  const text = question.content?.trim() || '';
  return question.module === '数字谜'
    || question.module === '几何'
    || question.needs_ai_explanation === true
    || text.length < 35
    || /(?:如图|下图|图中|图形|阴影|示意图|数阵|幻方|在图|图\s*\d)/.test(text);
}

function getAnswerReference(question: Question): string {
  const answer = question.answer?.trim() || '';
  if (!answer || /^(?:见解析|见解答|详见|略|参见|原版答案图缺失)/.test(answer)) {
    return '未提供可信文本答案，请独立求解并给出结论';
  }
  return isAutoGradableAnswer(answer)
    ? `官方文本答案：${answer}`
    : `OCR 转写的官方参考答案（格式可能有误，必须独立验算）：${answer}`;
}

export function buildTutorPrompt(question: Question): string {
  const reference = getAnswerReference(question);
  const authoredExplanation = question.explanation?.trim()
    ? `\n题库已有解析线索（需要核验、补全，不能照抄错误内容）：${question.explanation.trim()}`
    : '';

  return `你是小学奥数教研组长。请解答《高斯导引》${question.grade}第${question.chapter_num}讲
模块：${question.module} / ${question.sub_module}
篇章：${question.section}
题目文字：${question.content}
${reference}${authoredExplanation}

要求：
1. 先用1至2句指出关键模型和突破口；
2. 给出3至6步、适合教师讲解的推导，每步包含理由，不能只报答案；
3. 单独给出最终答案并做一次代入、逆推或边界检查；
4. 指出一个学生最容易犯的错误及纠正方法；
5. 如果图片或题意不完整，明确说明不确定处，禁止猜测。
6. 字段值中禁止再次出现 analysis、stepByStepSolution、finalAnswer、teacherTips、relatedConcepts 等字段名，也不要重复输出 JSON。

只输出一个 JSON 对象，不要 Markdown 代码围栏：
{"analysis":"核心思路","stepByStepSolution":["步骤1","步骤2","步骤3"],"finalAnswer":"最终答案","teacherTips":"易错点与教学提示","relatedConcepts":["知识点1","知识点2"]}`;
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const withoutFence = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractPartialStringField(content: string, key: string): string {
  const match = content.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's'));
  return match ? decodeJsonString(match[1]).trim() : '';
}

function extractPartialStringArray(content: string, key: string): string[] {
  const marker = new RegExp(`"${key}"\\s*:\\s*\\[`, 's').exec(content);
  if (!marker) return [];
  const remainder = content.slice(marker.index + marker[0].length);
  const closingIndex = remainder.indexOf(']');
  let segment = closingIndex >= 0 ? remainder.slice(0, closingIndex) : remainder;
  const nextFieldIndex = segment.search(/\n\s*"(?:analysis|stepByStepSolution|finalAnswer|teacherTips|relatedConcepts)"\s*:/);
  if (nextFieldIndex >= 0) segment = segment.slice(0, nextFieldIndex);
  return Array.from(segment.matchAll(/"((?:\\.|[^"\\])*)"/gs))
    .map(match => decodeJsonString(match[1]).trim())
    .filter(Boolean);
}

function extractPartialJsonObject(content: string): Record<string, unknown> | null {
  if (!/"(?:analysis|stepByStepSolution|finalAnswer|teacherTips|relatedConcepts)"\s*:/.test(content)) return null;
  return {
    analysis: extractPartialStringField(content, 'analysis'),
    stepByStepSolution: extractPartialStringArray(content, 'stepByStepSolution'),
    finalAnswer: extractPartialStringField(content, 'finalAnswer'),
    teacherTips: extractPartialStringField(content, 'teacherTips'),
    relatedConcepts: extractPartialStringArray(content, 'relatedConcepts')
  };
}

function containsPromptScaffolding(text: string): boolean {
  return /"?(?:analysis|stepByStepSolution|finalAnswer|teacherTips|relatedConcepts)"?\s*:/.test(text);
}

function safeVisibleText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return normalized && !containsPromptScaffolding(normalized) ? normalized : fallback;
}

export function parseAiExplanationResponse(
  content: string,
  question: Question,
  model: string
): AiExplanationResult {
  const parsed = extractJsonObject(content) || extractPartialJsonObject(content);
  const isJsonLike = containsPromptScaffolding(content);
  const analysis = safeVisibleText(parsed?.analysis)
    ? safeVisibleText(parsed?.analysis)
    : isJsonLike ? '模型返回的结构化解析不完整。' : content.trim();
  const parsedSteps = Array.isArray(parsed?.stepByStepSolution)
    ? parsed.stepByStepSolution
        .filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        .map(step => safeVisibleText(step).replace(/^\s*(?:步骤\s*)?\d+[：:、.)]\s*/, '').trim())
        .filter(Boolean)
    : [];
  const fallbackSteps = (isJsonLike ? '' : content)
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*]|\d+[.、])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    analysis: analysis || '模型未返回有效解析。',
    stepByStepSolution: parsedSteps.length > 0 ? parsedSteps.slice(0, 6) : fallbackSteps,
    finalAnswer: safeVisibleText(parsed?.finalAnswer)
      ? safeVisibleText(parsed?.finalAnswer)
      : (isAutoGradableAnswer(question.answer) ? question.answer : '请以官方答案切片为准'),
    teacherTips: safeVisibleText(parsed?.teacherTips)
      ? safeVisibleText(parsed?.teacherTips)
      : `先让学生说清【${question.module}】模型，再列式计算并回到题意验算。`,
    relatedConcepts: Array.isArray(parsed?.relatedConcepts)
      ? parsed.relatedConcepts
          .map(item => safeVisibleText(item))
          .filter(Boolean)
          .slice(0, 5)
      : [question.module, question.sub_module],
    source: 'ai',
    model
  };
}

function isExplanationUsable(result: AiExplanationResult, question: Question): boolean {
  const usefulSteps = result.stepByStepSolution.filter(step => step.trim().length >= 2);
  if (result.analysis.trim().length < 4 || usefulSteps.length < 3) return false;
  if (/模型未返回有效解析|无法提供|不能回答|抱歉.*(?:无法|不能)/.test(result.analysis)) return false;
  if (
    containsPromptScaffolding(result.analysis)
    || result.stepByStepSolution.some(containsPromptScaffolding)
    || containsPromptScaffolding(result.finalAnswer)
    || containsPromptScaffolding(result.teacherTips)
    || result.relatedConcepts.some(containsPromptScaffolding)
  ) return false;

  if (isAutoGradableAnswer(question.answer)) {
    const answerCheck = verifyAnswer(result.finalAnswer, question.answer);
    if (answerCheck.isGradable && !answerCheck.isCorrect) return false;
  }
  return true;
}

async function callTextModel(model: string, prompt: string, apiKey: string): Promise<string> {
  const response = await fetchWithAiTimeout(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是严谨的小学奥数教研组长。必须逐步推导、主动验算；题意不清时说明不确定，不能编造。'
        },
        { role: 'user', content: prompt }
      ],
      // These Go models default to thinking mode. For this structured teaching
      // response it can consume the whole token budget before producing any
      // visible content, so explicitly request non-thinking output.
      thinking: { type: 'disabled' },
      max_tokens: 1600,
      temperature: 0.15
    })
  });

  if (!response.ok) throw new Error(`${model}: HTTP ${response.status}`);
  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;
  const content = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent
          .map((item: any) => typeof item === 'string' ? item : item?.text || item?.content || '')
          .join('\n')
      : '';
  if (typeof content !== 'string' || !content.trim()) throw new Error(`${model}: 空响应`);
  return content;
}

async function imageUrlToSource(imageUrl: string): Promise<Record<string, unknown>> {
  const response = await fetchWithAiTimeout(imageUrl);
  if (!response.ok) throw new Error(`题目图片读取失败: HTTP ${response.status}`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: blob.type || 'image/png',
      data: btoa(binary)
    }
  };
}

async function dataUrlToSource(imageDataUrl: string): Promise<Record<string, unknown>> {
  const match = imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('图片格式无效');
  return {
    type: 'image',
    source: { type: 'base64', media_type: match[1], data: match[2] }
  };
}

async function callVisionModel(
  imageSource: Record<string, unknown> | Record<string, unknown>[],
  prompt: string,
  apiKey: string,
  maxTokens = 900
): Promise<string> {
  const imageSources = Array.isArray(imageSource) ? imageSource : [imageSource];
  const response = await fetchWithAiTimeout(MESSAGES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: maxTokens,
      temperature: 0.1,
      system: '你是严谨的小学奥数视觉教研助手。先准确识别图像，再推理；无法确认时必须标记不确定。',
      messages: [
        {
          role: 'user',
          content: [
            ...imageSources.flatMap((source, index) => [
              { type: 'text', text: index === 0 ? '下面是题目原图：' : '下面是官方答案或解析图，仅用于核验：' },
              source
            ]),
            { type: 'text', text: prompt }
          ]
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`${VISION_MODEL}: HTTP ${response.status}`);
  const data = await response.json();
  const content = Array.isArray(data.content)
    ? data.content.filter((item: any) => item?.type === 'text').map((item: any) => item.text).join('\n')
    : '';
  if (!content.trim()) throw new Error(`${VISION_MODEL}: 空响应`);
  return content;
}

export async function getAiProblemExplanation(
  question: Question,
  apiKey?: string
): Promise<AiExplanationResult> {
  const cached = getCachedExplanation(question);
  if (cached) return cached;

  const effectiveKey = getApiKey(apiKey);
  if (!effectiveKey) {
    return getLocalExplanation(question, '尚未配置 AI API Key');
  }

  const prompt = buildTutorPrompt(question);
  const errors: string[] = [];

  if (shouldUseVision(question) && question.q_slice_url) {
    try {
      const imageSources = [await imageUrlToSource(question.q_slice_url)];
      if (question.ans_slice_url) {
        try {
          imageSources.push(await imageUrlToSource(question.ans_slice_url));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const content = await callVisionModel(imageSources, prompt, effectiveKey, 1400);
      const result = parseAiExplanationResponse(content, question, VISION_MODEL);
      if (!isExplanationUsable(result, question)) throw new Error(`${VISION_MODEL}: 解析内容不完整或答案未通过核验`);
      persistCache(question, result);
      return result;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const model of TEXT_MODELS) {
    try {
      const content = await callTextModel(model, prompt, effectiveKey);
      const result = parseAiExplanationResponse(content, question, model);
      if (!isExplanationUsable(result, question)) throw new Error(`${model}: 解析内容不完整或答案未通过核验`);
      persistCache(question, result);
      return result;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  // DeepSeek/MiMo occasionally return an upstream 502 while the multimodal
  // endpoint remains healthy. Every published question has an original crop,
  // so use it as a final high-quality recovery path even for text-heavy items.
  if (!shouldUseVision(question) && question.q_slice_url) {
    try {
      const imageSources = [await imageUrlToSource(question.q_slice_url)];
      if (question.ans_slice_url) {
        try {
          imageSources.push(await imageUrlToSource(question.ans_slice_url));
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const content = await callVisionModel(imageSources, prompt, effectiveKey, 1400);
      const result = parseAiExplanationResponse(content, question, VISION_MODEL);
      if (!isExplanationUsable(result, question)) throw new Error(`${VISION_MODEL}: 解析内容不完整或答案未通过核验`);
      persistCache(question, result);
      return result;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return getLocalExplanation(question, errors.join('；') || 'AI 服务暂不可用');
}

export async function recognizePhotoAnswer(
  imageBase64: string,
  apiKey?: string
): Promise<PhotoOcrResult> {
  const effectiveKey = getApiKey(apiKey);
  if (!effectiveKey) {
    return {
      recognizedText: '未配置 AI API Key，无法识别答卷。',
      detectedStatus: 'unknown',
      confidence: 0,
      warning: '请在管理中心配置 API Key 后重试。'
    };
  }

  try {
    const imageSource = await dataUrlToSource(imageBase64);
    const content = await callVisionModel(
      imageSource,
      '识别图中的题号、学生算式、最终答案和可见批改痕迹。只有存在明确标准答案或清晰对错批注时才能判断 correct/wrong，否则必须返回 unknown。只输出 JSON：{"recognizedText":"识别内容","detectedStatus":"correct|wrong|unknown","confidence":0到1}',
      effectiveKey,
      500
    );
    const parsed = extractJsonObject(content);
    const detectedStatus = parsed?.detectedStatus === 'correct' || parsed?.detectedStatus === 'wrong'
      ? parsed.detectedStatus
      : 'unknown';
    const confidenceValue = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;

    return {
      recognizedText: typeof parsed?.recognizedText === 'string' ? parsed.recognizedText : content,
      detectedStatus,
      confidence: Math.max(0, Math.min(1, confidenceValue)),
      warning: detectedStatus === 'unknown' ? '缺少可靠标准答案或批改痕迹，请人工确认。' : undefined
    };
  } catch (error) {
    return {
      recognizedText: 'AI 识别失败，未自动判定对错。',
      detectedStatus: 'unknown',
      confidence: 0,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function parsePhotoStudentAnswer(imageBase64: string, apiKey?: string): Promise<PhotoOcrResult> {
  return recognizePhotoAnswer(imageBase64, apiKey);
}

function getLocalExplanation(question: Question, warning: string): AiExplanationResult {
  const moduleSteps: Record<string, string[]> = {
    计算: ['先观察算式结构，寻找凑整、拆分或交换结合的机会。', '逐步化简并保留关键中间量。', '用逆运算或估算检查结果。'],
    计数: ['明确计数对象和限制条件。', '按互斥情况分类，或分步骤使用乘法原理。', '检查是否重复或遗漏。'],
    数论: ['把条件转化为因数、倍数、余数或整除关系。', '列出必要范围内的候选并筛选。', '代回原条件验证。'],
    几何: ['在图上标出已知长度、角度和面积关系。', '选择割补、等积变形或比例模型。', '检查单位和图形边界。'],
    应用题: ['确定不变量并设出关键未知量。', '根据数量关系列式或画线段图。', '把结果代回题意检查。'],
    数字谜: ['从进位、退位或数位限制最强的位置入手。', '逐位排除不可能数字。', '把完整结果代回原式。'],
    组合数学: ['先确定全集和限制条件。', '选择分类、排列组合、容斥或抽屉原理。', '用小规模例子检查计数是否重复。']
  };
  const steps = moduleSteps[question.module] || [
    '整理已知条件与目标。',
    '选择对应数学模型逐步推导。',
    '代回题意验算。'
  ];
  const rawExplanation = question.explanation?.trim() || '';
  const authoredExplanation = rawExplanation.length >= 12
    && !/^(?:见解析|见解答|详见|略|暂无解析|原版答案图缺失)/.test(rawExplanation)
    ? rawExplanation
    : '';
  const authoredSteps = authoredExplanation
    .split(/(?:\r?\n)+|(?<=[。；！？])/u)
    .map(line => line.trim())
    .filter(Boolean);

  return {
    analysis: authoredExplanation
      ? 'AI 服务暂时不可用，以下直接展示题库中已经整理并核验的完整解析。'
      : question.analysis && !/考点：/.test(question.analysis)
      ? question.analysis
      : `本题属于【${question.module}】。先从“${steps[0]}”入手，再结合官方答案切片核对细节。`,
    stepByStepSolution: authoredSteps.length > 0 ? authoredSteps : steps,
    finalAnswer: question.answer?.trim() && !/^(?:见解析|见解答|详见|略)/.test(question.answer.trim())
      ? question.answer.trim()
      : '当前题意不足以可靠确定答案',
    teacherTips: question.key_point || '让学生先说数量关系，再写算式；每一步都追问“为什么”。',
    relatedConcepts: [question.module, question.sub_module, `${question.grade}第${question.chapter_num}讲`],
    source: 'local',
    model: '本地教学框架',
    warning
  };
}
