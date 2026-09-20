const { app, BrowserWindow, protocol, net, shell, Menu, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let mainWindow = null;
const publicDir = path.resolve(__dirname, '..', 'public');

// ── Remove default menu (File/Edit/View/Window/Help) ───────────
Menu.setApplicationMenu(null);

// Force system theme following — auto-switches when OS theme changes.
nativeTheme.themeSource = 'system';

// Register a privileged custom scheme so the renderer can use fetch() against it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── Response Helpers ────────────────────────────────────────────
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function textResponse(status, body, contentType) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
}

// ── Static Path Resolution (traversal-safe) ─────────────────────
function resolvePublicPath(pathname) {
  let decoded = '/';
  try { decoded = decodeURIComponent(pathname || '/'); } catch { decoded = '/'; }
  const posix = path.posix.normalize(decoded).replace(/^\/+/u, '');
  const requested = posix === '' ? 'index.html' : posix;
  const absolute = path.resolve(publicDir, requested);
  if (!absolute.startsWith(publicDir + path.sep) && absolute !== publicDir) return null;
  return absolute;
}

// ── Theme IPC ───────────────────────────────────────────────────
function sendThemeToRenderer() {
  if (!mainWindow) return;
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow.webContents.send('theme-change', dark ? 'dark' : 'light');
}

// ── API Routing (runs entirely in the main process) ─────────────
async function handleApi(url) {
  const p = url.pathname;
  try {
    if (p === '/api/health') {
      return jsonResponse(200, {
        ok: true,
        mock: process.env.MOCK_STORE_DATA === '1',
        time: new Date().toISOString(),
        node: process.version,
      });
    }

    const query = Object.fromEntries(url.searchParams.entries());

    if (p === '/api/asosearch') {
      const { analyzeKeyword } = await import('../src/aso.js');
      const result = await analyzeKeyword({
        keyword: query.q || query.keyword,
        store: query.store || 'both',
        country: query.country || 'us',
        lang: query.lang || 'en',
        limit: Number.parseInt(query.limit, 10) || 12,
      });
      return jsonResponse(200, result);
    }

    if (p === '/api/app-details') {
      const { fetchGoogleAppDetails, fetchAppleAppDetails, searchGoogleApps, searchAppleApps } = await import('../src/providers.js');
      const platform = query.platform === 'apple' ? 'apple' : 'google';
      const appId = String(query.appId || '').trim();
      if (!appId) return jsonResponse(400, { error: 'appId is required.' });
      let primary;
      let counterpart = null;
      if (platform === 'apple' && /^\d+$/u.test(appId)) {
        primary = await fetchAppleAppDetails({ appId, country: query.country || 'us' });
      } else {
        primary = await fetchGoogleAppDetails({ appId, country: query.country || 'us', lang: query.lang || 'en' });
      }
      // Try to merge the same app from the other store (when title is known).
      if (primary && primary.title) {
        try {
          const rows = platform === 'apple'
            ? await searchGoogleApps({ q: primary.title, country: query.country || 'us', lang: query.lang || 'en', limit: 8 })
            : await searchAppleApps({ q: primary.title, country: query.country || 'us', lang: query.lang || 'en', limit: 8 });
          const key = primary.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = rows.map((r) => ({ r, k: String(r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '') }))
            .find(({ r, k }) => k === key || (k && k.includes(key)) || (key && k.includes(key)));
          if (match) {
            counterpart = platform === 'apple'
              ? await fetchGoogleAppDetails({ appId: match.r.appId, country: query.country || 'us', lang: query.lang || 'en' })
              : await fetchAppleAppDetails({ appId: match.r.appId, country: query.country || 'us' });
          }
        } catch { counterpart = null; }
      }
      return jsonResponse(200, { primary, counterpart, merged: !query.store || query.store === 'both' });
    }

    if (p === '/api/search') {
      const { searchApps } = await import('../src/providers.js');
      const rows = await searchApps(query);
      return jsonResponse(200, { results: rows });
    }

    if (p === '/api/reviews') {
      const { fetchReviews, fetchReviewsMulti } = await import('../src/providers.js');
      const multi = query.multi === '1' || query.provider === 'multi' ||
        query.languages === 'all' || String(query.lang || '') === 'all';
      const payload = multi
        ? await fetchReviewsMulti(query)
        : await fetchReviews(query);
      return jsonResponse(200, payload);
    }

    if (p === '/api/reviews.full') {
      const { fetchAllReviews } = await import('../src/providers.js');
      const payload = await fetchAllReviews(query);
      return jsonResponse(200, payload);
    }

    // NDJSON stream: one line per completed store×lang group, then a final
    // "done" line. The renderer renders groups as they arrive; aborting the
    // fetch cancels the stream and stops the background work.
    if (p === '/api/reviews.full.stream') {
      const { fetchAllReviewsStream } = await import('../src/providers.js');
      const controller = new AbortController();
      const encoder = new TextEncoder();
      let cancelled = false;

      const stream = new ReadableStream({
        start(streamCtrl) {
          const send = (obj) => {
            if (cancelled) return;
            try { streamCtrl.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`)); } catch { cancelled = true; }
          };
          fetchAllReviewsStream(query, {
            signal: controller.signal,
            onGroup: (group) => send({ type: 'group', group }),
          }).then((summary) => {
            if (!cancelled) send({ type: 'done', ...summary });
            try { streamCtrl.close(); } catch { /* already closed */ }
          }).catch((error) => {
            if (!cancelled) send({ type: 'error', error: error.message || String(error) });
            try { streamCtrl.close(); } catch { /* already closed */ }
          });
        },
        cancel() {
          cancelled = true;
          controller.abort();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (p === '/api/reviews.csv') {
      const { fetchReviews } = await import('../src/providers.js');
      const { toCsv } = await import('../src/filters.js');
      const payload = await fetchReviews(query);
      return textResponse(200, toCsv(payload.reviews), 'text/csv; charset=utf-8');
    }

    return jsonResponse(404, { error: 'API route not found.' });
  } catch (error) {
    return jsonResponse(500, { error: error.message || String(error) });
  }
}

// ── Protocol Handler ────────────────────────────────────────────
function registerProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) return handleApi(url);

    const filePath = resolvePublicPath(url.pathname);
    if (filePath && filePath !== publicDir) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return net.fetch(pathToFileURL(filePath).toString());
        }
      } catch { /* fall through to SPA fallback */ }
    }

    return net.fetch(pathToFileURL(path.join(publicDir, 'index.html')).toString());
  });
}

// ── Window ──────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'OwlASO',
    backgroundColor: '#f5f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL('app://app/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendThemeToRenderer();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    console.error(`[app] failed to load: ${code} ${desc} (${validatedURL})`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  registerProtocol();
  createWindow();

  nativeTheme.on('updated', sendThemeToRenderer);

  ipcMain.handle('get-system-theme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});