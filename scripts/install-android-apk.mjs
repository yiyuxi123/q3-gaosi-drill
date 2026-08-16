import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const apkPath = path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const sdkRoots = [
  process.env.ANDROID_SDK_ROOT,
  process.env.ANDROID_HOME,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
].filter(Boolean);
const adbPath = sdkRoots
  .map(root => path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
  .find(existsSync);

if (!adbPath) throw new Error('未找到 Android adb，请先安装 Android SDK Platform Tools。');
if (!existsSync(apkPath)) throw new Error(`未找到待安装 APK：${apkPath}`);

const devicesResult = spawnSync(adbPath, ['devices'], { encoding: 'utf8' });
if (devicesResult.status !== 0) throw new Error(devicesResult.stderr || '无法读取已连接手机');
const devices = devicesResult.stdout
  .split(/\r?\n/)
  .slice(1)
  .map(line => line.trim().split(/\s+/))
  .filter(parts => parts.length >= 2 && parts[1] === 'device')
  .map(parts => parts[0]);
if (devices.length !== 1) {
  throw new Error(devices.length === 0
    ? '没有检测到已授权的 Android 手机，请连接数据线并允许 USB 调试。'
    : '检测到多台 Android 设备，请只保留一台后重试。');
}

const installResult = spawnSync(adbPath, ['-s', devices[0], 'install', '-r', apkPath], {
  encoding: 'utf8',
  stdio: 'inherit'
});
if (installResult.status !== 0) process.exit(installResult.status ?? 1);
console.log('手机安装完成。');
