// ============================================================
// OwlASO — Dashboard Application Logic
// ============================================================
import { toCsv, REVIEW_CSV_HEADERS } from './lib/csv.js';

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
  { code: 'all', cc: null, name: 'All languages' },
  { code: 'en', cc: 'gb', name: 'English' },
  { code: 'tr', cc: 'tr', name: 'Türkçe' },
  { code: 'de', cc: 'de', name: 'Deutsch' },
  { code: 'fr', cc: 'fr', name: 'Français' },
  { code: 'es', cc: 'es', name: 'Español' },
  { code: 'it', cc: 'it', name: 'Italiano' },
  { code: 'pt-BR', cc: 'br', name: 'Português (BR)' },
  { code: 'ru', cc: 'ru', name: 'Русский' },
  { code: 'ja', cc: 'jp', name: '日本語' },
  { code: 'ko', cc: 'kr', name: '한국어' },
  { code: 'ar', cc: 'sa', name: 'العربية' },
  { code: 'hi', cc: 'in', name: 'हिन्दी' },
  { code: 'nl', cc: 'nl', name: 'Nederlands' },
  { code: 'pl', cc: 'pl', name: 'Polski' },
  { code: 'sv', cc: 'se', name: 'Svenska' },
  { code: 'id', cc: 'id', name: 'Bahasa Indonesia' },
];
const LANGUAGE_NAMES = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.name]));

function flagImg(cc, size = '20x15') {
  if (!cc) return '<span class="flag-globe" aria-hidden="true">🌐</span>';
  const [w, h] = size.split('x');
  // Broken/blocked flags are hidden by the delegated error listener in init().
  return `<img class="flag-img" src="https://flagcdn.com/${size}/${encodeURIComponent(cc)}.png" alt="" width="${w}" height="${h}" loading="lazy">`;
}

const CAT_COLORS = ['#E1306C', '#1DB954', '#58CC02', '#FF9500', '#4A154B', '#FF0000', '#1877F2', '#FF4500', '#7C3AED', '#00A82D'];
const STORE_NAMES = { google: 'Google Play', apple: 'App Store' };
const STORE_ICON = {
  google: '<svg class="store-ico google" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.3v9.4c0 .4.4.6.7.4l7.6-4.7a.5.5 0 000-.8L3.2.9c-.3-.2-.7 0-.7.4z" fill="currentColor"/></svg>',
  apple: '<svg class="store-ico apple" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.4 2.4 9.8M6 1.4l3.6 8.4M3.5 7h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

// --- State ---
const STORAGE_KEY = 'srf_state_v2';
const RECENT_KEY = 'owlaso_recent_keywords';
const ONBOARDED_KEY = 'rr_onboarded';

// Max-reviews ladder used by the "Load more" button and the max-reviews selector.
const MAX_REVIEW_STEPS = [250, 500, 1000, 2000, 5000];
const RENDER_CAP = 500;          // review rows rendered per step ("Show more" adds another step)
const MAX_COMPARE_APPS = 5;      // Ctrl/⌘-click selection limit for the review view
const SIMILAR_ROWS = 5;

// Full-data panel
const FULL_DATA_RENDER_STEP = 50;   // rows rendered when the panel first opens
const FULL_DATA_SHOW_STEP = 200;    // rows added per "Show more" click
const FULL_DATA_RENDER_CAP = 2000;  // max rows physically rendered; beyond this, export

const state = {
  view: 'keywords',                 // 'keywords' | 'reviews'
  apps: [],
  folders: [],
  selectedAppId: null,              // primary selection (positions, full data)
  selectedApps: new Set(),          // Ctrl/⌘-click multi-selection (review comparison)
  sidebarCollapsed: false,
  filters: {
    store: 'both',
    starMin: '',
    starMax: '',
    country: 'us',
    lang: 'all',
    maxReviews: 250,
  },
  aso: emptyAso(),
  detailKeyword: null,              // keyword shown in the detail modal
  reviews: emptyReviews(),
  __reviewData: null,               // rows currently rendered in the review table
  recentKeywords: [],
};

function emptyAso() {
  return { keyword: '', signature: '', main: null, rows: new Map(), order: [], history: [], error: null };
}

// Filters an analysis depends on; a mismatch means the table shows stale data.
function asoSignature() {
  const f = state.filters;
  return JSON.stringify([f.store, f.country, f.lang]);
}

function emptyReviews() {
  return { status: 'idle', signature: '', apps: [], all: [], filtered: [], term: '', totalFetched: 0, perStore: {}, errors: [], warnings: [], notes: [], moreAvailable: false, languages: [], renderLimit: RENDER_CAP };
}

// --- Utilities ---
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only web links may reach an href/src: blocks javascript:, data:, file: … from store data.
function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw); // absolute only: store data never carries relative links
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundToK(v) {
  v = num(v);
  if (!v) return '0';
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}K`;
  return String(Math.round(v));
}

function formatRating(v) {
  const n = num(v);
  return n > 0 ? n.toFixed(1) : '—';
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

function absoluteDate(ts, withTime = false) {
  const date = new Date(ts);
  if (!ts || Number.isNaN(date.getTime())) return '';
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

// Popularity: more demand is better for you → green; low demand is neutral grey.
function pctColor(v) {
  if (v >= 67) return 'green';
  if (v >= 34) return 'yellow';
  return 'gray';
}

function diffColor(difficulty) {
  // low difficulty = easy = green; high = hard = red
  if (difficulty < 34) return 'green';
  if (difficulty < 67) return 'yellow';
  return 'red';
}

// Unicode-aware, matches the server's normalizeTitle ("Ölçüm" ≈ "Olcum", "天気" kept).
function normTitle(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function newId(prefix) {
  const rand = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}

function byDateDesc(a, b) {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
}

function splitTerms(value) {
  return String(value || '').trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

// Escapes text and wraps search-term matches in <mark>.
function highlight(text, terms) {
  const raw = String(text ?? '');
  if (!terms.length) return escapeHtml(raw);
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu');
  return raw.split(re).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
}

function params(obj) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, v);
  }
  return u.toString();
}

async function api(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('Cannot reach the OwlASO server. Is it still running?');
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !json || json.error) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
  return json;
}

// One in-flight request per channel: starting a new one aborts the previous, and
// isCurrent() tells late responses they are stale (no more out-of-order renders).
const channels = new Map();
function beginRequest(channel) {
  channels.get(channel)?.abort();
  const ctl = new AbortController();
  channels.set(channel, ctl);
  return ctl;
}
function isCurrent(channel, ctl) { return channels.get(channel) === ctl && !ctl.signal.aborted; }
function cancelRequest(channel) {
  channels.get(channel)?.abort();
  channels.delete(channel);
}
const isAbort = (err) => err?.name === 'AbortError';

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i;
      i += 1;
      await fn(items[index], index);
    }
  }));
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage may be unavailable */ }
  return null;
}

// --- Theme: explicit Light/Dark win; "System" follows the OS live ---
const theme = {
  systemDark: false,
  pref() {
    const v = storage('theme');
    return v === 'dark' || v === 'light' ? v : 'system';
  },
  set(pref) {
    storage('theme', pref === 'system' ? null : pref);
    this.apply();
  },
  apply() {
    const pref = this.pref();
    const dark = pref === 'dark' || (pref === 'system' && this.systemDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    for (const b of $$('.theme-btn')) {
      const on = b.dataset.theme === pref;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  },
  init() {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    this.systemDark = Boolean(mq && mq.matches);
    mq?.addEventListener?.('change', (e) => { this.systemDark = e.matches; this.apply(); });
    const bridge = window.electronAPI;
    if (bridge?.getSystemTheme) {
      bridge.getSystemTheme().then((t) => { this.systemDark = t === 'dark'; this.apply(); }).catch(() => {});
      bridge.onThemeChange?.((t) => { this.systemDark = t === 'dark'; this.apply(); });
    }
    this.apply();
  },
};

// --- Toasts ---
function toast(message, { action, timeout = 4000, tone = 'info' } = {}) {
  const region = $('#toastRegion');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { close(); action.onClick(); });
    el.append(btn);
  }
  region.append(el);
  while (region.children.length > 3) region.firstElementChild.remove();
  timer = setTimeout(close, timeout);
  return close;
}

// --- Modals: stacked, Escape closes the top one, focus is trapped and restored ---
const modalStack = [];

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  const existing = modalStack.findIndex((m) => m.id === id);
  if (existing >= 0) modalStack.splice(existing, 1);
  modalStack.push({ id, returnFocus: document.activeElement });
  overlay.classList.remove('hidden');
  overlay.style.zIndex = String(1000 + modalStack.length * 10);
  requestAnimationFrame(() => {
    const target = ['[data-autofocus]:not([disabled])', 'input:not([disabled]):not([type="hidden"])', '.detail-close']
      .map((sel) => overlay.querySelector(sel)).find(Boolean);
    target?.focus({ preventScroll: true });
  });
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  const index = modalStack.findIndex((m) => m.id === id);
  const entry = index >= 0 ? modalStack.splice(index, 1)[0] : null;
  const back = entry?.returnFocus;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}

function topModal() { return modalStack.at(-1)?.id || null; }

function trapFocus(e) {
  const id = topModal();
  if (!id || e.key !== 'Tab') return;
  const overlay = document.getElementById(id);
  const focusables = [...overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables.at(-1);
  if (!overlay.contains(document.activeElement)) { first.focus(); e.preventDefault(); return; }
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

// --- Custom dropdowns (country / language): listbox with keyboard support ---
function buildCustomDropdown(btn, dropEl, entries, getCurrent, onSelect) {
  dropEl.innerHTML = entries.map((e) => {
    const cc = e.cc !== undefined ? e.cc : e.code; // countries use .code, languages use .cc
    return `<button type="button" class="country-option" role="option" tabindex="-1" data-code="${escapeHtml(e.code)}">
      ${flagImg(cc)}<span>${escapeHtml(e.name)}</span></button>`;
  }).join('');

  const options = () => [...dropEl.querySelectorAll('[data-code]')];
  const close = (focusButton = false) => {
    dropEl.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  };
  const open = () => {
    for (const other of $$('.country-dropdown.open')) if (other !== dropEl) other.classList.remove('open');
    dropEl.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    const current = getCurrent();
    for (const o of options()) o.setAttribute('aria-selected', String(o.dataset.code === current));
    (options().find((o) => o.dataset.code === current) || options()[0])?.focus();
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropEl.classList.contains('open')) close(); else open();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  dropEl.addEventListener('click', (ev) => {
    const opt = ev.target.closest('[data-code]');
    if (!opt) return;
    close(true);
    onSelect(opt.dataset.code);
  });
  dropEl.addEventListener('keydown', (e) => {
    const list = options();
    const index = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, index + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, index - 1)]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && /\S/u.test(e.key)) {
      const letter = e.key.toLowerCase();
      const start = index + 1;
      const hit = [...list.slice(start), ...list.slice(0, start)].find((o) => o.textContent.trim().toLowerCase().startsWith(letter));
      hit?.focus();
    }
  });
}

function setCountryUI(code) {
  const c = COUNTRIES.find((x) => x.code === code) || COUNTRIES[0];
  $('#countryFlag').innerHTML = flagImg(c.code);
  $('#countryCode').textContent = c.code.toUpperCase();
  $('#countryBtn').setAttribute('aria-label', `Country: ${c.name}`);
}

function setLangUI(code) {
  const l = LANGUAGES.find((x) => x.code === code) || LANGUAGES[0];
  $('#langFlag').innerHTML = flagImg(l.cc);
  $('#langCode').textContent = l.code === 'all' ? 'All' : l.code.toUpperCase();
  $('#langBtn').setAttribute('aria-label', `Language: ${l.name}`);
}

function initDropdowns() {
  buildCustomDropdown($('#countryBtn'), $('#countryDropdown'), COUNTRIES, () => state.filters.country, (code) => {
    if (state.filters.country === code) return;
    state.filters.country = code;
    setCountryUI(code);
    onFiltersChanged('fetch');
  });
  buildCustomDropdown($('#langBtn'), $('#langDropdown'), LANGUAGES, () => state.filters.lang, (code) => {
    if (state.filters.lang === code) return;
    state.filters.lang = code;
    setLangUI(code);
    onFiltersChanged('fetch');
  });
  setCountryUI(state.filters.country);
  setLangUI(state.filters.lang);
  document.addEventListener('click', () => {
    for (const dd of $$('.country-dropdown.open')) dd.classList.remove('open');
    for (const b of $$('.country-btn')) b.setAttribute('aria-expanded', 'false');
  });

  $('#storeFilter').value = state.filters.store;
  $('#starMin').value = state.filters.starMin;
  $('#starMax').value = state.filters.starMax;
  $('#maxReviews').value = String(state.filters.maxReviews || 250);
  $('#maxReviews').addEventListener('change', () => {
    state.filters.maxReviews = Number($('#maxReviews').value) || 250;
    onFiltersChanged('fetch');
  });
  $('#starMin').addEventListener('change', () => { state.filters.starMin = $('#starMin').value; onFiltersChanged('filter'); });
  $('#starMax').addEventListener('change', () => { state.filters.starMax = $('#starMax').value; onFiltersChanged('filter'); });
  $('#storeFilter').addEventListener('change', () => { state.filters.store = $('#storeFilter').value; onFiltersChanged('fetch'); });
}

// 'filter' changes are applied client-side; 'fetch' changes need new store data.
function onFiltersChanged(kind) {
  persist();
  if (kind === 'filter') {
    if (state.reviews.status === 'ready') applyReviewFilterState();
    return;
  }
  if (state.view === 'keywords') {
    if (state.aso.keyword) runASOSearch(state.aso.keyword);
  } else if (fullDataCtl.open) {
    openFullData();
  } else if (selectedApps().length) {
    loadReviews({ force: true });
  }
}

// --- Views ---
function setView(view, { focus = false } = {}) {
  const next = view === 'reviews' ? 'reviews' : 'keywords';
  if (fullDataCtl.open && next !== 'reviews') closeFullDataPanel({ render: false });
  state.view = next;
  for (const tab of $$('.view-tab')) {
    const on = tab.dataset.view === next;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  for (const el of $$('[data-view-only]')) {
    if (el.id === 'similarBar') continue; // visibility also depends on content
    el.classList.toggle('hidden', el.dataset.viewOnly !== next || (el.id === 'reviewBar' && fullDataCtl.open));
  }
  $('#tableContainer').setAttribute('aria-labelledby', next === 'reviews' ? 'tabReviews' : 'tabKeywords');
  renderSimilarBar();
  updateReviewAppLabel();
  persist();
  if (next === 'keywords') renderKeywordsView();
  else renderReviewsView();
  if (focus) focusSearch();
}

function focusSearch() {
  const input = state.view === 'reviews' ? $('#commentSearchInput') : $('#asoSearchInput');
  if (input.disabled) return;
  input.focus();
  input.select();
}

function renderKeywordsView() {
  if (state.aso.keyword && state.aso.signature !== asoSignature()) { runASOSearch(state.aso.keyword); return; }
  if (state.aso.error) { setError(state.aso.error, () => runASOSearch(state.aso.keyword)); return; }
  if (state.aso.keyword) { renderAsoTable(); return; }
  const recent = state.recentKeywords.slice(0, 6);
  const examples = ['habit tracker', 'photo editor', 'budget planner'];
  showEmpty({
    icon: '🔎',
    title: 'Analyze a keyword',
    desc: 'See who ranks for it, how popular and competitive it is, and where your tracked apps stand.',
    actions: (recent.length ? recent : examples).map((k) => `<button type="button" class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join(''),
    actionsLabel: recent.length ? 'Recent' : 'Try',
  });
}

