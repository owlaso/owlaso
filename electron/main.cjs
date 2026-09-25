const { app, BrowserWindow, protocol, net, shell, Menu, nativeTheme, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let mainWindow = null;
const publicDir = path.resolve(__dirname, '..', 'public');
const APP_ORIGIN = 'app://app';

// Rank history must live in the per-user data dir: next to the code it would land
// inside the (read-only) app.asar of a packaged build and silently never persist.
process.env.RANK_HISTORY_DIR ||= path.join(app.getPath('userData'), 'rank-history');

// Follow the OS theme; the renderer applies the user's explicit choice on top.
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

// ── Menu ────────────────────────────────────────────────────────
// No menu bar on Windows/Linux. macOS needs the standard app/Edit menus, otherwise
// Cmd+C / Cmd+V / Cmd+A / Cmd+Q do nothing in text fields.
function installMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

// ── Static Path Resolution (traversal-safe) ─────────────────────
function resolvePublicPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname || '/'); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const posix = path.posix.normalize(decoded).replace(/^\/+/u, '');
  const absolute = path.resolve(publicDir, posix === '' ? 'index.html' : posix);
  if (!absolute.startsWith(publicDir + path.sep)) return null;
  return absolute;
}

function isHttpUrl(value) {
  try {
    const { protocol: scheme } = new URL(value);
    return scheme === 'https:' || scheme === 'http:';
  } catch {
    return false;
  }
}

// ── API (shared router with the web server, runs in the main process) ─────
let routerPromise = null;
function loadRouter() {
  routerPromise ||= import('../src/api.js');
  return routerPromise;
}

async function handleApi(url) {
  const { handleApiRequest } = await loadRouter();
  const result = await handleApiRequest(url);
  const headers = { 'content-type': result.contentType, 'cache-control': 'no-store', ...result.headers };
  if (!result.ndjson) return new Response(result.body, { status: result.status, headers });

  // NDJSON stream; cancelling the renderer's fetch aborts the background work.
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(streamCtrl) {
      const write = (obj) => {
        if (controller.signal.aborted) return;
        try { streamCtrl.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`)); } catch { controller.abort(); }
      };
      result.ndjson(write, controller.signal).finally(() => {
        try { streamCtrl.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, { status: result.status, headers });
}

// ── Protocol Handler ────────────────────────────────────────────
function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(url);
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
    }

    const filePath = resolvePublicPath(url.pathname);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    try {
      if (fs.statSync(filePath).isFile()) return net.fetch(pathToFileURL(filePath).toString());
    } catch { /* not a file */ }
    if (path.extname(url.pathname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(publicDir, 'index.html')).toString());
  });
}

// ── Hardening ───────────────────────────────────────────────────
function hardenContents(contents) {
  // Links open in the default browser — but only real web links. shell.openExternal
  // with file:, smb:, ms-*: … URLs is a known code-execution vector.
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, legacyUrl) => {
    const url = event.url || legacyUrl || '';
    if (url.startsWith(`${APP_ORIGIN}/`)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// ── Window ──────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'OwlASO',
    // Match the theme so dark-mode users don't get a white flash on launch.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#2c2c2e' : '#f5f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

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
}

function sendThemeToRenderer() {
  if (!mainWindow) return;
  mainWindow.webContents.send('theme-change', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

// ── App Lifecycle ───────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    installMenu();
    // The app needs no camera, microphone, notifications, geolocation…
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    ipcMain.handle('get-system-theme', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
    nativeTheme.on('updated', sendThemeToRenderer);

    registerProtocol();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Applies to every webContents, the main window's included.
  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
