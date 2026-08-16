import { ZipArchive } from 'archiver';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { x as extractTar } from 'tar';

const NODE_VERSION = 'v24.19.0';
const projectRoot = process.cwd();
const cacheRoot = path.join(projectRoot, 'tmp', 'node-macos-runtime', NODE_VERSION);
const outputRoot = path.join(projectRoot, 'release-internal-macos');
const distRoot = path.join(projectRoot, 'dist');
const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;
const rootFolder = 'Q3考高斯刷题';

function assertInside(target, parent) {
  const resolved = path.resolve(target);
  const allowed = `${path.resolve(parent)}${path.sep}`;
  if (!resolved.startsWith(allowed)) throw new Error(`目标路径超出允许范围：${resolved}`);
}

async function sha256(target) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(target);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`下载失败：${url}（HTTP ${response.status}）`);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    Readable.fromWeb(response.body).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
  });
}

async function ensureArchive(filename, expectedHash) {
  const target = path.join(cacheRoot, filename);
  try {
    if (await sha256(target) === expectedHash) return target;
  } catch {
    // Missing or incomplete cache entries are downloaded again.
  }
  await download(`${baseUrl}/${filename}`, target);
  const actualHash = await sha256(target);
  if (actualHash !== expectedHash) throw new Error(`Node.js 官方归档校验失败：${filename}`);
  return target;
}

async function createZip({ architecture, nodeBinary, licenseFile }) {
  const output = path.join(outputRoot, `Q3考高斯刷题_1.0.0_macOS内部免安装版_${architecture}.zip`);
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(output);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    stream.on('close', resolve);
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    archive.file(path.join(projectRoot, 'release', 'mac', '启动Q3刷题.command'), {
      name: `${rootFolder}/启动Q3刷题.command`,
      mode: 0o755
    });
    archive.file(path.join(projectRoot, 'release', 'mac', 'Mac使用说明.md'), {
      name: `${rootFolder}/Mac使用说明.md`,
      mode: 0o644
    });
    archive.file(path.join(projectRoot, 'release', 'mac', 'Node运行时来源与许可.md'), {
      name: `${rootFolder}/Node运行时来源与许可.md`,
      mode: 0o644
    });
    archive.file(path.join(projectRoot, 'release', 'web', 'server.cjs'), {
      name: `${rootFolder}/server.cjs`,
      mode: 0o644
    });
    archive.file(nodeBinary, { name: `${rootFolder}/runtime/node`, mode: 0o755 });
    archive.file(licenseFile, { name: `${rootFolder}/runtime/LICENSE`, mode: 0o644 });
    archive.directory(distRoot, `${rootFolder}/www`);
    archive.finalize();
  });
  const size = (await stat(output)).size;
  if (size < 50_000_000) throw new Error(`Mac ${architecture} 包体积异常：${size}`);
  return { output, size, sha256: await sha256(output) };
}

await mkdir(cacheRoot, { recursive: true });
assertInside(outputRoot, projectRoot);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const bank = JSON.parse(await readFile(path.join(distRoot, 'bank', 'questions.json'), 'utf8'));
if (!Array.isArray(bank) || bank.length !== 479) throw new Error('Mac 发布资源未包含完整 479 道题库');

const checksumsPath = path.join(cacheRoot, 'SHASUMS256.txt');
await download(`${baseUrl}/SHASUMS256.txt`, checksumsPath);
const checksumSource = await readFile(checksumsPath, 'utf8');
const results = [];
for (const architecture of ['arm64', 'x64']) {
  const filename = `node-${NODE_VERSION}-darwin-${architecture}.tar.gz`;
  const checksumMatch = checksumSource.match(new RegExp(`^([a-f0-9]{64})\\s+${filename.replaceAll('.', '\\.')}\\s*$`, 'm'));
  if (!checksumMatch) throw new Error(`官方校验清单缺少：${filename}`);
  const archive = await ensureArchive(filename, checksumMatch[1]);
  const extractRoot = path.join(cacheRoot, `extract-${architecture}`);
  assertInside(extractRoot, cacheRoot);
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  const topLevel = `node-${NODE_VERSION}-darwin-${architecture}`;
  await extractTar({
    file: archive,
    cwd: extractRoot,
    strict: true,
    filter: entry => entry === `${topLevel}/bin/node` || entry === `${topLevel}/LICENSE`
  });
  results.push(await createZip({
    architecture,
    nodeBinary: path.join(extractRoot, topLevel, 'bin', 'node'),
    licenseFile: path.join(extractRoot, topLevel, 'LICENSE')
  }));
}

console.log(JSON.stringify({ nodeVersion: NODE_VERSION, questions: bank.length, packages: results }));