function renderReviewsView() {
  const apps = selectedApps();
  if (!state.apps.length) {
    showEmpty({ icon: '💬', title: 'No apps tracked yet', desc: 'Add an app to read and filter its App Store and Google Play reviews.', actions: '<button type="button" class="pill-btn pill-primary" data-action="add-app">Add an app</button>' });
    renderReviewSummary();
    return;
  }
  if (!apps.length) {
    showEmpty({ icon: '👈', title: 'Select an app', desc: 'Pick an app in the sidebar to load its reviews. Ctrl/⌘-click to compare up to 5 apps.' });
    renderReviewSummary();
    return;
  }
  loadReviews();
}

// --- Keyword analysis (ASO) ---
function asoQuery(keyword, extra = {}) {
  return params({
    q: keyword,
    store: state.filters.store,
    country: state.filters.country,
    // "All languages" → the server uses the storefront's main language.
    lang: state.filters.lang === 'all' ? '' : state.filters.lang,
    ...extra,
  });
}

async function runASOSearch(keyword) {
  const kw = String(keyword ?? $('#asoSearchInput').value).trim().replace(/\s+/gu, ' ');
  if (kw.length < 2) {
    toast('Type at least 2 characters to analyze a keyword.');
    $('#asoSearchInput').focus();
    return;
  }
  $('#asoSearchInput').value = kw;
  if (state.view !== 'keywords') setView('keywords');
  const ctl = beginRequest('aso');
  state.aso = emptyAso();
  state.aso.keyword = kw;
  state.aso.signature = asoSignature();
  state.aso.rows.set(kw, { status: 'loading' });
  state.aso.order = [kw];
  renderAsoTable();
  renderSimilarBar();

  try {
    const data = await api(`/api/asosearch?${asoQuery(kw)}`, { signal: ctl.signal });
    if (!isCurrent('aso', ctl)) return;
    const similar = (data.similar || []).filter((s) => s !== data.keyword).slice(0, SIMILAR_ROWS);
    state.aso.keyword = data.keyword;
    state.aso.main = data;
    state.aso.rows = new Map([[data.keyword, { status: 'ready', data }], ...similar.map((s) => [s, { status: 'loading' }])]);
    state.aso.order = [data.keyword, ...similar];
    rememberKeyword(data.keyword);
    persist();
    renderAsoTable();
    renderSimilarBar();
    if (data.errors?.length) toast(`Partial results — ${data.errors.join(' · ')}`, { tone: 'warn', timeout: 7000 });
    loadRankHistory(data.keyword, ctl);
    await mapLimit(similar, 2, (s) => loadSimilarRow(s, ctl));
  } catch (err) {
    if (isAbort(err) || !isCurrent('aso', ctl)) return;
    state.aso.error = err.message;
    setError(err.message, () => runASOSearch(kw));
  }
}

async function loadSimilarRow(kw, ctl) {
  try {
    const data = await api(`/api/asosearch?${asoQuery(kw, { lite: '1' })}`, { signal: ctl.signal });
    if (!isCurrent('aso', ctl)) return;
    state.aso.rows.set(kw, { status: 'ready', data });
  } catch (err) {
    if (isAbort(err) || !isCurrent('aso', ctl)) return;
    state.aso.rows.set(kw, { status: 'error', error: err.message });
  }
  updateAsoRow(kw);
}

async function loadRankHistory(keyword, ctl) {
  try {
    const data = await api(`/api/asosearch/history?${asoQuery(keyword)}`, { signal: ctl.signal });
    if (!isCurrent('aso', ctl)) return;
    state.aso.history = Array.isArray(data.snapshots) ? data.snapshots : [];
    updateAsoRow(keyword);
  } catch { /* history is optional */ }
}

function rememberKeyword(kw) {
  state.recentKeywords = [kw, ...state.recentKeywords.filter((k) => k.toLowerCase() !== kw.toLowerCase())].slice(0, 8);
  storage(RECENT_KEY, JSON.stringify(state.recentKeywords));
}

// Rank of a tracked app in a keyword's search results, per store it is listed on.
function appPositions(app, rankings) {
  if (!app || !rankings) return [];
  const out = [];
  for (const store of ['google', 'apple']) {
    const list = rankings[store];
    const listing = (app.stores || []).find((s) => s.platform === store);
    if (!Array.isArray(list) || !listing) continue;
    const index = list.indexOf(listing.appId);
    out.push({ platform: store, rank: index >= 0 ? index + 1 : null, depth: list.length });
  }
  return out;
}

function bestRank(app, rankings) {
  const ranks = appPositions(app, rankings).map((p) => p.rank).filter(Boolean);
  return ranks.length ? Math.min(...ranks) : null;
}

function rankTrend(app, platform, history) {
  if (!history || history.length < 2) return '';
  const rankIn = (snap) => appPositions(app, snap.rankings).find((p) => p.platform === platform)?.rank ?? null;
  const now = rankIn(history.at(-1));
  const before = rankIn(history.at(-2));
  if (!now || !before || now === before) return '';
  const up = now < before;
  return `<span class="kw-trend ${up ? 'up' : 'down'}" data-tip="${up ? 'Up' : 'Down'} ${Math.abs(before - now)} since ${escapeHtml(absoluteDate(history.at(-2).at))}">${up ? '▲' : '▼'}${Math.abs(before - now)}</span>`;
}

function positionCell(data, isMain) {
  const app = selectedApp();
  if (!app) return '<span class="kw-pos muted" data-tip="Select an app in the sidebar to see where it ranks">—</span>';
  const positions = appPositions(app, data.rankings);
  if (!positions.length) return `<span class="kw-pos muted" data-tip="${escapeHtml(app.name)} is not listed on the analyzed store">n/a</span>`;
  return `<div class="kw-pos-list">${positions.map((p) => {
    const label = p.rank ? `${app.name}: #${p.rank} on ${STORE_NAMES[p.platform]}` : `${app.name} is not in the top ${p.depth} on ${STORE_NAMES[p.platform]}`;
    return `<span class="kw-pos-item" data-tip="${escapeHtml(label)}">${STORE_ICON[p.platform]}<span class="kw-pos${p.rank ? '' : ' muted'}">${p.rank ? `#${p.rank}` : `${p.depth}+`}</span>${isMain ? rankTrend(app, p.platform, state.aso.history) : ''}</span>`;
  }).join('')}</div>`;
}

// --- Table rendering ---
function skeletonRows(mode = 'aso') {
  const cols = mode === 'comments'
    ? ['55%', '60%', '85%', '45%']
    : ['65%', '45%', '75%', '75%', '30%', '85%'];
  return Array.from({ length: 6 }, () =>
    `<tr class="skel-tr" aria-hidden="true">${cols.map((w) => `<td><div class="skel" style="width:${w}"></div></td>`).join('')}</tr>`
  ).join('');
}

function setLoading(mode = 'aso') {
  hideEmpty();
  setTableHeaders(mode);
  $('#tableBody').innerHTML = skeletonRows(mode);
  $('#keywordTable').setAttribute('aria-busy', 'true');
}

let retryHandler = null;
function setError(message, retry) {
  retryHandler = retry || null;
  $('#tableBody').innerHTML = '';
  $('#kwTableHead').classList.add('hidden');
  $('#keywordTable').removeAttribute('aria-busy');
  $('#errorMessage').textContent = message;
  $('#retryBtn').classList.toggle('hidden', !retry);
  $('#errorState').classList.remove('hidden');
  $('#emptyState').classList.add('hidden');
}

function showEmpty({ icon = '🔎', title, desc = '', actions = '', actionsLabel = '' }) {
  $('#tableBody').innerHTML = '';
  $('#kwTableHead').classList.add('hidden');
  $('#keywordTable').removeAttribute('aria-busy');
  const box = $('#emptyState');
  box.querySelector('.empty-icon').textContent = icon;
  box.querySelector('.empty-title').textContent = title || 'Nothing here yet';
  box.querySelector('.empty-desc').textContent = desc;
  $('#emptyActions').innerHTML = actions ? `${actionsLabel ? `<span class="empty-actions-label">${escapeHtml(actionsLabel)}</span>` : ''}${actions}` : '';
  box.classList.remove('hidden');
  $('#errorState').classList.add('hidden');
}

function hideEmpty() {
  $('#emptyState').classList.add('hidden');
  $('#errorState').classList.add('hidden');
  $('#kwTableHead').classList.remove('hidden');
}

function metricCell(value, colorFn, label) {
  const v = clamp(num(value), 0, 100);
  const color = colorFn(v);
  return `
    <div class="kw-metric" aria-label="${escapeHtml(label)} ${Math.round(v)} of 100">
      <div class="kw-metric-bar"><div class="kw-metric-fill ${color}" style="width:${v}%"></div></div>
      <div class="kw-metric-val">${Math.round(v)}</div>
    </div>`;
}

function appIcon(app, cls = '') {
  const src = safeUrl(app.icon);
  const name = app.name || app.title || '?';
  return src
    ? `<img class="${cls}" src="${escapeHtml(src)}" alt="" loading="lazy">`
    : `<span class="${cls} icon-fallback" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
}

