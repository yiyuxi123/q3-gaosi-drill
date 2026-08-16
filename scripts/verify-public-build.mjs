import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const distRoot = path.join(projectRoot, 'dist');
const envPath = path.join(projectRoot, '.env.local');

async function readPrivateValues() {
  try {
    const source = await readFile(envPath, 'utf8');
    return source
      .split(/\r?\n/)
      .map(line => line.match(/^\s*(?:OPENCODE_API_KEY|NUTSTORE_USERNAME|NUTSTORE_PASSWORD)\s*=\s*(.*)\s*$/)?.[1]?.trim())
      .map(value => value && /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value)
      .filter(value => typeof value === 'string' && value.length >= 6);
  } catch {
    return [];
  }
}

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(fullPath));
    else if (/\.(?:css|html|js|json|mjs|svg|txt)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const privateValues = await readPrivateValues();
const textFiles = await collectTextFiles(distRoot);
for (const file of textFiles) {
  const content = await readFile(file, 'utf8');
  if (privateValues.some(value => content.includes(value))) {
    throw new Error(`公开发布检查失败：${path.relative(projectRoot, file)} 含私人配置`);
  }
}

console.log(`公开发布检查通过：${textFiles.length} 个文本资源未包含本机私人配置。`);
