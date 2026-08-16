import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const secretKeys = ['NUTSTORE_USERNAME', 'NUTSTORE_PASSWORD', 'OPENCODE_API_KEY'];

function envValue(raw = '') {
  const value = raw.trim();
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function git(args, options = {}) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

const source = await readFile(path.join(root, '.env.local'), 'utf8');
const secrets = secretKeys.map(key => {
  const value = envValue(source.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, 'm'))?.[1]);
  if (value.length < 6) throw new Error(`无法审计：${key} 未配置或过短`);
  return { key, value };
});

const auditRef = process.env.PUBLIC_AUDIT_REF || 'HEAD';
const revisions = git(['rev-list', auditRef]);
if (revisions.status !== 0) throw new Error('无法读取 Git 历史');
const commits = revisions.stdout.split(/\r?\n/).filter(Boolean);

for (const { key, value } of secrets) {
  const staged = git(['grep', '--cached', '-I', '-l', '-F', '--', value]);
  if (staged.status === 0) throw new Error(`暂存区包含真实 ${key}`);
  if (staged.status !== 1) throw new Error(`暂存区 ${key} 审计失败`);

  for (const commit of commits) {
    const historical = git(['grep', '-I', '-l', '-F', '--', value, commit]);
    if (historical.status === 0) throw new Error(`Git 历史包含真实 ${key}（提交 ${commit.slice(0, 12)}）`);
    if (historical.status !== 1) throw new Error(`Git 历史 ${key} 审计失败`);
  }
}

console.log(JSON.stringify({ ref: auditRef, commits: commits.length, checked: secretKeys, safe: true }));