function appsChips(apps, max = 4) {
  const list = apps || [];
  const chips = list.slice(0, max).map((app) => {
    const name = app.name || app.title || '';
    return `
    <button type="button" class="kw-app-chip" data-app-index="${escapeHtml(app._index)}" data-pop="1" data-tip="${escapeHtml(name)}${app.bestRank ? ` · best rank #${escapeHtml(app.bestRank)}` : ''}">
      <span class="kw-app-chip-icon">${appIcon(app)}</span>
      <span class="kw-app-chip-name">${escapeHtml(name)}</span>
    </button>`;
  }).join('');
  const more = list.length > max ? `<button type="button" class="kw-apps-more" data-pop="more" aria-label="Show all ${list.length} apps">+${list.length - max}</button>` : '';
  return `<div class="kw-apps">${chips}${more}</div>`;
}

function buildAsoRow(kw, isMain) {
  const row = state.aso.rows.get(kw) || { status: 'loading' };
  const badge = isMain ? '<span class="kw-keyword-type">analyzed</span>' : '<span class="kw-keyword-type similar">similar</span>';
  const keywordCell = `<td class="kw-col-keyword"><span class="kw-keyword">${escapeHtml(kw)}</span>${badge}</td>`;

  if (row.status === 'loading') {
    return `
    <tr data-row-kind="aso-loading" data-row-kw="${escapeHtml(kw)}" aria-busy="true">
      ${keywordCell}
      <td class="kw-col-updated"><span class="kw-updated muted">Analyzing…</span></td>
      <td colspan="4"><div class="skel skel-inline"></div></td>
    </tr>`;
  }
  if (row.status === 'error') {
    return `
    <tr data-row-kind="aso-error" data-row-kw="${escapeHtml(kw)}">
      ${keywordCell}
      <td class="kw-col-updated"><span class="kw-updated muted">Failed</span></td>
      <td colspan="4"><span class="row-error" data-tip="${escapeHtml(row.error || '')}">Couldn't analyze this keyword.</span> <button type="button" class="link-btn" data-retry-kw="${escapeHtml(kw)}">Retry</button></td>
    </tr>`;
  }
  const data = row.data;
  const metrics = data.metrics || {};
  const apps = (data.apps || []).map((a, i) => ({ ...a, _index: i }));
  const historyHint = isMain && state.aso.history.length > 1
    ? `<span class="kw-history-hint" data-tip="Tracked since ${escapeHtml(absoluteDate(state.aso.history[0].at))}">${state.aso.history.length} days</span>`
    : '';
  return `
  <tr data-row-kind="aso" data-row-kw="${escapeHtml(kw)}" tabindex="0" aria-label="${escapeHtml(kw)}: open analysis">
    ${keywordCell}
    <td class="kw-col-updated"><span class="kw-updated" data-tip="${escapeHtml(absoluteDate(data.analyzedAt, true))}">${relativeTime(data.analyzedAt)}</span>${historyHint}</td>
    <td class="kw-col-pop">${metricCell(metrics.popularity, pctColor, 'Popularity')}</td>
    <td class="kw-col-diff">${metricCell(metrics.difficulty, diffColor, 'Difficulty')}</td>
    <td class="kw-col-pos">${positionCell(data, isMain)}</td>
    <td class="kw-col-apps">${apps.length ? appsChips(apps) : '<span class="muted">No apps found</span>'}</td>
  </tr>`;
}

function renderAsoTable() {
  if (state.view !== 'keywords') return;
  hideEmpty();
  setTableHeaders('aso');
  $('#keywordTable').removeAttribute('aria-busy');
  $('#tableBody').innerHTML = state.aso.order.map((kw, i) => buildAsoRow(kw, i === 0)).join('');
}

function updateAsoRow(kw) {
  if (state.view !== 'keywords') return;
  const rowEl = $('#tableBody').querySelector(`tr[data-row-kw="${CSS.escape(kw)}"]`);
  if (!rowEl) return;
  const hadFocus = rowEl.contains(document.activeElement);
  rowEl.outerHTML = buildAsoRow(kw, state.aso.order[0] === kw);
  if (hadFocus) $('#tableBody').querySelector(`tr[data-row-kw="${CSS.escape(kw)}"]`)?.focus();
}

function setTableHeaders(mode) {
  const thead = $('#kwTableHead');
  const table = $('#keywordTable');
  table.classList.toggle('comment-table', mode === 'comments');
  if (mode === 'comments') {
    const multi = state.reviews.apps.length > 1;
    table.classList.toggle('multi-app', multi);
    thead.innerHTML = `<tr>
      <th class="kw-th kw-col-updated" scope="col">Date</th>
      <th class="kw-th kw-col-rating" scope="col">Rating</th>
      <th class="kw-th kw-col-comment" scope="col">Review</th>
      <th class="kw-th kw-col-store" scope="col">Store</th>
      ${multi ? '<th class="kw-th kw-col-app" scope="col">App</th>' : ''}
    </tr>`;
  } else {
    table.classList.remove('multi-app');
    thead.innerHTML = `<tr>
      <th class="kw-th kw-col-keyword" scope="col">Keyword / Topic</th>
      <th class="kw-th kw-col-updated" scope="col">Last Updated</th>
      <th class="kw-th kw-col-pop" scope="col" data-tip="Search demand estimate (0–100)">Popularity</th>
      <th class="kw-th kw-col-diff" scope="col" data-tip="How hard it is to reach the top results (0–100)">Difficulty</th>
      <th class="kw-th kw-col-pos" scope="col" data-tip="Rank of the app selected in the sidebar">Position</th>
      <th class="kw-th kw-col-apps" scope="col">Apps in Ranking</th>
    </tr>`;
  }
}

function starsHtml(rating) {
  const n = Math.max(0, Math.min(5, Math.round(num(rating))));
  return `<span class="star-rating" aria-label="${n} out of 5 stars">${'★'.repeat(n)}<span class="star-empty">${'★'.repeat(5 - n)}</span></span>`;
}

function storeBadge(platform) {
  return `<span class="store-badge ${platform === 'apple' ? 'apple' : 'google'}">${STORE_ICON[platform === 'apple' ? 'apple' : 'google']}${STORE_NAMES[platform] || 'Store'}</span>`;
}

// --- Similar keywords bar ---
function renderSimilarBar() {
  const bar = $('#similarBar');
  const similar = state.view === 'keywords' ? state.aso.main?.similar || [] : [];
  if (!similar.length) { bar.classList.add('hidden'); return; }
  bar.innerHTML = '<span class="similar-bar-label">Similar keywords</span>' +
    similar.map((k) => `<button type="button" class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('');
  bar.classList.remove('hidden');
}

// --- Keyword detail modal ---
function lineChart(series, { width = 560, height = 110, min = 0, max = 100, invert = false } = {}) {
  const n = Math.max(...series.map((s) => s.points.length));
  if (n < 2) return '';
  const pad = 8;
  const x = (i) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v) => {
    const t = (clamp(v, min, max) - min) / (max - min || 1);
    return invert ? pad + t * (height - pad * 2) : height - pad - t * (height - pad * 2);
  };
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.points.forEach((v, i) => {
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d ? `<path class="chart-line ${s.cls}" d="${d}"/>` : '';
  }).join('');
  const grid = [0.25, 0.5, 0.75].map((t) => `<line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${(pad + t * (height - pad * 2)).toFixed(1)}" y2="${(pad + t * (height - pad * 2)).toFixed(1)}"/>`).join('');
  return `<svg class="history-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="History chart">${grid}${paths}</svg>`;
}

function historySection(keyword) {
  const history = keyword === state.aso.keyword ? state.aso.history : [];
  if (history.length < 2) {
    return '<div class="detail-note">History builds up automatically: analyze this keyword again on another day to see trends.</div>';
  }
  const app = selectedApp();
  const metrics = lineChart([
    { cls: 'pop', points: history.map((s) => s.popularity) },
    { cls: 'diff', points: history.map((s) => s.difficulty) },
  ]);
  let position = '';
  if (app) {
    const ranks = history.map((s) => bestRank(app, s.rankings));
    const worst = Math.max(10, ...ranks.filter(Boolean));
    if (ranks.some(Boolean)) {
      position = `<div class="chart-caption"><span class="legend pos"></span>${escapeHtml(app.name)} best rank (lower is better)</div>${lineChart([{ cls: 'pos', points: ranks }], { min: 1, max: worst, invert: true, height: 80 })}`;
    }
  }
  return `
    <div class="detail-section-title">Trend · ${history.length} days</div>
    <div class="chart-caption"><span class="legend pop"></span>Popularity <span class="legend diff"></span>Difficulty</div>
    ${metrics}
    ${position}
    <div class="chart-axis"><span>${escapeHtml(absoluteDate(history[0].at))}</span><span>${escapeHtml(absoluteDate(history.at(-1).at))}</span></div>`;
}

function isTracked(stores) {
  return state.apps.find((a) => (stores || []).some((s) => (a.stores || []).some((t) => t.platform === s.platform && t.appId === s.appId))) || null;
}

function appRowsHtml(apps) {
  return apps.map((app, i) => {
    const tracked = isTracked(app.stores);
    const storesMeta = (app.stores || []).map((s) => `${STORE_NAMES[s.platform] || s.platform} #${escapeHtml(s.rank ?? '—')} · ★${formatRating(s.rating)} · ${roundToK(s.reviews)} ratings`).join('<br>');
    return `
    <div class="app-row" data-asa-app="${i}" tabindex="0" role="button" aria-label="${escapeHtml(app.name)} details">
      <div class="app-row-icon">${appIcon(app)}</div>
      <div class="app-row-info">
        <div class="app-row-name">${escapeHtml(app.name)}</div>
        <div class="app-row-meta">${storesMeta}</div>
        <div class="app-row-tags">
          <span class="tag good">★ ${formatRating(app.avgRating)}</span>
          <span class="tag">${roundToK(app.totalReviews)} ratings</span>
          ${app.adsActive ? '<span class="tag ads">ads</span>' : ''}
          ${app.fbAds && app.fbAds.activeAds ? `<span class="tag ads">Meta ads: ${escapeHtml(app.fbAds.activeAds)} active</span>` : ''}
        </div>
      </div>
      <button type="button" class="app-select-btn${tracked ? ' tracked' : ''}" data-select-aso="${i}">${tracked ? 'Tracked ✓' : '+ Track'}</button>
      <span class="app-row-rank" data-tip="Best rank across stores">#${escapeHtml(app.bestRank ?? i + 1)}</span>
    </div>`;
  }).join('');
}

function detailData() {
  const row = state.aso.rows.get(state.detailKeyword);
  return row?.status === 'ready' ? row.data : null;
}

function openKeywordDetail(kw) {
  state.detailKeyword = kw;
  const data = detailData();
  if (!data) return;
  const m = data.metrics || {};
  const app = selectedApp();
  const positions = app ? appPositions(app, data.rankings) : [];
  const positionCards = positions.map((p) => `<div class="kw-hero-card accent"><div class="value">${p.rank ? `#${p.rank}` : `${p.depth}+`}</div><div class="label" data-tip="${escapeHtml(app.name)}">${STORE_NAMES[p.platform]} rank</div></div>`).join('');
  const isMain = kw === state.aso.keyword;

  $('#detailTitle').textContent = `“${data.keyword}”`;
  $('#detailBody').innerHTML = `
    <div class="kw-hero">
      <div class="kw-hero-card"><div class="value" data-c="${pctColor(num(m.popularity))}">${escapeHtml(m.popularity ?? '—')}</div><div class="label">Popularity</div></div>
      <div class="kw-hero-card"><div class="value" data-c="${diffColor(num(m.difficulty))}">${escapeHtml(m.difficulty ?? '—')}</div><div class="label">Difficulty</div></div>
      <div class="kw-hero-card"><div class="value">${escapeHtml(m.opportunity ?? '—')}</div><div class="label">Opportunity</div></div>
      <div class="kw-hero-card"><div class="value">${roundToK(m.totalReviews)}</div><div class="label">Total ratings</div></div>
      <div class="kw-hero-card"><div class="value">${formatRating(m.avgRating)}</div><div class="label">Avg rating</div></div>
      <div class="kw-hero-card"><div class="value">${escapeHtml(m.adsFraction ?? 0)}%</div><div class="label">Apps with ads</div></div>
      ${positionCards}
    </div>
    ${isMain ? historySection(kw) : `<div class="detail-note">Quick analysis. <button type="button" class="link-btn" data-kw="${escapeHtml(data.keyword)}">Run full analysis</button> to track its history and competitor keywords.</div>`}
    ${data.similar && data.similar.length ? `<div class="detail-section-title">Similar keywords</div><div class="chip-row">${data.similar.map((k) => `<button type="button" class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}</div>` : ''}
    ${data.competitorKeywords && data.competitorKeywords.length ? `<div class="detail-section-title">Keywords the top apps also rank for</div>${data.competitorKeywords.map((c) => `<div class="competitor-keywords"><span class="competitor-name">${escapeHtml(c.app)}</span><div class="competitor-chips">${(c.keywords || []).map((k) => `<button type="button" class="similar-chip" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}</div></div>`).join('')}` : ''}
    <div class="detail-section-title">Apps in ranking (${(data.apps || []).length})</div>
    ${appRowsHtml(data.apps || []) || '<div class="modal-empty">No apps found.</div>'}
  `;
  openModal('detailOverlay');
}

function closeDetailPanel() {
  closeModal('detailOverlay');
}

// --- All apps for a keyword ---
function openKeywordAppsModal(kw) {
  state.detailKeyword = kw;
  const data = detailData();
  if (!data) return;
  $('#kwModalTitle').textContent = `“${data.keyword}” — all apps (${(data.apps || []).length})`;
  $('#kwModalBody').innerHTML = `<div class="store-detail-list">${appRowsHtml(data.apps || []) || '<div class="modal-empty">No apps found.</div>'}</div>`;
  openModal('keywordAppsModal');
}

// --- App detail modal ---
function renderAppStoreCard(store) {
  const price = num(store.price);
  const freeTag = store.free !== false && !price ? 'Free' : price ? `$${price.toFixed(2)}` : 'Paid';
  const link = safeUrl(store.url);
  return `
    <div class="store-detail-card">
      <div class="header">
        ${storeBadge(store.platform)}
        <span class="store-id">${escapeHtml(store.appId)}</span>
        <span class="spacer"></span>
        ${link ? `<a class="store-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open store ↗</a>` : ''}
      </div>
      <div class="stat-grid">
        <div class="stat-cell"><div class="k">Rating</div><div class="v">${formatRating(store.score ?? store.rating)}★</div></div>
        <div class="stat-cell"><div class="k">Ratings</div><div class="v">${roundToK(store.reviews)}</div></div>
        <div class="stat-cell"><div class="k">${store.installs ? 'Installs' : 'Price'}</div><div class="v">${escapeHtml(store.installs || freeTag)}</div></div>
        <div class="stat-cell"><div class="k">Category</div><div class="v">${escapeHtml(store.genre || '—')}</div></div>
        <div class="stat-cell"><div class="k">Updated</div><div class="v">${relativeTime(store.updated)}</div></div>
        <div class="stat-cell"><div class="k">Ads</div><div class="v">${store.platform === 'apple' ? 'Unknown' : store.containsAds ? 'Yes' : 'No'}</div></div>
      </div>
    </div>`;
}

function appHero(name, icon, sub) {
  return `
    <div class="app-detail-hero">
      <div class="big-icon">${appIcon({ name, icon })}</div>
      <div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="sub">${sub}</div>
      </div>
    </div>`;
}

let asoDetailApp = null;
function openAppDetailModal(app) {
  asoDetailApp = app;
  const tracked = isTracked(app.stores);
  $('#appDetailTitle').textContent = app.name || 'App details';
  $('#appDetailBody').innerHTML = `
    ${appHero(app.name, app.icon, (app.stores || []).map((s) => `${escapeHtml(STORE_NAMES[s.platform] || s.platform)} · ${escapeHtml(s.appId)}`).join('<br>'))}
    <div class="store-detail-list">${(app.stores || []).map(renderAppStoreCard).join('') || '<div class="modal-empty">Details unavailable.</div>'}</div>
    <div class="modal-actions"><button type="button" class="pill-btn ${tracked ? '' : 'pill-primary'}" data-track-detail="1">${tracked ? 'Show reviews' : '+ Track this app'}</button></div>`;
  openModal('appDetailModal');
}

async function fetchAndShowAppDetails(app) {
  // ASO results already carry full listing data — no round-trip needed.
  if (!app.primaryAppId && app.stores && app.stores.length && app.stores[0].rating !== undefined) {
    openAppDetailModal(app);
    return;
  }
  asoDetailApp = null;
  $('#appDetailTitle').textContent = app.name || 'App details';
  $('#appDetailBody').innerHTML = '<div class="modal-loading"><div class="spinner"></div></div>';
  openModal('appDetailModal');
  const ctl = beginRequest('app-details');
  try {
    const other = (app.stores || []).find((s) => s.platform !== app.platform);
    const q = params({
      appId: app.primaryAppId,
      platform: app.platform,
      appId2: other?.appId,
      store: 'both',
      country: state.filters.country,
      lang: state.filters.lang === 'all' ? '' : state.filters.lang,
    });
    const data = await api(`/api/app-details?${q}`, { signal: ctl.signal });
    if (!isCurrent('app-details', ctl)) return;
    const primary = data.primary || {};
    const stores = [primary, data.counterpart].filter(Boolean);
    $('#appDetailTitle').textContent = primary.title || app.name;
    $('#appDetailBody').innerHTML = `
      ${appHero(primary.title || app.name, primary.icon, escapeHtml(primary.developer || ''))}
      <div class="store-detail-list">${stores.map(renderAppStoreCard).join('') || '<div class="modal-empty">Details unavailable.</div>'}</div>
      ${(data.warnings || []).map((w) => `<div class="detail-note">${escapeHtml(w)}</div>`).join('')}`;
  } catch (err) {
    if (isAbort(err)) return;
    $('#appDetailBody').innerHTML = `<div class="modal-empty error-text">${escapeHtml(err.message)}</div>`;
  }
}

// --- Reviews ---
function selectedApp() {
  return state.apps.find((a) => a.id === state.selectedAppId) || null;
}

function selectedApps() {
  const list = [...state.selectedApps].map((id) => state.apps.find((a) => a.id === id)).filter(Boolean);
  const primary = selectedApp();
  if (primary && !list.includes(primary)) list.unshift(primary);
  return list.slice(0, MAX_COMPARE_APPS);
}

function listingFor(app, platform) {
  return (app.stores || []).find((s) => s.platform === platform && s.appId) || null;
}

// Which store listing(s) to read. The server needs to know which store appId
// belongs to and the known counterpart id; otherwise it looks the other store up by title.
function reviewRequest(app) {
  const store = state.filters.store;
  const allLangs = state.filters.lang === 'all';
  const base = {
    country: state.filters.country,
    lang: allLangs ? 'all' : state.filters.lang,
    multi: allLangs ? '1' : '',
    maxLanguages: allLangs ? '6' : '',
    max: String(state.filters.maxReviews || 250),
    title: app.name,
    developer: app.developer || '',
  };
  const primary = listingFor(app, app.platform) || { platform: app.platform, appId: app.primaryAppId };
  if (store === 'both') {
    const other = listingFor(app, primary.platform === 'apple' ? 'google' : 'apple');
    return { ...base, platform: 'both', appId: primary.appId, appPlatform: primary.platform, appId2: other?.appId || '' };
  }
  const own = listingFor(app, store);
  if (own) return { ...base, platform: store, appId: own.appId, appPlatform: store };
  return { ...base, platform: store, appId: primary.appId, appPlatform: primary.platform };
}

function reviewSignature(apps) {
  const f = state.filters;
  return JSON.stringify([apps.map((a) => a.id), f.store, f.country, f.lang, f.maxReviews]);
}

async function loadReviews({ force = false } = {}) {
  const apps = selectedApps();
  if (!apps.length) { renderReviewsView(); return; }
  const signature = reviewSignature(apps);
  if (!force && state.reviews.signature === signature && state.reviews.status !== 'idle') {
    if (state.reviews.status === 'ready') applyReviewFilterState();
    else if (state.reviews.status === 'error') setError(state.reviews.errors.join('\n'), () => loadReviews({ force: true }));
    else if (!fullDataCtl.open) setLoading('comments'); // the pending request renders when done
    renderReviewSummary();
    return;
  }

  const ctl = beginRequest('reviews');
  const term = state.reviews.term;
  state.reviews = { ...emptyReviews(), status: 'loading', signature, apps, term };
  if (state.view === 'reviews' && !fullDataCtl.open) {
    setLoading('comments');
    renderReviewSummary();
  }

  const settled = await Promise.allSettled(apps.map((app) => api(`/api/reviews?${params(reviewRequest(app))}`, { signal: ctl.signal })));
  if (!isCurrent('reviews', ctl)) return;

  // The user may have typed a filter while the request was running.
  const next = { ...emptyReviews(), status: 'ready', signature, apps, term: state.reviews.term };
  const languages = new Set();
  settled.forEach((result, i) => {
    const app = apps[i];
    const prefix = apps.length > 1 ? `${app.name}: ` : '';
    if (result.status === 'rejected') {
      next.errors.push(`${prefix}${result.reason?.message || 'request failed'}`);
      return;
    }
    const data = result.value;
    const meta = data.meta || {};
    for (const review of data.reviews || []) {
      next.all.push({ ...review, _appId: app.id });
      next.perStore[review.platform] = (next.perStore[review.platform] || 0) + 1;
    }
    next.totalFetched += num(data.totalFetched);
    next.moreAvailable ||= Boolean(meta.moreAvailable);
    for (const w of meta.warnings || []) next.warnings.push(prefix + w);
    for (const e of meta.errors || []) next.errors.push(prefix + e);
    for (const n of meta.notes || []) if (!next.notes.includes(n)) next.notes.push(n);
    for (const s of meta.sources || []) {
      const known = listingFor(app, s.platform);
      if (s.matchedTitle && !known) next.warnings.push(`${prefix}${STORE_NAMES[s.platform]} listing matched by name: “${s.matchedTitle}” (${s.appId}).`);
    }
    for (const l of data.languages || []) languages.add(l);
  });
  next.languages = [...languages];
  next.all.sort(byDateDesc);

  if (!next.all.length && next.errors.length && settled.every((r) => r.status === 'rejected')) {
    next.status = 'error';
    state.reviews = next;
    if (state.view === 'reviews' && !fullDataCtl.open) {
      setError(next.errors.join('\n'), () => loadReviews({ force: true }));
      renderReviewSummary();
    }
    return;
  }
  state.reviews = next;
  if (state.view === 'reviews' && !fullDataCtl.open) applyReviewFilterState();
}

function filterReviewsClient(reviews) {
  const terms = splitTerms(state.reviews.term);
  let min = Number.parseInt(state.filters.starMin, 10);
  let max = Number.parseInt(state.filters.starMax, 10);
  if (Number.isInteger(min) && Number.isInteger(max) && min > max) [min, max] = [max, min];
  const ratingFilter = Number.isInteger(min) || Number.isInteger(max);
  return reviews.filter((r) => {
    if (ratingFilter) {
      const rating = Number(r.rating);
      if (!Number.isFinite(rating)) return false;
      if (Number.isInteger(min) && rating < min) return false;
      if (Number.isInteger(max) && rating > max) return false;
    }
    if (terms.length) {
      const haystack = `${r.title || ''} ${r.text || ''} ${r.author || ''} ${r.version || ''}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });
}

function applyReviewFilterState({ resetLimit = true } = {}) {
  if (resetLimit) state.reviews.renderLimit = RENDER_CAP;
  state.reviews.filtered = filterReviewsClient(state.reviews.all);
  if (state.view === 'reviews' && !fullDataCtl.open) {
    renderCommentTable(state.reviews.filtered, state.reviews.term, state.reviews.apps);
    renderReviewSummary();
  }
}

// Keyword filtering is local (instant): no refetch per keystroke.
function runCommentSearch(keyword) {
  const term = String(keyword !== undefined ? keyword : $('#commentSearchInput').value || '').trim();
  state.reviews.term = term;
  if (!selectedApps().length) {
    showEmpty({ icon: '👈', title: 'Select an app first', desc: 'Click an app in the sidebar to choose whose reviews to search.' });
    return;
  }
  if (state.view !== 'reviews') { setView('reviews'); return; }
  if (state.reviews.status === 'ready') applyReviewFilterState();
  else loadReviews();
}

function renderCommentTable(reviews, term, apps) {
  if (!reviews.length) {
    const why = state.reviews.all.length
      ? { title: 'No reviews match', desc: 'Nothing matches the current keyword or rating filter. Loosen the filters to see more.' }
      : { title: 'No reviews found', desc: 'The store returned no reviews for this app with the current store, country and language.' };
    showEmpty({ icon: '🗒️', ...why, actions: state.reviews.all.length ? '<button type="button" class="pill-btn" data-action="clear-review-filters">Clear filters</button>' : '' });
    return;
  }
  hideEmpty();
  setTableHeaders('comments');
  $('#keywordTable').removeAttribute('aria-busy');
  const terms = splitTerms(term);
  const multi = apps.length > 1;
  const appById = new Map(apps.map((a) => [a.id, a]));
  const shown = reviews.slice(0, state.reviews.renderLimit);
  state.__reviewData = { reviews: shown, term, apps };
  $('#tableBody').innerHTML = shown.map((r, i) => {
    const app = appById.get(r._appId);
    const title = (r.title || '').trim();
    const text = (r.text || '').trim();
    return `
    <tr data-row-kind="comment" data-review-index="${i}" class="review-row-clickable" tabindex="0">
      <td class="kw-col-updated"><span class="kw-updated" data-tip="${escapeHtml(absoluteDate(r.date, true))}">${relativeTime(r.date)}</span></td>
      <td class="kw-col-rating">${starsHtml(r.rating)}</td>
      <td class="kw-col-comment"><div class="review-text-cell">${title && title !== text ? `<strong class="review-title">${highlight(title, terms)}</strong> ` : ''}${highlight(text || title || '(No review text)', terms)}</div></td>
      <td class="kw-col-store">${storeBadge(r.platform)}${r.version ? `<span class="review-version">v${escapeHtml(r.version)}</span>` : ''}${r.lang ? `<span class="review-version">${escapeHtml(r.lang)}</span>` : ''}</td>
      ${multi ? `<td class="kw-col-app">${app ? `<span class="kw-app-chip static"><span class="kw-app-chip-icon">${appIcon(app)}</span><span class="kw-app-chip-name">${escapeHtml(app.name)}</span></span>` : ''}</td>` : ''}
    </tr>`;
  }).join('') + (reviews.length > shown.length
    ? `<tr class="table-footer-row"><td colspan="${multi ? 5 : 4}"><div class="review-truncate-note">Showing ${shown.length} of ${reviews.length} matching reviews. <button type="button" class="link-btn" data-action="more-review-rows">Show ${Math.min(RENDER_CAP, reviews.length - shown.length)} more</button></div></td></tr>`
    : '');
}

// --- Review detail modal (opened by clicking a review row) ---
let reviewModalIndex = -1;

function openReviewModal(index) {
  const data = state.__reviewData;
  const review = data && data.reviews[index];
  if (!review) return;
  reviewModalIndex = index;
  const app = data.apps.find((a) => a.id === review._appId) || data.apps[0];
  const platformName = STORE_NAMES[review.platform] || 'Store';
  const body = (review.text || '').trim();
  const rating = num(review.rating);
  const helpful = review.helpful === '' || review.helpful == null ? null : Number(review.helpful);
  const link = safeUrl(review.url);
  const terms = splitTerms(data.term);

  $('#reviewModalTitle').textContent = (review.title || '').trim() || 'Review';
  $('#reviewModalBody').innerHTML = `
    <div class="review-detail-head">
      <div class="review-detail-stars">${starsHtml(rating)}<span class="review-detail-score">${rating}/5</span></div>
      <span class="review-detail-platform ${review.platform === 'apple' ? 'apple' : 'google'}">${platformName}</span>
    </div>
    <div class="review-detail-meta">
      <span class="review-detail-author">${escapeHtml(review.author || 'Anonymous')}</span>
      <span>${escapeHtml(absoluteDate(review.date, true) || 'Unknown date')}</span>
      ${review.version ? `<span class="review-detail-version">v${escapeHtml(review.version)}</span>` : ''}
      ${review.lang ? `<span>${escapeHtml(LANGUAGE_NAMES[review.lang] || review.lang)}</span>` : ''}
      ${helpful ? `<span>${helpful} found helpful</span>` : ''}
    </div>
    <div class="review-detail-text">${highlight(body || '(No review text provided)', terms)}</div>
    ${review.replyText ? `<div class="review-detail-reply"><div class="review-detail-reply-label">Developer response</div><div>${escapeHtml(review.replyText)}</div></div>` : ''}
    <div class="review-detail-actions">
      ${app ? `<span class="review-detail-app">${appIcon(app)}<span>${escapeHtml(app.name || '')}</span></span>` : ''}
      <span class="review-detail-pos">${index + 1} / ${data.reviews.length}</span>
      ${link ? `<a class="pill-btn" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open in ${platformName}</a>` : ''}
    </div>`;
  $('#prevReviewBtn').disabled = index <= 0;
  $('#nextReviewBtn').disabled = index >= data.reviews.length - 1;
  if (topModal() !== 'reviewModal') openModal('reviewModal');
}

function stepReview(delta) {
  const data = state.__reviewData;
  if (!data) return;
  const next = reviewModalIndex + delta;
  if (next < 0 || next >= data.reviews.length) return;
  openReviewModal(next);
  const row = $('#tableBody').querySelector(`tr[data-review-index="${next}"]`);
  row?.scrollIntoView({ block: 'nearest' });
  const entry = modalStack.find((m) => m.id === 'reviewModal');
  if (entry && row) entry.returnFocus = row;
}

function closeReviewModal() { closeModal('reviewModal'); }

// --- Review summary bar (fetched / filtered / store limits / warnings) ---
function renderReviewSummary() {
  const bar = $('#reviewSummary');
  const r = state.reviews;
  if (state.view !== 'reviews' || r.status === 'idle' || !selectedApps().length) { bar.classList.add('hidden'); return; }
  if (r.status === 'loading') {
    bar.innerHTML = `<span class="review-summary-text"><span class="inline-spinner" aria-hidden="true"></span>Fetching reviews for ${escapeHtml(r.apps.map((a) => a.name).join(', '))}…</span>`;
    bar.classList.remove('hidden');
    return;
  }

  const stores = Object.entries(r.perStore).map(([p, n]) => `${STORE_NAMES[p] || p} ${roundToK(n)}`).join(' · ');
  const parts = [`Fetched <strong>${r.all.length}</strong> review${r.all.length === 1 ? '' : 's'}${stores ? ` <span class="muted">(${escapeHtml(stores)})</span>` : ''}`];
  if (r.filtered.length !== r.all.length) parts.push(`<strong>${r.filtered.length}</strong> match`);
  if (r.languages.length > 1) parts.push(`<span data-tip="${escapeHtml(r.languages.map((l) => LANGUAGE_NAMES[l] || l).join(', '))}">${r.languages.length} languages</span>`);

  const next = MAX_REVIEW_STEPS.find((s) => s > (Number(state.filters.maxReviews) || 250));
  const lines = [
    ...r.errors.map((m) => `<li class="summary-error">${escapeHtml(m)}</li>`),
    ...r.warnings.map((m) => `<li class="summary-warn">${escapeHtml(m)}</li>`),
    ...(r.moreAvailable ? [`<li class="summary-info">More reviews are available — raise “Fetch” or use Load more.</li>`] : []),
    ...r.notes.map((m) => `<li class="summary-info">${escapeHtml(m)}</li>`),
  ];
  bar.innerHTML = `<span class="review-summary-text">${parts.join(' · ')}</span>` +
    (next && r.moreAvailable ? `<button type="button" class="pill-btn" id="loadMoreReviews" data-tip="Fetch up to ${next} reviews per store">Load more</button>` : '') +
    (lines.length ? `<ul class="review-summary-notes">${lines.join('')}</ul>` : '');
  bar.classList.remove('hidden');
}

function loadMoreReviews() {
  const cur = Number(state.filters.maxReviews) || 250;
  const next = MAX_REVIEW_STEPS.find((s) => s > cur);
  if (!next) return;
  state.filters.maxReviews = next;
  $('#maxReviews').value = String(next);
  onFiltersChanged('fetch');
}

function updateReviewAppLabel() {
  const label = $('#reviewAppLabel');
  const apps = selectedApps();
  if (!apps.length) { label.classList.add('hidden'); return; }
  $('#reviewAppName').textContent = apps.length > 1 ? `${apps.length} apps` : apps[0].name;
  label.dataset.tip = apps.map((a) => a.name).join(', ');
  label.classList.remove('hidden');
}

function updateCommentInputState() {
  const enabled = selectedApps().length > 0;
  const input = $('#commentSearchInput');
  input.disabled = !enabled;
  $('#commentSearchBtn').disabled = !enabled;
  input.placeholder = enabled ? 'Filter reviews, e.g. crash login' : 'Select an app first…';
}

// --- Persistence ---
function persist() {
  const f = state.filters;
  storage(STORAGE_KEY, JSON.stringify({
    apps: state.apps,
    folders: state.folders,
    country: f.country,
    lang: f.lang,
    store: f.store,
    starMin: f.starMin,
    starMax: f.starMax,
    maxReviews: f.maxReviews,
    view: state.view,
    selectedAppId: state.selectedAppId,
    sidebarCollapsed: state.sidebarCollapsed,
  }));
}

// Validates everything read back from storage: it may be old, partial or hand-edited.
function sanitizeApp(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const stores = (Array.isArray(raw.stores) ? raw.stores : [])
    .filter((s) => s && (s.platform === 'google' || s.platform === 'apple') && typeof s.appId === 'string' && s.appId)
    .map((s) => ({ platform: s.platform, appId: s.appId.slice(0, 200) }));
  const platform = raw.platform === 'apple' ? 'apple' : 'google';
  const primaryAppId = typeof raw.primaryAppId === 'string' && raw.primaryAppId ? raw.primaryAppId.slice(0, 200) : stores[0]?.appId;
  if (!primaryAppId) return null;
  if (!stores.some((s) => s.appId === primaryAppId)) stores.unshift({ platform, appId: primaryAppId });
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : newId('app'),
    name: String(raw.name || primaryAppId).slice(0, 200),
    platform,
    primaryAppId,
    stores,
    icon: safeUrl(raw.icon),
    developer: String(raw.developer || '').slice(0, 200),
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    color: /^#[0-9a-f]{6}$/iu.test(raw.color || '') ? raw.color : CAT_COLORS[index % CAT_COLORS.length],
  };
}

function loadPersisted() {
  try {
    const data = JSON.parse(storage(STORAGE_KEY) || 'null');
    if (data && typeof data === 'object') {
      const seen = new Set();
      state.apps = (Array.isArray(data.apps) ? data.apps : []).map(sanitizeApp).filter((a) => a && !seen.has(a.id) && seen.add(a.id));
      state.folders = (Array.isArray(data.folders) ? data.folders : [])
        .filter((f) => f && typeof f.id === 'string')
        .map((f) => ({ id: f.id.slice(0, 80), name: String(f.name || 'Folder').slice(0, 80), expanded: f.expanded !== false }));
      if (COUNTRIES.some((c) => c.code === data.country)) state.filters.country = data.country;
      if (LANGUAGES.some((l) => l.code === data.lang)) state.filters.lang = data.lang;
      if (['both', 'google', 'apple'].includes(data.store)) state.filters.store = data.store;
      if (/^[1-5]?$/u.test(String(data.starMin ?? ''))) state.filters.starMin = String(data.starMin ?? '');
      if (/^[1-5]?$/u.test(String(data.starMax ?? ''))) state.filters.starMax = String(data.starMax ?? '');
      if (MAX_REVIEW_STEPS.includes(Number(data.maxReviews))) state.filters.maxReviews = Number(data.maxReviews);
      if (data.view === 'reviews') state.view = 'reviews';
      if (state.apps.some((a) => a.id === data.selectedAppId)) {
        state.selectedAppId = data.selectedAppId;
        state.selectedApps = new Set([data.selectedAppId]);
      }
      state.sidebarCollapsed = data.sidebarCollapsed === true;
    }
  } catch { /* corrupted or unavailable */ }
  try {
    const recent = JSON.parse(storage(RECENT_KEY) || '[]');
    if (Array.isArray(recent)) state.recentKeywords = recent.filter((k) => typeof k === 'string' && k.length >= 2).slice(0, 8);
  } catch { /* ignore */ }
}

// --- Sidebar / folders ---
function appItemHtml(app, indented = false) {
  const active = app.id === state.selectedAppId;
  const selected = state.selectedApps.has(app.id);
  const initials = (app.name || '?').slice(0, 2).toUpperCase();
  const icon = safeUrl(app.icon);
  const stores = (app.stores || []).map((s) => STORE_NAMES[s.platform]).join(' + ');
  return `<div class="app-item${active ? ' active' : ''}${selected ? ' selected' : ''}${indented ? ' app-item-indented' : ''}" role="listitem">
    <div class="app-item-main" role="button" tabindex="0" data-app-id="${escapeHtml(app.id)}" draggable="true" aria-pressed="${selected}" data-tip="${escapeHtml(app.name)}">
      <div class="app-item-icon" style="background:${/^#[0-9a-f]{6}$/iu.test(app.color) ? app.color : '#8e8e93'}">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(initials)}</div>
      <div class="app-item-info">
        <div class="app-item-name">${escapeHtml(app.name)}</div>
        <div class="app-item-meta">${escapeHtml(stores)}</div>
      </div>
    </div>
    <button type="button" class="app-item-remove" data-remove-app="${escapeHtml(app.id)}" aria-label="Remove ${escapeHtml(app.name)}" title="Remove">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8"/></svg>
    </button>
  </div>`;
}

function renderFolders() {
  const tree = $('#folderTree');
  if (!state.apps.length && !state.folders.length) {
    tree.innerHTML = `<div class="sidebar-apps-empty">
      <div>No apps yet.</div>
      <button type="button" class="pill-btn pill-primary" data-action="add-app">+ Add your first app</button>
    </div>`;
    $('#footerMeta').textContent = 'No apps tracked';
    return;
  }

  const folderIds = new Set(state.folders.map((f) => f.id));
  const unfiled = state.apps.filter((a) => !a.folderId || !folderIds.has(a.folderId));
  const folderHtml = (folder) => {
    const apps = state.apps.filter((a) => a.folderId === folder.id);
    const expanded = folder.expanded !== false;
    return `<div class="folder-group${expanded ? '' : ' collapsed'}" data-folder-id="${escapeHtml(folder.id)}" role="listitem">
      <div class="folder-header" data-folder-toggle="${escapeHtml(folder.id)}" role="button" tabindex="0" aria-expanded="${expanded}">
        <svg class="folder-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5"/></svg>
        <svg class="folder-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3A1.5 1.5 0 000 4.5v7A1.5 1.5 0 001.5 13h13a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0014.5 3H8.621a1.5 1.5 0 01-1.06-.44L6.44 1.44A1.5 1.5 0 005.378 1H1.5z"/></svg>
        <span class="folder-name-label" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</span>
        <span class="folder-count">${apps.length}</span>
        <div class="folder-actions">
          <button type="button" class="folder-btn" data-rename-folder="${escapeHtml(folder.id)}" aria-label="Rename folder" title="Rename">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 2l2 2M2 8l-1 3 3-1L9.5 4.5l-2-2L2 8z"/></svg>
          </button>
          <button type="button" class="folder-btn folder-btn-danger" data-delete-folder="${escapeHtml(folder.id)}" aria-label="Delete folder" title="Delete folder">
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8"/></svg>
          </button>
        </div>
      </div>
      <div class="folder-body folder-drop-zone" data-drop-folder="${escapeHtml(folder.id)}" role="list">
        ${apps.length ? apps.map((a) => appItemHtml(a, true)).join('') : '<div class="folder-empty-hint">Drop apps here</div>'}
      </div>
    </div>`;
  };

  tree.innerHTML = `<div class="root-drop-zone" data-drop-folder="__root__" role="list">${unfiled.map((a) => appItemHtml(a)).join('')}</div>${state.folders.map(folderHtml).join('')}`;
  const n = state.apps.length;
  $('#footerMeta').textContent = `${n} app${n === 1 ? '' : 's'} tracked`;
}

// Drag & drop between folders (delegated: bound once, survives re-renders).
let draggingAppId = null;
function initFolderDragDrop() {
  const tree = $('#folderTree');
  tree.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-app-id]');
    if (!item) return;
    draggingAppId = item.dataset.appId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingAppId);
    setTimeout(() => item.closest('.app-item')?.classList.add('dragging'), 0);
  });
  tree.addEventListener('dragend', () => {
    draggingAppId = null;
    for (const el of tree.querySelectorAll('.dragging, .folder-drag-over')) el.classList.remove('dragging', 'folder-drag-over');
  });
  tree.addEventListener('dragover', (e) => {
    const zone = e.target.closest('[data-drop-folder]');
    if (!zone || !draggingAppId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    for (const el of tree.querySelectorAll('.folder-drag-over')) if (el !== zone) el.classList.remove('folder-drag-over');
    zone.classList.add('folder-drag-over');
  });
  tree.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop-folder]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('folder-drag-over');
  });
  tree.addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-drop-folder]');
    if (!zone || !draggingAppId) return;
    e.preventDefault();
    const app = state.apps.find((a) => a.id === draggingAppId);
    const target = zone.dataset.dropFolder;
    if (app) {
      app.folderId = target === '__root__' ? null : target;
      persist();
      renderFolders();
    }
  });
}

