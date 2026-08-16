import type { Chapter, Question } from '../types';

const QUESTION_BANK_CACHE_KEY = 'strj_question_bank_cache_v1';
const DEFAULT_QUESTION_BANK_TIMEOUT_MS = 15_000;

interface QuestionBankCache {
  schemaVersion: 1;
  cachedAt: string;
  questions: Question[];
  chapters: Chapter[];
}

export interface LoadedQuestionBank {
  questions: Question[];
  chapters: Chapter[];
  source: 'network' | 'cache';
  warning?: string;
}

function validateQuestionBank(
  rawQuestions: unknown,
  rawChapters: unknown
): { questions: Question[]; chapters: Chapter[] } {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('题目数据为空或格式不正确');
  }
  if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
    throw new Error('章节数据为空或格式不正确');
  }

  const chapters = rawChapters as Chapter[];
  const questions = rawQuestions as Question[];
  const chapterIds = new Set<string>();
  chapters.forEach((chapter, index) => {
    if (!chapter || typeof chapter.id !== 'string' || !chapter.id.trim()) {
      throw new Error(`第 ${index + 1} 条章节缺少有效 ID`);
    }
    if (chapterIds.has(chapter.id)) throw new Error(`章节 ID 重复：${chapter.id}`);
    const missingField = (['grade', 'title', 'module'] as const).find(field => (
      typeof chapter[field] !== 'string' || !chapter[field].trim()
    ));
    if (missingField) {
      throw new Error(`章节 ${chapter.id} 缺少有效字段：${missingField}`);
    }
    chapterIds.add(chapter.id);
  });

  const questionIds = new Set<string>();
  questions.forEach((question, index) => {
    if (!question || typeof question.id !== 'string' || !question.id.trim()) {
      throw new Error(`第 ${index + 1} 道题缺少有效 ID`);
    }
    if (questionIds.has(question.id)) throw new Error(`题目 ID 重复：${question.id}`);
    questionIds.add(question.id);
    if (typeof question.chapter_id !== 'string' || !chapterIds.has(question.chapter_id)) {
      throw new Error(`题目 ${question.id} 指向不存在的章节 ${String(question.chapter_id || '')}`);
    }
    const missingField = (['grade', 'chapter_title', 'module', 'section', 'short_title', 'content'] as const).find(field => (
      typeof question[field] !== 'string' || !question[field].trim()
    ));
    if (missingField) {
      throw new Error(`题目 ${question.id} 缺少有效字段：${missingField}`);
    }
  });

  return { questions, chapters };
}

function readCachedQuestionBank(): QuestionBankCache | null {
  try {
    const raw = globalThis.localStorage?.getItem(QUESTION_BANK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuestionBankCache>;
    if (parsed.schemaVersion !== 1 || typeof parsed.cachedAt !== 'string') return null;
    const validated = validateQuestionBank(parsed.questions, parsed.chapters);
    return { schemaVersion: 1, cachedAt: parsed.cachedAt, ...validated };
  } catch {
    try {
      globalThis.localStorage?.removeItem(QUESTION_BANK_CACHE_KEY);
    } catch {
      // Ignore read-only/private-mode storage failures.
    }
    return null;
  }
}

function cacheQuestionBank(questions: Question[], chapters: Chapter[]): void {
  try {
    const payload: QuestionBankCache = {
      schemaVersion: 1,
      cachedAt: new Date().toISOString(),
      questions,
      chapters
    };
    globalThis.localStorage?.setItem(QUESTION_BANK_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache quota/private-mode failures must not discard valid network data.
  }
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  label: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`${label}请求失败（HTTP ${response.status}）`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}不是有效的 JSON 数据`);
  }
}

export async function loadQuestionBank(
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs: number = DEFAULT_QUESTION_BANK_TIMEOUT_MS
): Promise<LoadedQuestionBank> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const networkRequest = Promise.all([
      fetchJson(fetcher, '/bank/questions.json', '题目文件', controller?.signal),
      fetchJson(fetcher, '/bank/chapters.json', '章节文件', controller?.signal)
    ]);
    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_QUESTION_BANK_TIMEOUT_MS;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`题库加载超时（已等待 ${Math.ceil(effectiveTimeoutMs / 1000)} 秒）`));
        controller?.abort();
      }, effectiveTimeoutMs);
    });
    const [rawQuestions, rawChapters] = await Promise.race([networkRequest, timeout]);
    const validated = validateQuestionBank(rawQuestions, rawChapters);
    cacheQuestionBank(validated.questions, validated.chapters);
    return { ...validated, source: 'network' };
  } catch (error) {
    const cached = readCachedQuestionBank();
    if (cached) {
      return {
        questions: cached.questions,
        chapters: cached.chapters,
        source: 'cache',
        warning: `在线题库暂时不可用，已恢复 ${cached.cachedAt.slice(0, 10)} 的本机副本。`
      };
    }
    throw new Error(error instanceof Error ? error.message : '题库加载失败');
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
