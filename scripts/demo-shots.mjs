// Demo screenshot driver.
//
// Boots OwlASO in mock mode (MOCK_STORE_DATA=1) and drives every view with
// Playwright, capturing high-DPI screenshots plus a shots.json manifest that
// the Remotion demo-video project consumes.
//
//   node scripts/demo-shots.mjs
//
// Output: owlaso-demo-video/public/shots/*.png (+ shots manifest)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3918);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, 'owlaso-demo-video', 'public', 'shots');
const HISTORY_DIR = path.join(ROOT, '.demo-data', 'rank-history');
const VW = 1480, VH = 920;

const manifest = [];
const failures = [];

// ─── Rank history seed ──────────────────────────────────────────────────────
function seedHistory() {
  const identity = ['habit tracker', 'both', 'us', 'en'].join('\u0000');
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 20);
  const file = path.join(HISTORY_DIR, `habit-tracker.${hash}.json`);
  const keyword = 'habit tracker';
  const days = 14;
  const extra = 3; // days ago the series ends (server appends "today" when we analyze)
  const rankings = { google: ['com.instagram.android'], apple: ['994882113', '389801252'] };
  const snapshots = [];
  for (let i = 0; i < days; i++) {
    const at = new Date(Date.UTC(2026, 9, 12 + i, 9, 0, 0)); // Oct 12..25
    const t = i / (days - 1);
    const popularity = Math.round(48 + 9 * t + Math.sin(i * 1.7) * 2);
    const difficulty = Math.round(44 - 3 * t + Math.cos(i * 1.3) * 1.6);
    // Days 13-14: Streaks climbs to #1 on the App Store (trend arrows!)
    const apple = i >= days - 2 ? ['389801252', '994882113'] : rankings.apple;
    snapshots.push({
      at: at.toISOString(),
      popularity: Math.min(99, popularity),
      difficulty: Math.max(1, difficulty),
      opportunity: Math.round((popularity * (100 - difficulty)) / 100),
      appCount: 2,
      topApp: 'Instagram',
      rankings: { google: rankings.google, apple },
    });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ keyword, store: 'both', country: 'us', lang: 'en', snapshots }, null, 2));
  console.log(`seeded rank history (${snapshots.length} snapshots)`);
}

// ─── Storage seed helpers ───────────────────────────────────────────────────
const APPS = [
  {
    id: 'app-1', name: 'Habitica', platform: 'google', primaryAppId: 'com.instagram.android',
    stores: [{ platform: 'google', appId: 'com.instagram.android' }, { platform: 'apple', appId: '994882113' }],
    icon: '', developer: 'HabitRPG, Inc.', folderId: null, color: '#7C3AED',
  },
  {
    id: 'app-2', name: 'Streaks', platform: 'apple', primaryAppId: '389801252',
    stores: [{ platform: 'apple', appId: '389801252' }],
    icon: '', developer: 'Quentinz', folderId: 'f-1', color: '#1DB954',
  },
];
const FOLDERS = [{ id: 'f-1', name: 'Productivity', expanded: true }];

function buildSeedArg({ dark = false, hints = true, apps = true, onboarding = false, selected = 'app-1' } = {}) {
  return {
    dark, hints, onboarding, selected,
    appsPayload: apps ? {
      apps: APPS, folders: FOLDERS, country: 'us', lang: 'en', store: 'both',
      starMin: '', starMax: '', maxReviews: 250,
    } : null,
  };
}

// Runs in the page at document start — data must arrive via `arg`; closures
// over module scope do not survive Playwright's function serialization.
function pageSeed(arg) {
  localStorage.setItem('theme', arg.dark ? 'dark' : 'light');
  localStorage.setItem('owlaso_hints_seen', JSON.stringify(arg.hints ? ['*'] : []));
  if (arg.hints) localStorage.setItem('owlaso_tips_off', '1');
  localStorage.setItem('owlaso_recent_keywords', JSON.stringify(['habit tracker', 'meditation', 'water reminder']));
  if (arg.appsPayload) {
    localStorage.setItem('srf_state_v2', JSON.stringify({
      ...arg.appsPayload, view: 'keywords', selectedAppId: arg.selected, sidebarCollapsed: false,
    }));
    if (!arg.selected) localStorage.removeItem('srf_state_v2');
  }
  if (arg.onboarding) localStorage.removeItem('rr_onboarded');
  else localStorage.setItem('rr_onboarded', '1');
}

function seedScript(opts = {}) {
  return { fn: pageSeed, arg: buildSeedArg(opts) };
}

