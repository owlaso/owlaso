import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchApps, fetchReviews, fetchReviewsMulti, searchGoogleApps, searchAppleApps, fetchGoogleAppDetails, fetchAppleAppDetails } from './providers.js';
import { analyzeKeyword } from './aso.js';
import { getRankHistory, formatHistoryChart } from './aso.js';
import { toCsv } from './filters.js';

const version = '1.5.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const port = Number.parseInt(process.env.PORT || '3000', 10);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        mock: process.env.MOCK_STORE_DATA === '1',
        time: new Date().toISOString(),
        node: process.version
      });
    }

    if (url.pathname === '/api/search') {
      const rows = await searchApps(queryObject(url));
      return json(res, 200, { results: rows });
    }

    if (url.pathname === '/api/asosearch') {
      const q = queryObject(url);
      const data = await analyzeKeyword({
        keyword: q.q,
        store: q.store,
        country: q.country,
        lang: q.lang,
        limit: Number(q.limit) || 12,
        fbToken: q.fbToken || null,
      });
      return json(res, 200, data);
    }

    if (url.pathname === '/api/asosearch/history') {
      const q = queryObject(url);
      const snapshots = getRankHistory(q.q, q.store || 'both');
      return json(res, 200, { keyword: q.q, store: q.store || 'both', chart: formatHistoryChart(snapshots) });
    }

    if (url.pathname === '/api/app-details') {
      const q = queryObject(url);
      const primaryPlat = q.platform === 'apple' ? 'apple' : 'google';
      const primary = await (primaryPlat === 'apple'
        ? fetchAppleAppDetails({ appId: q.appId, country: q.country })
        : fetchGoogleAppDetails({ appId: q.appId, country: q.country, lang: q.lang }));

      let counterpart = null;
      if (q.store === 'both' && primary.title) {
        const otherPlat = primaryPlat === 'apple' ? 'google' : 'apple';
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        try {
          const rows = otherPlat === 'google'
            ? await searchGoogleApps({ q: primary.title, country: q.country, lang: q.lang || 'en', limit: 5 })
            : await searchAppleApps({ q: primary.title, country: q.country, lang: q.lang || 'en', limit: 5 });
          const match = rows.find((r) => norm(r.title) === norm(primary.title)) || rows[0];
          if (match) {
            counterpart = otherPlat === 'apple'
              ? await fetchAppleAppDetails({ appId: match.appId, country: q.country })
              : await fetchGoogleAppDetails({ appId: match.appId, country: q.country, lang: q.lang });
          }
        } catch { /* best-effort */ }
      }

      return json(res, 200, { primary, counterpart });
    }

    if (url.pathname === '/api/reviews') {
      const q = queryObject(url);
      const payload = q.multi === '1' ? await fetchReviewsMulti(q) : await fetchReviews(q);
      return json(res, 200, payload);
    }

    if (url.pathname === '/api/reviews.full') {
      const q = queryObject(url);
      const { fetchAllReviews } = await import('./providers.js');
      const payload = await fetchAllReviews(q);
      return json(res, 200, payload);
    }

    // NDJSON stream: one line per completed store×lang group, then a final
    // "done" line. The client renders groups as they arrive; disconnect aborts.
    if (url.pathname === '/api/reviews.full.stream') {
      const q = queryObject(url);
      const { fetchAllReviewsStream } = await import('./providers.js');
      const controller = new AbortController();
      let clientGone = false;

      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no'
      });
      const send = (obj) => {
        if (clientGone) return;
        try { res.write(`${JSON.stringify(obj)}\n`); } catch { clientGone = true; }
      };
      res.on('close', () => {
        if (!res.writableEnded) {
          clientGone = true;
          controller.abort();
        }
      });

      try {
        const summary = await fetchAllReviewsStream(q, {
          signal: controller.signal,
          onGroup: (group) => send({ type: 'group', group })
        });
        if (!clientGone) send({ type: 'done', ...summary });
      } catch (error) {
        if (!clientGone) send({ type: 'error', error: error.message || String(error) });
      }
      res.end();
      return;
    }

    if (url.pathname === '/api/reviews.csv') {
      const payload = await fetchReviews(queryObject(url));
      return text(res, 200, toCsv(payload.reviews), 'text/csv; charset=utf-8');
    }

    return json(res, 404, { error: 'API route not found.' });
  } catch (error) {
    return json(res, 500, { error: error.message || String(error) });
  }
}

function resolvePublicPath(urlPathname) {
  let decodedPathname = '/';
  try {
    decodedPathname = decodeURIComponent(urlPathname || '/');
  } catch {
    decodedPathname = '/';
  }

  // Always handle URL paths as POSIX paths first. On Windows, path.normalize('/') becomes
  // a directory separator, which can accidentally make createReadStream read a folder.
  const posixPath = path.posix.normalize(decodedPathname).replace(/^\/+/u, '');
  const requested = posixPath === '' ? 'index.html' : posixPath;
  const absolute = path.resolve(publicDir, requested);

  if (!absolute.startsWith(publicDir + path.sep) && absolute !== publicDir) return null;
  return absolute;
}

async function serveStatic(req, res, url) {
  const preferredPath = resolvePublicPath(url.pathname);
  if (!preferredPath) return text(res, 403, 'Forbidden');

  let filePath = preferredPath;
  let fileStat = null;

  try {
    fileStat = await stat(filePath);
  } catch {
    filePath = path.join(publicDir, 'index.html');
    fileStat = await stat(filePath);
  }

  if (!fileStat.isFile()) {
    filePath = path.join(publicDir, 'index.html');
    fileStat = await stat(filePath);
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream' });

  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    if (!res.headersSent) return text(res, 500, error.message || 'Static file error');
    res.destroy(error);
  });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Store Review Filter App running on http://localhost:${port}`);
});
