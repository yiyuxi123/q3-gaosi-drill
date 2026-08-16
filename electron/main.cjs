const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const LOOPBACK_HOST = '127.0.0.1';
const STATIC_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-dist')
  : path.resolve(__dirname, '..', 'dist');
const PROXY_ROUTES = [
  { prefix: '/dav', target: 'https://dav.jianguoyun.com' },
  { prefix: '/zen-api', target: 'https://opencode.ai' }
];

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

let localServer;

function safeStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return undefined;
  }
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(STATIC_ROOT, relative || 'index.html');
  if (candidate !== STATIC_ROOT && !candidate.startsWith(`${STATIC_ROOT}${path.sep}`)) return undefined;
  return candidate;
}

function sendStatic(request, response) {
  const requestedPath = safeStaticPath(request.url || '/');
  if (!requestedPath) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('请求路径无效');
    return;
  }

  let filePath = requestedPath;
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // React uses client-side routes, so unknown paths return the application shell.
    filePath = path.join(STATIC_ROOT, 'index.html');
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('文件不存在');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
}

function proxyRequest(request, response, route) {
  const upstreamUrl = new URL((request.url || '/').slice(route.prefix.length) || '/', route.target);
  const headers = { ...request.headers, host: upstreamUrl.host };
  delete headers.connection;
  delete headers['content-length'];
  delete headers.origin;
  delete headers.referer;

  const upstream = https.request(upstreamUrl, {
    method: request.method,
    headers
  }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers };
    delete responseHeaders.connection;
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(45_000, () => upstream.destroy(new Error('上游服务响应超时')));
  upstream.on('error', error => {
    if (!response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end(`桌面端代理暂时无法连接上游服务：${error.message}`);
  });
  request.pipe(upstream);
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((request, response) => {
      const route = PROXY_ROUTES.find(item => (request.url || '').startsWith(item.prefix));
      if (route) proxyRequest(request, response, route);
      else sendStatic(request, response);
    });
    localServer.once('error', reject);
    localServer.listen(0, LOOPBACK_HOST, () => {
      const address = localServer.address();
      resolve(`http://${LOOPBACK_HOST}:${address.port}`);
    });
  });
}

async function createMainWindow() {
  const baseUrl = await startLocalServer();
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Q3考高斯刷题',
    ...(!app.isPackaged ? { icon: path.join(__dirname, '..', 'build', 'icon.ico') } : {}),
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(baseUrl);
}

async function runSmokeTest() {
  const baseUrl = await startLocalServer();
  const [homeResponse, bankResponse] = await Promise.all([
    fetch(baseUrl),
    fetch(`${baseUrl}/bank/questions.json`)
  ]);
  const questions = await bankResponse.json();
  if (!homeResponse.ok || !bankResponse.ok || !Array.isArray(questions) || questions.length !== 479) {
    throw new Error('桌面端发布自检未通过');
  }
  console.log(JSON.stringify({
    homeStatus: homeResponse.status,
    bankStatus: bankResponse.status,
    questions: questions.length
  }));
  await new Promise(resolve => localServer.close(resolve));
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const currentWindow = BrowserWindow.getAllWindows()[0];
    if (!currentWindow) return;
    if (currentWindow.isMinimized()) currentWindow.restore();
    currentWindow.focus();
  });

  const startup = process.argv.includes('--smoke-test') ? runSmokeTest : createMainWindow;
  app.whenReady().then(startup).catch(error => {
    console.error(error);
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localServer?.close();
});
