import { ZipArchive } from 'archiver';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const outputBase = path.join(projectRoot, 'output', 'release');
const releaseName = 'Q3考高斯刷题_v1.0.0_内部发布材料_最终版';
const releaseRoot = path.join(outputBase, releaseName);
const webStaging = path.join(outputBase, '.web-staging-v1.0.0');

function assertGeneratedPath(target) {
  const resolved = path.resolve(target);
  const allowed = `${path.resolve(outputBase)}${path.sep}`;
  if (!resolved.startsWith(allowed)) throw new Error(`拒绝修改发布输出目录以外的路径：${resolved}`);
}

async function resetGeneratedDirectory(target) {
  assertGeneratedPath(target);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function requireFile(target) {
  const info = await stat(target);
  if (!info.isFile() || info.size === 0) throw new Error(`发布文件无效：${target}`);
}

async function zipDirectory(source, output) {
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(output);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    stream.on('close', resolve);
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    archive.directory(source, false);
    archive.finalize();
  });
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
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

await mkdir(outputBase, { recursive: true });
await resetGeneratedDirectory(releaseRoot);
await resetGeneratedDirectory(webStaging);

const folders = {
  windows: path.join(releaseRoot, '01_Windows桌面端'),
  mac: path.join(releaseRoot, '02_macOS免安装版'),
  android: path.join(releaseRoot, '03_Android安卓端'),
  web: path.join(releaseRoot, '04_网页部署'),
  ppt: path.join(releaseRoot, '05_项目介绍PPT'),
  screenshots: path.join(releaseRoot, '06_功能截图'),
  docs: path.join(releaseRoot, '07_说明文档')
};
await Promise.all(Object.values(folders).map(directory => mkdir(directory, { recursive: true })));

const copies = [
  ['release-internal-desktop/Q3考高斯刷题_1.0.0_Windows安装版_x64.exe', '01_Windows桌面端/Q3考高斯刷题_1.0.0_Windows内部安装版_x64.exe'],
  ['release-internal-desktop/Q3考高斯刷题_1.0.0_Windows免安装版_x64.exe', '01_Windows桌面端/Q3考高斯刷题_1.0.0_Windows内部免安装版_x64.exe'],
  ['release-internal-macos/Q3考高斯刷题_1.0.0_macOS内部免安装版_arm64.zip', '02_macOS免安装版/Q3考高斯刷题_1.0.0_macOS内部免安装版_arm64.zip'],
  ['release-internal-macos/Q3考高斯刷题_1.0.0_macOS内部免安装版_x64.zip', '02_macOS免安装版/Q3考高斯刷题_1.0.0_macOS内部免安装版_x64.zip'],
  ['android/app/build/outputs/apk/debug/app-debug.apk', '03_Android安卓端/Q3考高斯刷题_1.0.0_Android内部版.apk'],
  ['output/pptx/项目功能介绍.pptx', '05_项目介绍PPT/项目功能介绍.pptx'],
  ['output/pptx/项目迭代过程介绍.pptx', '05_项目介绍PPT/项目迭代过程介绍.pptx']
];
for (const [source, destination] of copies) {
  const sourcePath = path.join(projectRoot, source);
  await requireFile(sourcePath);
  await copyFile(sourcePath, path.join(releaseRoot, destination));
}

const screenshots = [
  ['home-current.png', '01_首页总览.png'],
  ['mobile-home.png', '02_手机端首页.png'],
  ['card-drill.png', '03_卡片刷题.png'],
  ['card-answer.png', '04_答案与解析.png'],
  ['random-drill-options.png', '05_随机模式与范围.png'],
  ['ai-tutor-full.png', '06_AI分步精讲.png'],
  ['quick-ocr.png', '07_拍照识别.png'],
  ['error-review-all.png', '08_错题复习.png'],
  ['paper-generator.png', '09_智能组卷.png'],
  ['paper-preview.png', '10_试卷预览.png'],
  ['paper-share.png', '11_打印与分享.png'],
  ['report.png', '12_学情战报.png'],
  ['leaderboard.png', '13_团队排行榜.png'],
  ['admin-members.png', '14_成员管理.png']
];
for (const [source, destination] of screenshots) {
  const sourcePath = path.join(projectRoot, 'tmp', 'ppt-assets', source);
  await requireFile(sourcePath);
  await copyFile(sourcePath, path.join(folders.screenshots, destination));
}

await cp(path.join(projectRoot, 'release', 'docs'), folders.docs, { recursive: true });
await copyFile(path.join(projectRoot, 'release', 'docs', '00_先看这里.md'), path.join(releaseRoot, '00_先看这里.md'));

await cp(path.join(projectRoot, 'release', 'web'), webStaging, { recursive: true });
await cp(path.join(projectRoot, 'dist'), path.join(webStaging, 'www'), { recursive: true });
const webZip = path.join(folders.web, 'Q3考高斯刷题_1.0.0_内部网页部署包.zip');
await zipDirectory(webStaging, webZip);
await requireFile(webZip);
assertGeneratedPath(webStaging);
await rm(webStaging, { recursive: true, force: true });

const files = (await listFiles(releaseRoot))
  .filter(file => path.basename(file) !== 'SHA256校验码.txt')
  .sort((left, right) => left.localeCompare(right, 'zh-CN'));
const checksumLines = [];
for (const file of files) {
  checksumLines.push(`${await sha256(file)}  ${path.relative(releaseRoot, file).replaceAll('\\', '/')}`);
}
await writeFile(path.join(releaseRoot, 'SHA256校验码.txt'), `${checksumLines.join('\r\n')}\r\n`, 'utf8');

const totalBytes = (await Promise.all((await listFiles(releaseRoot)).map(async file => (await stat(file)).size)))
  .reduce((sum, size) => sum + size, 0);
console.log(JSON.stringify({ releaseRoot, files: (await listFiles(releaseRoot)).length, totalBytes }));
