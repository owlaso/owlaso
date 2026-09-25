import { applyReviewFilters } from './filters.js';
import { badRequest } from './errors.js';
import { topTerms } from '../public/lib/terms.js';

const APPLE_SEARCH_URL = 'https://itunes.apple.com/search';
const APPLE_LOOKUP_URL = 'https://itunes.apple.com/lookup';
const GOOGLE_PLAY_SEARCH_URL = 'https://play.google.com/store/search';
const GOOGLE_PLAY_DETAILS_URL = 'https://play.google.com/store/apps/details';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const APP_USER_AGENT = 'OwlASO/1.6 (+https://github.com/owlaso/owlaso)';
const APPLE_SEARCH_LIMIT = 200;
const GOOGLE_SEARCH_LIMIT = 250;
const SEARCH_CACHE_TTL_MS = Number.parseInt(process.env.SEARCH_CACHE_TTL_MS || '300000', 10);
const REVIEW_CACHE_TTL_MS = Number.parseInt(process.env.REVIEW_CACHE_TTL_MS || '300000', 10);
const DETAILS_CACHE_TTL_MS = Number.parseInt(process.env.DETAILS_CACHE_TTL_MS || '900000', 10);

// Reviews are fetched page by page from the stores.
// * google-play-scraper serves up to 150 reviews per request.
// * Apple's RSS customer-reviews feed serves up to 50 per page and caps access at
//   10 pages per storefront (≈500 reviews). That is a store-side hard limit.
//   The feed is per storefront (country), not per language, so it is fetched once.
const GOOGLE_REVIEW_PAGE_SIZE = 150;
const APPLE_REVIEW_PAGE_SIZE = 50;
const APPLE_REVIEW_MAX = 500;
const MAX_REVIEWS = 5000;

// Languages used when the caller asks for "all languages".
export const ALL_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'tr', 'ru', 'ja', 'ko', 'pt-BR', 'ar', 'hi', 'nl', 'pl', 'sv', 'id'];

export const LANGUAGE_LABELS = {
  en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', tr: 'Türkçe',
  ru: 'Русский', ja: '日本語', ko: '한국어', 'pt-BR': 'Português (BR)', ar: 'العربية', hi: 'हिन्दी',
  nl: 'Nederlands', pl: 'Polski', sv: 'Svenska', id: 'Bahasa Indonesia', all: 'All languages'
};

// Most-used review languages per storefront, most relevant first.
const COUNTRY_LANGUAGES = {
  us: ['en', 'es'], gb: ['en'], au: ['en'], ca: ['en', 'fr'], in: ['en', 'hi'], tr: ['tr'],
  de: ['de'], at: ['de'], ch: ['de', 'fr', 'it'], fr: ['fr'], be: ['nl', 'fr'], it: ['it'],
  es: ['es'], mx: ['es'], br: ['pt-BR'], jp: ['ja'], kr: ['ko'], ru: ['ru'], nl: ['nl'],
  pl: ['pl'], se: ['sv'], id: ['id'], sa: ['ar'], ae: ['ar', 'en'], eg: ['ar']
};

// Storefronts covered by "All countries" (same list as the UI's country picker).
export const STOREFRONTS = ['us', 'tr', 'gb', 'de', 'fr', 'it', 'es', 'br', 'jp', 'kr', 'in', 'ru', 'au', 'ca', 'mx', 'nl', 'pl', 'se', 'id', 'sa'];

// ── Input normalisation ───────────────────────────────────────────────────

export function isAllCountries(country) {
  return String(country || '').trim().toLowerCase() === 'all';
}

// "all" is only meaningful where a caller handles it explicitly (reviews / full
// data); everywhere else it falls back to the US store instead of becoming "al".
export function cleanCountry(country) {
  if (isAllCountries(country)) return 'us';
  return String(country || 'us').toLowerCase().replace(/[^a-z]/gu, '').slice(0, 2) || 'us';
}

export function cleanLang(lang) {
  const raw = String(lang || 'en').replace(/[^A-Za-z-]/gu, '').slice(0, 8);
  const known = ALL_LANGUAGES.find((l) => l.toLowerCase() === raw.toLowerCase());
  return known || raw.toLowerCase() || 'en';
}

export function primaryLanguage(country) {
  return (COUNTRY_LANGUAGES[cleanCountry(country)] || ['en'])[0];
}

// Every supported language, ordered by relevance for the storefront.
export function languagesForCountry(country) {
  const local = COUNTRY_LANGUAGES[cleanCountry(country)] || [];
  return [...new Set([...local, 'en', ...ALL_LANGUAGES])];
}

export function normalizePlatform(value, fallback = 'google') {
  if (value === 'google' || value === 'apple' || value === 'both') return value;
  if (value === 'all') return 'both';
  return fallback;
}

export function cleanPackageName(value) {
  return String(value || '').trim().match(/^[a-zA-Z][\w]*(?:\.[\w-]+)+$/u)?.[0] || '';
}

export function isAppleAppId(value) {
  return /^\d{1,15}$/u.test(String(value || '').trim());
}

export function inferPlatform(appId) {
  return isAppleAppId(appId) ? 'apple' : 'google';
}

// Throws a 400 when the id cannot belong to the given store.
export function assertAppId(platform, appId) {
  const id = String(appId || '').trim();
  if (!id) throw badRequest('appId is required. Use an App Store numeric id (e.g. 389801252) or a Google Play package (e.g. com.instagram.android).');
  if (platform === 'apple' && !isAppleAppId(id)) throw badRequest(`"${id.slice(0, 80)}" is not an App Store id (expected digits, e.g. 389801252).`);
  if (platform === 'google' && !cleanPackageName(id)) throw badRequest(`"${id.slice(0, 80)}" is not a Google Play package id (e.g. com.instagram.android).`);
  return id;
}

function asInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// Unicode-aware title key: "Ölçüm Pro" and "Olcum PRO" collide, "天気" survives.
export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const DEVELOPER_SUFFIXES = /\b(inc|llc|ltd|limited|gmbh|ag|sa|sas|srl|bv|oy|ab|as|pte|pty|plc|co|corp|corporation|company|studios?|games|technologies|technology|software|apps|mobile|labs|group|holdings)\b\.?/gu;

function normalizeDeveloper(value) {
  const cleaned = String(value || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(DEVELOPER_SUFFIXES, ' ');
  return cleaned.replace(/[^\p{L}\p{N}]+/gu, '');
}

// 1 = same developer, 0 = unknown, -1 = different developer.
export function developerSimilarity(a, b) {
  const x = normalizeDeveloper(a);
  const y = normalizeDeveloper(b);
  if (!x || !y) return 0;
  return x === y || x.includes(y) || y.includes(x) ? 1 : -1;
}

function brandPart(title) {
  return String(title || '').split(/\s[-–—:|•]\s|:\s|\s\|\s/u)[0];
}

export function titleSimilarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = normalizeTitle(brandPart(a));
  const by = normalizeTitle(brandPart(b));
  if (bx && by && (bx === by || bx === y || by === x)) return 0.9;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  const ratio = shorter.length / longer.length;
  if (longer.startsWith(shorter)) return 0.55 + 0.35 * ratio;
  if (longer.includes(shorter)) return 0.45 + 0.35 * ratio;
  return 0;
}

