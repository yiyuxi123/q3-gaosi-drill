import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const androidRoot = path.join(projectRoot, 'android');
const gradleWrapper = path.join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const javaCandidates = [
  process.env.JAVA_HOME,
  process.platform === 'win32' ? 'E:\\as\\jbr' : undefined,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Android', 'Android Studio', 'jbr')
].filter(Boolean);

function javaMajor(javaHome) {
  const executable = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(executable)) return 0;
  const result = spawnSync(executable, ['-version'], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

const javaHome = javaCandidates.find(candidate => javaMajor(candidate) >= 21);
if (!javaHome) {
  throw new Error('Android 构建需要 JDK 21。请安装新版 Android Studio，或把 JAVA_HOME 指向 JDK 21。');
}
if (!existsSync(gradleWrapper)) throw new Error(`未找到 Gradle Wrapper：${gradleWrapper}`);

console.log(`使用 JDK ${javaMajor(javaHome)} 构建 Android APK。`);
const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : gradleWrapper;
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'gradlew.bat assembleDebug']
  : ['assembleDebug'];
const result = spawnSync(command, args, {
  cwd: androidRoot,
  env: { ...process.env, JAVA_HOME: javaHome },
  encoding: 'utf8',
  stdio: 'inherit'
});
if (result.status !== 0) process.exit(result.status ?? 1);