let server = null;
async function startServer() {
  server = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      MOCK_STORE_DATA: '1',
      RANK_HISTORY_DIR: HISTORY_DIR,
      DISABLE_CACHE: '1',
    },
    stdio: 'inherit',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Mock server did not start');
}

async function makePage(browser, seed) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });
  await ctx.addInitScript(seed.fn, seed.arg);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

async function shot(browser, seed, file, caption, action, opts = {}) {
  const t0 = Date.now();
  let { ctx, page } = { ctx: null, page: null };
  try {
    ({ ctx, page } = await makePage(browser, seed));
    await action(page);
    await settle(page, opts.ms ?? 350, opts.keep ?? []);
    await page.screenshot({ path: path.join(OUT_DIR, `${file}.png`) });
    manifest.push({ file: `${file}.png`, caption });
    console.log(`  ✔ ${file}.png — ${caption} (${Date.now() - t0}ms)`);
    return true;
  } catch (error) {
    console.error(`  ✖ ${file} — ${error.message.split('\n')[0]}`);
    failures.push(file);
    return false;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// Clean tooltips/hint bubbles that linger into the capture, then settle.
async function settle(page, ms = 350, keep = []) {
  await page.waitForTimeout(ms);
  await page.evaluate((keep) => {
    document.querySelectorAll('.app-tooltip, .hint-bubble').forEach((e) => {
      if (keep.some((sel) => e.matches(sel))) return;
      e.remove();
    });
    document.querySelectorAll('.hint-target').forEach((e) => e.classList.remove('hint-target'));
  }, keep);
  await page.waitForTimeout(120);
}

async function searchKeyword(page, kw = 'habit tracker') {
  await page.fill('#asoSearchInput', kw);
  await page.click('#asoSearchBtn');
  await page.waitForSelector('#tableBody tr[data-row-kind="aso"]', { timeout: 8000 });
  await page.waitForTimeout(450); // similar-bar lite queries
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  seedHistory();
  await startServer();
  const browser = await chromium.launch();

  // ── Light-mode flow ─────────────────────────────────────────────────────
  console.log('capturing light-mode screenshots…');

  await shot(browser, seedScript({ onboarding: true }), '01-onboarding',
    'First-run onboarding card', async (page) => {
      await page.waitForSelector('#onboardingOverlay:not(.hidden)', { timeout: 6000 });
    });

  await shot(browser, seedScript(), '02-empty',
    'Keywords view — empty state with tracked apps', async (page) => {
      await page.waitForSelector('#emptyState:not(.hidden)');
    });

  await shot(browser, seedScript(), '03-keywords',
    'Keyword analysis — popularity & difficulty at a glance', async (page) => {
      await searchKeyword(page);
    });

  await shot(browser, seedScript(), '04-tooltip',
    'Rich tooltip — scoped help everywhere', async (page) => {
      await page.hover('#asoSearchInput');
      await page.waitForSelector('.app-tooltip.rich.visible', { timeout: 4000 });
    }, { keep: ['.app-tooltip'] });

  await shot(browser, seedScript(), '05-keyword-detail',
    'Keyword detail — trend chart, rankings & competitor keywords', async (page) => {
      await searchKeyword(page);
      await page.click('#tableBody tr[data-row-kind="aso"]');
      await page.waitForSelector('#detailOverlay:not(.hidden)');
      await page.waitForSelector('.kw-hero-card', { timeout: 8000 });
      await page.waitForTimeout(500); // history/chart fill
    });

  await shot(browser, seedScript(), '06-app-detail',
    'App details — merged across both stores (live store data)', async (page) => {
      await searchKeyword(page);
      await page.click('#tableBody tr[data-row-kind="aso"]');
      await page.waitForSelector('#detailOverlay:not(.hidden)');
      await page.click('#detailClose');
      await page.click('.kw-app-chip'); // open app details (live store data)
      await page.waitForSelector('#appDetailModal:not(.hidden)');
      await page.waitForSelector('.store-detail-card', { timeout: 40000 });
      await page.waitForFunction(
        () => document.querySelectorAll('#appDetailBody .store-detail-card').length >= 2,
        null, { timeout: 40000 },
      ).catch(() => { /* capture with whatever loaded */ });
      await page.waitForTimeout(1500); // icons swap-in settle
    });

  await shot(browser, seedScript(), '07-add-app',
    'Add app — search both stores at once', async (page) => {
      await page.click('#addAppBtn2');
      await page.waitForSelector('#addAppModal:not(.hidden)');
      await page.fill('#modalSearchInput', 'instagram');
      await page.waitForSelector('.modal-app-result', { timeout: 8000 });
    });

  await shot(browser, seedScript(), '08-reviews',
    'Reviews — both stores, filtered and compared', async (page) => {
      await page.click('#tabReviews');
      await page.waitForSelector('[data-row-kind="comment"]', { timeout: 8000 });
      await page.locator('.app-item').nth(1).locator('[data-app-id], .app-item-main').first().click({ modifiers: ['Control'] });
      await page.waitForSelector('.comment-table.multi-app', { timeout: 8000 });
    });

  await shot(browser, seedScript(), '09-review-detail',
    'Review detail — full text, reply and store metadata', async (page) => {
      await page.click('#tabReviews');
      await page.waitForSelector('[data-row-kind="comment"]', { timeout: 8000 });
      await page.click('[data-row-kind="comment"]');
      await page.waitForSelector('#reviewModal:not(.hidden)');
    });

  await shot(browser, seedScript(), '10-full-data',
    'Full data explorer — every language, terms & rating splits', async (page) => {
      await page.click('#tabReviews');
      await page.waitForSelector('[data-row-kind="comment"]', { timeout: 8000 });
      await page.click('#fullDataBtn');
      await page.waitForSelector('#fullDataPanel:not(.hidden)');
      await page.waitForSelector('.fd-card', { timeout: 15000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.querySelectorAll('.app-tooltip, .hint-bubble').forEach((e) => e.remove()));
    });

  await shot(browser, seedScript(), '11-settings',
    'Settings — themes, language, tips and shortcuts', async (page) => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal:not(.hidden)', { timeout: 6000 });
    });

  await shot(browser, seedScript(), '12-settings-tr',
    'Language switch — full English/Türkçe UI', async (page) => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal:not(.hidden)', { timeout: 6000 });
      await page.click('#langPicker .theme-btn[data-lang="tr"]');
      await page.waitForTimeout(600); // applyStatic re-render
    });

  // ── Dark-mode flow ──────────────────────────────────────────────────────
  console.log('capturing dark-mode screenshots…');

  await shot(browser, seedScript({ dark: true }), '20-dark-keywords',
    'Dark theme — keyword analysis', async (page) => {
      await searchKeyword(page);
    });

  await shot(browser, seedScript({ dark: true }), '21-dark-detail',
    'Dark theme — keyword detail', async (page) => {
      await searchKeyword(page);
      await page.click('#tableBody tr[data-row-kind="aso"]');
      await page.waitForSelector('#detailOverlay:not(.hidden)');
      await page.waitForTimeout(500);
    });

  await shot(browser, seedScript({ dark: true }), '22-dark-reviews',
    'Dark theme — reviews explorer', async (page) => {
      await page.click('#tabReviews');
      await page.waitForSelector('[data-row-kind="comment"]', { timeout: 8000 });
      await page.locator('.app-item').nth(1).locator('[data-app-id], .app-item-main').first().click({ modifiers: ['Control'] });
      await page.waitForSelector('.comment-table.multi-app', { timeout: 8000 });
    });

  await shot(browser, seedScript({ dark: true }), '23-dark-full-data',
    'Dark theme — full data explorer', async (page) => {
      await page.click('#tabReviews');
      await page.waitForSelector('[data-row-kind="comment"]', { timeout: 8000 });
      await page.click('#fullDataBtn');
      await page.waitForSelector('#fullDataPanel:not(.hidden)');
      await page.waitForSelector('.fd-card', { timeout: 15000 });
      await page.waitForTimeout(1200);
    });

  await shot(browser, seedScript({ dark: true }), '24-dark-settings',
    'Dark theme — settings', async (page) => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal:not(.hidden)', { timeout: 6000 });
    });

  await browser.close();
  await writeFile(path.join(OUT_DIR, 'shots.json'), JSON.stringify(manifest, null, 2));
  console.log(`done — ${manifest.length} shots captured${failures.length ? `; failed: ${failures.join(', ')}` : ''}`);
  if (failures.length) process.exitCode = 1;
}

export function stopServer() {
  if (server) {
    const proc = server;
    server = null;
    proc.kill();
    setTimeout(() => proc.kill('SIGKILL'), 1500);
  }
}

export { PORT, BASE, ROOT, HISTORY_DIR, seedHistory, APPS, seedScript, startServer };

// Only run the screenshot flow when this file is invoked directly.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } finally {
    stopServer();
  }
}
