import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const distRoot = path.join(projectRoot, 'dist');

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

async function readRequiredConfiguration() {
  const source = await readFile(path.join(projectRoot, '.env.local'), 'utf8');
  const requiredKeys = ['NUTSTORE_USERNAME', 'NUTSTORE_PASSWORD', 'OPENCODE_API_KEY'];
  return requiredKeys.map(key => {
    const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, 'm'));
    const value = match ? parseEnvValue(match[1]) : '';
    if (value.length < 6) throw new Error(`内部构建缺少有效的 ${key}`);
    return { key, value };
  });
}

async function collectTextFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(fullPath));
    else if (/\.(?:css|html|js|json|mjs|svg|txt)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const requiredConfiguration = await readRequiredConfiguration();
const textFiles = await collectTextFiles(distRoot);
const contents = await Promise.all(textFiles.map(file => readFile(file, 'utf8')));
for (const item of requiredConfiguration) {
  if (!contents.some(content => content.includes(item.value))) {
    throw new Error(`内部构建未嵌入 ${item.key}`);
  }
}

console.log(`内部构建检查通过：三项运行配置均已嵌入，检查 ${textFiles.length} 个文本资源。`);
