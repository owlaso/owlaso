// Loads electron/main.cjs against a stubbed `electron` module to check the
// security-relevant wiring without needing the Electron binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const userData = path.join(os.tmpdir(), 'owlaso-electron-test');
const calls = { openExternal: [], windows: [], appEvents: {}, handlers: {}, fetched: [] };

class FakeWebContents {
  constructor() { this.listeners = {}; this.openHandler = null; }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  on(event, fn) { (this.listeners[event] ||= []).push(fn); }
  emit(event, ...args) { for (const fn of this.listeners[event] || []) fn(...args); }
  send() {}
}
class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    calls.windows.push(this);
    for (const fn of calls.appEvents['web-contents-created'] || []) fn({}, this.webContents);
  }
  loadURL(url) { this.url = url; }
  once() {}
  on() {}
  static getAllWindows() { return calls.windows; }
}
const fakeElectron = {
  app: {
    getPath: () => userData,
    requestSingleInstanceLock: () => true,
    on: (event, fn) => (calls.appEvents[event] ||= []).push(fn),
    whenReady: () => ({ then: (fn) => { calls.ready = fn; } }),
    quit() {},
  },
  BrowserWindow: FakeBrowserWindow,
  protocol: {
    registerSchemesAsPrivileged: (schemes) => { calls.schemes = schemes; },
    handle: (_scheme, fn) => { calls.protocolHandler = fn; },
  },
  net: { fetch: async (url) => { calls.fetched.push(url); return new Response('ok'); } },
  shell: { openExternal: (url) => calls.openExternal.push(url) },
  Menu: { setApplicationMenu: (menu) => { calls.menu = menu; }, buildFromTemplate: (t) => t },
  nativeTheme: { themeSource: 'light', shouldUseDarkColors: false, on() {} },
  ipcMain: { handle: (channel, fn) => { calls.handlers[channel] = fn; } },
  session: { defaultSession: { setPermissionRequestHandler: (fn) => { calls.permissionRequest = fn; }, setPermissionCheckHandler: (fn) => { calls.permissionCheck = fn; } } },
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === 'electron' ? fakeElectron : originalLoad.call(this, request, ...rest);
};
delete process.env.RANK_HISTORY_DIR;
process.env.MOCK_STORE_DATA = '1';
require('../electron/main.cjs');
Module._load = originalLoad;
calls.ready();
const win = calls.windows[0];

test('rank history is stored in the per-user data directory', () => {
  assert.equal(process.env.RANK_HISTORY_DIR, path.join(userData, 'rank-history'));
});

test('renderer runs sandboxed and isolated', () => {
  const prefs = win.options.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(win.url, 'app://app/index.html');
});

test('only http(s) links are handed to the OS, new windows are always denied', () => {
  for (const url of ['https://apps.apple.com/app/id1', 'file:///etc/passwd', 'javascript:alert(1)', 'ms-msdt:/id', 'smb://host/share']) {
    assert.deepEqual(win.webContents.openHandler({ url }), { action: 'deny' });
  }
  assert.deepEqual(calls.openExternal, ['https://apps.apple.com/app/id1']);
});

test('in-app navigation away from app:// is blocked', () => {
  const external = { url: 'https://evil.example/', preventDefault() { this.prevented = true; } };
  win.webContents.emit('will-navigate', external, external.url);
  assert.equal(external.prevented, true);
  const internal = { url: 'app://app/index.html', preventDefault() { this.prevented = true; } };
  win.webContents.emit('will-navigate', internal, internal.url);
  assert.equal(internal.prevented, undefined);
});

test('permission requests are denied', () => {
  let granted = null;
  calls.permissionRequest(null, 'media', (ok) => { granted = ok; });
  assert.equal(granted, false);
  assert.equal(calls.permissionCheck(), false);
});

test('app:// protocol serves files, 404s missing assets and routes the shared API', async () => {
  const index = await calls.protocolHandler({ url: 'app://app/' });
  assert.equal(index.status, 200);
  assert.match(calls.fetched.at(-1), /public\/index\.html$/);
  assert.equal((await calls.protocolHandler({ url: 'app://app/missing.js' })).status, 404);
  const escape = await calls.protocolHandler({ url: 'app://app/..%2f..%2fpackage.json' });
  assert.notEqual(escape.status, 200);
  assert.equal((await calls.protocolHandler({ url: 'app://other/index.html' })).status, 404);
  const health = await calls.protocolHandler({ url: 'app://app/api/health' });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const history = await calls.protocolHandler({ url: 'app://app/api/asosearch/history?q=habit' });
  assert.equal(history.status, 200, 'history route exists in the desktop app too');
});

test('non-macOS builds have no menu bar; theme IPC answers', () => {
  if (process.platform !== 'darwin') assert.equal(calls.menu, null);
  assert.equal(calls.handlers['get-system-theme'](), 'light');
});