const COUNTERPART_MIN_SCORE = 0.8;

// Picks the listing on the other store that is the same app, or null. Never falls
// back to an unrelated "top" result: merging a stranger's reviews is worse than a gap.
export function pickCounterpart(rows, { title, developer } = {}) {
  let best = null;
  (rows || []).forEach((row, index) => {
    let score = titleSimilarity(title, row.title);
    if (score <= 0) return;
    const dev = developerSimilarity(developer, row.developer);
    if (dev > 0) score += 0.15;
    if (dev < 0) score -= 0.3;
    score -= index * 0.002; // earlier search results win ties
    if (!best || score > best.score) best = { row, score };
  });
  return best && best.score >= COUNTERPART_MIN_SCORE ? best.row : null;
}

// ── Networking ────────────────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class HttpStatusError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

async function fetchWithRetry(url, options = {}, { timeoutMs = 15000, retries = 2, baseDelayMs = 450, signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw signal.reason;
    let waitAtLeast = 0;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (response.ok) return response;
      // Release the connection before retrying or giving up.
      await response.body?.cancel().catch(() => {});
      lastError = new HttpStatusError(response.status);
      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
      waitAtLeast = retryAfterMs(response.headers.get('retry-after'));
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof HttpStatusError && !RETRYABLE_STATUS.has(error.status)) throw error;
      lastError = error; // network error, timeout or retryable status
    }
    if (attempt < retries) {
      const backoff = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 200);
      await sleep(Math.min(Math.max(backoff, waitAtLeast), 10000));
    }
  }
  throw lastError || new Error(`Request failed after ${retries + 1} attempts`);
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Cache: LRU bounded by weight (≈ rows held) + in-flight request coalescing ──
// Cached values are shared between callers and must be treated as immutable.

const CACHE_MAX_WEIGHT = Number.parseInt(process.env.CACHE_MAX_WEIGHT || '100000', 10);
const cache = new Map();
const inflight = new Map();
let cacheWeight = 0;

function weightOf(value) {
  if (Array.isArray(value)) return Math.max(1, value.length);
  if (value && Array.isArray(value.rows)) return Math.max(1, value.rows.length);
  return 1;
}

function cacheKey(type, params) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return `${type}:${JSON.stringify(entries)}`;
}

function dropEntry(key) {
  const entry = cache.get(key);
  if (!entry) return;
  cacheWeight -= entry.weight;
  cache.delete(key);
}

export function clearCache() {
  cache.clear();
  cacheWeight = 0;
}

export function cacheStats() {
  return { entries: cache.size, weight: cacheWeight, inflight: inflight.size };
}

export async function withCache(type, params, ttlMs, producer) {
  if (process.env.DISABLE_CACHE === '1' || process.env.MOCK_STORE_DATA === '1') return producer();
  const key = cacheKey(type, params);
  const hit = cache.get(key);
  if (hit) {
    if (hit.expires > Date.now()) {
      cache.delete(key); // move to most-recently-used position
      cache.set(key, hit);
      return hit.value;
    }
    dropEntry(key);
  }
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await producer();
      const weight = weightOf(value);
      dropEntry(key);
      cache.set(key, { value, expires: Date.now() + ttlMs, weight });
      cacheWeight += weight;
      for (const oldest of cache.keys()) {
        if (cacheWeight <= CACHE_MAX_WEIGHT || cache.size <= 1) break;
        dropEntry(oldest);
      }
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

// ── Google Play HTML helpers (fallback path when the scraper fails) ───────

function googleHeaders(lang, country) {
  const language = cleanLang(lang).split('-')[0] || 'en';
  return {
    'user-agent': BROWSER_USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': `${language}-${cleanCountry(country).toUpperCase()},${language};q=0.9,en;q=0.8`
  };
}

function decodeGoogleHtml(html) {
  return String(html || '')
    .replaceAll('\\u003d', '=')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\x3d', '=')
    .replaceAll('&amp;', '&');
}

export function extractGoogleAppIds(html, limit = 10) {
  const normalized = decodeGoogleHtml(html);
  const ids = new Set();
  // Only links to app detail pages: a bare "a.b.c" pattern also matched hostnames
  // like play.google.com and injected them as fake apps.
  const patterns = [
    /play\.google\.com[^"'<>]*?apps[^"'<>]*?details[^"'<>]*?id=([A-Za-z0-9._-]+)/gu,
    /\/store\/apps\/details\?id=([A-Za-z0-9._-]+)/gu,
    /details\?id=([A-Za-z0-9._-]+)/gu
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const appId = cleanPackageName(match[1]);
      if (appId) ids.add(appId);
      if (ids.size >= limit) return [...ids];
    }
  }
  return [...ids].slice(0, limit);
}

function extractMetaContent(html, property) {
  const pattern = new RegExp(
    `<meta[^>]+?(?:property|name)=["']${property}["'][^>]+?content=["']([^"']*)["'][^>]*>` +
    `|<meta[^>]+?content=["']([^"']*)["'][^>]+?(?:property|name)=["']${property}["'][^>]*>`,
    'iu'
  );
  const match = String(html || '').match(pattern);
  return decodeEntities(match ? String(match[1] ?? match[2] ?? '') : '');
}

