// ============================================================
// OwlASO — Dashboard Application Logic
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Country / language maps ---
const COUNTRIES = [
  { code: 'us', name: 'United States' },
  { code: 'tr', name: 'Turkey' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'de', name: 'Germany' },
  { code: 'fr', name: 'France' },
  { code: 'it', name: 'Italy' },
  { code: 'es', name: 'Spain' },
  { code: 'br', name: 'Brazil' },
  { code: 'jp', name: 'Japan' },
  { code: 'kr', name: 'South Korea' },
  { code: 'in', name: 'India' },
  { code: 'ru', name: 'Russia' },
  { code: 'au', name: 'Australia' },
  { code: 'ca', name: 'Canada' },
  { code: 'mx', name: 'Mexico' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'pl', name: 'Poland' },
  { code: 'se', name: 'Sweden' },
  { code: 'id', name: 'Indonesia' },
  { code: 'sa', name: 'Saudi Arabia' },
];

// cc = ISO country code for the flag image; matches flagcdn.com path
const LANGUAGES = [
  { code: 'all', cc: null,  name: 'All languages' },
  { code: 'en',  cc: 'gb',  name: 'English' },
  { code: 'tr',  cc: 'tr',  name: 'Türkçe' },
  { code: 'de',  cc: 'de',  name: 'Deutsch' },
  { code: 'fr',  cc: 'fr',  name: 'Français' },
  { code: 'es',  cc: 'es',  name: 'Español' },
  { code: 'it',  cc: 'it',  name: 'Italiano' },
  { code: 'pt-BR', cc: 'br', name: 'Português (BR)' },
  { code: 'ru',  cc: 'ru',  name: 'Русский' },
  { code: 'ja',  cc: 'jp',  name: '日本語' },
  { code: 'ko',  cc: 'kr',  name: '한국어' },
  { code: 'ar',  cc: 'sa',  name: 'العربية' },
  { code: 'hi',  cc: 'in',  name: 'हिन्दी' },
  { code: 'nl',  cc: 'nl',  name: 'Nederlands' },
  { code: 'pl',  cc: 'pl',  name: 'Polski' },
];

function flagImg(cc, size = '20x15') {
  if (!cc) return `<span style="font-size:14px;line-height:1">🌐</span>`;
  return `<img src="https://flagcdn.com/${size}/${cc}.png" alt="${cc}" width="${size.split('x')[0]}" height="${size.split('x')[1]}" style="border-radius:2px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">`;
}

const CAT_COLORS = ['#E1306C', '#1DB954', '#58CC02', '#FF9500', '#4A154B', '#FF0000', '#1877F2', '#FF4500', '#7C3AED', '#00A82D'];

// --- State ---
const state = {
  apps: [],
  folders: [],
  selectedAppId: null,
  selectedApps: new Set(),
  mode: null,                 // 'aso' | 'comments' | null
  activeAso: null,            // analyzeKeyword result
  lastCommentQuery: null,
  lastReviews: [],
  __reviewData: null,         // current comment table data (replaces DOM property)
  collapsed: new Set(),
  asoCache: new Map(),
  filters: {
    store: 'both',
    starMin: '',
    starMax: '',
    country: 'us',
    lang: 'all',
    maxReviews: 250,
  },
  loading: false,
  error: null,
};
let draggingAppId = null;

const STORAGE_KEY = 'srf_state_v2';

// Max-reviews ladder used by the "Load more" button and the max-reviews selector.
const MAX_REVIEW_STEPS = [250, 500, 1000, 2000, 5000];
const RENDER_CAP = 500; // rows physically rendered in the comment table per fetch

// Full-data panel state
const FULL_DATA_RENDER_STEP = 50;   // rows rendered when the panel first opens
const FULL_DATA_SHOW_STEP = 200;    // rows added per "Show more" click
const FULL_DATA_RENDER_CAP = 2000;  // max rows physically rendered; beyond this, export
let fullDataPayload = null;
let fullDataStreamCtl = null;
let fullDataShownCount = FULL_DATA_RENDER_STEP;

// --- Utilities ---
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function roundToK(v) {
  if (!v) return '0';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function relativeTime(ts) {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function pctColor(v) {
  if (v < 34) return 'green';
  if (v < 67) return 'yellow';
  return 'red';
}

function diffColor(difficulty) {
  // low difficulty = easy = green; high = hard = red
  if (difficulty < 34) return 'green';
  if (difficulty < 67) return 'yellow';
  return 'red';
}

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function api(path) {
  const res = await fetch(path);
  let json;
  try { json = await res.json(); } catch { throw new Error('Invalid JSON response'); }
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function params(obj) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, v);
  }
  return u.toString();
}

// --- Theme (follows the system automatically) ---
function systemPrefersDark() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch { return false; }
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  if (theme === 'dark') root.classList.add('dark');
  else if (theme === 'light') root.classList.add('light');
  else root.classList.toggle('dark', systemPrefersDark());
}

function initSystemTheme() {
  if (window.electronAPI && window.electronAPI.getSystemTheme) {
    window.electronAPI.getSystemTheme().then(applyTheme);
    window.electronAPI.onThemeChange(applyTheme);
  } else {
    applyTheme(null);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => applyTheme(e.matches ? 'dark' : 'light');
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }
}

// --- Custom dropdowns (country / language) ---
function buildCustomDropdown(dropEl, entries, currentCode, onSelect) {
  dropEl.innerHTML = entries.map((e) => {
    const cc = e.cc !== undefined ? e.cc : e.code; // countries use .code, languages use .cc
    return `
    <button class="country-option" data-code="${escapeHtml(e.code)}">
      ${flagImg(cc)}
      <span>${escapeHtml(e.name)}</span>
    </button>`;
  }).join('');
  dropEl.addEventListener('click', (ev) => {
    const opt = ev.target.closest('[data-code]');
    if (!opt) return;
    dropEl.classList.remove('open');
    onSelect(opt.dataset.code);
  });
}

function setCountryUI(code) {
  const c = COUNTRIES.find((x) => x.code === code) || COUNTRIES[0];
  $('#countryFlag').innerHTML = flagImg(c.code);
  $('#countryCode').textContent = c.code.toUpperCase();
}

function setLangUI(code) {
  const l = LANGUAGES.find((x) => x.code === code) || LANGUAGES[0];
  $('#langFlag').innerHTML = flagImg(l.cc);
  $('#langCode').textContent = l.code === 'all' ? 'All' : l.code.toUpperCase();
}

function initDropdowns() {
  buildCustomDropdown($('#countryDropdown'), COUNTRIES, state.filters.country, (code) => {
    state.filters.country = code;
    setCountryUI(code);
    onFiltersChanged();
  });
  buildCustomDropdown($('#langDropdown'), LANGUAGES, state.filters.lang, (code) => {
    state.filters.lang = code;
    setLangUI(code);
    onFiltersChanged();
  });
  setCountryUI(state.filters.country);
  setLangUI(state.filters.lang);

  $('#countryBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#countryDropdown');
    const langDd = $('#langDropdown');
    langDd.classList.remove('open');
    dd.classList.toggle('open');
  });
  $('#langBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#langDropdown');
    const cDd = $('#countryDropdown');
    cDd.classList.remove('open');
    dd.classList.toggle('open');
  });
  document.addEventListener('click', () => {
    $('#countryDropdown').classList.remove('open');
    $('#langDropdown').classList.remove('open');
  });

  $('#storeFilter').value = state.filters.store;
  $('#starMin').value = state.filters.starMin;
  $('#starMax').value = state.filters.starMax;
  $('#maxReviews').value = String(state.filters.maxReviews || 250);
  $('#maxReviews').addEventListener('change', () => {
    state.filters.maxReviews = Number($('#maxReviews').value) || 250;
    persist();
    onFiltersChanged();
  });
  $('#starMin').addEventListener('change', () => { state.filters.starMin = $('#starMin').value; onFiltersChanged(); });
  $('#starMax').addEventListener('change', () => { state.filters.starMax = $('#starMax').value; onFiltersChanged(); });
  $('#storeFilter').addEventListener('change', () => { state.filters.store = $('#storeFilter').value; onFiltersChanged(); });
}

// Mode search
let asoDebounce = null;
let commentDebounce = null;

function onFiltersChanged() {
  if (state.mode === 'aso' && state.activeAso) runASOSearch(state.activeAso.keyword, true);
  else if (state.mode === 'comments') {
    if (state.lastCommentQuery) runCommentSearch(state.lastCommentQuery, true);
    else if (state.selectedAppId) fetchAppReviews();
  }
}

