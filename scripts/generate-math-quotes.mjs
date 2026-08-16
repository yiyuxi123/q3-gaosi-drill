import fs from 'node:fs/promises';

const SOURCE_URL = 'https://www.gutenberg.org/cache/epub/44730/pg44730.txt';
const SOURCE_PAGE = 'https://www.gutenberg.org/ebooks/44730';
const ENDPOINT = 'http://localhost:5173/zen-api/zen/go/v1/chat/completions';
const TARGET_COUNT = 220;
const BATCH_SIZE = 5;
const CONCURRENCY = 4;
const CHECKPOINT_PATH = 'tmp/math-quotes-progress.json';

const normalize = value => value
  .replace(/\r?\n/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/_([^_]+)_/g, '$1')
  .replace(/\[(\d+)\]/g, '')
  .trim();

function parseSource(raw) {
  const entries = [...raw.matchAll(/^=(\d+)\.=\s*(.*?)(?=^=\d+\.=|(?![\s\S]))/gms)];
  const parsed = [];
  for (const entry of entries) {
    const paragraph = normalize(entry[2].split(/\r?\n\s*\r?\n/)[0] || '');
    const separator = paragraph.lastIndexOf('--');
    if (separator < 20) continue;
    const text = normalize(paragraph.slice(0, separator));
    const author = normalize(paragraph.slice(separator + 2)).replace(/\.$/, '');
    if (text.length < 30 || text.length > 230 || author.length < 2 || author.length > 80) continue;
    if (/^(quoted|from|see |ibid)/i.test(author) || /\[Illustration|\[Footnote/i.test(text)) continue;
    parsed.push({ id: Number(entry[1]), text, author });
  }

  // Spread the selection across the whole anthology instead of taking one chapter.
  const selected = [];
  const step = parsed.length / TARGET_COUNT;
  for (let index = 0; index < TARGET_COUNT; index++) {
    selected.push(parsed[Math.min(parsed.length - 1, Math.floor(index * step))]);
  }
  return selected;
}

async function translateBatch(batch) {
  const prompt = `你是严谨的数学史编辑。把下面公共领域数学名言译成简洁、自然、适合中国小学教师和学生阅读的中文，并把作者名译为常用中文名；不增添原文没有的观点，不伪造作者。只输出 JSON 数组，每项严格为 {"id":数字,"text":"中文译文","author":"中文作者名"}，数量与输入完全相同。\n\n${JSON.stringify(batch)}`;
  let lastError;
  for (const model of ['deepseek-v4-flash', 'mimo-v2.5']) {
    for (let attempt = 1; attempt <= 2; attempt++) try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-dev-proxy' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 3000
        })
      });
      if (!response.ok) throw new Error(`${model}: HTTP ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content || '';
      const start = content.indexOf('[');
      const end = content.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error(`${model}: 未返回完整 JSON 数组`);
      const translated = JSON.parse(content.slice(start, end + 1));
      if (!Array.isArray(translated) || translated.length !== batch.length) {
        throw new Error(`${model}: 返回数量 ${translated?.length ?? 0}/${batch.length}`);
      }
      return translated;
    } catch (error) {
      lastError = error;
      console.warn(`翻译批次重试：${error instanceof Error ? error.message : error}（第 ${attempt} 次）`);
    }
  }
  throw lastError;
}

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`名言源下载失败：HTTP ${response.status}`);
const selected = parseSource(await response.text());
if (selected.length !== TARGET_COUNT) throw new Error(`可用名言不足：${selected.length}/${TARGET_COUNT}`);

await fs.mkdir('tmp', { recursive: true });
let checkpoint = [];
try {
  checkpoint = JSON.parse(await fs.readFile(CHECKPOINT_PATH, 'utf8'));
} catch {}
const translatedBySource = new Map(checkpoint.map(item => [item.sourceNo, item]));
const missing = selected.filter(item => !translatedBySource.has(item.id));
const batches = [];
for (let start = 0; start < missing.length; start += BATCH_SIZE) {
  batches.push(missing.slice(start, start + BATCH_SIZE));
}
let nextBatch = 0;
let checkpointWrites = Promise.resolve();
const saveCheckpoint = () => {
  const content = JSON.stringify([...translatedBySource.values()], null, 2);
  checkpointWrites = checkpointWrites.then(() => fs.writeFile(CHECKPOINT_PATH, content, 'utf8'));
  return checkpointWrites;
};

async function worker() {
  while (nextBatch < batches.length) {
    const batch = batches[nextBatch++];
    const localized = await translateBatch(batch);
    localized.forEach((item, index) => {
      translatedBySource.set(batch[index].id, {
        text: String(item.text || '').trim(),
        author: String(item.author || '').trim(),
        sourceNo: batch[index].id
      });
    });
    await saveCheckpoint();
    console.log(`已整理 ${translatedBySource.size}/${TARGET_COUNT} 条数学名言`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
await checkpointWrites;
const translated = selected.map(item => translatedBySource.get(item.id));

if (translated.some(item => !item || item.text.length < 4 || item.author.length < 1)) {
  throw new Error('翻译结果存在空内容');
}

const output = `// Generated from the public-domain anthology Memorabilia Mathematica.\n// Source: ${SOURCE_PAGE}\nexport interface MathQuote {\n  text: string;\n  author: string;\n  sourceNo: number;\n}\n\nexport const MATH_QUOTES: MathQuote[] = ${JSON.stringify(translated, null, 2)};\n`;
await fs.mkdir('src/data', { recursive: true });
await fs.writeFile('src/data/mathQuotes.ts', output, 'utf8');
console.log(`完成：src/data/mathQuotes.ts，共 ${translated.length} 条。`);
