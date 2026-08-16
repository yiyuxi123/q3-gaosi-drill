const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const root = path.join(__dirname, 'www');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 5173;
const proxyRoutes = [
  { prefix: '/dav', target: 'https://dav.jianguoyun.com' },
  { prefix: '/zen-api', target: 'https://opencode.ai' }
];
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
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

function resolveStaticPath(requestUrl) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestUrl.split('?')[0]);
  } catch {
    return undefined;
  }
  const candidate = path.resolve(root, decoded.replace(/^\/+/, '') || 'index.html');
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : undefined;
}

function sendStatic(request, response) {
  const requested = resolveStaticPath(request.url || '/');
  if (!requested) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('请求路径无效');
    return;
  }
  let filePath = requested;
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(root, 'index.html');
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('文件不存在');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
}

function proxyRequest(request, response, route) {
  const upstreamUrl = new URL((request.url || '/').slice(route.prefix.length) || '/', route.target);
  const headers = { ...request.headers, host: upstreamUrl.host };
  delete headers.connection;
  delete headers['content-length'];
  delete headers.origin;
  delete headers.referer;
  const upstream = https.request(upstreamUrl, { method: request.method, headers }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers };
    delete responseHeaders.connection;
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(45_000, () => upstream.destroy(new Error('上游服务响应超时')));
  upstream.on('error', error => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`网页代理暂时无法连接上游服务：${error.message}`);
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const route = proxyRoutes.find(item => (request.url || '').startsWith(item.prefix));
  if (route) proxyRequest(request, response, route);
  else sendStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`Q3考高斯刷题已启动：http://${host}:${port}/`);
  console.log('按 Ctrl+C 停止服务。');
});

server.on('error', error => {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