function runASOSearch(keyword, silent = false) {
  const kw = (keyword || $('#asoSearchInput').value || '').trim();
  if (kw.length < 2) return;
  setLoading();
  const store = state.filters.store;
  const query = params({
    q: kw,
    store,
    country: state.filters.country,
    lang: state.filters.lang === 'all' ? 'en' : state.filters.lang,
    limit: 12,
  });
  api(`/api/asosearch?${query}`)
    .then((data) => {
      state.mode = 'aso';
      state.activeAso = data;
      state.error = null;
      renderKeywordTable(data);
      renderSimilarBar(data.similar);
      persist();
    })
    .catch((err) => setError(err.message))
    .finally(hideLoading);
}

function runCommentSearch(keyword, silent = false) {
  const term = (keyword !== undefined ? keyword : $('#commentSearchInput').value || '').trim();
  if (term.length < 2) {
    if (state.selectedAppId) { fetchAppReviews(); return; }
    showEmpty('Search reviews', `Select an app in the sidebar, or type a keyword to filter reviews.`);
    return;
  }
  if (!state.apps.length) { showEmpty('No tracked apps', `Add an app (top-left +) before searching reviews.`); return; }

  const app = state.apps.find((a) => a.id === state.selectedAppId);
  if (!app) { showEmpty('Select an app first', 'Click an app in the sidebar to choose which app to search reviews for.'); return; }
  updateReviewAppLabel(app);
  setLoading('comments');
  state.lastCommentQuery = term;

  const store = state.filters.store;
  const allLangs = state.filters.lang === 'all';
  const query = params({
    appId: app.primaryAppId,
    platform: store,
    country: state.filters.country,
    lang: allLangs ? 'all' : state.filters.lang,
    multi: allLangs ? '1' : '',
    maxLanguages: allLangs ? '6' : '1',
    max: String(state.filters.maxReviews || 250),
    anyKeyword: term,
    minRating: state.filters.starMin,
    maxRating: state.filters.starMax,
  });
  api(`/api/reviews?${query}`)
    .then((data) => {
      state.mode = 'comments';
      state.activeAso = null;
      state.lastReviews = data.reviews || [];
      renderCommentTable(state.lastReviews, term, app);
      renderReviewSummary(data, app);
      renderSimilarBar([]);
      persist();
    })
    .catch((err) => setError(err.message))
    .finally(hideLoading);
}

// --- Auto-fetch all reviews for selected app ---
function fetchAppReviews() {
  const app = state.apps.find(a => a.id === state.selectedAppId);
  if (!app) return;
  setLoading('comments');
  state.lastCommentQuery = '';
  const store = state.filters.store;
  const allLangs = state.filters.lang === 'all';
  const query = params({
    appId: app.primaryAppId,
    platform: store,
    country: state.filters.country,
    lang: allLangs ? 'all' : state.filters.lang,
    multi: allLangs ? '1' : '',
    maxLanguages: allLangs ? '6' : '1',
    max: String(state.filters.maxReviews || 250),
    minRating: state.filters.starMin,
    maxRating: state.filters.starMax,
  });
  api(`/api/reviews?${query}`)
    .then((data) => {
      state.mode = 'comments';
      state.activeAso = null;
      state.lastReviews = data.reviews || [];
      renderCommentTable(state.lastReviews, '', app);
      renderReviewSummary(data, app);
      renderSimilarBar([]);
      persist();
    })
    .catch((err) => setError(err.message))
    .finally(hideLoading);
}

// --- Comment input enable/disable ---
function updateCommentInputState() {
  const enabled = !!state.selectedAppId;
  const input = $('#commentSearchInput');
  const btn = $('#commentSearchBtn');
  input.disabled = !enabled;
  btn.disabled = !enabled;
  input.placeholder = enabled ? 'Filter reviews by keyword…' : 'Select an app first…';
}

