// Animated click-through demo capture.
//
// Boots OwlASO in mock mode and drives one continuous ~50 s take with
// Playwright: a synthetic cursor (arrow + click ripples) rides on top of real
// mouse/keyboard events while the page is recorded to webm. The take walks the
// full product story — onboarding, keyword search, tooltips, the detail modal,
// reviews, the full-data panel, tracking an app, dark mode.
//
//   node scripts/demo-capture.mjs
//
// Output:
//   owlaso-demo-video/public/captures/session.webm  (raw footage)
//   owlaso-demo-video/src/Timeline.ts               (chapter marks for Remotion)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, ROOT, seedHistory, seedScript, startServer, stopServer } from './demo-shots.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAP_DIR = path.join(ROOT, 'owlaso-demo-video', 'public', 'captures');
const TIMELINE_FILE = path.join(ROOT, 'owlaso-demo-video', 'src', 'Timeline.ts');
const VW = 1920, VH = 1080;

// ─── Chapter timeline ───────────────────────────────────────────────────────
const chapters = [];
let t0 = 0;
function mark(caption) {
  const t = Date.now() - t0;
  chapters.push({ t, caption });
  console.log(`  ⛳ +${(t / 1000).toFixed(1)}s ${caption}`);
}

// ─── Cursor overlay (injected at document_start as raw JS) ─────────────────
// A fixed-layer arrow that glides with a CSS transition (this is real footage —
// the compositing is done by the browser, not Remotion). Tip of the arrow sits
// at exactly (x, y); ripples are spawned at the same point on every click.
const CURSOR_SRC = `
(function () {
  function boot() {
    if (document.getElementById('demoArrow')) return;
    var style = document.createElement('style');
    style.textContent =
      '@keyframes demoRipple{0%{transform:translate(-50%,-50%) scale(1);opacity:.85}' +
      '100%{transform:translate(-50%,-50%) scale(3.1);opacity:0}}';
    document.head.appendChild(style);

    var layer = document.createElement('div');
    layer.id = 'demoFx';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;';
    document.documentElement.appendChild(layer);

    var arrow = document.createElement('div');
    arrow.id = 'demoArrow';
    arrow.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;' +
      'transform:translate3d(-120px,-120px,0);transition:transform .6s cubic-bezier(.3,.7,.3,1);';
    var inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;left:-6px;top:-5px;width:26px;height:26px;transition:transform .09s ease;' +
      'filter:drop-shadow(0 1px 3px rgba(0,0,0,.45));';
    inner.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" style="display:block">' +
      '<path d="M5.5 3.19 L5.5 19.28 L9.53 15.44 L11.94 20.9 L14.36 19.81 L11.97 14.44 L17.14 14.06 Z" ' +
      'fill="#ffffff" stroke="#1c1c1c" stroke-width="1.35" stroke-linejoin="round"/></svg>';
    arrow.appendChild(inner);
    document.documentElement.appendChild(arrow);

    window.__cursorTo = function (x, y, ms) {
      arrow.style.transition = 'transform ' + (ms || 600) + 'ms cubic-bezier(.3,.7,.3,1)';
      arrow.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    };
    window.__ripple = function (x, y) {
      var dark = document.documentElement.classList.contains('dark');
      var r = document.createElement('div');
      r.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:58px;height:58px;' +
        'border-radius:50%;border:2px solid ' + (dark ? 'rgba(255,255,255,.9)' : 'rgba(20,20,20,.75)') + ';' +
        'box-shadow:0 0 0 1px ' + (dark ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)') + ';' +
        'animation:demoRipple .5s cubic-bezier(.2,.6,.4,1) forwards;';
      layer.appendChild(r);
      setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 540);
    };
    window.__press = function (down) { inner.style.transform = down ? 'scale(.8)' : 'scale(1)'; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`;

// ─── Driver helpers ─────────────────────────────────────────────────────────
// Visual glide + real pointer move. The real mouse lands at 45 % through the
// visual glide so hover states trigger while the rendered cursor is still
// closing in — reads as a human moving a mouse.
async function cmove(page, x, y, ms = 600) {
  const xi = Math.round(x), yi = Math.round(y), dur = Math.round(ms);
  await page.evaluate(({ x, y, ms }) => window.__cursorTo(x, y, ms), { x: xi, y: yi, ms: dur });
  await page.waitForTimeout(Math.round(dur * 0.45));
  await page.mouse.move(xi, yi, { steps: 7 });
  await page.waitForTimeout(Math.round(dur * 0.55));
}

