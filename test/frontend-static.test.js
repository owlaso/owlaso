import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('HTML has dual search inputs: ASO keyword and comment search', () => {
  assert.match(index, /id="asoSearchInput"/);
  assert.match(index, /id="commentSearchInput"/);
});

test('HTML has star range filters (min and max)', () => {
  assert.match(index, /id="starMin"/);
  assert.match(index, /id="starMax"/);
});

test('HTML has store, country, and language selectors', () => {
  assert.match(index, /id="storeFilter"/);
  assert.match(index, /id="countryDropdown"/);
  assert.match(index, /id="langDropdown"/);
});

test('HTML has max-reviews selector and review summary bar', () => {
  assert.match(index, /id="maxReviews"/);
  assert.match(index, /id="reviewSummary"/);
});

test('HTML has ASO keyword table with all 6 columns', () => {
  assert.match(index, /Keyword \/ Topic/);
  assert.match(index, /Last Updated/);
  assert.match(index, /Popularity/);
  assert.match(index, /Difficulty/);
  assert.match(index, /Position/);
  assert.match(index, /Apps in Ranking/);
});

test('HTML has sidebar folder tree and all modal dialogs', () => {
  assert.match(index, /id="folderTree"/);
  assert.match(index, /id="addAppModal"/);
  assert.match(index, /id="keywordAppsModal"/);
  assert.match(index, /id="appDetailModal"/);
  assert.match(index, /id="settingsModal"/);
  assert.match(index, /id="detailOverlay"/);
});

test('app.js has no duplicate function declarations', () => {
  const fns = [...app.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  const dupes = fns.filter((name, i) => fns.indexOf(name) !== i);
  assert.deepEqual(dupes, [], `Duplicate declarations: ${dupes.join(', ')}`);
});

test('app.js wires ASO search to /api/asosearch endpoint', () => {
  assert.match(app, /runASOSearch/);
  assert.match(app, /asoSearchBtn/);
  assert.match(app, /\/api\/asosearch/);
});

test('app.js wires comment search to /api/reviews endpoint', () => {
  assert.match(app, /runCommentSearch/);
  assert.match(app, /commentSearchBtn/);
  assert.match(app, /\/api\/reviews/);
});

test('app.js merges both-store search results to avoid duplicates', () => {
  assert.match(app, /mergeModalResults/);
  assert.match(app, /normTitle/);
});

test('app.js persists and restores state via localStorage', () => {
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /localStorage\.getItem/);
});

test('app.js renders country flags from flagcdn images', () => {
  assert.match(app, /flagcdn\.com/);
  assert.match(app, /flagImg/);
});

test('app.js uses the max-reviews selector and never hardcodes pages/max', () => {
  assert.match(app, /state\.filters\.maxReviews/);
  assert.match(app, /MAX_REVIEW_STEPS/);
  assert.match(app, /loadMoreReviews/);
  assert.match(app, /RENDER_CAP/);
  assert.doesNotMatch(app, /pages: '1'/);
  assert.doesNotMatch(app, /max: '250'/);
});

test('app.js renders popularity and difficulty metric bars', () => {
  assert.match(app, /pctColor/);
  assert.match(app, /diffColor/);
  assert.match(app, /kw-metric-fill/);
});

test('HTML has review detail modal with close button', () => {
  assert.match(index, /id="reviewModal"/);
  assert.match(index, /id="reviewModalTitle"/);
  assert.match(index, /id="reviewModalBody"/);
  assert.match(index, /id="closeReviewModal"/);
});

test('app.js opens review modal from clickable comment rows', () => {
  assert.match(app, /openReviewModal/);
  assert.match(app, /closeReviewModal/);
  assert.match(app, /data-review-index/);
  assert.match(app, /__reviewData/);
  assert.match(app, /rowKind === 'comment'/);
  assert.match(app, /review-detail-text/);
  assert.match(app, /review-detail-reply/);
});

test('Meta Ads Library integration is disabled with coming-soon badge', () => {
  assert.match(index, /badge-soon/);
  assert.match(index, /Coming soon/);
  assert.match(index, /settings-integration-row is-disabled/);
  assert.match(index, /id="metaTokenInput"[^>]*disabled/);
  assert.match(index, /id="saveMetaTokenBtn" disabled/);
  assert.doesNotMatch(app, /fbToken/);
  assert.doesNotMatch(app, /FB_TOKEN_KEY/);
  assert.doesNotMatch(app, /metaToken/);
});