function createFolder() {
  const id = newId('folder');
  state.folders.push({ id, name: 'New folder', expanded: true });
  persist();
  renderFolders();
  startFolderRename(id);
}

function startFolderRename(folderId) {
  const nameEl = $('#folderTree').querySelector(`.folder-name-label[data-folder-id="${CSS.escape(folderId)}"]`);
  const folder = state.folders.find((f) => f.id === folderId);
  if (!nameEl || !folder) return;
  nameEl.contentEditable = 'true';
  nameEl.setAttribute('role', 'textbox');
  nameEl.focus();
  try {
    const r = document.createRange();
    r.selectNodeContents(nameEl);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch { /* ignore */ }
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = folder.name; nameEl.blur(); }
  };
  nameEl.addEventListener('keydown', onKey);
  nameEl.addEventListener('blur', () => {
    nameEl.removeEventListener('keydown', onKey);
    nameEl.contentEditable = 'false';
    nameEl.removeAttribute('role');
    folder.name = nameEl.textContent.trim().slice(0, 80) || folder.name;
    nameEl.textContent = folder.name;
    persist();
  }, { once: true });
}

function deleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const members = state.apps.filter((a) => a.folderId === folderId).map((a) => a.id);
  const index = state.folders.indexOf(folder);
  state.apps.forEach((a) => { if (a.folderId === folderId) a.folderId = null; });
  state.folders = state.folders.filter((f) => f.id !== folderId);
  persist();
  renderFolders();
  toast(`Folder “${folder.name}” deleted`, {
    action: {
      label: 'Undo',
      onClick: () => {
        state.folders.splice(index, 0, folder);
        state.apps.forEach((a) => { if (members.includes(a.id)) a.folderId = folderId; });
        persist();
        renderFolders();
      },
    },
  });
}