function decodeEntities(text) {
  return String(text || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function extractJsonLd(data) {
  const html = String(data || '');
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(pattern)) {
    const cleaned = match[1].trim()
      .replace(/^<!--[\s\S]*?-->/u, '')
      .replace(/\/\/<!\[CDATA\[[\s\S]*?\]\]>/gu, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const entry = candidates.find((item) => item && item['@type'] && /SoftwareApplication|MobileApplication|WebApplication|Product/iu.test(String(item['@type'])));
      if (entry) return entry;
    } catch {
      // try the next JSON-LD block
    }
  }
  return null;
}

function parseGoogleTitleFromHtml(html) {
  const titleMatch = String(html || '').match(/<title>(.*?)<\/title>/iu);
  if (!titleMatch) return '';
  return decodeEntities(titleMatch[1].replace(/ - Apps on Google Play$/iu, '')).trim();
}

function checkGoogleConsent(response) {
  if (/consent\.google\.com/iu.test(String(response.url || ''))) {
    throw new Error('Google Play returned a consent interstitial. Try a different country/language or use a direct package id.');
  }
}

async function loadGooglePlay() {
  try {
    const mod = await import('google-play-scraper');
    return mod.default || mod;
  } catch (error) {
    const err = new Error('google-play-scraper is not installed. Run `npm install` first.');
    err.cause = error;
    throw err;
  }
}

// ── Mock data (MOCK_STORE_DATA=1) ─────────────────────────────────────────

function mockSearch(platform) {
  const rows = [
    { platform: 'google', appId: 'com.instagram.android', title: 'Instagram', developer: 'Instagram', score: 4.1, icon: '', url: 'https://play.google.com/store/apps/details?id=com.instagram.android' },
    { platform: 'google', appId: 'com.instagram.lite', title: 'Instagram Lite', developer: 'Instagram', score: 4.2, icon: '', url: 'https://play.google.com/store/apps/details?id=com.instagram.lite' },
    { platform: 'apple', appId: '389801252', title: 'Instagram', developer: 'Instagram, Inc.', score: 4.7, icon: '', url: 'https://apps.apple.com/app/id389801252' },
    { platform: 'apple', appId: '414478124', title: 'Instagram Threads', developer: 'Instagram, Inc.', score: 4.4, icon: '', url: 'https://apps.apple.com/app/id414478124' }
  ];
  return platform === 'both' ? rows : rows.filter((r) => r.platform === platform);
}

function mockReviews(platform, appId) {
  return [
    { id: `${platform}-mock-1`, platform, appId, rating: 1, title: 'Crash', text: 'App crashes after login and support never replies.', author: 'mock-user-1', date: '2026-05-20T10:00:00.000Z', version: '1.2.0', helpful: 11, replyText: '', url: '' },
    { id: `${platform}-mock-2`, platform, appId, rating: 3, title: 'Okay', text: 'Good idea but filters feel slow sometimes.', author: 'mock-user-2', date: '2026-05-22T12:00:00.000Z', version: '1.2.1', helpful: 4, replyText: 'Thanks for the feedback.', url: '' },
    { id: `${platform}-mock-3`, platform, appId, rating: 5, title: 'Great', text: 'Clean app and stable on my phone.', author: 'mock-user-3', date: '2026-05-25T08:00:00.000Z', version: '1.3.0', helpful: 1, replyText: '', url: '' }
  ];
}

// ── App details ───────────────────────────────────────────────────────────

function mapAppleApp(entry, { withSummary = false } = {}) {
  const price = Number.parseFloat(entry.price);
  return {
    platform: 'apple',
    appId: String(entry.trackId),
    title: entry.trackName || '',
    developer: entry.sellerName || entry.artistName || '',
    score: Number.isFinite(Number(entry.averageUserRating)) ? Number(entry.averageUserRating) : '',
    icon: entry.artworkUrl100 || entry.artworkUrl512 || '',
    url: entry.trackViewUrl || '',
    reviews: Number.parseInt(entry.userRatingCount, 10) || 0,
    installs: '',
    containsAds: false,
    free: Number.isFinite(price) ? price === 0 : entry.formattedPrice === 'Free',
    price: Number.isFinite(price) ? price : 0,
    genre: entry.primaryGenreName || '',
    updated: entry.currentVersionReleaseDate || entry.releaseDate || null,
    summary: withSummary ? entry.description || '' : ''
  };
}

async function googleAppDetails(appId, country, lang) {
  const gplay = await loadGooglePlay();
  try {
    const app = await gplay.app({ appId, country, lang });
    return {
      platform: 'google',
      appId: app.appId || appId,
      title: app.title || appId,
      developer: app.developer || '',
      score: app.score,
      icon: app.icon || '',
      url: app.url || `${GOOGLE_PLAY_DETAILS_URL}?id=${encodeURIComponent(appId)}`,
      reviews: Number.parseInt(app.ratings ?? app.reviews, 10) || 0,
      installs: app.installs || '',
      containsAds: Boolean(app.containsAds ?? app.adSupported),
      free: Boolean(app.free),
      price: app.price || 0,
      genre: app.genre || '',
      updated: toIsoDate(app.updated) || null,
      summary: app.summary || ''
    };
  } catch (scraperError) {
    const url = new URL(GOOGLE_PLAY_DETAILS_URL);
    url.searchParams.set('id', appId);
    url.searchParams.set('hl', cleanLang(lang));
    url.searchParams.set('gl', cleanCountry(country).toUpperCase());
    let response;
    try {
      response = await fetchWithRetry(url, { headers: googleHeaders(lang, country) }, { retries: 1 });
    } catch (error) {
      throw new Error(`Google Play details failed for ${appId}: ${error.message || scraperError.message}`);
    }
    checkGoogleConsent(response);
    const html = await response.text();
    const ld = extractJsonLd(html);
    const image = typeof ld?.image === 'string' ? ld.image : Array.isArray(ld?.image) ? ld.image[0] : '';
    const author = typeof ld?.author === 'string' ? ld.author : ld?.author?.name || '';
    return {
      platform: 'google',
      appId,
      title: decodeEntities(ld?.name || '') || parseGoogleTitleFromHtml(html) || appId,
      developer: decodeEntities(author),
      score: toNumber(ld?.aggregateRating?.ratingValue) || '',
      icon: image || extractMetaContent(html, 'og:image') || '',
      url: `${GOOGLE_PLAY_DETAILS_URL}?id=${encodeURIComponent(appId)}`,
      reviews: Number.parseInt(ld?.aggregateRating?.ratingCount, 10) || 0,
      installs: '',
      containsAds: false,
      free: true,
      price: 0,
      genre: '',
      updated: null,
      summary: decodeEntities(ld?.description || '')
    };
  }
}

export async function fetchGoogleAppDetails({ appId, country = 'us', lang = 'en' } = {}) {
  const id = assertAppId('google', appId);
  const c = cleanCountry(country);
  const l = cleanLang(lang);
  return withCache('google-details', { appId: id, country: c, lang: l }, DETAILS_CACHE_TTL_MS, () => googleAppDetails(id, c, l));
}

export async function fetchAppleAppDetails({ appId, country = 'us' } = {}) {
  const id = assertAppId('apple', appId);
  const c = cleanCountry(country);
  return withCache('apple-details', { appId: id, country: c }, DETAILS_CACHE_TTL_MS, async () => {
    const url = new URL(APPLE_LOOKUP_URL);
    url.searchParams.set('id', id);
    url.searchParams.set('country', c);
    url.searchParams.set('media', 'software');
    const response = await fetchWithRetry(url, { headers: { 'user-agent': APP_USER_AGENT } });
    const json = await response.json();
    const entry = (json.results || [])[0];
    if (!entry) throw new Error(`App Store app ${id} not found in the ${c.toUpperCase()} storefront.`);
    return mapAppleApp(entry, { withSummary: true });
  });
}

// ── Search ────────────────────────────────────────────────────────────────

async function searchGoogleWithScraper({ q, country, lang, limit }) {
  const gplay = await loadGooglePlay();
  const results = await gplay.search({ term: q, num: limit, country, lang, fullDetail: false });
  return (results || []).map((app) => ({
    platform: 'google',
    appId: app.appId,
    title: app.title,
    developer: app.developer,
    score: app.score,
    icon: app.icon,
    url: app.url || `${GOOGLE_PLAY_DETAILS_URL}?id=${encodeURIComponent(app.appId)}`,
    free: app.free,
    price: app.price || 0
  })).filter((app) => app.appId);
}

async function searchGoogleFallback({ q, country, lang, limit, concurrency }) {
  const url = new URL(GOOGLE_PLAY_SEARCH_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('c', 'apps');
  url.searchParams.set('hl', cleanLang(lang));
  url.searchParams.set('gl', cleanCountry(country).toUpperCase());

  const response = await fetchWithRetry(url, { headers: googleHeaders(lang, country) });
  checkGoogleConsent(response);
  const appIds = extractGoogleAppIds(await response.text(), limit);
  return mapWithConcurrency(appIds, concurrency, async (appId) => {
    try {
      return await fetchGoogleAppDetails({ appId, country, lang });
    } catch {
      return { platform: 'google', appId, title: appId, developer: '', score: '', icon: '', url: `${GOOGLE_PLAY_DETAILS_URL}?id=${encodeURIComponent(appId)}` };
    }
  });
}

// Scraper first; the (much more expensive) HTML fallback only runs when the scraper
// fails or finds nothing — it re-fetches details for every hit.
export async function searchGoogleApps({ q, country, lang, limit = 50, concurrency = 6 } = {}) {
  const term = String(q || '').trim();
  const c = cleanCountry(country);
  const l = cleanLang(lang);
  const max = asInt(limit, 50, 1, GOOGLE_SEARCH_LIMIT);
  const packageName = cleanPackageName(term);
  if (packageName) {
    try {
      return [await fetchGoogleAppDetails({ appId: packageName, country: c, lang: l })];
    } catch {
      // "notes.app" looks like a package but may just be a search term
    }
  }

  return withCache('google-search', { q: term.toLowerCase(), country: c, lang: l, limit: max }, SEARCH_CACHE_TTL_MS, async () => {
    const errors = [];
    try {
      const rows = await searchGoogleWithScraper({ q: term, country: c, lang: l, limit: max });
      if (rows.length) return rows.slice(0, max);
      errors.push('google-play-scraper returned no apps');
    } catch (error) {
      errors.push(error.message || String(error));
    }
    try {
      const rows = await searchGoogleFallback({ q: term, country: c, lang: l, limit: max, concurrency });
      if (rows.length) return rows.slice(0, max);
      errors.push('Google Play HTML fallback returned no apps');
    } catch (error) {
      errors.push(error.message || String(error));
    }
    throw new Error(`Google search failed: ${errors.join(' | ')}`);
  });
}

export async function searchAppleApps({ q, country, lang, limit } = {}) {
  const term = String(q || '').trim();
  const c = cleanCountry(country);
  const max = asInt(limit, APPLE_SEARCH_LIMIT, 1, APPLE_SEARCH_LIMIT);
  // The Search API only knows en_us and ja_jp.
  const appleLang = cleanLang(lang) === 'ja' ? 'ja_jp' : 'en_us';
  return withCache('apple-search', { q: term.toLowerCase(), country: c, lang: appleLang, limit: max }, SEARCH_CACHE_TTL_MS, async () => {
    const url = new URL(APPLE_SEARCH_URL);
    url.searchParams.set('term', term);
    url.searchParams.set('entity', 'software');
    url.searchParams.set('country', c);
    url.searchParams.set('limit', String(max));
    url.searchParams.set('lang', appleLang);
    const response = await fetchWithRetry(url, { headers: { 'user-agent': APP_USER_AGENT } });
    const json = await response.json();
    return (json.results || []).filter((app) => app.trackId).map((app) => mapAppleApp(app));
  });
}

function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export async function searchApps({ platform = 'both', q, country = 'us', lang = 'en', limit = 200 } = {}) {
  const store = normalizePlatform(platform, 'both');
  const max = asInt(limit, 200, 1, Math.max(APPLE_SEARCH_LIMIT, GOOGLE_SEARCH_LIMIT));

  if (process.env.MOCK_STORE_DATA === '1') {
    return mockSearch(store).slice(0, max * (store === 'both' ? 2 : 1));
  }

  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const perStore = store === 'both' ? Math.max(1, Math.ceil(max / 2)) : max;

  const [google, apple] = await Promise.allSettled([
    store === 'apple' ? Promise.resolve([]) : searchGoogleApps({ q: term, country, lang, limit: Math.min(perStore, GOOGLE_SEARCH_LIMIT) }),
    store === 'google' ? Promise.resolve([]) : searchAppleApps({ q: term, country, lang, limit: Math.min(perStore, APPLE_SEARCH_LIMIT) })
  ]);
  const errors = [google, apple].filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
  const rows = interleave(google.value || [], apple.value || []);
  if (!rows.length && errors.length) throw new Error(errors.join(' | '));
  return uniqueRows(rows).slice(0, max);
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.platform}:${row.appId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Cross-store resolution ────────────────────────────────────────────────

const storeName = (platform) => (platform === 'apple' ? 'App Store' : 'Google Play');

async function findCounterpart({ platform, title, developer, country, lang }) {
  return withCache('counterpart', {
    platform,
    title: normalizeTitle(title),
    developer: normalizeDeveloper(developer),
    country: cleanCountry(country),
    lang: cleanLang(lang)
  }, SEARCH_CACHE_TTL_MS, async () => {
    const rows = platform === 'apple'
      ? await searchAppleApps({ q: title, country, lang, limit: 10 })
      : await searchGoogleApps({ q: title, country, lang, limit: 10 });
    const match = pickCounterpart(rows, { title, developer });
    return match ? { appId: match.appId, title: match.title } : null;
  });
}

// Works out which store listing(s) to read for a request.
//   appId        listing the caller knows
//   appPlatform  store appId belongs to (inferred from the id format when missing)
//   appId2       the caller's known listing on the other store
//   title/developer  used to find the other store's listing when appId2 is missing
export async function resolveListings(params = {}) {
  const platform = normalizePlatform(params.platform);
  const appId = String(params.appId || '').trim();
  const primaryPlatform = params.appPlatform === 'apple' || params.appPlatform === 'google' ? params.appPlatform : inferPlatform(appId);
  const otherPlatform = primaryPlatform === 'apple' ? 'google' : 'apple';
  const wanted = platform === 'both' ? [primaryPlatform, otherPlatform] : [platform];
  const specs = [];
  const warnings = [];

  for (const store of wanted) {
    if (store === primaryPlatform) {
      specs.push({ platform: store, appId: assertAppId(store, appId) });
      continue;
    }
    const pinned = String(params.appId2 || '').trim();
    const pinnedValid = pinned && (store === 'apple' ? isAppleAppId(pinned) : Boolean(cleanPackageName(pinned)));
    if (pinnedValid) {
      specs.push({ platform: store, appId: pinned });
      continue;
    }
    const title = String(params.title || '').trim();
    if (!title) {
      warnings.push(`No ${storeName(store)} listing is known for this app.`);
      continue;
    }
    try {
      const match = await findCounterpart({ platform: store, title, developer: params.developer, country: params.country, lang: params.lang });
      if (match) specs.push({ platform: store, appId: match.appId, matchedTitle: match.title });
      else warnings.push(`No matching ${storeName(store)} app found for “${title}”.`);
    } catch (error) {
      warnings.push(`${storeName(store)} lookup failed: ${error.message || String(error)}`);
    }
  }
  return { specs, warnings };
}

// ── Reviews ───────────────────────────────────────────────────────────────

function mapGoogleSort(gplay, sort) {
  const requested = String(sort || 'newest').toLowerCase();
  if (requested === 'rating') return gplay.sort?.RATING;
  if (requested === 'helpfulness') return gplay.sort?.HELPFULNESS;
  return gplay.sort?.NEWEST;
}

function normalizeGoogleReview(review, appId) {
  return {
    id: review.id || '',
    platform: 'google',
    appId,
    rating: Number(review.score),
    title: review.title || '',
    text: review.text || '',
    author: review.userName || '',
    date: toIsoDate(review.date),
    version: review.version || review.appVersion || '',
    helpful: review.thumbsUp || 0,
    replyText: review.replyText || '',
    url: review.url || `${GOOGLE_PLAY_DETAILS_URL}?id=${encodeURIComponent(appId)}&reviewId=${encodeURIComponent(review.id || '')}`
  };
}


function normalizeAppleEntry(entry, appId, country) {
  const rating = entry['im:rating']?.label || entry.rating?.label || entry.rating?.['im:rating'] || '';
  return {
    id: entry.id?.label || '',
    platform: 'apple',
    appId,
    rating: Number(rating),
    title: entry.title?.label || '',
    text: entry.content?.label || '',
    author: entry.author?.name?.label || '',
    date: toIsoDate(entry.updated?.label),
    version: entry['im:version']?.label || '',
    helpful: Number.parseInt(entry['im:voteSum']?.label, 10) || 0,
    replyText: '',
    url: entry.link?.attributes?.href || `https://apps.apple.com/${country}/app/id${encodeURIComponent(appId)}`
  };
}

// Stable identity of a review: the store's review id, else its content.
export function reviewKey(review) {
  if (review.id) return `${review.platform}:${review.id}`;
  return [
    review.platform,
    String(review.author || '').toLowerCase(),
    String(review.title || '').toLowerCase(),
    String(review.text || '').slice(0, 60).toLowerCase()
  ].join('|');
}

export function dedupeReviews(reviews) {
  const seen = new Set();
  const out = [];
  for (const review of reviews) {
    if (!review) continue;
    const key = reviewKey(review);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(review);
  }
  return out;
}

function byDateDesc(a, b) {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
}

async function runGoogleReviewsOnce(gplay, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await gplay.reviews(options);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(350 * (attempt + 1));
    }
  }
  throw lastError || new Error('Google Play reviews request failed');
}

async function fetchGoogleReviews(params) {
  const appId = assertAppId('google', params.appId);
  const max = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 60);
  const country = cleanCountry(params.country);
  const lang = cleanLang(params.lang);
  const sortKey = String(params.sort || 'newest').toLowerCase();

  return withCache('google-reviews', { appId, max, pages, country, lang, sortKey }, REVIEW_CACHE_TTL_MS, async () => {
    const gplay = await loadGooglePlay();
    const sort = mapGoogleSort(gplay, sortKey);
    const rows = [];
    const seen = new Set();
    let nextPaginationToken;
    let pagesFetched = 0;
    let drained = false;
    // A small budget (e.g. one language of a multi-language fetch) needs a single small page.
    const pageSize = Math.min(GOOGLE_REVIEW_PAGE_SIZE, max);
    const maxPages = pages > 0 ? Math.min(pages, Math.ceil(max / pageSize)) : Math.ceil(max / pageSize) + 2;

    for (let i = 0; i < maxPages && rows.length < max; i += 1) {
      const result = await runGoogleReviewsOnce(gplay, {
        appId,
        sort,
        num: pageSize,
        paginate: true,
        nextPaginationToken,
        country,
        lang
      });
      const data = Array.isArray(result) ? result : result.data || [];
      pagesFetched += 1;
      for (const review of data) {
        const row = normalizeGoogleReview(review, appId);
        const key = reviewKey(row);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }
      nextPaginationToken = result.nextPaginationToken;
      if (!nextPaginationToken || !data.length) {
        drained = true;
        break;
      }
      if (rows.length < max) await sleep(300);
    }

    return {
      rows: rows.slice(0, max),
      meta: {
        source: 'google-play-scraper',
        pageSize,
        pagesFetched,
        reachedStoreLimit: drained,
        moreAvailable: !drained && Boolean(nextPaginationToken)
      }
    };
  });
}