// --- Table rendering ---
function skeletonRows(mode = 'aso') {
  const cols = mode === 'comments'
    ? ['55%', '40%', '85%', '35%', '60%']
    : ['65%', '45%', '75%', '75%', '30%', '85%'];
  return Array.from({ length: 5 }, () =>
    `<tr class="skel-tr">${cols.map((w) =>
      `<td><div class="skel" style="width:${w}"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

function setLoading(mode = 'aso') {
  state.loading = true;
  state.error = null;
  $('#emptyState').classList.add('hidden');
  $('#errorState').classList.add('hidden');
  $('#loadingState').classList.add('hidden');
  if ($('#reviewSummary')) $('#reviewSummary').classList.add('hidden');
  setTableHeaders(mode);
  $('#tableBody').innerHTML = skeletonRows(mode);
}

function hideLoading() {
  state.loading = false;
}

function setError(message) {
  state.loading = false;
  $('#errorMessage').textContent = message;
  if ($('#reviewSummary')) $('#reviewSummary').classList.add('hidden');
  $('#errorState').classList.remove('hidden');
  $('#emptyState').classList.add('hidden');
  $('#loadingState').classList.add('hidden');
}

function showEmpty(title, desc) {
  state.loading = false;
  if ($('#reviewSummary')) $('#reviewSummary').classList.add('hidden');
  $('#loadingState').classList.add('hidden');
  $('#tableBody').innerHTML = '';
  $('#emptyState').querySelector('.empty-title').textContent = title || 'Nothing here yet';
  $('#emptyState').querySelector('.empty-desc').textContent = desc || '';
  $('#emptyState').classList.remove('hidden');
  $('#errorState').classList.add('hidden');
}

function hideEmpty() {
  $('#emptyState').classList.add('hidden');
  $('#errorState').classList.add('hidden');
  $('#loadingState').classList.add('hidden');
}

function metricCell(value, colorFn, label) {
  const v = clamp(value, 0, 100);
  const color = colorFn(v);
  return `
    <div class="kw-metric">
      <div class="kw-metric-bar"><div class="kw-metric-fill ${color}" style="width:${v}%"></div></div>
      <div class="kw-metric-val"><span class="kw-metric-label">${label}</span>${Math.round(v)}</div>
    </div>`;
}

function appsChips(apps, max = 5) {
  const chips = (apps || []).slice(0, max).map((app) => {
    const name = app.name || app.title || '';
    const short = name.replace(/\s.*$/, '').slice(0, 11);
    return `
    <div class="kw-app-chip" data-app-index="${escapeHtml(app._index)}" data-pop="1" title="${escapeHtml(name)}">
      <div class="kw-app-chip-icon">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="" loading="lazy">` : `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`}</div>
      <div class="kw-app-chip-name">${escapeHtml(short)}</div>
    </div>`;
  }).join('');
  const more = (apps || []).length > max ? `<button class="kw-apps-more" data-pop="more">+${(apps || []).length - max}</button>` : '';
  return `<div class="kw-apps">${chips}${more}</div>`;
}

function buildAsoRow(data, isMain) {
  const apps = data.apps || [];
  const metrics = data.metrics || {};
  const badge = isMain ? 'ASO' : 'similar';
  const history = data.chart || [];
  const historyLines = history.length
    ? `<span class="kw-history-hint" title="${escapeHtml(history.map(h => `${h.date}: ${h.position || '—'}`).join('\n'))}">${history.length} snapshots</span>`
    : '';
  return `
  <tr data-row-kind="aso" data-row-kw="${escapeHtml(data.keyword)}">
    <td class="kw-col-keyword"><div class="kw-keyword-wrap"><div><span class="kw-keyword">${escapeHtml(data.keyword)}</span><span class="kw-keyword-type"${isMain ? '' : ' style="opacity:.7"'}>${badge}</span></div></div></td>
    <td class="kw-col-updated"><span class="kw-updated">${relativeTime(data.analyzedAt)}</span></td>
    <td class="kw-col-pop">${metricCell(metrics.popularity ?? 0, pctColor, '')}</td>
    <td class="kw-col-diff">${metricCell(metrics.difficulty ?? 0, diffColor, '')}</td>
    <td class="kw-col-pos"><span class="kw-pos">${metrics.position ?? '—'}</span>${historyLines}</td>
    <td class="kw-col-apps">${appsChips(apps.map((a, i) => ({ ...a, _index: i })))}</td>
  </tr>`;
}

function buildLoadingRow(kw) {
  return `
  <tr data-row-kind="aso-loading" data-row-kw="${escapeHtml(kw)}">
    <td class="kw-col-keyword"><div class="kw-keyword-wrap"><div><span class="kw-keyword">${escapeHtml(kw)}</span><span class="kw-keyword-type" style="opacity:.7">similar</span></div></div></td>
    <td class="kw-col-updated"><span class="kw-updated" style="color:var(--text-tertiary)">Loading…</span></td>
    <td colspan="4" style="text-align:center"><div class="spinner" style="width:12px;height:12px;margin:6px auto"></div></td>
  </tr>`;
}

function renderKeywordTable(data) {
  hideEmpty();
  setTableHeaders('aso');
  // skeleton already shown by setLoading(); clear it now
  state.asoCache = new Map();
  state.asoCache.set(data.keyword, data);

  // Fetch rank history for the main keyword and attach to the row.
  fetchRankHistory(data.keyword, data.store).then((chart) => {
    const updated = { ...data, chart };
    state.asoCache.set(data.keyword, updated);
    const rowEl = $('#tableBody').querySelector(`tr[data-row-kw="${CSS.escape(data.keyword)}"]`);
    if (rowEl) rowEl.outerHTML = buildAsoRow(updated, true);
  });

  const similar = (data.similar || []).slice(0, 5);
  const rows = [buildLoadingRow(data.keyword), ...similar.map(buildLoadingRow)];
  $('#tableBody').innerHTML = rows.join('');

  for (const kw of similar) {
    const store = state.filters.store;
    const query = params({ q: kw, store, country: state.filters.country, lang: state.filters.lang === 'all' ? 'en' : state.filters.lang, limit: 12 });
    api(`/api/asosearch?${query}`)
      .then((d) => {
        state.asoCache.set(kw, d);
        const rowEl = $('#tableBody').querySelector(`tr[data-row-kw="${CSS.escape(kw)}"]`);
        if (rowEl) rowEl.outerHTML = buildAsoRow(d, false);
      })
      .catch(() => {
        const rowEl = $('#tableBody').querySelector(`tr[data-row-kw="${CSS.escape(kw)}"]`);
        if (rowEl) rowEl.remove();
      });
  }
}

async function fetchRankHistory(keyword, store) {
  try {
    const data = await api(`/api/asosearch/history?${params({ q: keyword, store })}`);
    return data.chart || [];
  } catch {
    return [];
  }
}

function setTableHeaders(mode) {
  const thead = $('#kwTableHead');
  const table = $('#keywordTable');
  if (!thead) return;
  // Toggle comment-table class for proper text wrapping
  if (table) {
    if (mode === 'comments') table.classList.add('comment-table');
    else table.classList.remove('comment-table');
  }
  if (mode === 'comments') {
    const app = state.selectedAppId ? state.apps.find(a => a.id === state.selectedAppId) : null;
    const appLabel = app ? ` — ${escapeHtml(app.name)}` : '';
    thead.innerHTML = `<tr>
      <th class="kw-th kw-col-keyword">Search Term</th>
      <th class="kw-th kw-col-updated">Review Date</th>
      <th class="kw-th kw-col-comment">Review${appLabel}</th>
      <th class="kw-th kw-col-rating">Rating</th>
      <th class="kw-th kw-col-apps">App</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr>
      <th class="kw-th kw-col-keyword">Keyword / Topic</th>
      <th class="kw-th kw-col-updated">Last Updated</th>
      <th class="kw-th kw-col-pop">Popularity</th>
      <th class="kw-th kw-col-diff">Difficulty</th>
      <th class="kw-th kw-col-pos">Position</th>
      <th class="kw-th kw-col-apps">Apps in Ranking</th>
    </tr>`;
  }
}

function starsHtml(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return `<span class="star-rating">${'★'.repeat(n)}<span class="star-empty">${'★'.repeat(5 - n)}</span></span>`;
}

function renderCommentTable(reviews, term, app) {
  hideEmpty();
  setTableHeaders('comments');

  if (!reviews.length) {
    $('#tableBody').innerHTML = `<tr><td colspan="5"><div class="modal-empty">No matching reviews found.</div></td></tr>`;
    return;
  }

  const termDisplay = term || 'All Reviews';
  const termClass = term ? 'kw-keyword' : 'kw-keyword kw-keyword-all';
  const appChip = [{ name: app.name, icon: app.icon || '', _index: 0, platform: app.platform }];
  const shown = reviews.slice(0, RENDER_CAP);
  state.__reviewData = { reviews: shown, term, app };
  $('#tableBody').innerHTML = shown.map((r, i) => {
    const text = (r.text || r.title || '').trim();
    return `
    <tr data-row-kind="comment" data-review-index="${i}" class="review-row-clickable" title="Click to view full review">
      <td class="kw-col-keyword"><span class="${termClass}">${escapeHtml(termDisplay)}</span></td>
      <td class="kw-col-updated"><span class="kw-updated">${relativeTime(r.date)}</span></td>
      <td class="kw-col-comment"><div class="review-text-cell">${escapeHtml(text)}</div></td>
      <td class="kw-col-rating">${starsHtml(r.rating)}</td>
      <td class="kw-col-apps">${appsChips(appChip)}</td>
    </tr>`;
  }).join('') + (reviews.length > RENDER_CAP
    ? `<tr><td colspan="5"><div class="modal-empty review-truncate-note">… and ${reviews.length - RENDER_CAP} more matching ${reviews.length - RENDER_CAP === 1 ? 'review' : 'reviews'}.</div></td></tr>`
    : '');
}

// --- Review detail modal (opened by clicking a review row) ---
function openReviewModal(review, app) {
  if (!review) return;
  const platformName = review.platform === 'apple' ? 'App Store' : 'Google Play';
  const title = (review.title || '').trim();
  const body = (review.text || '').trim();
  const dateAbs = review.date ? new Date(review.date).toLocaleString() : 'Unknown date';
  const rating = Number(review.rating) || 0;
  const helpful = review.helpful === '' || review.helpful == null ? null : Number(review.helpful);

  $('#reviewModalTitle').textContent = title || 'Review';
  $('#reviewModalBody').innerHTML = `
    <div class="review-detail-head">
      <div class="review-detail-stars">${starsHtml(rating)}<span class="review-detail-score">${rating}/5</span></div>
      <span class="review-detail-platform ${review.platform === 'apple' ? 'apple' : 'google'}">${platformName}</span>
    </div>
    <div class="review-detail-meta">
      ${review.author ? `<span class="review-detail-author">${escapeHtml(review.author)}</span>` : '<span class="review-detail-author">Anonymous</span>'}
      <span>${escapeHtml(dateAbs)}</span>
      ${review.version ? `<span class="review-detail-version">v${escapeHtml(review.version)}</span>` : ''}
      ${helpful != null && !Number.isNaN(helpful) ? `<span>${helpful} found helpful</span>` : ''}
    </div>
    <div class="review-detail-text">${escapeHtml(body || '(No review text provided)')}</div>
    ${review.replyText ? `<div class="review-detail-reply"><div class="review-detail-reply-label">Developer response</div><div>${escapeHtml(review.replyText)}</div></div>` : ''}
    <div class="review-detail-actions">
      ${app ? `<span class="review-detail-app">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="" loading="lazy">` : ''}<span>${escapeHtml(app.name || '')}</span></span>` : ''}
      ${review.url ? `<a class="pill-btn" href="${escapeHtml(review.url)}" target="_blank" rel="noopener">Open in ${platformName}</a>` : ''}
    </div>`;
  $('#reviewModal').classList.remove('hidden');
}

function closeReviewModal() { $('#reviewModal').classList.add('hidden'); }

// --- Review summary bar (fetched / filtered / store limits) ---
function renderReviewSummary(data, app) {
  const bar = $('#reviewSummary');
  if (!bar) return;
  const reviews = data && data.reviews ? data.reviews : [];
  const fetched = Number(data && data.totalFetched) || 0;
  const afterFilters = reviews.length;

  if (!reviews.length) {
    bar.classList.add('hidden');
    return;
  }

  const meta = (data && data.meta) || {};
  const multi = Number(data && data.languages && data.languages.length) > 1;
  const parts = [`Fetched <strong>${fetched}</strong> review${fetched === 1 ? '' : 's'}`];
  if (afterFilters < fetched) parts.push(`${afterFilters} match filters`);
  parts.push(`showing <strong>${Math.min(afterFilters, RENDER_CAP)}</strong> of ${afterFilters}`);

  let hint = '';
  const anyTruncated = meta.sources ? meta.sources.some((s) => s.moreAvailable === true) : Boolean(meta.moreAvailable);
  if (anyTruncated && afterFilters > RENDER_CAP) {
    hint = `More reviews available — raise “Max” (top right) or use Load more below.`;
  } else if (anyTruncated) {
    hint = `More reviews are available — raise “Max” (top right) to fetch deeper.`;
  } else if (multi) {
    hint = `“All languages” splits the max across ${data.languages.length} languages.`;
  } else if (meta.note) {
    hint = meta.note;
  }

  const next = MAX_REVIEW_STEPS.find((s) => s > (Number(state.filters.maxReviews) || 250));
  bar.innerHTML = `<span class="review-summary-text">${parts.join(' · ')}</span>` +
    (hint ? `<span class="review-summary-hint">${escapeHtml(hint)}</span>` : '') +
    (next && !multi
      ? `<button class="pill-btn" id="loadMoreReviews" title="Fetch up to ${next} reviews">Load more</button>`
      : '');
  bar.classList.remove('hidden');
}

function loadMoreReviews() {
  const cur = Number(state.filters.maxReviews) || 250;
  const next = MAX_REVIEW_STEPS.find((s) => s > cur);
  if (!next) return;
  state.filters.maxReviews = next;
  $('#maxReviews').value = String(next);
  persist();
  const app = state.apps.find((a) => a.id === state.selectedAppId);
  if (app) {
    if (state.lastCommentQuery) runCommentSearch(state.lastCommentQuery, true);
    else fetchAppReviews();
  }
}

// --- Similar keywords bar ---
function renderSimilarBar(similar) {
  const bar = $('#similarBar');
  if (!similar || !similar.length) { bar.classList.add('hidden'); return; }
  bar.innerHTML = `<span class="similar-bar-label">Similar keywords</span>` +
    similar.map((k) => `<button class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('');
  bar.classList.remove('hidden');
}

// --- Detail panel (keyword analysis) ---
function openKeywordDetail(data) {
  state.activeAso = data;
  const m = data.metrics || {};
  const appRows = (data.apps || []).map((app, i) => `
    <div class="app-row" data-asa-app="${i}">
      <div class="app-row-icon">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="" loading="lazy">` : ''}</div>
      <div class="app-row-info">
        <div class="app-row-name">${escapeHtml(app.name)}</div>
        <div class="app-row-meta">${(app.stores || []).map((s) => escapeHtml(s.platform === 'apple' ? 'App Store' : 'Google Play') + ' · ' + escapeHtml(s.appId)).join('  ·  ')}</div>
        <div class="app-row-tags">
          <span class="tag good">★ ${app.avgRating ?? '—'}</span>
          <span class="tag">${roundToK(app.totalReviews)} reviews</span>
          ${app.adsActive ? '<span class="tag ads">ads</span>' : ''}
          ${(app.stores || []).map((s) => `<span class="tag store-${escapeHtml(s.platform)}">${escapeHtml(s.platform === 'apple' ? 'App Store' : 'Google Play')}</span>`).join('')}
        </div>
      </div>
      <button class="app-select-btn" data-select-aso="${i}" title="Select & track this app">Select</button>
      <span class="app-row-rank">${i + 1}</span>
    </div>`).join('');

  $('#detailTitle').textContent = `“${data.keyword}” — analysis`;
  $('#detailBody').innerHTML = `
    <div class="kw-hero">
      <div class="kw-hero-card"><div class="value" data-c="pop">${m.popularity ?? '—'}</div><div class="label">Popularity</div></div>
      <div class="kw-hero-card"><div class="value" data-c="diff">${m.difficulty ?? '—'}</div><div class="label">Difficulty</div></div>
      <div class="kw-hero-card"><div class="value" data-c="opp">${m.opportunity ?? '—'}</div><div class="label">Opportunity</div></div>
      <div class="kw-hero-card"><div class="value">${roundToK(m.totalReviews)}</div><div class="label">Total reviews</div></div>
      <div class="kw-hero-card"><div class="value">${m.avgRating ?? '—'}</div><div class="label">Avg rating</div></div>
      <div class="kw-hero-card"><div class="value">${m.adsFraction ?? 0}%</div><div class="label">Apps with ads</div></div>
    </div>
    ${data.similar && data.similar.length ? `<div class="similar-bar" style="border:none;padding:0 0 10px"><span class="similar-bar-label">Similar</span>${data.similar.map((k) => `<button class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}</div>` : ''}
    ${data.competitorKeywords && data.competitorKeywords.length ? `<div class="similar-bar" style="border:none;padding:0 0 10px"><span class="similar-bar-label">Top apps ranked keywords</span>${data.competitorKeywords.map((c) => `<div class="competitor-keywords"><span class="competitor-name">${escapeHtml(c.app)}</span><div class="competitor-chips">${c.keywords.map((k) => `<button class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
    <div class="detail-subtitle" style="font-size:12px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Apps in ranking (${(data.apps || []).length})</div>
    ${appRows || '<div class="modal-empty">No apps found.</div>'}
  `;
  $('#detailOverlay').classList.remove('hidden');
}

function closeDetailPanel() {
  $('#detailOverlay').classList.add('hidden');
}

function updateReviewAppLabel(app) {
  const label = $('#reviewAppLabel');
  const name = $('#reviewAppName');
  if (app) {
    name.textContent = app.name;
    label.classList.remove('hidden');
  } else {
    label.classList.add('hidden');
  }
}

// --- All apps for keyword modal ---
function openKeywordAppsModal(data) {
  $('#kwModalTitle').textContent = `“${data.keyword}” — all apps (${(data.apps || []).length})`;
  $('#kwModalBody').innerHTML = `<div class="store-detail-list">${(data.apps || []).map((app, i) => `
    <div class="app-row" data-asa-app="${i}">
      <div class="app-row-icon">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="" loading="lazy">` : ''}</div>
      <div class="app-row-info">
        <div class="app-row-name">${escapeHtml(app.name)}</div>
        <div class="app-row-meta">${(app.stores || []).map((s) => `${escapeHtml(s.platform === 'apple' ? 'App Store' : 'Google Play')} · ${escapeHtml(s.appId)} · ★${s.rating} · ${roundToK(s.reviews)} reviews`).join('<br>')}</div>
        <div class="app-row-tags">
          <span class="tag good">★ ${app.avgRating ?? '—'}</span>
          <span class="tag">${roundToK(app.totalReviews)} reviews</span>
          ${app.adsActive ? '<span class="tag ads">active ads</span>' : ''}
          ${app.fbAds && app.fbAds.activeAds ? `<span class="tag ads">Meta ads: ${app.fbAds.activeAds} active</span>` : ''}
        </div>
      </div>
      <button class="app-select-btn" data-select-aso="${i}" title="Select & track this app">Select</button>
      <span class="app-row-rank">${i + 1}</span>
    </div>`).join('') || '<div class="modal-empty">No apps found.</div>'}</div>`;
  $('#keywordAppsModal').classList.remove('hidden');
}

// --- App detail modal ---
function renderAppStoreCard(store, title) {
  const freeTag = store.free ? 'Free' : store.price ? `$${store.price}` : 'Paid';
  return `
    <div class="store-detail-card">
      <div class="header">
        <span class="tag store-${escapeHtml(store.platform)}">${escapeHtml(store.platform === 'apple' ? 'App Store' : 'Google Play')}</span>
        <span style="flex:1"></span>
        ${store.url ? `<a class="store-link" href="${escapeHtml(store.url)}" target="_blank" rel="noopener">Open store ↗</a>` : ''}
      </div>
      <div class="stat-grid">
        <div class="stat-cell"><div class="k">Rating</div><div class="v">${store.score ?? store.rating ?? '—'}★</div></div>
        <div class="stat-cell"><div class="k">Reviews</div><div class="v">${roundToK(store.reviews)}</div></div>
        <div class="stat-cell"><div class="k">Installs / Price</div><div class="v">${escapeHtml(store.installs || freeTag || '—')}</div></div>
        <div class="stat-cell"><div class="k">Category</div><div class="v">${escapeHtml(store.genre || '—')}</div></div>
        <div class="stat-cell"><div class="k">Updated</div><div class="v">${relativeTime(store.updated)}</div></div>
        <div class="stat-cell"><div class="k">Ads</div><div class="v">${store.containsAds ? 'Yes' : 'Not flagged'}</div></div>
      </div>
    </div>`;
}

function openAppDetailModal(app) {
  $('#appDetailModal').classList.remove('hidden');
  $('#appDetailTitle').textContent = app.name || 'App details';
  $('#appDetailBody').innerHTML = `
    <div class="app-detail-hero">
      <div class="big-icon">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="">` : ''}</div>
      <div>
        <div class="name">${escapeHtml(app.name)}</div>
        <div class="sub">${escapeHtml(app.subtitle || '')}<br>${escapeHtml((app.stores || []).map((s) => s.platform === 'apple' ? 'App Store · ' + s.appId : 'Google Play · ' + s.appId).join('<br>'))}</div>
      </div>
    </div>
    <div class="store-detail-list">${(app.stores || []).map((s, i) => renderAppStoreCard(s)).join('') || '<div class="modal-empty">Details unavailable.</div>'}</div>
  `;
}

async function fetchAndShowAppDetails(app) {
  // ASO result apps already carry full store detail data — no round-trip needed.
  if (!app.primaryAppId && app.stores && app.stores.length && app.stores[0].rating !== undefined) {
    openAppDetailModal(app);
    return;
  }
  $('#appDetailModal').classList.remove('hidden');
  $('#appDetailTitle').textContent = app.name || 'App details';
  $('#appDetailBody').innerHTML = `<div class="loading-state" style="display:flex;align-items:center;justify-content:center;padding:40px"><div class="spinner"></div></div>`;
  try {
    const q = params({
      appId: app.primaryAppId,
      platform: app.platform,
      store: 'both',
      country: state.filters.country,
      lang: state.filters.lang === 'all' ? 'en' : state.filters.lang,
    });
    const data = await api(`/api/app-details?${q}`);
    const primary = data.primary || {};
    const counterpart = data.counterpart || null;
    const stores = [primary, counterpart].filter(Boolean);
    $('#appDetailTitle').textContent = primary.title || app.name;
    $('#appDetailBody').innerHTML = `
      <div class="app-detail-hero">
        <div class="big-icon">${primary.icon ? `<img src="${escapeHtml(primary.icon)}" alt="">` : ''}</div>
        <div>
          <div class="name">${escapeHtml(primary.title || app.name)}</div>
          <div class="sub">${escapeHtml(primary.developer || '')}</div>
        </div>
      </div>
      <div class="store-detail-list">${stores.map((s) => renderAppStoreCard(s)).join('') || '<div class="modal-empty">Details unavailable.</div>'}</div>
    `;
  } catch (err) {
    $('#appDetailBody').innerHTML = `<div class="modal-empty" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }
}

// --- Sidebar / folders ---
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      apps: state.apps,
      folders: state.folders,
      country: state.filters.country,
      lang: state.filters.lang,
      maxReviews: state.filters.maxReviews,
    }));
  } catch { /* storage may be unavailable */ }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.apps)) state.apps = data.apps;
    if (Array.isArray(data.folders)) state.folders = data.folders;
    if (data.country) state.filters.country = data.country;
    if (data.lang) state.filters.lang = data.lang;
    if (data.maxReviews) state.filters.maxReviews = Number(data.maxReviews) || 250;
  } catch { /* corrupted or unavailable */ }
}

function appItemHtml(app, indented = false) {
  const active = app.id === state.selectedAppId;
  const selected = state.selectedApps.has(app.id);
  const initials = (app.name || '?').slice(0, 2).toUpperCase();
  const bg = app.color || '#8e8e93';
  const platform = app.platform === 'apple' ? 'App Store' : 'Google Play';
  return `<button class="app-item${active ? ' active' : ''}${selected ? ' selected' : ''}${indented ? ' app-item-indented' : ''}" data-app-id="${escapeHtml(app.id)}" draggable="true" title="${escapeHtml(app.name)}">
    <div class="app-item-icon" style="background:${bg}">${app.icon ? `<img src="${escapeHtml(app.icon)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : escapeHtml(initials)}</div>
    <div class="app-item-info">
      <div class="app-item-name">${escapeHtml(app.name)}</div>
      <div class="app-item-meta">${escapeHtml(platform)}</div>
    </div>
    <span class="app-item-remove" data-remove-app="${escapeHtml(app.id)}" title="Remove">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
    </span>
  </button>`;
}

function renderFolders() {
  const tree = $('#folderTree');
  if (!state.apps.length && !state.folders.length) {
    tree.innerHTML = '<div class="sidebar-apps-empty">No apps yet.\nClick + to add your first app.</div>';
    $('#footerMeta').textContent = 'No apps tracked';
    return;
  }

  const unfiledApps = state.apps.filter(a => !a.folderId);
  const folderAppsMap = new Map(state.folders.map(f => [f.id, []]));
  state.apps.filter(a => a.folderId).forEach(a => {
    const arr = folderAppsMap.get(a.folderId);
    if (arr) arr.push(a); else { a.folderId = null; unfiledApps.push(a); }
  });

  const folderHtml = (folder) => {
    const apps = folderAppsMap.get(folder.id) || [];
    const expanded = folder.expanded !== false;
    return `<div class="folder-group${expanded ? '' : ' collapsed'}" data-folder-id="${escapeHtml(folder.id)}">
      <div class="folder-header" data-folder-toggle="${escapeHtml(folder.id)}">
        <svg class="folder-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5L5 6.5L8 3.5"/></svg>
        <svg class="folder-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3A1.5 1.5 0 000 4.5v7A1.5 1.5 0 001.5 13h13a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0014.5 3H8.621a1.5 1.5 0 01-1.06-.44L6.44 1.44A1.5 1.5 0 005.378 1H1.5z"/></svg>
        <span class="folder-name-label" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</span>
        <span class="folder-count">${apps.length}</span>
        <div class="folder-actions">
          <button class="folder-btn" data-rename-folder="${escapeHtml(folder.id)}" title="Rename">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2l2 2M2 8l-1 3 3-1L9.5 4.5l-2-2L2 8z"/></svg>
          </button>
          <button class="folder-btn folder-btn-danger" data-delete-folder="${escapeHtml(folder.id)}" title="Delete folder">
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
          </button>
        </div>
      </div>
      <div class="folder-body folder-drop-zone" data-drop-folder="${escapeHtml(folder.id)}">
        ${apps.length ? apps.map(a => appItemHtml(a, true)).join('') : '<div class="folder-empty-hint">Drop apps here</div>'}
      </div>
    </div>`;
  };

  tree.innerHTML = `<div class="root-drop-zone" data-drop-folder="__root__">${unfiledApps.map(a => appItemHtml(a)).join('')}</div>${state.folders.map(folderHtml).join('')}`;

  const n = state.apps.length;
  $('#footerMeta').textContent = `${n} app${n === 1 ? '' : 's'} tracked`;
  initFolderDragDrop();
}

function initFolderDragDrop() {
  $('#folderTree').querySelectorAll('.app-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      draggingAppId = el.dataset.appId;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggingAppId = null;
      $('#folderTree').querySelectorAll('.folder-drag-over').forEach(z => z.classList.remove('folder-drag-over'));
    });
  });
  $('#folderTree').querySelectorAll('[data-drop-folder]').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      if (!draggingAppId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('folder-drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('folder-drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('folder-drag-over');
      if (!draggingAppId) return;
      const targetId = zone.dataset.dropFolder;
      const app = state.apps.find(a => a.id === draggingAppId);
      if (app) { app.folderId = targetId === '__root__' ? null : targetId; persist(); renderFolders(); }
    });
  });
}

function createFolder() {
  const id = `folder_${Date.now()}`;
  state.folders.push({ id, name: 'New Folder', expanded: true });
  persist();
  renderFolders();
  startFolderRename(id);
}

function startFolderRename(folderId) {
  const nameEl = $('#folderTree').querySelector(`.folder-name-label[data-folder-id="${folderId}"]`);
  if (!nameEl) return;
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  nameEl.contentEditable = 'true';
  nameEl.focus();
  try { const r = document.createRange(); r.selectNodeContents(nameEl); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* ignore */ }
  const finish = () => {
    nameEl.contentEditable = 'false';
    folder.name = nameEl.textContent.trim() || folder.name;
    nameEl.textContent = folder.name;
    persist();
  };
  nameEl.addEventListener('blur', finish, { once: true });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = folder.name; nameEl.blur(); }
  });
}