test('styles.css styles the review modal, badges, and search inputs', () => {
  assert.match(css, /\.review-detail-text/);
  assert.match(css, /\.review-detail-reply-label/);
  assert.match(css, /\.review-row-clickable/);
  assert.match(css, /\.badge-soon/);
  assert.match(css, /\.settings-integration-row\.is-disabled/);
  assert.match(css, /\.tb-search-btn/);
  assert.doesNotMatch(css, /tb-search-btn \{[^}]*position: absolute/);
});

test('index.html ships a CSP and no inline scripts or inline event handlers', () => {
  assert.match(index, /http-equiv="Content-Security-Policy"[^>]*script-src 'self'/);
  const scripts = [...index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src="/);
    assert.equal(body.trim(), '');
  }
  assert.doesNotMatch(index, /\son[a-z]+="/i);
  assert.doesNotMatch(app, /onerror=/i);
});

test('dialogs are accessible modals and icon buttons are labelled', () => {
  for (const id of ['addAppModal', 'keywordAppsModal', 'appDetailModal', 'reviewModal', 'settingsModal', 'detailOverlay']) {
    const block = index.slice(index.indexOf(`id="${id}"`), index.indexOf(`id="${id}"`) + 400);
    assert.match(block, /role="dialog"[^>]*aria-modal="true"/, `${id} must be role=dialog`);
  }
  for (const id of ['sidebarToggle', 'createFolderBtn', 'addAppBtn2', 'settingsBtn', 'asoSearchBtn', 'commentSearchBtn']) {
    assert.match(index, new RegExp(`id="${id}"[^>]*aria-label="`), `${id} needs an aria-label`);
  }
});

test('app.js only puts http(s) URLs into href/src and shares the CSV implementation', () => {
  assert.match(app, /function safeUrl/);
  assert.match(app, /url\.protocol === 'https:' \|\| url\.protocol === 'http:'/);
  assert.doesNotMatch(app, /href="\$\{escapeHtml\(review\.url\)\}"/);
  assert.match(app, /from '\.\/lib\/csv\.js'/);
});

test('review requests tell the server which store the id belongs to and the known counterpart', () => {
  assert.match(app, /appPlatform: primary\.platform/);
  assert.match(app, /appId2: other\?\.appId/);
  assert.match(app, /title: app\.name/);
  assert.match(app, /choice === 'both' \? 'all' : choice/, 'add-app modal "All stores" must search both stores');
});

test('stale responses cannot overwrite newer ones', () => {
  assert.match(app, /function beginRequest/);
  assert.match(app, /isCurrent\('reviews', ctl\)/);
  assert.match(app, /isCurrent\('aso', ctl\)/);
});

test('every data-help key used in the UI has help content', async () => {
  const keys = new Set([...index.matchAll(/data-help="([\w-]+)"/g), ...app.matchAll(/data-help="([\w-]+)"/g)].map((m) => m[1]));
  assert.ok(keys.size >= 20, `expected many help anchors, got ${keys.size}`);
  const helpBlock = app.slice(app.indexOf('const HELP = {'), app.indexOf('const tour = createTour'));
  for (const key of keys) {
    assert.match(helpBlock, new RegExp(`(^|\\s)'?${key}'?: `, 'm'), `HELP is missing "${key}"`);
  }
});

test('guided tour, contextual tips and help entry points are wired', async () => {
  const guide = await readFile(new URL('../public/lib/guide.js', import.meta.url), 'utf8');
  assert.match(guide, /export function createTour/);
  assert.match(guide, /export function createHints/);
  assert.match(guide, /export function initTooltips/);
  assert.doesNotMatch(guide, /innerHTML/, 'guidance UI must be built with textContent only');
  assert.match(index, /id="helpBtn"[^>]*aria-label="Guided tour"/);
  assert.match(index, /id="onboardingTour"/);
  assert.match(index, /id="tipsToggle"/);
  assert.match(app, /e\.key === '\?'/);
  assert.match(app, /const HINTS = \[/);
});