async function fetchAppleReviews(params) {
  const appId = assertAppId('apple', params.appId);
  const max = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 10);
  const country = cleanCountry(params.country);
  const lang = cleanLang(params.lang).toLowerCase();
  const sort = String(params.sort || 'newest').toLowerCase() === 'helpfulness' ? 'mostHelpful' : 'mostRecent';
  const windowPages = APPLE_REVIEW_MAX / APPLE_REVIEW_PAGE_SIZE;

  return withCache('apple-reviews', { appId, max, pages, country, sort, lang }, REVIEW_CACHE_TTL_MS, async () => {
    const rows = [];
    const seen = new Set();
    let pagesFetched = 0;
    let drained = false;
    const maxPages = Math.min(pages > 0 ? pages : windowPages, Math.ceil(max / APPLE_REVIEW_PAGE_SIZE), windowPages);

    for (let page = 1; page <= maxPages && rows.length < max; page += 1) {
      const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/sortBy=${sort}/id=${encodeURIComponent(appId)}/json?l=${encodeURIComponent(lang)}&limit=${APPLE_REVIEW_PAGE_SIZE}`;
      let entries;
      try {
        const response = await fetchWithRetry(url, { headers: { 'user-agent': APP_USER_AGENT } });
        const json = await response.json();
        const raw = json.feed?.entry || [];
        entries = (Array.isArray(raw) ? raw : [raw]).filter((entry) => entry['im:rating'] || entry.rating);
      } catch (error) {
        // Past the last page the feed errors out: that just means "no more".
        // Failing on the first page is a real error and must not look like "0 reviews".
        if (page === 1) throw new Error(`App Store reviews failed for ${appId}: ${error.message || String(error)}`);
        drained = true;
        break;
      }

      if (!entries.length) {
        drained = true;
        break;
      }
      pagesFetched += 1;
      for (const entry of entries) {
        const row = normalizeAppleEntry(entry, appId, country);
        const key = reviewKey(row);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }
      if (entries.length < APPLE_REVIEW_PAGE_SIZE) {
        drained = true;
        break;
      }
    }

    const windowExhausted = pagesFetched >= windowPages;
    return {
      rows: rows.slice(0, max),
      meta: {
        source: 'apple-rss',
        pageSize: APPLE_REVIEW_PAGE_SIZE,
        pagesFetched,
        storeLimit: APPLE_REVIEW_MAX,
        reachedStoreLimit: drained || windowExhausted,
        moreAvailable: !drained && !windowExhausted && rows.length >= max,
        note: `App Store reviews are capped at ~${APPLE_REVIEW_MAX} per storefront by Apple's RSS feed.`
      }
    };
  });
}

