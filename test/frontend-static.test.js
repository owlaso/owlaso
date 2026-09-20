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
