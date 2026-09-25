import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOCK_STORE_DATA = '1';
const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owlaso-sec-'));
process.env.RANK_HISTORY_DIR = historyDir;

const { createServer, isAllowedHost, isCrossSiteRequest } = await import('../src/server.js');

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
test.after(() => {
  server.close();
  fs.rmSync(historyDir, { recursive: true, force: true });
});

// Raw request so we can send headers fetch() refuses to set (Host, Sec-Fetch-*).
function request(pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('malformed Host header is rejected without crashing the server', async () => {
  const bad = await request('/api/health', { headers: { host: 'a b' } });
  assert.equal(bad.status, 403);
  const ok = await request('/api/health');
  assert.equal(ok.status, 200, 'server must still be alive');
});

test('DNS-rebinding hostnames are rejected, loopback and IP literals allowed', async () => {
  assert.equal((await request('/api/health', { headers: { host: `attacker.example:${port}` } })).status, 403);
  assert.equal(isAllowedHost('localhost:3000'), true);
  assert.equal(isAllowedHost('127.0.0.1:3000'), true);
  assert.equal(isAllowedHost('[::1]:3000'), true);
  assert.equal(isAllowedHost('evil.localhost.example'), false);
  assert.equal(isAllowedHost(''), false);
});

test('cross-site browser requests to the API are refused (CSRF)', async () => {
  assert.equal((await request('/api/health', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { origin: 'null' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await request('/api/health', { headers: { 'sec-fetch-site': 'none' } })).status, 200);
  assert.equal(isCrossSiteRequest({ host: 'localhost:3000', origin: 'http://localhost:3000' }), false);
});

test('only GET/HEAD are allowed', async () => {
  const res = await request('/api/health', { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
});

test('responses carry security headers', async () => {
  for (const pathname of ['/', '/api/health']) {
    const res = await request(pathname);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
  }
});

test('static files: traversal blocked, missing assets 404, app routes fall back to index', async () => {
  const traversal = await request('/..%2f..%2fpackage.json');
  assert.notEqual(traversal.status, 200);
  assert.doesNotMatch(traversal.body, /"devDependencies"/);
  assert.equal((await request('/nope.js')).status, 404);
  const spa = await request('/some/app/route');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /OwlASO/);
  const nested = await request('/lib/csv.js');
  assert.equal(nested.status, 200);
  assert.match(nested.headers['content-type'], /javascript/);
});

test('rank history cannot be written outside its directory (store/keyword path traversal)', async () => {
  const escaped = path.join(historyDir, '..', 'escaped-proof.json');
  const res = await request(`/api/asosearch?q=poc&store=${encodeURIComponent('x/../../escaped-proof')}`);
  assert.equal(res.status, 200);
  await request(`/api/asosearch?q=${encodeURIComponent('../../../escaped-proof')}`);
  assert.equal(fs.existsSync(escaped), false);
  for (const file of fs.readdirSync(historyDir)) {
    assert.match(file, /^[a-z0-9-]+\.[0-9a-f]{20}\.json$/, `unexpected history file name ${file}`);
  }
});