function fetchStoreReviews(platform, scoped) {
  return platform === 'apple' ? fetchAppleReviews(scoped) : fetchGoogleReviews(scoped);
}

function summarizeSources(specs, settled) {
  const sources = [];
  const errors = [];
  const notes = [];
  settled.forEach((result, index) => {
    const spec = specs[index];
    if (result.status === 'fulfilled') {
      const meta = result.value.meta || {};
      sources.push({ platform: spec.platform, appId: spec.appId, matchedTitle: spec.matchedTitle, source: meta.source, fetched: result.value.rows.length, moreAvailable: Boolean(meta.moreAvailable) });
      if (meta.note && !notes.includes(meta.note)) notes.push(meta.note);
    } else {
      errors.push(`${storeName(spec.platform)} (${spec.appId}): ${result.reason?.message || String(result.reason)}`);
    }
  });
  return { sources, errors, notes };
}

export async function fetchReviews(params = {}) {
  if (isAllCountries(params.country)) return fetchReviewsAllCountries(params);
  const platform = normalizePlatform(params.platform);
  const appId = String(params.appId || '').trim();

  if (process.env.MOCK_STORE_DATA === '1') {
    if (platform === 'both') {
      const rows = [
        ...applyReviewFilters(mockReviews('google', appId || 'com.example.app'), params),
        ...applyReviewFilters(mockReviews('apple', '389801252'), params)
      ].sort(byDateDesc);
      return { platform: 'both', appId, reviews: rows, totalFetched: 6, totalAfterFilters: rows.length, meta: { mock: true, sources: [], errors: [], warnings: [], notes: [] } };
    }
    assertAppId(platform, appId);
    const rows = applyReviewFilters(mockReviews(platform, appId), params);
    return { platform, appId, reviews: rows, totalFetched: 3, totalAfterFilters: rows.length, meta: { mock: true, sources: [], errors: [], warnings: [], notes: [] } };
  }

  const country = cleanCountry(params.country);
  const lang = cleanLang(params.lang === 'all' ? primaryLanguage(country) : params.lang);
  const { specs, warnings } = await resolveListings({ ...params, platform, country, lang });
  if (!specs.length) throw badRequest(warnings[0] || 'No store listing available for this app.');

  const settled = await Promise.allSettled(specs.map((spec) => fetchStoreReviews(spec.platform, { ...params, appId: spec.appId, country, lang })));
  const { sources, errors, notes } = summarizeSources(specs, settled);
  if (!sources.length) throw new Error(errors.join(' | '));

  const merged = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value.rows : []));
  if (String(params.sort || 'newest').toLowerCase() === 'newest') merged.sort(byDateDesc);
  const filtered = applyReviewFilters(merged, params);
  return {
    platform,
    appId,
    reviews: filtered,
    totalFetched: merged.length,
    totalAfterFilters: filtered.length,
    meta: { sources, errors, warnings, notes, moreAvailable: sources.some((s) => s.moreAvailable) }
  };
}