function deleteFolder(folderId) {
  state.apps.filter(a => a.folderId === folderId).forEach(a => { a.folderId = null; });
  state.folders = state.folders.filter(f => f.id !== folderId);
  persist();
  renderFolders();
}

function toggleFolder(folderId) {
  const f = state.folders.find(f => f.id === folderId);
  if (f) { f.expanded = !(f.expanded !== false); persist(); renderFolders(); }
}

function selectAsoApp(asoApp) {
  let tracked = state.apps.find(a =>
    asoApp.stores && asoApp.stores.some(s => a.primaryAppId === s.appId)
  );
  if (!tracked) {
    const id = `app_${Date.now()}`;
    const stores = (asoApp.stores || []).map(s => ({ platform: s.platform, appId: s.appId }));
    tracked = {
      id,
      name: asoApp.name,
      platform: stores[0]?.platform || 'google',
      primaryAppId: stores[0]?.appId || '',
      stores,
      icon: asoApp.icon || '',
      folderId: null,
      color: CAT_COLORS[state.apps.length % CAT_COLORS.length],
    };
    state.apps.push(tracked);
    persist();
  }
  closeDetailPanel();
  $('#keywordAppsModal').classList.add('hidden');
  selectSidebarApp(tracked);
}

function removeApp(appId) {
  state.apps = state.apps.filter((a) => a.id !== appId);
  state.selectedApps.delete(appId);
  if (state.selectedAppId === appId) {
    state.selectedAppId = [...state.selectedApps].at(-1) || null;
    if (!state.selectedAppId) updateReviewAppLabel(null);
  }
  persist();
  renderFolders();
  updateCommentInputState();
}