function toggleFolder(folderId) {
  const f = state.folders.find((x) => x.id === folderId);
  if (!f) return;
  f.expanded = f.expanded === false;
  persist();
  renderFolders();
  $('#folderTree').querySelector(`[data-folder-toggle="${CSS.escape(folderId)}"]`)?.focus();
}

function selectionChanged() {
  persist();
  renderFolders();
  updateReviewAppLabel();
  updateCommentInputState();
}

function selectSidebarApp(app, multi = false) {
  if (multi) {
    if (state.selectedApps.has(app.id)) {
      state.selectedApps.delete(app.id);
      if (state.selectedAppId === app.id) state.selectedAppId = [...state.selectedApps].at(-1) || null;
    } else {
      if (state.selectedApps.size >= MAX_COMPARE_APPS) {
        toast(`Compare up to ${MAX_COMPARE_APPS} apps at a time.`, { tone: 'warn' });
        return;
      }
      state.selectedApps.add(app.id);
      state.selectedAppId ||= app.id;
    }
  } else {
    state.selectedApps = new Set([app.id]);
    state.selectedAppId = app.id;
  }
  selectionChanged();

  // Keywords view with results: selecting an app shows its positions, no view switch.
  if (state.view === 'keywords' && state.aso.keyword) {
    renderAsoTable();
    if (!multi && state.selectedAppId) {
      toast(`Showing where ${app.name} ranks`, { action: { label: 'View reviews', onClick: () => setView('reviews') }, timeout: 3500 });
    }
    return;
  }
  if (state.view !== 'reviews') setView('reviews');
  else if (fullDataCtl.open) openFullData();
  else renderReviewsView();
}