function parseLangList(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return fallback;
  return [...new Set(raw.split(',').map((x) => cleanLang(x.trim())).filter(Boolean))];
}

// Google splits reviews by language, so the budget is spread across languages
// (storefront languages first). Apple's feed is per storefront: fetched once.
async function fetchGoogleLanguages({ appId, country, languages, pages, maxPerSource, sort }) {
  const perLang = Math.max(10, Math.ceil(maxPerSource / Math.max(1, languages.length)));
  const settled = await Promise.allSettled(languages.map((lang) => fetchGoogleReviews({ appId, country, lang, sort, max: perLang, pages })));
  const rows = [];
  const errors = [];
  let moreAvailable = false;
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      for (const row of result.value.rows) rows.push({ ...row, lang: languages[index] });
      moreAvailable ||= Boolean(result.value.meta?.moreAvailable);
    } else {
      errors.push(`${languages[index]}: ${result.reason?.message || String(result.reason)}`);
    }
  });
  if (!rows.length && errors.length === languages.length) throw new Error(errors.join(' | '));
  return { rows: dedupeReviews(rows), meta: { source: 'google-play-scraper', moreAvailable } };
}

export async function fetchReviewsMulti(params = {}) {
  if (isAllCountries(params.country)) return fetchReviewsAllCountries(params);
  const platform = normalizePlatform(params.platform, 'both');
  const appId = String(params.appId || '').trim();
  const country = cleanCountry(params.country);
  const maxPerSource = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 10);
  const maxLanguages = asInt(params.maxLanguages, 6, 1, ALL_LANGUAGES.length);
  const languages = parseLangList(params.languages, languagesForCountry(country)).slice(0, maxLanguages);
  const sort = String(params.sort || 'newest').toLowerCase();

  if (process.env.MOCK_STORE_DATA === '1') {
    const result = await fetchReviews({ ...params, platform, appId, max: maxPerSource, pages, country, lang: 'en', sort });
    return { ...result, languages };
  }

  const { specs, warnings } = await resolveListings({ ...params, platform, country, lang: languages[0] });
  if (!specs.length) throw badRequest(warnings[0] || 'No store listing available for this app.');

  const settled = await Promise.allSettled(specs.map((spec) => (spec.platform === 'apple'
    ? fetchAppleReviews({ appId: spec.appId, country, lang: languages[0], sort, max: maxPerSource, pages })
    : fetchGoogleLanguages({ appId: spec.appId, country, languages, pages, maxPerSource, sort }))));
  const { sources, errors, notes } = summarizeSources(specs, settled);
  if (!sources.length) throw new Error(errors.join(' | '));

  const merged = dedupeReviews(settled.flatMap((result) => (result.status === 'fulfilled' ? result.value.rows : [])));
  if (sort === 'newest') merged.sort(byDateDesc);
  const filtered = applyReviewFilters(merged, params);
  return {
    platform,
    appId,
    languages,
    reviews: filtered,
    totalFetched: merged.length,
    totalAfterFilters: filtered.length,
    meta: { sources, errors, warnings, notes, moreAvailable: sources.some((s) => s.moreAvailable) }
  };
}

// ── All countries ─────────────────────────────────────────────────────────
// App Store reviews belong to a storefront, so every country is read. Google
// Play keys reviews by language (country barely changes them), so it is read
// once per distinct language, from a storefront that speaks it.
export function googleLanguageStorefronts(countries = STOREFRONTS) {
  const byLang = new Map();
  for (const country of countries) {
    const lang = primaryLanguage(country);
    if (!byLang.has(lang)) byLang.set(lang, country);
  }
  return [...byLang].map(([lang, country]) => ({ lang, country }));
}

function mockAllCountries(params) {
  const platform = normalizePlatform(params.platform);
  const appId = String(params.appId || '').trim() || 'com.example.app';
  const stores = platform === 'both' ? ['google', 'apple'] : [platform];
  const rows = [];
  for (const store of stores) {
    if (store === 'apple') {
      for (const country of ['us', 'tr']) {
        for (const r of mockReviews('apple', '389801252')) rows.push({ ...r, id: `${r.id}-${country}`, country });
      }
    } else {
      for (const r of mockReviews('google', appId)) rows.push({ ...r, lang: 'en' });
    }
  }
  rows.sort(byDateDesc);
  const filtered = applyReviewFilters(rows, params);
  return {
    platform, appId, countries: STOREFRONTS, reviews: filtered, totalFetched: rows.length, totalAfterFilters: filtered.length,
    meta: { mock: true, sources: [], errors: [], warnings: [], notes: [], moreAvailable: false },
  };
}

