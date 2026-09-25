import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest, APP_VERSION } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const port = Number.parseInt(process.env.PORT || '3000', 10);
// Loopback only by default: the API triggers outbound store traffic and writes history files.
const host = process.env.HOST || '127.0.0.1';

// Domain names allowed in the Host header. IP literals and "localhost" are always
// allowed; any other name is rejected so DNS-rebinding pages cannot reach the API.
const allowedHosts = new Set(['localhost', ...String(process.env.ALLOWED_HOSTS || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

function send(res, status, body, headers = {}) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'content-type': 'application/json; charset=utf-8' });
}

export function isAllowedHost(hostHeader) {
  const match = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::\d{1,5})?$/iu.exec(String(hostHeader || ''));
  if (!match) return false;
  const name = match[1].toLowerCase();
  const bare = name.startsWith('[') ? name.slice(1, -1) : name;
  return net.isIP(bare) !== 0 || allowedHosts.has(name);
}

// Blocks requests other websites make the browser send (<img src>, fetch, forms).
// Address-bar navigation (Sec-Fetch-Site: none), same-origin calls and non-browser
// clients (no Sec-Fetch-* / Origin headers) pass.
export function isCrossSiteRequest(headers) {
  const site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== headers.host;
  } catch {
    return true; // "null" and malformed origins
  }
}

function resolvePublicPath(urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname || '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // Handle URL paths as POSIX paths first. On Windows, path.normalize('/') becomes
  // a directory separator, which can accidentally make createReadStream read a folder.
  const posixPath = path.posix.normalize(decoded).replace(/^\/+/u, '');
  const absolute = path.resolve(publicDir, posixPath === '' ? 'index.html' : posixPath);
  if (!absolute.startsWith(publicDir + path.sep)) return null;
  return absolute;
}

async function serveStatic(req, res, url) {
  const requested = resolvePublicPath(url.pathname);
  if (!requested) return send(res, 403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' });

  let filePath = requested;
  let fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    // SPA fallback for app routes only; a missing asset is a real 404.
    if (path.extname(url.pathname)) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    filePath = path.join(publicDir, 'index.html');
    fileStat = await stat(filePath);
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': fileStat.size,
    'cache-control': 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(filePath);
  stream.on('error', (error) => res.destroy(error));
  stream.pipe(res);
}

async function serveApi(req, res, url) {
  const result = await handleApiRequest(url);
  if (!result.ndjson) {
    return send(res, result.status, result.body, { 'content-type': result.contentType, ...result.headers });
  }

  res.writeHead(result.status, {
    ...SECURITY_HEADERS,
    'content-type': result.contentType,
    'cache-control': 'no-store',
    'x-accel-buffering': 'no'
  });
  // A disconnecting client aborts the remaining background fetches.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  await result.ndjson((obj) => {
    if (!controller.signal.aborted) res.write(`${JSON.stringify(obj)}\n`);
  }, controller.signal);
  res.end();
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host)) return send(res, 403, 'Forbidden host', { 'content-type': 'text/plain; charset=utf-8' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      // Never build URLs from the Host header: a malformed one used to crash the process.
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (isCrossSiteRequest(req.headers)) return sendJson(res, 403, { error: 'Cross-site requests are not allowed.' });
        return await serveApi(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.destroy();
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Set PORT to another value, e.g. PORT=3001 npm start`
      : error);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shown = host === '127.0.0.1' || host === '::1' ? 'localhost' : host;
    console.log(`OwlASO ${APP_VERSION} running on http://${shown}:${port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