function removeApp(appId) {
  const index = state.apps.findIndex((a) => a.id === appId);
  if (index < 0) return;
  const [app] = state.apps.splice(index, 1);
  const wasSelected = state.selectedApps.has(appId) || state.selectedAppId === appId;
  state.selectedApps.delete(appId);
  if (state.selectedAppId === appId) state.selectedAppId = [...state.selectedApps].at(-1) || null;
  selectionChanged();
  if (wasSelected) refreshAfterSelectionChange();
  toast(`Removed ${app.name}`, {
    action: {
      label: 'Undo',
      onClick: () => {
        state.apps.splice(Math.min(index, state.apps.length), 0, app);
        persist();
        renderFolders();
      },
    },
    timeout: 6000,
  });
}

function refreshAfterSelectionChange() {
  if (state.view === 'keywords') {
    if (state.aso.keyword) renderAsoTable();
    return;
  }
  if (fullDataCtl.open) {
    if (selectedApp()) openFullData();
    else closeFullDataPanel();
    return;
  }
  renderReviewsView();
}

// --- Add App modal ---
let modalDebounce = null;
let modalRows = [];

function openAddAppModal() {
  $('#modalSearchInput').value = '';
  modalRows = [];
  $('#modalResults').innerHTML = '<div class="modal-empty">Search by name, or paste a package name (com.spotify.music) or App Store id (324684580).</div>';
  openModal('addAppModal');
}

function closeAddAppModal() {
  cancelRequest('app-search');
  closeModal('addAppModal');
}

async function searchAppsInModal() {
  const q = $('#modalSearchInput').value.trim();
  if (q.length < 2) {
    cancelRequest('app-search');
    return;
  }
  const choice = $('#modalPlatform').value;
  const ctl = beginRequest('app-search');
  $('#modalResults').innerHTML = '<div class="modal-empty"><span class="inline-spinner" aria-hidden="true"></span>Searching…</div>';
  try {
    const data = await api(`/api/search?${params({
      platform: choice === 'both' ? 'all' : choice,
      q,
      country: state.filters.country,
      lang: state.filters.lang === 'all' ? '' : state.filters.lang,
      limit: 16,
    })}`, { signal: ctl.signal });
    if (!isCurrent('app-search', ctl)) return;
    modalRows = mergeModalResults(data.results || []);
    renderModalResults();
  } catch (err) {
    if (isAbort(err) || !isCurrent('app-search', ctl)) return;
    $('#modalResults').innerHTML = `<div class="modal-empty error-text">${escapeHtml(err.message)}</div>`;
  }
}

function renderModalResults() {
  if (!modalRows.length) {
    $('#modalResults').innerHTML = '<div class="modal-empty">No results. Try another name, store or country.</div>';
    return;
  }
  $('#modalResults').innerHTML = modalRows.map((group, i) => {
    const already = isTracked(group.stores);
    const storeNames = group.stores.map((s) => STORE_NAMES[s.platform]).join(' + ');
    return `
      <div class="modal-app-result">
        <div class="modal-app-icon">${appIcon(group)}</div>
        <div class="modal-app-info">
          <div class="modal-app-title">${escapeHtml(group.name)}${group.stores.length > 1 ? '<span class="tag store-both">both stores</span>' : ''}</div>
          <div class="modal-app-meta">${escapeHtml(storeNames)}${group.developer ? ` · ${escapeHtml(group.developer)}` : ''}${num(group.score) ? ` · ★${formatRating(group.score)}` : ''}</div>
        </div>
        <button type="button" class="modal-app-add${already ? ' added' : ''}" data-modal-index="${i}" ${already ? 'disabled' : ''}>${already ? 'Tracked ✓' : '+ Add'}</button>
      </div>`;
  }).join('');
}

// Same title (+ compatible developer) on both stores → one result with two listings.
function mergeModalResults(rows) {
  const groups = [];
  const byKey = new Map();
  for (const row of rows) {
    if (!row || !row.appId) continue;
    const key = normTitle(row.title) || `${row.platform}:${row.appId}`;
    const candidates = byKey.get(key) || [];
    let group = candidates.find((g) => !g.stores.some((s) => s.platform === row.platform));
    if (!group) {
      group = { name: row.title || row.appId, developer: row.developer || '', icon: safeUrl(row.icon), score: row.score, stores: [] };
      candidates.push(group);
      byKey.set(key, candidates);
      groups.push(group);
    }
    group.stores.push({ platform: row.platform, appId: row.appId, icon: safeUrl(row.icon), url: safeUrl(row.url), score: row.score });
    if (!group.icon) group.icon = safeUrl(row.icon);
  }
  // Stable sort: apps found on both stores first, otherwise keep search relevance.
  return groups.sort((a, b) => b.stores.length - a.stores.length);
}

function handleModalAdd(btn) {
  if (btn.disabled) return;
  const group = modalRows[Number(btn.dataset.modalIndex)];
  if (!group) return;
  const app = addTrackedApp(group);
  btn.classList.add('added');
  btn.disabled = true;
  btn.textContent = 'Tracked ✓';
  if (!app) return;
  if (state.apps.length === 1 || !state.selectedAppId) {
    closeAddAppModal();
    selectSidebarApp(app);
  } else {
    toast(`Added ${app.name}`, { action: { label: 'Open', onClick: () => { closeAddAppModal(); selectSidebarApp(app); } } });
  }
}

function addTrackedApp({ name, stores, icon, developer }) {
  const normStores = (stores || []).filter((s) => s && s.appId).map((s) => ({ platform: s.platform === 'apple' ? 'apple' : 'google', appId: String(s.appId) }));
  if (!normStores.length) return null;
  const existing = isTracked(normStores);
  if (existing) return existing;
  const app = {
    id: newId('app'),
    name: name || normStores[0].appId,
    platform: normStores[0].platform,
    primaryAppId: normStores[0].appId,
    stores: normStores,
    icon: safeUrl(icon || stores[0]?.icon),
    developer: developer || '',
    folderId: null,
    color: CAT_COLORS[state.apps.length % CAT_COLORS.length],
  };
  state.apps.push(app);
  persist();
  renderFolders();
  return app;
}

function selectAsoApp(asoApp) {
  const tracked = addTrackedApp({ name: asoApp.name, icon: asoApp.icon, developer: asoApp.stores?.[0]?.developer, stores: (asoApp.stores || []).map((s) => ({ platform: s.platform, appId: s.appId })) });
  if (!tracked) return;
  closeModal('appDetailModal');
  closeModal('keywordAppsModal');
  closeDetailPanel();
  selectSidebarApp(tracked);
}

// --- Full data (every language × every store, streamed) ---
const fullDataCtl = { open: false, payload: null, controller: null, shown: FULL_DATA_RENDER_STEP, term: '' };

function roundToKShort(v) {
  return roundToK(v);
}

function fullDataReviews(payload) {
  const out = [];
  for (const grp of payload.groups) {
    for (const r of grp.reviews || []) out.push(r.lang || grp.lang === 'all' ? r : { ...r, lang: grp.lang });
  }
  return out.sort(byDateDesc);
}

function computeStats(reviews) {
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let rated = 0;
  let from = null;
  let to = null;
  for (const r of reviews) {
    const s = Number(r.rating);
    if (Number.isInteger(s) && s >= 1 && s <= 5) { stars[s] += 1; sum += s; rated += 1; }
    const d = Date.parse(r.date);
    if (Number.isFinite(d)) {
      if (from === null || d < from) from = d;
      if (to === null || d > to) to = d;
    }
  }
  return { count: reviews.length, stars, avgRating: rated ? Math.round((sum / rated) * 10) / 10 : null, dateFrom: from, dateTo: to };
}

