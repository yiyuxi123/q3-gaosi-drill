import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const publicRoot = path.join(projectRoot, 'public');
const questionsPath = path.join(publicRoot, 'bank', 'questions.json');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function collectQuestionAssets(question) {
  return [
    question.q_slice_url,
    question.ans_slice_url,
    question.q_page_url,
    question.ans_page_url,
    ...(Array.isArray(question.all_q_pages) ? question.all_q_pages : []),
    ...(Array.isArray(question.all_ans_pages) ? question.all_ans_pages : [])
  ].filter(value => typeof value === 'string' && value.trim());
}

const publicFiles = await listFiles(publicRoot);
const nestedPackages = publicFiles.filter(file => /\.(?:apk|aab)$/i.test(file));
if (nestedPackages.length > 0) {
  const relative = nestedPackages.map(file => path.relative(projectRoot, file)).join(', ');
  throw new Error(`禁止把安装包放入 public，否则会被再次打包：${relative}`);
}

const questions = JSON.parse(await readFile(questionsPath, 'utf8'));
const referencedAssets = new Set(questions.flatMap(collectQuestionAssets));
for (const assetUrl of referencedAssets) {
  const relative = assetUrl.replace(/^\/+/, '');
  const resolved = path.resolve(publicRoot, relative);
  if (!resolved.startsWith(`${path.resolve(publicRoot)}${path.sep}`)) {
    throw new Error(`题库资源路径越界：${assetUrl}`);
  }
  await stat(resolved).catch(() => {
    throw new Error(`题库引用的图片不存在：${assetUrl}`);
  });
}

console.log(`静态资源检查通过：${questions.length} 道题，${referencedAssets.size} 个题图引用。`);
