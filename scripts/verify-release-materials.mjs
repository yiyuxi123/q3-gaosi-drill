import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import extract from 'extract-zip';

const root = process.cwd();
const releaseRoot = path.join(root, 'output', 'release', 'Q3考高斯刷题_v1.0.0_内部发布材料_最终版');
const tempRoot = path.join(root, 'tmp', 'release-internal-verification');
const questionCount = 479;

function envValue(raw = '') {
  const value = raw.trim();
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

async function configuration() {
  const source = await readFile(path.join(root, '.env.local'), 'utf8');
  return ['NUTSTORE_USERNAME', 'NUTSTORE_PASSWORD', 'OPENCODE_API_KEY'].map(key => {
    const value = envValue(source.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, 'm'))?.[1]);
    if (value.length < 6) throw new Error(`内部发布审计缺少有效的 ${key}`);
    return { key, value };
  });
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

async function contains(target, value) {
  const needle = Buffer.from(value);
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(target)) {
    const buffer = Buffer.concat([carry, chunk]);
    if (buffer.includes(needle)) return true;
    carry = buffer.subarray(Math.max(0, buffer.length - needle.length + 1));
  }
  return false;
}

async function embeds(directory, config, label) {
  const files = (await filesUnder(directory)).filter(file => /\.(?:css|html|js|json|mjs|svg|txt)$/i.test(file));
  for (const item of config) {
    let found = false;
    for (const file of files) if (await contains(file, item.value)) { found = true; break; }
    if (!found) throw new Error(`${label} 未内嵌 ${item.key}`);
  }
}

async function bank(directory, relative, label) {
  const data = JSON.parse(await readFile(path.join(directory, ...relative.split('/')), 'utf8'));
  if (!Array.isArray(data) || data.length !== questionCount) throw new Error(`${label} 题库数量异常`);
}

function safeTemp(target) {
  if (!path.resolve(target).startsWith(`${path.resolve(root, 'tmp')}${path.sep}`)) throw new Error('验证目录越界');
}

async function reset(target) {
  safeTemp(target);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function sha256(target) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(target);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function webSmoke(directory) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: directory, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`网页服务提前退出：${child.exitCode}`);
      try {
        const home = await fetch(`http://127.0.0.1:${port}/`);
        const response = await fetch(`http://127.0.0.1:${port}/bank/questions.json`);
        const questions = await response.json();
        if (home.status === 200 && response.status === 200 && questions.length === questionCount) {
          return { home: 200, bank: 200, questions: questions.length };
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('网页部署包启动自检超时');
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
}

async function inspectMac(zip, architecture, config) {
  const target = path.join(tempRoot, `mac-${architecture}`);
  await reset(target);
  await extract(zip, { dir: target });
  const app = path.join(target, 'Q3考高斯刷题');
  await bank(app, 'www/bank/questions.json', `macOS ${architecture}`);
  await embeds(path.join(app, 'www'), config, `macOS ${architecture}`);
  const header = (await readFile(path.join(app, 'runtime', 'node'))).subarray(0, 8);
  const cpu = architecture === 'arm64' ? 0x0100000c : 0x01000007;
  if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu) throw new Error(`macOS ${architecture} 运行时架构错误`);
  for (const item of ['启动Q3刷题.command', 'server.cjs', 'runtime/LICENSE']) {
    if (!(await stat(path.join(app, ...item.split('/')))).isFile()) throw new Error(`macOS ${architecture} 缺少 ${item}`);
  }
}