function starDistribution(stars, total) {
  return `<div class="star-dist" aria-label="Rating distribution">${[5, 4, 3, 2, 1].map((s) => {
    const n = stars?.[s] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="star-dist-row"><span>${s}★</span><div class="star-dist-bar"><div style="width:${pct}%"></div></div><span class="muted">${pct}%</span></div>`;
  }).join('')}</div>`;
}

function renderFullData() {
  const payload = fullDataCtl.payload;
  if (!payload) return;
  const header = $('#fullDataHeader');
  const storesEl = $('#fullDataStores');
  const all = fullDataReviews(payload);
  const terms = splitTerms(fullDataCtl.term);
  const list = terms.length
    ? all.filter((r) => terms.every((t) => `${r.title || ''} ${r.text || ''}`.toLowerCase().includes(t)))
    : all;
  const g = computeStats(all);
  const topTerms = payload.global?.topTerms || [];
  const errors = payload.errors || [];
  const warnings = payload.warnings || [];

  header.innerHTML = `
    <div class="full-data-title">
      <button type="button" class="pill-btn" data-full-data-action="close" aria-label="Back to reviews">← Back</button>
      <div>
        <div class="full-data-name">${escapeHtml(payload.appName)}</div>
        <div class="muted">Full data · ${escapeHtml(STORE_NAMES[payload.platform] || 'All stores')} · ${escapeHtml(payload.country.toUpperCase())}</div>
      </div>
      ${!payload.done ? `<span class="full-data-stream-status">Fetching… ${payload.groups.length} group${payload.groups.length === 1 ? '' : 's'} done</span>` : ''}
      <div class="full-data-export-actions">
        <button type="button" class="full-data-export-btn" data-full-data-action="export-csv" ${all.length ? '' : 'disabled'} title="Download every fetched review as CSV">Export CSV</button>
        <button type="button" class="full-data-export-btn" data-full-data-action="export-json" ${all.length ? '' : 'disabled'} title="Download the structured result as JSON">Export JSON</button>
      </div>
    </div>
    <div class="full-data-global-stats">
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Total reviews</span>
        <span class="full-data-global-stat-value">${roundToKShort(g.count)}</span>
      </div>
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Avg rating</span>
        <span class="full-data-global-stat-value">${g.avgRating ?? '—'}${g.avgRating ? '<small>/5</small>' : ''}</span>
      </div>
      <div class="full-data-global-stat">
        <span class="full-data-global-stat-label">Date range</span>
        <span class="full-data-global-stat-value small">${g.dateFrom ? escapeHtml(absoluteDate(g.dateFrom)) : '—'} – ${g.dateTo ? escapeHtml(absoluteDate(g.dateTo)) : '—'}</span>
      </div>
      ${g.count ? starDistribution(g.stars, g.count) : ''}
    </div>
    ${topTerms.length ? `<div class="full-data-top-terms">
        <span class="full-data-top-terms-label">Top terms</span>
        ${topTerms.map((t) => `<button type="button" class="full-data-term-chip${fullDataCtl.term === t ? ' active' : ''}" data-full-data-term="${escapeHtml(t)}" aria-pressed="${fullDataCtl.term === t}">${escapeHtml(t)}</button>`).join('')}
        ${fullDataCtl.term ? '<button type="button" class="link-btn" data-full-data-term="">Clear</button>' : ''}
      </div>` : ''}
    ${warnings.map((w) => `<div class="full-data-warn">${escapeHtml(w)}</div>`).join('')}
    ${errors.length ? `<details class="full-data-error-bar"><summary>${errors.length} request${errors.length === 1 ? '' : 's'} failed — details</summary><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></details>` : ''}
  `;

  if (!list.length) {
    storesEl.innerHTML = `<div class="full-data-empty-groups">${!payload.done ? '<span class="inline-spinner" aria-hidden="true"></span>Fetching reviews…' : all.length ? 'No reviews contain that term.' : 'No review data available.'}</div>`;
    return;
  }

  const prevScroll = storesEl.scrollTop;
  const limit = Math.min(fullDataCtl.shown, FULL_DATA_RENDER_CAP);
  const shown = list.slice(0, limit);
  const more = list.length - shown.length;
  const rows = shown.map((r) => `
    <article class="full-data-review">
      <div class="full-data-review-head">
        <span class="full-data-review-rating">${starsHtml(r.rating)}</span>
        <span class="full-data-review-platform ${r.platform === 'apple' ? 'apple' : 'google'}">${escapeHtml(STORE_NAMES[r.platform] || r.platform)}</span>
        <span class="full-data-review-author">${escapeHtml(r.author || 'Anonymous')}</span>
      </div>
      <div class="full-data-review-meta">
        <span class="full-data-review-date" data-tip="${escapeHtml(absoluteDate(r.date, true))}">${relativeTime(r.date)}</span>
        ${r.lang ? `<span>${escapeHtml(LANGUAGE_NAMES[r.lang] || r.lang)}</span>` : ''}
        ${r.version ? `<span class="full-data-review-version">v${escapeHtml(r.version)}</span>` : ''}
      </div>
      ${r.title ? `<div class="full-data-review-title">${highlight(r.title, terms)}</div>` : ''}
      <div class="full-data-review-text">${highlight(r.text || '(No text)', terms)}</div>
      ${r.replyText ? `<div class="full-data-review-reply">${escapeHtml(r.replyText)}</div>` : ''}
    </article>`).join('');

  let footer = '';
  if (more > 0) {
    footer = limit < FULL_DATA_RENDER_CAP
      ? `<div class="full-data-show-more"><span class="full-data-count">+${more} more</span><button type="button" class="pill-btn" data-full-data-action="show-more">Show ${Math.min(FULL_DATA_SHOW_STEP, more)} more</button></div>`
      : `<div class="full-data-show-more"><span class="full-data-count">Showing the first ${FULL_DATA_RENDER_CAP} of ${list.length} — export to get all of them.</span><button type="button" class="full-data-export-btn" data-full-data-action="export-csv">Export all (CSV)</button></div>`;
  } else if (!payload.done) {
    footer = '<div class="full-data-group-footer"><span class="inline-spinner" aria-hidden="true"></span>Fetching more reviews…</div>';
  }
  storesEl.innerHTML = `<div class="full-data-review-list">${rows}${footer}</div>`;
  storesEl.scrollTop = prevScroll;
}

function closeFullDataPanel({ render = true } = {}) {
  fullDataCtl.controller?.abort();
  fullDataCtl.controller = null;
  fullDataCtl.payload = null;
  if (!fullDataCtl.open) return;
  fullDataCtl.open = false;
  $('#fullDataPanel').classList.add('hidden');
  $('#tableContainer').classList.remove('hidden');
  $('#reviewBar').classList.toggle('hidden', state.view !== 'reviews');
  if (render && state.view === 'reviews') renderReviewsView();
}

function openFullData() {
  const app = selectedApp();
  if (!app) {
    toast('Select an app in the sidebar first.', { tone: 'warn' });
    return;
  }
  if (state.view !== 'reviews') setView('reviews');
  fullDataCtl.controller?.abort();
  const req = reviewRequest(app);
  const payload = { appId: app.primaryAppId, appName: app.name, platform: state.filters.store, country: state.filters.country, groups: [], errors: [], warnings: [], done: false };
  fullDataCtl.open = true;
  fullDataCtl.payload = payload;
  fullDataCtl.shown = FULL_DATA_RENDER_STEP;
  fullDataCtl.term = '';
  $('#tableContainer').classList.add('hidden');
  $('#reviewBar').classList.add('hidden');
  $('#fullDataPanel').classList.remove('hidden');
  renderFullData();
  runFullDataStream(params({ appId: req.appId, platform: req.platform, appPlatform: req.appPlatform, appId2: req.appId2, title: req.title, developer: req.developer, country: req.country }), payload);
}

// Consumes the /api/reviews.full.stream NDJSON response, rendering each group
// as it arrives. The payload is bound per stream so an aborted stream can never
// write into a newer one.
async function runFullDataStream(query, payload) {
  const ctl = new AbortController();
  fullDataCtl.controller = ctl;
  let pending = false;
  const scheduleRender = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (fullDataCtl.payload === payload) renderFullData();
    });
  };
  try {
    const res = await fetch(`/api/reviews.full.stream?${query}`, { signal: ctl.signal });
    if (!res.ok || !res.body) {
      let message = `Full data request failed (HTTP ${res.status})`;
      try { message = (await res.json()).error || message; } catch { /* not JSON */ }
      throw new Error(message);
    }
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
        if (!line || fullDataCtl.payload !== payload) continue;
        try { handleFullDataStreamMessage(payload, JSON.parse(line)); } catch { /* skip bad line */ }
        scheduleRender();
      }
    }
  } catch (err) {
    if (!isAbort(err) && fullDataCtl.payload === payload) payload.errors.push(err.message || String(err));
  } finally {
    if (fullDataCtl.controller === ctl) fullDataCtl.controller = null;
    if (fullDataCtl.payload === payload) {
      payload.done = true;
      renderFullData();
    }
  }
}

function handleFullDataStreamMessage(payload, msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'group' && msg.group) {
    payload.groups.push(msg.group);
  } else if (msg.type === 'done') {
    payload.done = true;
    payload.global = msg.global;
    payload.perStore = msg.perStore;
    payload.sources = msg.sources;
    if (Array.isArray(msg.errors)) payload.errors.push(...msg.errors);
    if (Array.isArray(msg.warnings)) payload.warnings.push(...msg.warnings);
    if (msg.truncated) payload.warnings.push('Stopped at 20,000 reviews to keep the result manageable.');
  } else if (msg.type === 'error' && msg.error) {
    payload.errors.push(msg.error);
  }
}

// --- Export (CSV, UTF-8 BOM so Excel reads non-Latin text correctly) ---
function safeFileName(s) {
  return String(s || 'export').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'export';
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCsv(filename, rows, headers) {
  downloadBlob(filename, `﻿${toCsv(rows, headers)}`, 'text/csv;charset=utf-8');
  toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} → ${filename}`, { tone: 'ok' });
}

function exportFullDataCsv() {
  const payload = fullDataCtl.payload;
  if (!payload) return;
  const rows = fullDataReviews(payload);
  if (!rows.length) { toast('Nothing to export yet.'); return; }
  downloadCsv(`full-data-${safeFileName(payload.appName)}-reviews.csv`, rows, REVIEW_CSV_HEADERS);
}