async function clickAt(page, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  await page.mouse.move(xi, yi, { steps: 6 });
  await page.mouse.down();
  await page.evaluate(({ x, y }) => window.__press(true), {});
  await page.evaluate(({ x, y }) => window.__ripple(x, y), { x: xi, y: yi });
  await page.waitForTimeout(85);
  await page.mouse.up();
  await page.evaluate(() => window.__press(false), {});
  await page.waitForTimeout(70);
}

async function centerOf(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for ${sel}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickSel(page, sel, ms = 520) {
  const p = await centerOf(page, sel);
  await cmove(page, p.x, p.y, ms);
  await clickAt(page, p.x, p.y);
}

// ─── The take ───────────────────────────────────────────────────────────────
async function take(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

  // 1. First run — the onboarding card is up; cursor sweeps in and skips it.
  await page.waitForSelector('#onboardingOverlay:not(.hidden)', { timeout: 20000 });
  await page.waitForTimeout(500);
  mark('First run — guided from the very start');
  await page.waitForTimeout(2400);
  await clickSel(page, '#onboardingSkip', 950);
  await page.waitForTimeout(750);

  // 2. Keyword analysis — click, type it out, run the search.
  mark('Analyze any keyword — one search, both stores');
  const sb = await centerOf(page, '#asoSearchInput');
  await cmove(page, sb.x, sb.y, 700);
  await clickAt(page, sb.x, sb.y);
  await page.waitForTimeout(280);
  await page.type('#asoSearchInput', 'habit tracker', { delay: 55 });
  await page.waitForTimeout(280);
  await clickSel(page, '#asoSearchBtn', 480);
  await page.waitForSelector('#tableBody tr[data-row-kind="aso"]', { timeout: 30000 });
  await page.waitForTimeout(1200);

  // 3. Scoped help — rest the cursor on the input, rich tooltip fades in.
  mark('Scoped help everywhere — hover anything');
  const tp = await centerOf(page, '#asoSearchInput');
  await cmove(page, tp.x - 40, tp.y, 700);
  await page.waitForFunction(
    () => { const el = document.querySelector('.app-tooltip'); return !!el && el.classList.contains('visible'); },
    null,
    { timeout: 6000 },
  );
  await page.waitForTimeout(1500);
  const away = await centerOf(page, '#tabKeywords');
  await cmove(page, away.x, away.y, 600);

  // 4. Keyword detail — open the modal and glide across the chart/rankings.
  mark('Trends, rankings and competitor keywords');
  const row = await centerOf(page, '#tableBody tr[data-row-kind="aso"]');
  await cmove(page, row.x + 90, row.y, 650); // left text zone, away from the app chips
  await clickAt(page, row.x + 90, row.y);
  await page.waitForSelector('#detailOverlay:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(850);
  const db = await centerOf(page, '#detailBody');
  await cmove(page, db.x, Math.max(170, db.y - 150), 700);
  await cmove(page, Math.min(VW - 120, db.x + 270), db.y + 130, 700);
  await page.waitForTimeout(450);
  await clickSel(page, '#detailClose', 520);
  await page.waitForTimeout(480);

  // 5. Reviews — switch tab, open one, page through, close.
  mark('Reviews — both stores, filtered and compared');
  await clickSel(page, '#tabReviews', 620);
  await page.waitForSelector('#tableBody tr[data-row-kind="comment"]', { timeout: 30000 });
  await page.waitForTimeout(1000);
  const rv = await centerOf(page, '#tableBody tr[data-row-kind="comment"]');
  await cmove(page, rv.x + 90, rv.y, 650);
  await clickAt(page, rv.x + 90, rv.y);
  await page.waitForSelector('#reviewModal:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(1050);
  await clickSel(page, '#nextReviewBtn', 520);
  await page.waitForTimeout(950);
  await clickSel(page, '#closeReviewModal', 520);
  await page.waitForTimeout(420);

  // 6. Full data — open the panel, scroll it, back out.
  mark('Full data — every language, every source');
  await clickSel(page, '#fullDataBtn', 620);
  await page.waitForSelector('.fd-card', { timeout: 20000 });
  await page.waitForTimeout(850);
  const fd = await centerOf(page, '#fullDataPanel');
  await cmove(page, fd.x, fd.y + 60, 600);
  await page.mouse.wheel(0, 460);
  await page.waitForTimeout(750);
  const back = await centerOf(page, '[data-full-data-action="close"]');
  await cmove(page, back.x, back.y, 600);
  await clickAt(page, back.x, back.y);
  await page.waitForTimeout(480);

  // 7. Track an app — add-app modal, search, add the Lite edition.
  mark('Track apps from one place');
  await clickSel(page, '#addAppBtn2', 640);
  await page.waitForSelector('#addAppModal:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(380);
  const ms = await centerOf(page, '#modalSearchInput');
  await cmove(page, ms.x, ms.y, 500);
  await clickAt(page, ms.x, ms.y);
  await page.type('#modalSearchInput', 'instagram', { delay: 62 });
  await page.waitForSelector('.modal-app-result', { timeout: 20000 });
  await page.waitForTimeout(350);
  await clickSel(page, '.modal-app-result:nth-child(2) .modal-app-add', 560);
  await page.waitForTimeout(1150); // button flips to "Tracked ✓", toast pops, sidebar updates
  await clickSel(page, '#closeAddAppModal', 540);
  await page.waitForTimeout(450);

  // 8. Dark mode — settings, one click, palettes flip everywhere.
  mark('Light or dark — one click, everywhere');
  await clickSel(page, '#settingsBtn', 620);
  await page.waitForSelector('#settingsModal:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(420);
  await clickSel(page, '#settingsModal .theme-btn[data-theme="dark"]', 640);
  await page.waitForTimeout(1000); // the flip
  await clickSel(page, '#closeSettingsModal', 540);
  await page.waitForTimeout(550);

  // Tail — park the cursor and let the dark dashboard breathe.
  await cmove(page, VW - 150, VH - 130, 900);
  await page.waitForTimeout(1200);
}

function writeTimeline(captureMs) {
  const lines = [];
  lines.push('// Generated by scripts/demo-capture.mjs — do not edit by hand.');
  lines.push('// t = milliseconds from the start of the raw capture (public/captures/session.webm).');
  lines.push('');
  lines.push('export type Chapter = { t: number; caption: string };');
  lines.push('');
  lines.push(`export const CAPTURE_MS = ${captureMs};`);
  lines.push('');
  lines.push('export const CHAPTERS: Chapter[] = [');
  for (const c of chapters) lines.push(`  { t: ${c.t}, caption: ${JSON.stringify(c.caption)} },`);
  lines.push('];');
  lines.push('');
  fs.writeFileSync(TIMELINE_FILE, lines.join('\n'), 'utf8');
}

async function main() {
  fs.rmSync(CAP_DIR, { recursive: true, force: true });
  fs.mkdirSync(CAP_DIR, { recursive: true });
  seedHistory();
  await startServer();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    locale: 'en-US',
    recordVideo: { dir: CAP_DIR, size: { width: VW, height: VH } },
  });
  const seed = seedScript({ onboarding: true, hints: true });
  await ctx.addInitScript(seed.fn, seed.arg);
  await ctx.addInitScript(CURSOR_SRC);

  const page = await ctx.newPage();
  t0 = Date.now();
  let ok = false;
  try {
    await take(page);
    ok = true;
  } finally {
    // Flushing the recording always — even on failure — so a partial take can
    // be inspected. The timeline is only written for clean takes.
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  const captureMs = Date.now() - t0;

  const videos = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.webm'));
  if (videos.length !== 1) throw new Error(`expected exactly one webm in ${CAP_DIR}, got ${videos.join(', ')}`);
  const videoPath = path.join(CAP_DIR, 'session.webm');
  fs.renameSync(path.join(CAP_DIR, videos[0]), videoPath);
  const sizeMb = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1);

  if (!ok) throw new Error('take did not complete — session.webm kept for inspection');
  writeTimeline(captureMs);
  console.log(`\n✔ capture complete — session.webm ${sizeMb} MB, ${(captureMs / 1000).toFixed(1)}s, ${chapters.length} chapters`);
  for (const c of chapters) console.log(`   ${(c.t / 1000).toFixed(1)}s — ${c.caption}`);
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ capture failed — ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  stopServer();
}
