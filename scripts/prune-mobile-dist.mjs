import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const distRoot = path.join(projectRoot, 'dist');
const removablePaths = [
  'audit_crops',
  'debug_ans',
  'debug_pages',
  'sample',
  'test_screenshots',
  'bank/pages',
  'bank/slices',
  'bank/crop_audit.html',
  'bank/audit_10_samples.html',
  'bank/audit_sample_crops.html'
];

for (const relative of removablePaths) {
  await rm(path.join(distRoot, relative), { recursive: true, force: true });
}

async function removeNestedPackages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeNestedPackages(fullPath);
    else if (entry.isFile() && /\.(?:apk|aab)$/i.test(entry.name)) await rm(fullPath, { force: true });
  }
}

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(fullPath) : (await stat(fullPath)).size;
  }
  return total;
}

await removeNestedPackages(distRoot);
const sizeMiB = (await directoryBytes(distRoot) / 1024 / 1024).toFixed(1);
console.log(`移动端资源已裁剪，dist 约 ${sizeMiB} MiB。`);