function exportFullDataJson() {
  const payload = fullDataCtl.payload;
  if (!payload) return;
  downloadBlob(`full-data-${safeFileName(payload.appName)}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function exportData() {
  if (fullDataCtl.open) { exportFullDataCsv(); return; }
  if (state.view === 'reviews') {
    const rows = state.reviews.filtered;
    if (!rows.length) { toast('No reviews to export yet.'); return; }
    const names = new Map(state.apps.map((a) => [a.id, a.name]));
    const withApp = rows.map((r) => ({ ...r, app: names.get(r._appId) || '' }));
    const label = state.reviews.apps.length === 1 ? state.reviews.apps[0].name : 'apps';
    downloadCsv(`reviews-${safeFileName(label)}${state.reviews.term ? `-${safeFileName(state.reviews.term)}` : ''}.csv`, withApp, ['app', ...REVIEW_CSV_HEADERS]);
    return;
  }
  const ready = state.aso.order.map((kw, i) => ({ kw, i, row: state.aso.rows.get(kw) })).filter((x) => x.row?.status === 'ready');
  if (!ready.length) { toast('Analyze a keyword first.'); return; }
  const app = selectedApp();
  const rows = ready.map(({ kw, i, row }) => {
    const d = row.data;
    const m = d.metrics || {};
    const pos = app ? appPositions(app, d.rankings) : [];
    const rankOn = (p) => { const x = pos.find((y) => y.platform === p); return x ? x.rank ?? `>${x.depth}` : ''; };
    return {
      keyword: kw,
      type: i === 0 ? 'analyzed' : 'similar',
      popularity: m.popularity,
      difficulty: m.difficulty,
      opportunity: m.opportunity,
      ratings: m.totalReviews,
      avgRating: m.avgRating,
      adsPercent: m.adsFraction,
      app: app?.name || '',
      googleRank: rankOn('google'),
      appleRank: rankOn('apple'),
      topApps: (d.apps || []).slice(0, 5).map((a) => a.name).join('; '),
      store: d.store,
      country: d.country,
      analyzedAt: d.analyzedAt,
    };
  });
  downloadCsv(`keywords-${safeFileName(state.aso.keyword)}.csv`, rows, Object.keys(rows[0]));
}

// --- Event Listeners ---
function isTypingTarget(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(el.tagName));
}

function initEvents() {
  const runAso = () => runASOSearch();
  let commentDebounce = null;

  // View tabs (arrow keys move between tabs)
  $('.view-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (!tab) return;
    // "Reviews" while Full data is open means "back to the review table".
    if (tab.dataset.view === 'reviews' && fullDataCtl.open) closeFullDataPanel({ render: false });
    setView(tab.dataset.view);
  });
  $('.view-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = state.view === 'keywords' ? 'reviews' : 'keywords';
    setView(next);
    $(`[data-view="${next}"]`).focus();
  });

  $('#asoSearchBtn').addEventListener('click', runAso);
  $('#asoSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAso(); });

  $('#commentSearchBtn').addEventListener('click', () => runCommentSearch());
  $('#commentSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(commentDebounce); runCommentSearch(); } });
  $('#commentSearchInput').addEventListener('input', () => {
    clearTimeout(commentDebounce);
    commentDebounce = setTimeout(() => runCommentSearch(), 180);
  });

  $('#exportBtn').addEventListener('click', exportData);
  $('#reviewAppLabel').addEventListener('click', () => {
    const app = selectedApp();
    if (app) fetchAndShowAppDetails(app);
  });
  $('#fullDataBtn').addEventListener('click', openFullData);
  $('#retryBtn').addEventListener('click', () => retryHandler?.());

  $('#reviewSummary').addEventListener('click', (e) => {
    if (e.target.closest('#loadMoreReviews')) loadMoreReviews();
  });

  // Full-data panel (delegated — survives re-renders)
  $('#fullDataPanel').addEventListener('click', (e) => {
    const term = e.target.closest('[data-full-data-term]');
    if (term) {
      fullDataCtl.term = fullDataCtl.term === term.dataset.fullDataTerm ? '' : term.dataset.fullDataTerm;
      fullDataCtl.shown = FULL_DATA_RENDER_STEP;
      renderFullData();
      return;
    }
    const action = e.target.closest('[data-full-data-action]');
    if (!action) return;
    const kind = action.dataset.fullDataAction;
    if (kind === 'show-more') {
      fullDataCtl.shown += FULL_DATA_SHOW_STEP;
      renderFullData();
    } else if (kind === 'export-csv') {
      exportFullDataCsv();
    } else if (kind === 'export-json') {
      exportFullDataJson();
    } else if (kind === 'close') {
      closeFullDataPanel();
    }
  });

  // Sidebar collapse toggle
  $('#sidebarToggle').addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    applySidebarCollapsed();
    persist();
  });

  // Onboarding
  $('#onboardingDone').addEventListener('click', () => {
    storage(ONBOARDED_KEY, '1');
    closeModal('onboardingOverlay');
    openAddAppModal();
  });
  $('#onboardingSkip').addEventListener('click', () => {
    storage(ONBOARDED_KEY, '1');
    closeModal('onboardingOverlay');
  });

  // App list + folder delegation
  const tree = $('#folderTree');
  tree.addEventListener('click', (e) => {
    if (e.target.closest('[contenteditable="true"]')) return;
    const renameBtn = e.target.closest('[data-rename-folder]');
    if (renameBtn) { startFolderRename(renameBtn.dataset.renameFolder); return; }
    const deleteBtn = e.target.closest('[data-delete-folder]');
    if (deleteBtn) { deleteFolder(deleteBtn.dataset.deleteFolder); return; }
    const folderToggle = e.target.closest('[data-folder-toggle]');
    if (folderToggle) { toggleFolder(folderToggle.dataset.folderToggle); return; }
    const rm = e.target.closest('[data-remove-app]');
    if (rm) { removeApp(rm.dataset.removeApp); return; }
    const appBtn = e.target.closest('[data-app-id]');
    if (appBtn) {
      const app = state.apps.find((a) => a.id === appBtn.dataset.appId);
      if (app) selectSidebarApp(app, e.ctrlKey || e.metaKey);
    }
  });
  tree.addEventListener('keydown', (e) => {
    if (e.target.closest('[contenteditable="true"]')) return;
    const appBtn = e.target.closest('[data-app-id]');
    const folderToggle = e.target.closest('[data-folder-toggle]');
    if ((e.key === 'Enter' || e.key === ' ') && (appBtn || folderToggle) && e.target === (appBtn || folderToggle)) {
      e.preventDefault();
      if (folderToggle) toggleFolder(folderToggle.dataset.folderToggle);
      else {
        const app = state.apps.find((a) => a.id === appBtn.dataset.appId);
        if (app) selectSidebarApp(app, e.ctrlKey || e.metaKey);
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && appBtn) {
      e.preventDefault();
      removeApp(appBtn.dataset.appId);
    }
  });
  initFolderDragDrop();
  $('#createFolderBtn').addEventListener('click', createFolder);

  // Add App modal
  $('#addAppBtn2').addEventListener('click', openAddAppModal);
  $('#closeAddAppModal').addEventListener('click', closeAddAppModal);
  $('#modalSearchInput').addEventListener('input', () => {
    clearTimeout(modalDebounce);
    modalDebounce = setTimeout(searchAppsInModal, 300);
  });
  $('#modalSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(modalDebounce); searchAppsInModal(); }
  });
  $('#modalPlatform').addEventListener('change', searchAppsInModal);
  $('#modalResults').addEventListener('click', (e) => {
    const btn = e.target.closest('.modal-app-add');
    if (btn) handleModalAdd(btn);
  });

  // Shared handlers for app lists in the keyword modals
  const onAppList = (e) => {
    const selectBtn = e.target.closest('[data-select-aso]');
    const data = detailData();
    if (selectBtn && data) {
      e.stopPropagation();
      const app = data.apps[Number(selectBtn.dataset.selectAso)];
      if (app) selectAsoApp(app);
      return true;
    }
    const row = e.target.closest('[data-asa-app]');
    if (row && data) {
      const app = data.apps[Number(row.dataset.asaApp)];
      if (app) fetchAndShowAppDetails(app);
      return true;
    }
    return false;
  };
  const onAppListKey = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-asa-app]')) {
      e.preventDefault();
      onAppList(e);
    }
  };
  $('#kwModalBody').addEventListener('click', onAppList);
  $('#kwModalBody').addEventListener('keydown', onAppListKey);
  $('#detailBody').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-kw]');
    if (chip) {
      closeDetailPanel();
      runASOSearch(chip.dataset.kw);
      return;
    }
    onAppList(e);
  });
  $('#detailBody').addEventListener('keydown', onAppListKey);
  $('#appDetailBody').addEventListener('click', (e) => {
    if (!e.target.closest('[data-track-detail]') || !asoDetailApp) return;
    selectAsoApp(asoDetailApp);
  });

  // Close buttons + backdrop clicks for every overlay
  const closers = {
    detailClose: 'detailOverlay',
    closeKwAppsModal: 'keywordAppsModal',
    closeAppDetailModal: 'appDetailModal',
    closeSettingsModal: 'settingsModal',
  };
  for (const [btn, modal] of Object.entries(closers)) $(`#${btn}`).addEventListener('click', () => closeModal(modal));
  $('#closeReviewModal').addEventListener('click', closeReviewModal);
  for (const overlay of $$('.modal-overlay')) {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target !== overlay) return;
      if (overlay.id === 'addAppModal') closeAddAppModal();
      else closeModal(overlay.id);
    });
  }
  $('#prevReviewBtn').addEventListener('click', () => stepReview(-1));
  $('#nextReviewBtn').addEventListener('click', () => stepReview(1));

  // Main table (delegated)
  const onTableActivate = (e) => {
    const retry = e.target.closest('[data-retry-kw]');
    if (retry) {
      const ctl = channels.get('aso');
      if (!ctl || ctl.signal.aborted) return;
      state.aso.rows.set(retry.dataset.retryKw, { status: 'loading' });
      updateAsoRow(retry.dataset.retryKw);
      loadSimilarRow(retry.dataset.retryKw, ctl);
      return;
    }
    const action = e.target.closest('[data-action]');
    if (action) return; // handled by the document-level action listener
    const chip = e.target.closest('[data-pop="1"]');
    const rowEl = e.target.closest('tr');
    if (chip && rowEl?.dataset.rowKw) {
      state.detailKeyword = rowEl.dataset.rowKw;
      const app = detailData()?.apps?.[Number(chip.dataset.appIndex)];
      if (app) fetchAndShowAppDetails(app);
      return;
    }
    if (e.target.closest('[data-pop="more"]') && rowEl?.dataset.rowKw) {
      openKeywordAppsModal(rowEl.dataset.rowKw);
      return;
    }
    if (!rowEl) return;
    if (rowEl.dataset.rowKind === 'comment') openReviewModal(Number(rowEl.dataset.reviewIndex));
    else if (rowEl.dataset.rowKind === 'aso') openKeywordDetail(rowEl.dataset.rowKw);
  };
  $('#tableBody').addEventListener('click', onTableActivate);
  $('#tableBody').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[tabindex]')) {
      e.preventDefault();
      onTableActivate(e);
    }
  });

  // Keyword chips anywhere outside the detail modal (similar bar, empty state)
  for (const container of [$('#similarBar'), $('#emptyState')]) {
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-kw]');
      if (chip) runASOSearch(chip.dataset.kw);
    });
  }

  // Generic data-action buttons (empty states, sidebar CTA, table footer)
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === 'add-app') openAddAppModal();
    else if (kind === 'clear-review-filters') clearReviewFilters();
    else if (kind === 'more-review-rows') {
      state.reviews.renderLimit += RENDER_CAP;
      applyReviewFilterState({ resetLimit: false });
    }
  });

  // Settings
  $('#settingsBtn').addEventListener('click', () => { theme.apply(); openModal('settingsModal'); });
  $('.theme-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-btn');
    if (btn) theme.set(btn.dataset.theme);
  });
  const resetBtn = $('#resetDataBtn');
  const resetLabel = resetBtn.textContent;
  let resetTimer = null;
  resetBtn.addEventListener('click', () => {
    if (resetBtn.dataset.confirm !== '1') {
      resetBtn.dataset.confirm = '1';
      resetBtn.textContent = 'Click again to confirm';
      resetTimer = setTimeout(() => { delete resetBtn.dataset.confirm; resetBtn.textContent = resetLabel; }, 3000);
      return;
    }
    clearTimeout(resetTimer);
    for (const key of [STORAGE_KEY, RECENT_KEY, ONBOARDED_KEY, 'theme']) storage(key, null);
    location.reload();
  });

  // Global keyboard: Escape closes the top layer; shortcuts when not typing.
  document.addEventListener('keydown', (e) => {
    trapFocus(e);
    if (e.key === 'Escape') {
      const top = topModal();
      if (top) {
        e.preventDefault();
        if (top === 'addAppModal') closeAddAppModal();
        else if (top === 'onboardingOverlay') { storage(ONBOARDED_KEY, '1'); closeModal(top); }
        else closeModal(top);
      } else if ($('.country-dropdown.open')) {
        document.body.click();
      } else if (fullDataCtl.open) {
        closeFullDataPanel();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportData();
      return;
    }
    if (topModal() === 'reviewModal' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stepReview(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (topModal() || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); focusSearch(); }
    else if (e.key.toLowerCase() === 'a') { e.preventDefault(); openAddAppModal(); }
  });

  // Flags from flagcdn may be blocked/offline: hide broken images instead of showing a broken icon.
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.add('img-failed');
  }, true);
}

function clearReviewFilters() {
  state.filters.starMin = '';
  state.filters.starMax = '';
  $('#starMin').value = '';
  $('#starMax').value = '';
  $('#commentSearchInput').value = '';
  state.reviews.term = '';
  persist();
  applyReviewFilterState();
}

function applySidebarCollapsed() {
  $('#sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
  const btn = $('#sidebarToggle');
  btn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  btn.setAttribute('aria-label', state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

// --- Styled tooltips (data-tip, or title converted on first hover) ---
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let hide = null;
  const show = (el) => {
    const text = el.dataset.tip || el.getAttribute('title');
    if (!text) return;
    if (!el.dataset.tip) { el.dataset.tip = text; el.removeAttribute('title'); }
    clearTimeout(hide);
    tip.textContent = text;
    tip.classList.add('visible');
    const r = el.getBoundingClientRect();
    tip.style.top = '0px';
    tip.style.left = '0px';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = r.top - th - 7;
    if (top < 4) top = r.bottom + 7;
    const left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  };
  const hideSoon = () => { hide = setTimeout(() => tip.classList.remove('visible'), 80); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title],[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) hideSoon(); });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip],[title]');
    if (el && e.target.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hideSoon);
  document.addEventListener('mousedown', () => tip.classList.remove('visible'));
  document.addEventListener('scroll', () => tip.classList.remove('visible'), true);
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('#appVersion').textContent = `Version ${health.version || '—'}${health.mock ? ' · demo data' : ''}`;
    if (health.mock) document.documentElement.classList.add('mock-mode');
  } catch { /* shown on first real request */ }
}

// --- Initialization ---
function init() {
  theme.init();
  loadPersisted();
  initDropdowns();
  initEvents();
  initTooltips();
  applySidebarCollapsed();
  renderFolders();
  updateReviewAppLabel();
  updateCommentInputState();
  setView(state.view);
  loadHealth();
  if (!storage(ONBOARDED_KEY)) openModal('onboardingOverlay');
}

init();