function selectSidebarApp(app, multi = false) {
  if (multi) {
    if (state.selectedApps.has(app.id)) {
      state.selectedApps.delete(app.id);
      state.selectedAppId = [...state.selectedApps].at(-1) || null;
    } else {
      state.selectedApps.add(app.id);
      state.selectedAppId = app.id;
    }
  } else {
    state.selectedApps = new Set([app.id]);
    state.selectedAppId = app.id;
  }
  const selCount = state.selectedApps.size;
  const labelApp = selCount > 1 ? { name: `${selCount} apps` } : (selCount === 1 ? app : null);
  updateReviewAppLabel(labelApp);
  updateCommentInputState();
  renderFolders();
  if (state.selectedAppId) fetchAppReviews();
}

// --- Add App modal ---
let modalDebounce = null;

function openAddAppModal() {
  $('#addAppModal').classList.remove('hidden');
  $('#addAppModal').style.zIndex = '600';
  $('#modalSearchInput').value = '';
  $('#modalResults').innerHTML = '<div class="modal-empty">Search for an app to add it to your tracking list.</div>';
  setTimeout(() => $('#modalSearchInput').focus(), 100);
}

function closeAddAppModal() {
  $('#addAppModal').classList.add('hidden');
}

async function searchAppsInModal() {
  const q = $('#modalSearchInput').value.trim();
  if (q.length < 2) return;
  const platform = $('#modalPlatform').value;
  $('#modalResults').innerHTML = '<div class="modal-empty">Searching…</div>';
  try {
    const data = await api(`/api/search?${params({ platform, q, country: state.filters.country, lang: state.filters.lang === 'all' ? 'en' : state.filters.lang, limit: 12 })}`);
    const merged = mergeModalResults(data.results || [], state.filters.store);
    $('#modalResults').__rows = merged;
    if (!merged.length) {
      $('#modalResults').innerHTML = '<div class="modal-empty">No results found. Try a different search term.</div>';
      return;
    }
    $('#modalResults').innerHTML = merged.map((group, i) => {
      const storeNames = group.stores.map((s) => s.platform).join(' + ');
      const tag = group.stores.length > 1 ? `<span class="tag ads">merged</span>` : '';
      const already = state.apps.some((a) => a.primaryAppId === group.stores[0].appId && (a.stores && a.stores.some((s2) => s2.appId === group.stores[0].appId)));
      return `
        <div class="modal-app-result">
          <div class="modal-app-icon">${group.icon ? `<img src="${escapeHtml(group.icon)}" alt="" loading="lazy">` : ''}</div>
          <div class="modal-app-info">
            <div class="modal-app-title">${escapeHtml(group.name)}${tag}</div>
            <div class="modal-app-meta">${escapeHtml(storeNames)} · ${escapeHtml(group.developer || '')} · ${escapeHtml(group.score ?? '')}★</div>
          </div>
          <button class="modal-app-add${already ? ' added' : ''}" data-modal-index="${i}" ${already ? 'disabled' : ''}>${already ? 'Added' : '+ Add'}</button>
        </div>`;
    }).join('');
  } catch (err) {
    $('#modalResults').innerHTML = `<div class="modal-empty" style="color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }
}

function mergeModalResults(rows, storeFilter) {
  const groupsMap = new Map();
  for (const row of rows) {
    const key = normTitle(row.title) || `${row.platform}:${row.appId}`;
    if (storeFilter === 'google' && row.platform !== 'google') continue;
    if (storeFilter === 'apple' && row.platform !== 'apple') continue;
    if (!groupsMap.has(key)) groupsMap.set(key, { name: row.title || row.appId, developer: row.developer, icon: row.icon, score: row.score, stores: [] });
    groupsMap.get(key).stores.push({ platform: row.platform, appId: row.appId, icon: row.icon, url: row.url, score: row.score });
  }
  const sorted = [...groupsMap.values()].sort((a, b) => {
    const aS = a.stores.some((s) => s.platform === 'apple') ? 1 : 0;
    const bS = b.stores.some((s) => s.platform === 'apple') ? 1 : 0;
    return b.stores.length - a.stores.length || bS - aS;
  });
  return sorted;
}

function handleModalAdd(btn) {
  if (btn.disabled) return;
  const index = Number(btn.dataset.modalIndex);
  const rows = $(`#modalResults`).__rows;
  if (!rows || !rows[index]) return;
  const group = rows[index];
  addTrackedApp({ name: group.name, stores: group.stores });
  btn.classList.add('added');
  btn.disabled = true;
  btn.textContent = 'Added';
}

function addTrackedApp({ name, stores }) {
  const normStores = (stores || [{ platform: 'google', appId: '' }]).map((s) => ({ platform: s.platform, appId: s.appId }));
  if (!normStores.length) return;
  const exists = state.apps.some((a) => normStores.some((s) => a.primaryAppId === s.appId));
  if (exists) return;
  const id = `app_${Date.now()}`;
  state.apps.push({
    id,
    name: name || normStores[0].appId,
    platform: normStores[0].platform,
    primaryAppId: normStores[0].appId,
    stores: normStores,
    icon: (stores[0] && stores[0].icon) || '',
    folderId: null,
    color: CAT_COLORS[state.apps.length % CAT_COLORS.length],
  });
  persist();
  renderFolders();
}

// --- Full data structured view ---
function roundToKShort(v) {
  if (!v) return '0';
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function renderFullData(data) {
  const panel = $('#fullDataPanel');
  const header = $('#fullDataHeader');

  // Flatten all reviews into one ungrouped list, sorted by date descending.
  const storesEl = $('#fullDataStores');
  const storeLabels = { apple: 'App Store', google: 'Google Play' };

  const allReviews = [];
  for (const grp of (data.groups || [])) {
    for (const r of (grp.reviews || [])) {
      allReviews.push({ ...r, platform: grp.platform || r.platform });
    }
  }
  allReviews.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Stats: server-provided once the stream is done; client-computed running
  // stats while it is still fetching in the background.
  let g = data.global;
  if (!g) {
    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sumRating = 0;
    let dateFrom = null;
    let dateTo = null;
    for (const r of allReviews) {
      const s = Number(r.rating);
      if (Number.isInteger(s) && s >= 1 && s <= 5) stars[s] += 1;
      if (Number.isFinite(s)) sumRating += s;
      const d = r.date ? new Date(r.date) : null;
      if (d && !Number.isNaN(d.getTime())) {
        if (!dateFrom || d < dateFrom) dateFrom = d;
        if (!dateTo || d > dateTo) dateTo = d;
      }
    }
    g = {
      count: allReviews.length,
      avgRating: allReviews.length ? Math.round((sumRating / allReviews.length) * 10) / 10 : null,
      dateFrom: dateFrom ? dateFrom.toISOString() : null,
      dateTo: dateTo ? dateTo.toISOString() : null,
      topTerms: null,
    };
  }
  const errs = data.errors && data.errors.length;

  header.innerHTML = `
    <div class="full-data-global-stats">
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Total reviews</span>
        <span class="full-data-global-stat-value">${roundToKShort(g.count || 0)}</span>
      </div>
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Avg rating</span>
        <span class="full-data-global-stat-value">${g.avgRating ?? '—'}${g.avgRating ? '<small>/5</small>' : ''}</span>
      </div>
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Date range</span>
        <span class="full-data-global-stat-value" style="font-size:14px">${g.dateFrom ? relativeTime(g.dateFrom) : '—'} – ${g.dateTo ? relativeTime(g.dateTo) : '—'}</span>
      </div>
      ${!data.done ? '<span class="full-data-stream-status">Fetching more…</span>' : ''}
      ${g.topTerms && g.topTerms.length
        ? `<div class="full-data-top-terms">
            <span class="full-data-top-terms-label">Top terms</span>
            ${g.topTerms.map(t => `<button class="full-data-term-chip">${escapeHtml(t)}</button>`).join('')}
          </div>`
        : ''}
      ${allReviews.length ? `<div class="full-data-export-actions">
        <button class="full-data-export-btn" data-full-data-action="export-csv" title="Download every fetched review as CSV (includes all comments)">Export CSV</button>
        <button class="full-data-export-btn" data-full-data-action="export-json" title="Download structured full-data as JSON">Export JSON</button>
      </div>` : ''}
    </div>
    ${errs ? `<div class="full-data-error-bar">${errs} group${errs === 1 ? '' : 's'} failed to fetch. Check console for details.</div>` : ''}
  `;

  const prevScroll = storesEl.scrollTop;

  if (!allReviews.length) {
    storesEl.innerHTML = data.done
      ? '<div class="full-data-empty-groups">No review data available.</div>'
      : '<div class="full-data-empty-groups">Fetching reviews…</div>';
    return;
  }

  const shown = allReviews.slice(0, 50);
  const more = allReviews.length - shown.length;

  const rows = shown.map(r => `
    <div class="full-data-review" data-review-platform="${r.platform}" data-review-index="${Math.abs(hashCode(r.author + r.text + r.date)) % 100000}">
      <div class="full-data-review-head">
        <span class="full-data-review-rating">${'★'.repeat(Math.max(1, Math.round(Number(r.rating) || 0)))}</span>
        <span class="full-data-review-platform ${r.platform}">${storeLabels[r.platform] || r.platform}</span>
        <span class="full-data-review-author">${escapeHtml(r.author || 'Anonymous')}</span>
      </div>
      <div class="full-data-review-meta">
        <span class="full-data-review-date">${relativeTime(r.date)}</span>
        ${r.lang ? `<span>${escapeHtml(r.lang)}</span>` : ''}
        ${r.version ? `<span class="full-data-review-version">v${escapeHtml(r.version)}</span>` : ''}
      </div>
      <div class="full-data-review-text">${escapeHtml(r.text || r.title || '(No text)')}</div>
      ${r.replyText ? `<div class="full-data-review-text" style="color:var(--accent);border-left:2px solid var(--accent);padding-left:8px;margin-top:3px">${escapeHtml(r.replyText)}</div>` : ''}
    </div>
  `).join('');

  storesEl.innerHTML = `
    <div class="full-data-review-list">
      ${rows}
      ${!data.done
        ? '<div class="full-data-group-footer" style="border:none;background:transparent">Fetching more reviews…</div>'
        : more > 0
          ? (fullDataShownCount < FULL_DATA_RENDER_CAP
            ? `<div class="full-data-show-more">
                <span class="full-data-count">+${more} more reviews</span>
                <button class="pill-btn" data-full-data-action="show-more" title="Show next ${Math.min(FULL_DATA_SHOW_STEP, more)} reviews">Show more</button>
              </div>`
            : `<div class="full-data-show-more">
                <span class="full-data-count">Showing the first ${FULL_DATA_RENDER_CAP} of ${allReviews.length} reviews — export to get all of them</span>
                <button class="full-data-export-btn" data-full-data-action="export-csv">Export all (CSV)</button>
              </div>`)
          : ''}
    </div>
  `;
  storesEl.scrollTop = prevScroll;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function closeFullDataPanel() {
  fullDataStreamCtl?.abort();
  $('#fullDataPanel').classList.add('hidden');
  $('#tableContainer').classList.remove('hidden');
  $('#similarBar').classList.remove('hidden');
  if (state.mode === 'comments' && state.lastReviews.length) {
    renderCommentTable(state.lastReviews, state.lastCommentQuery || '', state.apps.find(a => a.id === state.selectedAppId));
    renderReviewSummary(state.lastReviews.length ? { reviews: state.lastReviews, totalFetched: state.lastReviews.length, totalAfterFilters: state.lastReviews.length } : {}, state.apps.find(a => a.id === state.selectedAppId));
  }
  fullDataPayload = null;
}

// Consumes the /api/reviews.full.stream NDJSON response, rendering each group
// as it arrives while the rest is still fetching in the background.
async function runFullDataStream(query) {
  const ctl = new AbortController();
  fullDataStreamCtl = ctl;
  try {
    const res = await fetch(`/api/reviews.full.stream?${query}`, { signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(`Stream request failed (HTTP ${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !fullDataPayload) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        handleFullDataStreamMessage(msg);
      }
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      setError(err.message || String(err));
      $('#fullDataPanel').classList.add('hidden');
      $('#tableContainer').classList.remove('hidden');
    }
  } finally {
    if (fullDataStreamCtl === ctl) fullDataStreamCtl = null;
    hideLoading();
    if (fullDataPayload && !fullDataPayload.done) {
      fullDataPayload.done = true;
      renderFullData(fullDataPayload);
    }
  }
}

function handleFullDataStreamMessage(msg) {
  if (!fullDataPayload || !msg || !msg.type) return;
  if (msg.type === 'group' && msg.group) {
    fullDataPayload.groups.push(msg.group);
    renderFullData(fullDataPayload);
  } else if (msg.type === 'done') {
    fullDataPayload.done = true;
    if (msg.global) fullDataPayload.global = msg.global;
    if (typeof msg.totalReviews === 'number') fullDataPayload.totalReviews = msg.totalReviews;
    if (Array.isArray(msg.errors)) fullDataPayload.errors = msg.errors;
    fullDataPayload.perStore = msg.perStore;
    renderFullData(fullDataPayload);
  } else if (msg.type === 'error' && msg.error) {
    fullDataPayload.errors = fullDataPayload.errors || [];
    fullDataPayload.errors.push(msg.error);
    renderFullData(fullDataPayload);
  }
}

// export structured full-data as JSON + every comment as CSV
function fullDataFlatReviews() {
  if (!fullDataPayload) return [];
  const out = [];
  for (const grp of (fullDataPayload.groups || [])) {
    for (const r of (grp.reviews || [])) {
      out.push({ ...r, platform: grp.platform || r.platform, lang: r.lang || grp.lang });
    }
  }
  return out;
}

function exportFullDataCsv() {
  if (!fullDataPayload) return;
  const headers = ['platform', 'lang', 'rating', 'title', 'text', 'author', 'date', 'version', 'helpful', 'replyText', 'url'];
  const esc = (v) => {
    const raw = v == null ? '' : String(v);
    return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}` : raw;
  };
  const rows = fullDataFlatReviews();
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  downloadBlob(`full-data-${encodeURIComponent(fullDataPayload.appId || 'app')}-reviews.csv`, csv, 'text/csv; charset=utf-8');
}

function exportFullDataJson() {
  if (!fullDataPayload) return;
  const fileName = `full-data-${encodeURIComponent(fullDataPayload.appId || 'app')}.json`;
  downloadBlob(fileName, JSON.stringify(fullDataPayload, null, 2), 'application/json');
}
function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 400);
}

function exportData() {
  if (fullDataPayload) {
    exportFullDataCsv();
    return;
  }
  if (state.mode === 'aso' && state.activeAso) {
    downloadBlob(`keyword-${state.activeAso.keyword.replace(/\s+/g, '-')}.json`, JSON.stringify(state.activeAso, null, 2), 'application/json');
  } else if (state.mode === 'comments') {
    const headers = ['platform', 'appId', 'rating', 'title', 'text', 'author', 'date', 'version', 'helpful', 'replyText', 'url'];
    const esc = (v) => {
      const raw = v == null ? '' : String(v);
      return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
    };
    const csv = [headers.join(','), ...state.lastReviews.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
    downloadBlob('filtered-reviews.csv', csv, 'text/csv; charset=utf-8');
  }
}

// --- Event Listeners ---
function initEvents() {
  const runAso = () => runASOSearch();
  const runComment = () => runCommentSearch();

  $('#asoSearchBtn').addEventListener('click', runAso);
  $('#asoSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAso(); });
  $('#asoSearchInput').addEventListener('input', () => {
    clearTimeout(asoDebounce);
    asoDebounce = setTimeout(runAso, 1400);
  });

  $('#commentSearchBtn').addEventListener('click', runComment);
  $('#commentSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runComment(); });
  $('#commentSearchInput').addEventListener('input', () => {
    clearTimeout(commentDebounce);
    commentDebounce = setTimeout(runComment, 1400);
  });

  $('#exportBtn').addEventListener('click', exportData);
  $('#fullDataBtn').addEventListener('click', () => {
    const app = state.apps.find(a => a.id === state.selectedAppId);
    if (!app) { showEmpty('Select an app first', 'Pick an app in the sidebar before fetching full data.'); return; }
    fullDataStreamCtl?.abort();
    $('#tableContainer').classList.add('hidden');
    $('#similarBar').classList.add('hidden');
    $('#reviewSummary').classList.add('hidden');
    $('#fullDataPanel').classList.remove('hidden');
    fullDataPayload = {
      appId: app.primaryAppId,
      platform: state.filters.store,
      country: state.filters.country,
      groups: [],
      errors: [],
      done: false
    };
    fullDataShownCount = FULL_DATA_RENDER_STEP;
    renderFullData(fullDataPayload);
    setLoading();
    const store = state.filters.store;
    const query = params({
      appId: app.primaryAppId,
      platform: store,
      country: state.filters.country,
      title: app.name,
      ...(app.stores.length > 1 ? { appId2: app.stores.find(s => s.platform !== store)?.appId || '' } : {}),
    });
    runFullDataStream(query);
  });

  // Review summary: "Load more" bumps the max-reviews selector and refetches.
  $('#reviewSummary').addEventListener('click', (e) => {
    if (e.target.closest('#loadMoreReviews')) loadMoreReviews();
  });

  // Full-data panel: show-more / export buttons (delegated — survives re-renders).
  $('#fullDataPanel').addEventListener('click', (e) => {
    const action = e.target.closest('[data-full-data-action]');
    if (!action) return;
    const kind = action.dataset.fullDataAction;
    if (kind === 'show-more') {
      fullDataShownCount += FULL_DATA_SHOW_STEP;
      renderFullData(fullDataPayload);
    } else if (kind === 'export-csv') {
      exportFullDataCsv();
    } else if (kind === 'export-json') {
      exportFullDataJson();
    }
  });

  // Sidebar collapse toggle
  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
  });

  // Onboarding
  if (!localStorage.getItem('rr_onboarded')) {
    $('#onboardingOverlay').classList.remove('hidden');
  }
  $('#onboardingDone').addEventListener('click', () => {
    try { localStorage.setItem('rr_onboarded', '1'); } catch { /* ignore */ }
    $('#onboardingOverlay').classList.add('hidden');
  });

  // App list + folder delegation
  $('#folderTree').addEventListener('click', (e) => {
    // Folder toggle (header click, not buttons inside it)
    const folderToggle = e.target.closest('[data-folder-toggle]');
    if (folderToggle && !e.target.closest('[data-rename-folder]') && !e.target.closest('[data-delete-folder]')) {
      toggleFolder(folderToggle.dataset.folderToggle);
      return;
    }
    const renameBtn = e.target.closest('[data-rename-folder]');
    if (renameBtn) { e.stopPropagation(); startFolderRename(renameBtn.dataset.renameFolder); return; }
    const deleteBtn = e.target.closest('[data-delete-folder]');
    if (deleteBtn) { e.stopPropagation(); deleteFolder(deleteBtn.dataset.deleteFolder); return; }
    const rm = e.target.closest('[data-remove-app]');
    if (rm) { e.stopPropagation(); removeApp(rm.dataset.removeApp); return; }
    const appBtn = e.target.closest('[data-app-id]');
    if (appBtn) {
      const app = state.apps.find((a) => a.id === appBtn.dataset.appId);
      if (app) selectSidebarApp(app, e.ctrlKey || e.metaKey);
    }
  });
  // Create folder button
  $('#createFolderBtn').addEventListener('click', createFolder);

  // Add App modal
  $('#addAppBtn2').addEventListener('click', openAddAppModal);
  $('#closeAddAppModal').addEventListener('click', closeAddAppModal);
  $('#modalSearchInput').addEventListener('input', () => {
    clearTimeout(modalDebounce);
    modalDebounce = setTimeout(searchAppsInModal, 350);
  });
  $('#modalSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAppsInModal(); });
  $('#modalPlatform').addEventListener('change', searchAppsInModal);
  $('#modalResults').addEventListener('click', (e) => {
    const btn = e.target.closest('.modal-app-add');
    if (btn) handleModalAdd(btn);
  });

  // Keyword apps modal
  $('#closeKwAppsModal').addEventListener('click', () => $('#keywordAppsModal').classList.add('hidden'));
  $('#keywordAppsModal').addEventListener('click', (e) => {
    if (e.target.id === 'keywordAppsModal') { $('#keywordAppsModal').classList.add('hidden'); return; }
    const selectBtn = e.target.closest('[data-select-aso]');
    if (selectBtn && state.activeAso && state.activeAso.apps) {
      e.stopPropagation();
      const app = state.activeAso.apps[Number(selectBtn.dataset.selectAso)];
      if (app) selectAsoApp(app);
      return;
    }
    const row = e.target.closest('[data-asa-app]');
    if (row && state.activeAso && state.activeAso.apps) {
      const app = state.activeAso.apps[Number(row.dataset.asaApp)];
      if (app) fetchAndShowAppDetails(app);
    }
  });

  // App detail modal
  $('#closeAppDetailModal').addEventListener('click', () => $('#appDetailModal').classList.add('hidden'));
  $('#appDetailModal').addEventListener('click', (e) => {
    if (e.target.id === 'appDetailModal') $('#appDetailModal').classList.add('hidden');
  });

  // Review detail modal
  $('#closeReviewModal').addEventListener('click', closeReviewModal);
  $('#reviewModal').addEventListener('click', (e) => {
    if (e.target.id === 'reviewModal') closeReviewModal();
  });

  // Add App modal close on overlay
  $('#addAppModal').addEventListener('click', (e) => { if (e.target.id === 'addAppModal') closeAddAppModal(); });

  // Keyword detail overlay backdrop
  $('#detailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'detailOverlay') closeDetailPanel();
  });

  // Table body delegation
  $('#tableBody').addEventListener('click', (e) => {
    const simChip = e.target.closest('.similar-chip');
    if (simChip && simChip.dataset.kw) {
      e.stopPropagation();
      $('#asoSearchInput').value = simChip.dataset.kw;
      runASOSearch(simChip.dataset.kw);
      return;
    }
    const chip = e.target.closest('[data-pop="1"]');
    if (chip) {
      e.stopPropagation();
      const index = Number(chip.dataset.appIndex);
      const rowEl = e.target.closest('tr');
      if (rowEl && rowEl.dataset.rowKind === 'aso' && rowEl.dataset.rowKw) {
        const asoData = state.asoCache.get(rowEl.dataset.rowKw);
        const app = asoData && asoData.apps && asoData.apps[index];
        if (app) fetchAndShowAppDetails(app);
      }
      return;
    }
    const more = e.target.closest('[data-pop="more"]');
    if (more) {
      e.stopPropagation();
      const rowEl = e.target.closest('tr');
      const asoData = rowEl && state.asoCache.get(rowEl.dataset.rowKw);
      if (asoData) openKeywordAppsModal(asoData);
      return;
    }
    const row = e.target.closest('tr');
    if (!row) return;
    if (row.dataset.rowKind === 'comment') {
      const data = state.__reviewData;
      const review = data && data.reviews[Number(row.dataset.reviewIndex)];
      if (review) openReviewModal(review, data.app);
      return;
    }
    if (row.dataset.rowKind === 'aso' && row.dataset.rowKw) {
      const asoData = state.asoCache.get(row.dataset.rowKw);
      if (asoData) openKeywordDetail(asoData);
    }
  });

  // Detail panel close
  $('#detailClose').addEventListener('click', closeDetailPanel);

  // Similar chips
  $('#similarBar').addEventListener('click', (e) => {
    const chip = e.target.closest('.similar-chip');
    if (chip) {
      $('#asoSearchInput').value = chip.dataset.kw;
      runASOSearch(chip.dataset.kw);
    }
  });
  $('#detailBody').addEventListener('click', (e) => {
    const chip = e.target.closest('.similar-chip');
    if (chip) { $('#asoSearchInput').value = chip.dataset.kw; runASOSearch(chip.dataset.kw); return; }
    const selectBtn = e.target.closest('[data-select-aso]');
    if (selectBtn && state.activeAso && state.activeAso.apps) {
      e.stopPropagation();
      const app = state.activeAso.apps[Number(selectBtn.dataset.selectAso)];
      if (app) selectAsoApp(app);
      return;
    }
    const row = e.target.closest('[data-asa-app]');
    if (row && state.activeAso && state.activeAso.apps) {
      const app = state.activeAso.apps[Number(row.dataset.asaApp)];
      if (app) fetchAndShowAppDetails(app);
    }
  });

  // Settings modal
  function openSettings() {
    updateThemeBtns();
    $('#settingsModal').classList.remove('hidden');
  }
  function closeSettings() { $('#settingsModal').classList.add('hidden'); }

  function updateThemeBtns() {
    const current = localStorage.getItem('theme') || 'system';
    $$('.theme-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === current));
  }
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#closeSettingsModal').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    const t = btn.dataset.theme;
    if (t === 'system') { try { localStorage.removeItem('theme'); } catch { } }
    else { try { localStorage.setItem('theme', t); } catch { } }
    applyTheme(t === 'system' ? null : t);
    updateThemeBtns();
  });

  // Reset app data
  $('#resetDataBtn').addEventListener('click', () => {
    const btn = $('#resetDataBtn');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Tap again to confirm';
      setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'Reset app data'; }, 3000);
      return;
    }
    try { localStorage.clear(); } catch { /* ignore */ }
    location.reload();
  });

  // Keyboard: Ctrl+E export, Escape closes modals
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportData();
    }
    if (e.key === 'Escape') {
      closeSettings();
      closeDetailPanel();
      closeAddAppModal();
      closeReviewModal();
      closeFullDataPanel();
      $('#keywordAppsModal').classList.add('hidden');
      $('#appDetailModal').classList.add('hidden');
    }
  });
}