export async function fetchReviewsAllCountries(params = {}) {
  if (process.env.MOCK_STORE_DATA === '1') return mockAllCountries(params);
  const platform = normalizePlatform(params.platform);
  const appId = String(params.appId || '').trim();
  const max = asInt(params.max, 200, 1, MAX_REVIEWS);
  // The "Fetch" budget is spread over the markets, with at least one full page each.
  const perSource = Math.min(APPLE_REVIEW_MAX, Math.max(APPLE_REVIEW_PAGE_SIZE, Math.ceil(max / 4)));
  const sort = String(params.sort || 'newest').toLowerCase();

  const { specs, warnings } = await resolveListings({ ...params, platform, country: 'us', lang: 'en' });
  if (!specs.length) throw badRequest(warnings[0] || 'No store listing available for this app.');

  const tasks = [];
  for (const spec of specs) {
    if (spec.platform === 'apple') {
      for (const country of STOREFRONTS) tasks.push({ spec, country, lang: primaryLanguage(country) });
    } else {
      for (const { lang, country } of googleLanguageStorefronts()) tasks.push({ spec, country, lang });
    }
  }

  const results = await mapWithConcurrency(tasks, 5, async (task) => {
    try {
      const result = await fetchStoreReviews(task.spec.platform, { appId: task.spec.appId, country: task.country, lang: task.lang, sort, max: perSource });
      return { task, result };
    } catch (error) {
      return { task, error };
    }
  });

  const rows = [];
  const errors = [];
  const perStore = {};
  let moreAvailable = false;
  for (const { task, result, error } of results) {
    const store = task.spec.platform;
    perStore[store] ||= { platform: store, appId: task.spec.appId, matchedTitle: task.spec.matchedTitle, fetched: 0, markets: 0, failed: 0 };
    if (error) {
      perStore[store].failed += 1;
      continue;
    }
    perStore[store].markets += 1;
    perStore[store].fetched += result.rows.length;
    moreAvailable ||= Boolean(result.meta?.moreAvailable);
    for (const row of result.rows) rows.push(store === 'apple' ? { ...row, country: task.country } : { ...row, lang: task.lang });
  }
  for (const s of Object.values(perStore)) {
    if (s.failed && !s.markets) errors.push(`${storeName(s.platform)} (${s.appId}): every ${s.platform === 'apple' ? 'storefront' : 'language'} failed`);
    else if (s.failed) warnings.push(`${storeName(s.platform)}: ${s.failed} ${s.platform === 'apple' ? 'storefront(s)' : 'language(s)'} could not be read`);
  }
  const sources = Object.values(perStore).filter((s) => s.markets).map((s) => ({ ...s, moreAvailable }));
  if (!sources.length) throw new Error(errors.join(' | ') || 'No reviews could be fetched.');

  const merged = dedupeReviews(rows);
  if (sort === 'newest') merged.sort(byDateDesc);
  const filtered = applyReviewFilters(merged, params);
  return {
    platform,
    appId,
    countries: STOREFRONTS,
    reviews: filtered,
    totalFetched: merged.length,
    totalAfterFilters: filtered.length,
    meta: {
      sources,
      errors,
      warnings,
      notes: ['All countries: App Store reviews come from each storefront; Google Play reviews are grouped by language, because Google does not separate them by country.'],
      moreAvailable,
    },
  };
}

// ── Full-data fetch (every language × every store) ────────────────────────

// depth 1/2/3 → Google reviews per language and overall ceiling ("Go deeper" in the UI).
const FULL_DEPTH = [
  { googlePerLang: 1000, ceiling: 20000 },
  { googlePerLang: 2500, ceiling: 30000 },
  { googlePerLang: 5000, ceiling: 40000 },
];
const FULL_CONCURRENCY = 6;

function computeGroupStats(reviews) {
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sumRating = 0;
  let rated = 0;
  let dateFrom = null;
  let dateTo = null;
  for (const r of reviews) {
    const s = Number(r.rating);
    if (Number.isInteger(s) && s >= 1 && s <= 5) {
      stars[s] += 1;
      sumRating += s;
      rated += 1;
    }
    const d = Date.parse(r.date);
    if (Number.isFinite(d)) {
      if (dateFrom === null || d < dateFrom) dateFrom = d;
      if (dateTo === null || d > dateTo) dateTo = d;
    }
  }
  return {
    count: reviews.length,
    stars,
    avgRating: rated ? Math.round((sumRating / rated) * 10) / 10 : null,
    dateFrom: dateFrom === null ? null : new Date(dateFrom).toISOString(),
    dateTo: dateTo === null ? null : new Date(dateTo).toISOString(),
    topTerms: topTerms(reviews).map((t) => t.term),
  };
}

export { computeGroupStats };

// Streams reviews group by group (one group per store×language task as it
// completes) so the UI renders early results while the rest keeps loading.
// Deterministic multilingual demo reviews so the Full data explorer has
// something realistic to show in MOCK_STORE_DATA mode.
const MOCK_LINES = {
  en: { bad: ['App crashes every time I export a photo', 'Subscription charged twice and no refund', 'Too many ads after the update', 'Watermark on every photo unless you pay', 'Freezes when I open the camera'], good: ['Filters look natural and smooth', 'Beautiful results with the slim tool', 'Editing is fast and the filters are natural', 'Smooth editor, natural skin tone'], mid: ['Decent editor but the export is slow', 'Nice filters, export quality could be better'] },
  tr: { bad: ['Uygulama sürekli çöküyor, fotoğraf kaydedilmiyor', 'Abonelik iptal edilmiyor, param geri gelmedi', 'Reklamlar çok fazla', 'Filigran kaldırmak için ödeme istiyor'], good: ['Filtreler doğal duruyor', 'İnceltme aracı harika sonuç veriyor', 'Hızlı ve doğal filtreler'], mid: ['Fena değil ama kayıt yavaş'] },
  es: { bad: ['La aplicación se cierra al exportar', 'Me cobraron la suscripción dos veces', 'Demasiados anuncios'], good: ['Filtros naturales y suaves', 'Resultados muy naturales'], mid: ['Está bien pero exportar es lento'] },
  'pt-BR': { bad: ['O aplicativo trava ao salvar a foto', 'Cobraram a assinatura duas vezes', 'Muitos anúncios'], good: ['Filtros naturais e bonitos', 'Resultado natural no rosto'], mid: ['Razoável, mas a exportação demora'] },
};

function mockFullReviews(platform, appId, lang, country, count) {
  const pool = MOCK_LINES[lang] || MOCK_LINES.en;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const seed = (i * 7919 + lang.length * 104729 + (country || '').length * 13) % 1000;
    const rating = seed % 10 < 2 ? 1 : seed % 10 < 3 ? 2 : seed % 10 < 4 ? 3 : seed % 10 < 6 ? 4 : 5;
    const bucket = rating <= 2 ? pool.bad : rating === 3 ? pool.mid : pool.good;
    const text = seed % 17 === 0 ? 'ok' : bucket[seed % bucket.length];
    rows.push({
      id: `${platform}-${lang}-${country || 'x'}-${i}`,
      platform, appId, rating,
      title: seed % 3 === 0 ? text.split(' ').slice(0, 3).join(' ') : '',
      text,
      author: `user${seed}`,
      date: new Date(Date.UTC(2026, 8, 20) - i * 86400000 * 3 - seed * 60000).toISOString(),
      version: `2.${6 - Math.floor(i / 60)}.${seed % 5}`,
      helpful: seed % 11,
      replyText: seed % 13 === 0 ? 'Thanks for the feedback — a fix is on the way.' : '',
      url: '',
    });
  }
  return rows;
}