const config = await configuration();
const releaseFiles = await filesUnder(releaseRoot);
if (releaseFiles.length !== 33) throw new Error(`发布文件数量异常：${releaseFiles.length}`);
const required = [
  'Q3考高斯刷题_1.0.0_Windows内部安装版_x64.exe', 'Q3考高斯刷题_1.0.0_Windows内部免安装版_x64.exe',
  'Q3考高斯刷题_1.0.0_macOS内部免安装版_arm64.zip', 'Q3考高斯刷题_1.0.0_macOS内部免安装版_x64.zip',
  'Q3考高斯刷题_1.0.0_Android内部版.apk', 'Q3考高斯刷题_1.0.0_内部网页部署包.zip',
  '项目功能介绍.pptx', '项目迭代过程介绍.pptx', '08_各平台使用指南.png', '09_各平台使用指南_A4.pdf', 'SHA256校验码.txt'
];
for (const name of required) if (!releaseFiles.some(file => path.basename(file) === name)) throw new Error(`缺少发布文件：${name}`);
if (releaseFiles.some(file => /(?:^|[\\/])(?:node_modules|debug_pages|debug_ans|audit_crops|\.env)(?:[\\/]|$)/i.test(file))) throw new Error('发布目录包含禁止资源');

const checksumFile = path.join(releaseRoot, 'SHA256校验码.txt');
const checksumLines = (await readFile(checksumFile, 'utf8')).trim().split(/\r?\n/);
if (checksumLines.length !== releaseFiles.length - 1) throw new Error('SHA-256 清单数量不匹配');
for (const line of checksumLines) {
  const match = line.match(/^([A-F0-9]{64})  (.+)$/);
  if (!match) throw new Error('SHA-256 清单格式错误');
  if (await sha256(path.join(releaseRoot, ...match[2].split('/'))) !== match[1]) throw new Error(`SHA-256 不匹配：${match[2]}`);
}

const gitResult = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer' });
if (gitResult.status !== 0) throw new Error('无法读取 Git 跟踪清单');
const tracked = gitResult.stdout.toString('utf8').split('\0').filter(Boolean).map(file => path.join(root, file));
for (const item of config) for (const file of tracked) if (await contains(file, item.value)) throw new Error(`Git 文件包含 ${item.key}：${path.relative(root, file)}`);

await reset(tempRoot);
const windows = path.join(root, 'release-internal-desktop', 'win-unpacked', 'resources', 'app-dist');
await bank(windows, 'bank/questions.json', 'Windows');
await embeds(windows, config, 'Windows');

const webZip = releaseFiles.find(file => file.endsWith('_内部网页部署包.zip'));
const web = path.join(tempRoot, 'web');
await reset(web);
await extract(webZip, { dir: web });
await bank(web, 'www/bank/questions.json', '网页部署包');
await embeds(path.join(web, 'www'), config, '网页部署包');
for (const item of ['启动网页服务.cmd', '停止网页服务.cmd', 'start-web.cmd', 'stop-web.cmd', 'tools/start-web.ps1', 'tools/stop-web.ps1']) if (!(await stat(path.join(web, ...item.split('/')))).isFile()) throw new Error(`网页包缺少 ${item}`);
const launcher = await readFile(path.join(web, 'tools', 'start-web.ps1'), 'utf8');
for (const marker of ['Get-Command node.exe', 'nodejs.org/dist/', 'Get-FileHash', 'CreateShortcut', 'Start-Process $WebUrl']) if (!launcher.includes(marker)) throw new Error(`网页启动脚本缺少 ${marker}`);
const webResult = await webSmoke(web);

await inspectMac(releaseFiles.find(file => file.endsWith('_arm64.zip')), 'arm64', config);
await inspectMac(releaseFiles.find(file => file.includes('macOS') && file.endsWith('_x64.zip')), 'x64', config);
const android = path.join(tempRoot, 'android');
await reset(android);
await extract(releaseFiles.find(file => file.endsWith('_Android内部版.apk')), { dir: android });
await bank(path.join(android, 'assets', 'public'), 'bank/questions.json', 'Android');
await embeds(path.join(android, 'assets', 'public'), config, 'Android');

const totalBytes = (await Promise.all(releaseFiles.map(async file => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
await rm(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify({ files: 33, checksums: checksumLines.length, totalBytes, questions: questionCount, embedded: config.map(item => item.key), web: webResult, platforms: ['Windows', 'macOS arm64', 'macOS x64', 'Android', 'Web'] }));