// --- Styled tooltips (replaces native title delay) ---
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  document.body.appendChild(tip);
  let hide = null;
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title],[data-tip]');
    if (!el) return;
    const text = el.dataset.tip || el.getAttribute('title');
    if (!text) return;
    if (!el.dataset.tip) { el.dataset.tip = text; el.removeAttribute('title'); }
    clearTimeout(hide);
    tip.textContent = text;
    tip.classList.add('visible');
    const r = el.getBoundingClientRect();
    tip.style.cssText = 'top:0;left:0';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let top = r.top - th - 7;
    if (top < 4) top = r.bottom + 7;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) hide = setTimeout(() => tip.classList.remove('visible'), 80);
  });
  document.addEventListener('mousedown', () => tip.classList.remove('visible'));
  document.addEventListener('scroll', () => tip.classList.remove('visible'), true);
}

// --- Initialization ---
function init() {
  const savedTheme = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  if (savedTheme === 'dark' || savedTheme === 'light') applyTheme(savedTheme);
  else initSystemTheme();
  document.documentElement.classList.add('electron');
  loadPersisted();
  initDropdowns();
  renderFolders();
  initEvents();
  initTooltips();
  updateReviewAppLabel(state.apps.find((a) => a.id === state.selectedAppId) || null);
  updateCommentInputState();
  api('/api/health').then(() => {}).catch(() => {});
}

init();