function mockFullData(platform, appId, country, depth, { onGroup, onPlan, onProgress }) {
  const stores = platform === 'both' ? ['google', 'apple'] : [platform];
  const appleCountries = country === 'all' ? ['us', 'tr', 'br'] : [country];
  const sources = [];
  for (const store of stores) {
    if (store === 'apple') for (const c of appleCountries) sources.push({ id: `apple:${c}`, platform: 'apple', lang: null, country: c });
    else for (const l of ['en', 'tr', 'es', 'pt-BR']) sources.push({ id: `google:${l}`, platform: 'google', lang: l, country: null });
  }
  onPlan?.({ total: sources.length, depth, sources });
  const groups = sources.map((source, i) => {
    const lang = source.lang || primaryLanguage(source.country);
    const rows = mockFullReviews(source.platform, source.platform === 'apple' ? '389801252' : appId, lang, source.country, source.platform === 'apple' ? 60 : 90)
      .map((r) => (source.platform === 'google' ? { ...r, lang: source.lang } : { ...r, country: source.country }));
    const capped = source.platform === 'google' && depth < 3;
    const group = { platform: source.platform, lang: source.lang || 'all', country: source.country, langLabel: LANGUAGE_LABELS[source.lang || 'all'], ...computeGroupStats(rows), reviews: rows, source: { ...source, count: rows.length, capped }, meta: { mock: true, moreAvailable: capped } };
    onGroup?.(group);
    onProgress?.({ done: i + 1, total: sources.length, source: { ...source, status: 'ok', count: rows.length, capped } });
    return group;
  });
  const global = computeGroupStats(groups.flatMap((g) => g.reviews));
  return { appId, platform, country, depth, sources: [], totalGroups: groups.length, totalReviews: global.count, global, perStore: {}, errors: [], warnings: [], aborted: false, truncated: false };
}

// Callbacks: onPlan({ total, sources }) once, onGroup(group) per finished source
// with reviews, onProgress({ done, total, source }) after every source (ok or failed).
export async function fetchAllReviewsStream(params = {}, { onGroup, onPlan, onProgress, signal } = {}) {
  const appId = String(params.appId || '').trim();
  if (!appId) throw badRequest('appId is required.');
  const allCountries = isAllCountries(params.country);
  const country = allCountries ? 'all' : cleanCountry(params.country);
  const platform = normalizePlatform(params.platform);
  const languages = languagesForCountry(allCountries ? 'us' : country);
  const depth = asInt(params.depth, 1, 1, FULL_DEPTH.length);
  const { googlePerLang, ceiling } = FULL_DEPTH[depth - 1];
  if (process.env.MOCK_STORE_DATA === '1') return mockFullData(platform, appId, country, depth, { onGroup, onPlan, onProgress });

  const { specs, warnings } = await resolveListings({ ...params, platform, country: allCountries ? 'us' : country, lang: languages[0] });
  if (!specs.length) throw badRequest(warnings[0] || 'No store listing available for this app.');

  // One task per App Store storefront (all of them for "All countries") and one
  // per Google Play language.
  const appleCountries = allCountries ? STOREFRONTS : [country];
  const googleTargets = allCountries
    ? ALL_LANGUAGES.map((lang) => ({ lang, country: STOREFRONTS.find((c) => primaryLanguage(c) === lang) || 'us' }))
    : languages.map((lang) => ({ lang, country }));
  const tasks = [];
  for (const spec of specs) {
    if (spec.platform === 'apple') {
      for (const c of appleCountries) {
        tasks.push({ spec, lang: 'all', country: c, source: { id: `apple:${c}`, platform: 'apple', lang: null, country: c }, producer: () => fetchAppleReviews({ appId: spec.appId, country: c, lang: primaryLanguage(c), max: APPLE_REVIEW_MAX }) });
      }
    } else {
      for (const { lang, country: c } of googleTargets) {
        tasks.push({ spec, lang, source: { id: `google:${lang}`, platform: 'google', lang, country: null }, producer: () => fetchGoogleReviews({ appId: spec.appId, country: c, lang, max: googlePerLang }) });
      }
    }
  }
  const totalTasks = tasks.length;
  let finished = 0;
  const report = (source) => {
    finished += 1;
    try { onProgress?.({ done: finished, total: totalTasks, source }); } catch { /* listener errors must not break the fetch */ }
  };
  try { onPlan?.({ total: totalTasks, depth, sources: tasks.map((t) => t.source) }); } catch { /* ignore */ }

  const emitted = [];
  const errors = [];
  const seen = new Set();
  let total = 0;
  let aborted = false;
  let truncated = false;

  await mapWithConcurrency(tasks, FULL_CONCURRENCY, async (task) => {
    if (aborted || signal?.aborted) {
      aborted = true;
      return;
    }
    try {
      const result = await task.producer();
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      // Same review can come back for several languages: keep the first copy.
      const rows = [];
      for (const row of result.rows) {
        const key = reviewKey(row);
        if (seen.has(key)) continue;
        if (total >= ceiling) {
          truncated = true;
          break;
        }
        seen.add(key);
        total += 1;
        rows.push(task.country ? { ...row, country: task.country } : { ...row, lang: task.lang });
      }
      const stats = computeGroupStats(rows);
      // Capped = the store had more than we read: Google's per-language limit
      // for this depth, or Apple's 10-page (~500 reviews) window.
      const capped = task.spec.platform === 'apple'
        ? (result.meta?.pagesFetched || 0) >= APPLE_REVIEW_MAX / APPLE_REVIEW_PAGE_SIZE
        : Boolean(result.meta?.moreAvailable);
      const source = { ...task.source, status: 'ok', count: rows.length, fetched: result.rows.length, capped };
      const group = {
        platform: task.spec.platform,
        lang: task.lang,
        country: task.country || null,
        langLabel: LANGUAGE_LABELS[task.lang] || task.lang,
        ...stats,
        reviews: rows,
        source,
        sources: [{ platform: task.spec.platform, appId: task.spec.appId }],
        meta: result.meta
      };
      emitted.push(group);
      if (onGroup) {
        try { onGroup(group); } catch { /* listener errors must not break the fetch */ }
      }
      report(source);
    } catch (err) {
      const message = err.message || String(err);
      errors.push(`${storeName(task.spec.platform)} ${task.lang === 'all' ? '' : `${LANGUAGE_LABELS[task.lang] || task.lang} `}(${task.spec.appId}): ${message}`);
      report({ ...task.source, status: 'failed', count: 0, error: message });
    }
  });

  const globalStats = computeGroupStats(emitted.flatMap((g) => g.reviews));
  const perStore = {};
  for (const g of emitted) {
    if (!perStore[g.platform]) perStore[g.platform] = { count: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    perStore[g.platform].count += g.count;
    for (const s of [1, 2, 3, 4, 5]) perStore[g.platform].stars[s] += g.stars[s];
  }

  return {
    appId,
    platform,
    country,
    depth,
    maxDepth: FULL_DEPTH.length,
    sources: specs.map(({ platform: p, appId: id, matchedTitle }) => ({ platform: p, appId: id, matchedTitle })),
    totalGroups: emitted.length,
    totalReviews: globalStats.count,
    global: globalStats,
    perStore,
    errors,
    warnings,
    aborted,
    truncated
  };
}

// Non-streaming variant: groups sorted apple-first, then by language.
export async function fetchAllReviews(params = {}) {
  const groups = [];
  const summary = await fetchAllReviewsStream(params, { onGroup: (g) => groups.push(g) });
  groups.sort((a, b) => {
    const pa = a.platform === 'apple' ? 0 : 1;
    const pb = b.platform === 'apple' ? 0 : 1;
    return pa - pb || a.lang.localeCompare(b.lang);
  });
  return { ...summary, groups };
}
