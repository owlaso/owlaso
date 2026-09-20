import { applyReviewFilters } from './filters.js';

const APPLE_SEARCH_URL = 'https://itunes.apple.com/search';
const GOOGLE_PLAY_SEARCH_URL = 'https://play.google.com/store/search';
const GOOGLE_PLAY_DETAILS_URL = 'https://play.google.com/store/apps/details';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const APPLE_SEARCH_LIMIT = 200;
const GOOGLE_SEARCH_LIMIT = 250;
const SEARCH_CACHE_TTL_MS = Number.parseInt(process.env.SEARCH_CACHE_TTL_MS || '300000', 10);
const REVIEW_CACHE_TTL_MS = Number.parseInt(process.env.REVIEW_CACHE_TTL_MS || '300000', 10);

// Reviews are fetched page by page from the stores.
// * google-play-scraper serves up to 150 reviews per request (google-play-scraper clamps `num`).
// * Apple's RSS customer-reviews feed serves up to 50 per page and caps access at
//   ~10 pages per country/language (≈500 reviews). That is a store-side hard limit.
const GOOGLE_REVIEW_PAGE_SIZE = 150;
const APPLE_REVIEW_PAGE_SIZE = 50;
const APPLE_REVIEW_MAX = 500;
const MAX_REVIEWS = 5000;

const cache = new Map();

function asInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanCountry(country) {
  return (country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'us';
}

function cleanLang(lang) {
  return (lang || 'en').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 8) || 'en';
}

// Languages used when the caller asks for "all languages".
export const ALL_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'tr', 'ru', 'ja', 'ko', 'pt-BR', 'ar', 'hi', 'nl', 'pl'];

function cleanPackageName(value) {
  return String(value || '').trim().match(/^[a-zA-Z][\w]*(?:\.[\w-]+)+$/u)?.[0] || '';
}

function googleHeaders(lang, country) {
  const language = cleanLang(lang).split('-')[0] || 'en';
  return {
    'user-agent': DEFAULT_USER_AGENT,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': `${language}-${country.toUpperCase()},${language};q=0.9,en;q=0.8`
  };
}

function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchWithRetry(url, options = {}, { timeoutMs = 25000, retries = 3, baseDelayMs = 450 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') break;
    }
    if (attempt < retries) {
      const jitter = Math.floor(Math.random() * 200);
      await sleep(baseDelayMs * 2 ** attempt + jitter);
    }
  }
  throw lastError || new Error(`Request failed after ${retries + 1} attempts`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function uniqueRowsByPlatformAndAppId(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.platform}:${row.appId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheKey(type, params) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return `${type}:${JSON.stringify(entries)}`;
}

async function withCache(type, params, ttlMs, producer) {
  if (process.env.DISABLE_CACHE === '1' || process.env.MOCK_STORE_DATA === '1') return producer();
  const key = cacheKey(type, params);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await producer();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
  }
  return value;
}

function decodeGoogleHtml(html) {
  return String(html || '')
    .replaceAll('\\u003d', '=')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\x3d', '=')
    .replaceAll('&amp;', '&');
}

function extractGoogleAppIds(html, limit = 10) {
  const normalized = decodeGoogleHtml(html);
  const ids = new Set();
  const patterns = [
    // Matches Google's embedded JSON payloads where slashes are escaped (\/store\/apps\/details?id=...)
    /play\.google\.com[^"'<>]*?apps[^"'<>]*?details[^"'<>]*?id=([A-Za-z0-9._-]+)/gu,
    /\/store\/apps\/details\?id=([A-Za-z0-9._-]+)/gu,
    /details\?id=([A-Za-z0-9._-]+)/gu,
    /"([a-zA-Z][\w]*(?:\.[\w-]+){2,})"/gu
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
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function extractJsonLd(data) {
  const html = String(data || '');
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  const blocks = [...html.matchAll(pattern)].map((match) => match[1].trim());
  for (const block of blocks) {
    const cleaned = block
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
  return titleMatch[1]
    .replace(/ - Apps on Google Play$/iu, '')
    .replace(/&amp;/g, '&')
    .trim();
}

function mockSearch(platform) {
  const rows = [
    { platform: 'google', appId: 'com.instagram.android', title: 'Instagram', developer: 'Instagram', score: 4.1, icon: '', url: 'https://play.google.com/store/apps/details?id=com.instagram.android' },
    { platform: 'google', appId: 'com.instagram.lite', title: 'Instagram Lite', developer: 'Instagram', score: 4.2, icon: '', url: 'https://play.google.com/store/apps/details?id=com.instagram.lite' },
    { platform: 'apple', appId: '389801252', title: 'Instagram', developer: 'Instagram, Inc.', score: 4.7, icon: '', url: 'https://apps.apple.com/app/id389801252' },
    { platform: 'apple', appId: '414478124', title: 'Instagram Threads', developer: 'Instagram, Inc.', score: 4.4, icon: '', url: 'https://apps.apple.com/app/id414478124' }
  ];
  return platform === 'all' ? rows : rows.filter((r) => r.platform === platform);
}

function parseTitleKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? n : 0;
}

function pickBestTitleMatch(rows, title) {
  if (!rows || !rows.length) return null;
  const key = parseTitleKey(title);
  const scored = rows.map((row) => ({ row, k: parseTitleKey(row.title) }));
  const exact = scored.find((item) => item.k && item.k === key);
  if (exact) return exact.row;
  const contains = scored.filter((item) => item.k && (item.k.includes(key) || key.includes(item.k)));
  if (contains.length) {
    contains.sort((a, b) => toScore(b.row.score) - toScore(a.row.score));
    return contains[0].row;
  }
  scored.sort((a, b) => toScore(b.row.score) - toScore(a.row.score));
  return scored[0].row;
}

async function resolveBothApps(params) {
  const primaryPlatform = params.appPlatform === 'apple' ? 'apple' : 'google';
  const otherPlatform = primaryPlatform === 'apple' ? 'google' : 'apple';
  const specs = [];
  const primaryId = String(params.appId || '').trim();
  if (primaryId) specs.push({ platform: primaryPlatform, appId: primaryId });

  const overriddenId = String(params.appId2 || '').trim();
  if (overriddenId) {
    specs.push({ platform: otherPlatform, appId: overriddenId });
    return { specs, warnings: [] };
  }

  const title = String(params.title || '').trim();
  const warnings = [];
  if (title) {
    let matchedId = null;
    try {
      matchedId = await withCache('resolve-counterpart', {
        otherPlatform,
        title,
        country: cleanCountry(params.country),
        lang: cleanLang(params.lang)
      }, SEARCH_CACHE_TTL_MS, async () => {
        const rows = otherPlatform === 'apple'
          ? await searchAppleApps({ q: title, country: params.country, lang: params.lang, limit: 10 })
          : await searchGoogleApps({ q: title, country: params.country, lang: params.lang, limit: 10 });
        return pickBestTitleMatch(rows, title)?.appId || null;
      });
    } catch (error) {
      warnings.push(`Counterpart store lookup failed: ${error.message || String(error)}`);
    }
    if (matchedId) {
      specs.push({ platform: otherPlatform, appId: matchedId });
    } else {
      warnings.push(`Could not find a matching ${otherPlatform} app for “${title}”.`);
    }
  }
  return { specs, warnings };
}

function mockReviews(platform, appId) {
  return [
    { platform, appId, rating: 1, title: 'Crash', text: 'App crashes after login and support never replies.', author: 'mock-user-1', date: '2026-05-20T10:00:00.000Z', version: '1.2.0', helpful: 11, replyText: '', url: '' },
    { platform, appId, rating: 3, title: 'Okay', text: 'Good idea but filters feel slow sometimes.', author: 'mock-user-2', date: '2026-05-22T12:00:00.000Z', version: '1.2.1', helpful: 4, replyText: 'Thanks for the feedback.', url: '' },
    { platform, appId, rating: 5, title: 'Great', text: 'Clean app and stable on my phone.', author: 'mock-user-3', date: '2026-05-25T08:00:00.000Z', version: '1.3.0', helpful: 1, replyText: '', url: '' }
  ];
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

function checkGoogleConsent(response) {
  const finalUrl = String(response.url || '');
  if (/consent\.google\.com/i.test(finalUrl)) {
    throw new Error('Google Play returned a consent interstitial. Try a different country/language or use a direct package id.');
  }
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
      url: app.url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
      reviews: Number.parseInt(app.reviews, 10) || 0,
      installs: app.installs || '',
      containsAds: Boolean(app.containsAds),
      free: Boolean(app.free),
      price: app.price || 0,
      genre: app.genre || '',
      updated: app.updated || null,
      summary: app.summary || ''
    };
  } catch {
    const url = new URL(GOOGLE_PLAY_DETAILS_URL);
    url.searchParams.set('id', appId);
    url.searchParams.set('hl', cleanLang(lang));
    url.searchParams.set('gl', cleanCountry(country).toUpperCase());
    const response = await fetchWithRetry(url, { headers: googleHeaders(lang, country) }, { retries: 2 });
    if (!response.ok) throw new Error(`Google app details failed: HTTP ${response.status}`);
    const html = await response.text();
    const ld = extractJsonLd(html);
    const image = typeof ld?.image === 'string' ? ld.image : Array.isArray(ld?.image) ? ld.image[0] : '';
    const author = typeof ld?.author === 'string' ? ld.author : ld?.author?.name || '';
    return {
      platform: 'google',
      appId,
      title: decodeEntities(ld?.name || '') || parseGoogleTitleFromHtml(html) || appId,
      developer: decodeEntities(author) || '',
      score: ld?.aggregateRating?.ratingValue || '',
      icon: image || extractMetaContent(html, 'og:image') || '',
      url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
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
  return googleAppDetails(appId, country, lang);
}

export async function fetchAppleAppDetails({ appId, country = 'us' } = {}) {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', String(appId || ''));
  url.searchParams.set('country', cleanCountry(country));
  url.searchParams.set('media', 'software');
  const response = await fetchWithRetry(url, { headers: { 'user-agent': 'store-review-filter-app/1.3' } }, { retries: 2 });
  if (!response.ok) throw new Error(`Apple details failed: HTTP ${response.status}`);
  const json = await response.json();
  const entry = (json.results || [])[0];
  if (!entry) throw new Error(`Apple app not found: ${appId}`);
  return {
    platform: 'apple',
    appId: String(entry.trackId),
    title: entry.trackName || '',
    developer: entry.sellerName || entry.artistName || '',
    score: entry.averageUserRating || '',
    icon: entry.artworkUrl100 || entry.artworkUrl512 || '',
    url: entry.trackViewUrl || '',
    reviews: Number.parseInt(entry.userRatingCount, 10) || 0,
    installs: '',
    containsAds: false,
    free: Boolean(entry.price === 0 || entry.formattedPrice === 'Free' || entry.formattedPrice === 'Get'),
    price: Number.parseFloat(entry.price) || 0,
    genre: entry.primaryGenreName || '',
    updated: entry.currentVersionReleaseDate || entry.releaseDate || null,
    summary: entry.description || ''
  };
}

async function searchGoogleWithScraper({ q, country, lang, limit, concurrency = 8 }) {
  const gplay = await loadGooglePlay();
  const results = await gplay.search({ term: q, num: limit, country, lang, fullDetail: false });
  return (results || []).map((app) => ({
    platform: 'google',
    appId: app.appId,
    title: app.title,
    developer: app.developer,
    score: app.score,
    icon: app.icon,
    url: app.url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(app.appId)}`
  })).filter((app) => app.appId);
}

async function searchGoogleFallback({ q, country, lang, limit, concurrency = 8 }) {
  const packageName = cleanPackageName(q);
  if (packageName) return [await googleAppDetails(packageName, country, lang)];

  const url = new URL(GOOGLE_PLAY_SEARCH_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('c', 'apps');
  url.searchParams.set('hl', cleanLang(lang));
  url.searchParams.set('gl', cleanCountry(country).toUpperCase());

  const response = await fetchWithRetry(url, { headers: googleHeaders(lang, country) }, { retries: 2 });
  if (!response.ok) throw new Error(`Google Play search fallback failed: HTTP ${response.status}`);
  checkGoogleConsent(response);

  const html = await response.text();
  const appIds = extractGoogleAppIds(html, limit);
  const rows = await mapWithConcurrency(appIds, concurrency, async (appId, index) => {
    // Small stagger prevents a thundering herd against Google when deep-searching.
    if (index > 0 && index % 24 === 0) await sleep(150);
    try {
      return await googleAppDetails(appId, country, lang);
    } catch {
      return {
        platform: 'google',
        appId,
        title: appId,
        developer: '',
        score: '',
        icon: '',
        url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`
      };
    }
  });
  return rows;
}

export async function searchGoogleApps({ q, country, lang, limit, concurrency = 8 } = {}) {
  const packageName = cleanPackageName(q);
  if (packageName) return [await googleAppDetails(packageName, country, lang)];

  const errors = [];
  const rows = [];

  try {
    const scraperRows = await searchGoogleWithScraper({ q, country, lang, limit, concurrency });
    rows.push(...scraperRows);
    if (!scraperRows.length) errors.push('google-play-scraper returned zero Google apps');
  } catch (error) {
    errors.push(error.message || String(error));
  }

  const mergedAfterScraper = uniqueRowsByPlatformAndAppId(rows);
  if (mergedAfterScraper.length >= limit) return mergedAfterScraper.slice(0, limit);

  try {
    const fallbackRows = await searchGoogleFallback({ q, country, lang, limit, concurrency });
    rows.push(...fallbackRows);
    if (!fallbackRows.length) errors.push('Google Play HTML fallback returned zero Google apps');
  } catch (error) {
    errors.push(error.message || String(error));
  }

  const merged = uniqueRowsByPlatformAndAppId(rows).slice(0, limit);
  if (merged.length) return merged;
  throw new Error(`Google search failed: ${errors.join(' | ')}`);
}

export async function searchAppleApps({ q, country, lang, limit }) {
  limit = asInt(limit, APPLE_SEARCH_LIMIT, 1, APPLE_SEARCH_LIMIT);
  const url = new URL(APPLE_SEARCH_URL);
  url.searchParams.set('term', q);
  url.searchParams.set('entity', 'software');
  url.searchParams.set('country', country);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', lang);

  const response = await fetchWithRetry(
    url,
    { headers: { 'user-agent': 'store-review-filter-app/1.3' } },
    { retries: 2 }
  );
  if (!response.ok) throw new Error(`Apple search failed: HTTP ${response.status}`);
  const json = await response.json();
  return (json.results || []).map((app) => ({
    platform: 'apple',
    appId: String(app.trackId),
    title: app.trackName,
    developer: app.artistName,
    score: app.averageUserRating,
    icon: app.artworkUrl100,
    url: app.trackViewUrl
  })).filter((app) => app.appId);
}

export async function searchApps({ platform = 'all', q, country = 'us', lang = 'en', limit = 200 } = {}) {
  platform = platform === 'all' ? 'all' : platform === 'apple' ? 'apple' : 'google';
  limit = asInt(limit, 200, 1, Math.max(APPLE_SEARCH_LIMIT, GOOGLE_SEARCH_LIMIT));
  country = cleanCountry(country);
  lang = cleanLang(lang);

  if (process.env.MOCK_STORE_DATA === '1') {
    return mockSearch(platform).slice(0, limit * (platform === 'all' ? 2 : 1));
  }

  if (!q || q.trim().length < 2) return [];

  const query = q.trim();
  return withCache('search', { platform, q: query, country, lang, limit }, SEARCH_CACHE_TTL_MS, async () => {
    const scraperConcur = platform === 'all' ? 4 : 8;
    const scraperLimit  = platform === 'all' ? Math.floor(limit / 2) : limit;

    const tasks = [];
    if (platform === 'google' || platform === 'all') tasks.push(searchGoogleApps({ q: query, country, lang, limit: Math.min(scraperLimit, GOOGLE_SEARCH_LIMIT), concurrency: scraperConcur }));
    if (platform === 'apple' || platform === 'all') tasks.push(searchAppleApps({ q: query, country, lang, limit: Math.min(scraperLimit, APPLE_SEARCH_LIMIT) }));

    const settled = await Promise.allSettled(tasks);
    const rows = [];
    const errors = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') rows.push(...result.value);
      else errors.push(result.reason?.message || String(result.reason));
    }

    if (!rows.length && errors.length) throw new Error(errors.join(' | '));
    return uniqueRowsByPlatformAndAppId(rows).slice(0, limit);
  });
}

function mapGoogleSort(gplay, sort) {
  const requested = String(sort || 'newest').toLowerCase();
  if (requested === 'rating') return gplay.sort?.RATING;
  if (requested === 'helpfulness') return gplay.sort?.HELPFULNESS;
  return gplay.sort?.NEWEST;
}

function normalizeGoogleReview(review, appId) {
  return {
    platform: 'google',
    appId,
    rating: Number(review.score),
    title: review.title || '',
    text: review.text || '',
    author: review.userName || '',
    date: review.date ? new Date(review.date).toISOString() : '',
    version: review.appVersion || '',
    helpful: review.thumbsUp || 0,
    replyText: review.replyText || '',
    url: review.url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&reviewId=${encodeURIComponent(review.id || '')}`
  };
}

function normalizeDateLabel(label) {
  if (!label) return '';
  const date = new Date(label);
  return Number.isNaN(date.getTime()) ? String(label) : date.toISOString();
}

function normalizeAppleEntry(entry, appId, country) {
  const rating = entry['im:rating']?.label || entry.rating?.label || (entry.rating?.['im:rating'] || '');
  return {
    platform: 'apple',
    appId,
    rating: Number(rating),
    title: entry.title?.label || '',
    text: entry.content?.label || '',
    author: entry.author?.name?.label || '',
    date: normalizeDateLabel(entry.updated?.label),
    version: entry['im:version']?.label || '',
    helpful: '',
    replyText: '',
    url: entry.link?.attributes?.href || `https://apps.apple.com/${country}/app/id${encodeURIComponent(appId)}`
  };
}

async function runGoogleReviewsOnce(gplay, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await gplay.reviews(options);
    } catch (error) {
      lastError = error;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastError || new Error('Google Play reviews request failed');
}

async function fetchGoogleReviews(params) {
  const gplay = await loadGooglePlay();
  const appId = params.appId;
  const max = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 60);
  const country = cleanCountry(params.country);
  const lang = cleanLang(params.lang);
  const sortKey = String(params.sort || 'newest').toLowerCase();

  return withCache('google-reviews', { appId, max, pages, country, lang, sortKey }, REVIEW_CACHE_TTL_MS, async () => {
    const sort = mapGoogleSort(gplay, sortKey);
    const rows = [];
    const seen = new Set();
    let nextPaginationToken;
    let pagesFetched = 0;
    let drained = false;

    // 150 reviews per page; loop until requested count is reached or the store runs dry.
    const maxPages = pages > 0 ? Math.min(pages, Math.ceil(max / GOOGLE_REVIEW_PAGE_SIZE)) : Math.ceil(max / GOOGLE_REVIEW_PAGE_SIZE);

    for (let i = 0; i < maxPages && rows.length < max; i += 1) {
      const result = await runGoogleReviewsOnce(gplay, {
        appId,
        sort,
        num: GOOGLE_REVIEW_PAGE_SIZE,
        paginate: true,
        nextPaginationToken,
        country,
        lang
      });
      const data = Array.isArray(result) ? result : result.data || [];
      pagesFetched += 1;

      for (const review of data) {
        const row = normalizeGoogleReview(review, appId);
        const key = `${row.author}|${row.date}|${String(row.text || '').slice(0, 80)}`;
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
      if (i + 1 < maxPages && rows.length < max) await sleep(300);
    }

    const moreAvailable = !drained && !!nextPaginationToken;
    return {
      rows,
      meta: {
        nextPaginationToken: nextPaginationToken || null,
        source: 'google-play-scraper',
        pageSize: GOOGLE_REVIEW_PAGE_SIZE,
        pagesFetched,
        reachedStoreLimit: drained,
        moreAvailable
      }
    };
  });
}

async function fetchAppleReviews(params) {
  const appId = params.appId;
  const max = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 10);
  const country = cleanCountry(params.country);
  const lang = cleanLang(params.lang);
  const sort = String(params.sort || 'newest').toLowerCase() === 'helpfulness' ? 'mostHelpful' : 'mostRecent';

  return withCache('apple-reviews', { appId, max, pages, country, sort, lang }, REVIEW_CACHE_TTL_MS, async () => {
    const rows = [];
    const seen = new Set();
    let pagesFetched = 0;

    // Apple RSS caps review access around 10 pages × 50 reviews (≈500) per country/language.
    const maxPages = pages > 0 ? Math.min(pages, Math.ceil(APPLE_REVIEW_MAX / APPLE_REVIEW_PAGE_SIZE)) : Math.min(Math.ceil(APPLE_REVIEW_MAX / APPLE_REVIEW_PAGE_SIZE), Math.ceil(max / APPLE_REVIEW_PAGE_SIZE));

    for (let page = 1; page <= maxPages && rows.length < max; page += 1) {
      const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/sortBy=${sort}/id=${encodeURIComponent(appId)}/json?l=${lang}&limit=${APPLE_REVIEW_PAGE_SIZE}`;
      let reviewEntries = [];
      try {
        const response = await fetchWithRetry(
          url,
          { headers: { 'user-agent': 'store-review-filter-app/1.3' } },
          { retries: 2 }
        );
        if (!response.ok) break; // e.g. page beyond the feed window → stop gracefully
        const json = await response.json();
        const entries = json.feed?.entry || [];
        reviewEntries = (Array.isArray(entries) ? entries : [entries]).filter((entry) => entry['im:rating'] || entry.rating);
      } catch {
        break; // non-JSON or network error past the last page → stop, not fail
      }

      if (!reviewEntries.length) break;
      pagesFetched += 1;

      for (const entry of reviewEntries) {
        const row = normalizeAppleEntry(entry, appId, country);
        const key = `${row.author}|${row.date}|${String(row.text || '').slice(0, 80)}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }

      if (reviewEntries.length < APPLE_REVIEW_PAGE_SIZE) break; // last available page
    }

    return {
      rows: rows.slice(0, max),
      meta: {
        source: 'apple-rss',
        pageSize: APPLE_REVIEW_PAGE_SIZE,
        pagesFetched,
        storeLimit: APPLE_REVIEW_MAX,
        reachedStoreLimit: true,
        moreAvailable: false,
        note: `App Store reviews are capped at ~${APPLE_REVIEW_MAX} per country/language by Apple's RSS feed.`
      }
    };
  });
}

export async function fetchReviews(params) {
  const platform = params.platform === 'both' ? 'both' : params.platform === 'apple' ? 'apple' : 'google';
  const appId = String(params.appId || '').trim();

  if (process.env.MOCK_STORE_DATA === '1') {
    if (platform === 'both') {
      const rows = [
        ...applyReviewFilters(mockReviews('google', appId || 'com.example.app'), params),
        ...applyReviewFilters(mockReviews('apple', appId || '389801252'), params)
      ];
      return { platform: 'both', appId, reviews: rows, totalFetched: 6, totalAfterFilters: rows.length, meta: { mock: true } };
    }
    if (!appId) throw new Error('appId is required. Use Apple numeric app id, for example 389801252, or Google package id, for example com.instagram.android.');
    const rows = applyReviewFilters(mockReviews(platform, appId), params);
    return { platform, appId, reviews: rows, totalFetched: 3, totalAfterFilters: rows.length, meta: { mock: true } };
  }

  if (!appId) throw new Error('appId is required. Use Apple numeric app id, for example 389801252, or Google package id, for example com.instagram.android.');

  if (platform === 'both') {
    const { specs, warnings } = await resolveBothApps(params);
    if (!specs.length) throw new Error('No app id available for either store.');

    const results = await Promise.allSettled(specs.map((spec) => {
      const scoped = { ...params, platform: spec.platform, appId: spec.appId };
      return spec.platform === 'apple' ? fetchAppleReviews(scoped) : fetchGoogleReviews(scoped);
    }));

    const mergedRows = [];
    const errors = [];
    const sources = [];
    results.forEach((result, index) => {
      const spec = specs[index];
      if (result.status === 'fulfilled') {
        mergedRows.push(...result.value.rows);
        sources.push({ platform: spec.platform, appId: spec.appId, source: result.value.meta.source });
      } else {
        errors.push(`${spec.platform}:${spec.appId} — ${result.reason?.message || String(result.reason)}`);
      }
    });

    const filtered = applyReviewFilters(mergedRows, params);
    return {
      platform: 'both',
      appId,
      reviews: filtered,
      totalFetched: mergedRows.length,
      totalAfterFilters: filtered.length,
      meta: { sources, errors, warnings }
    };
  }

  const result = platform === 'apple'
    ? await fetchAppleReviews(params)
    : await fetchGoogleReviews(params);

  const filtered = applyReviewFilters(result.rows, params);
  return {
    platform,
    appId,
    reviews: filtered,
    totalFetched: result.rows.length,
    totalAfterFilters: filtered.length,
    meta: result.meta
  };
}

// ── Full-data fetch (all languages × all stores) ──────────────────────────
// Fetches every reachable review for an app across all supported languages and
// both stores, grouped by (platform, lang) with per-group + aggregate stats.
const FULL_LANGUAGES = ALL_LANGUAGES;
const FULL_GOOGLE_MAX_PER_LANG = 1000;   // per-language ceiling for Google
const FULL_APPLE_MAX_PER_LANG = 500;     // Apple RSS hard cap per country/lang
const FULL_TOTAL_CEILING = 20000;        // overall cap to keep the payload bounded
const FULL_CONCURRENCY = 8;              // parallel store×lang fetches

function computeGroupStats(reviews) {
  const count = reviews.length;
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sumRating = 0;
  let dateFrom = null;
  let dateTo = null;
  const termFreq = new Map();
  const STOP = new Set(['the', 'and', 'this', 'that', 'with', 'from', 'have', 'were', 'they', 'your', 'which', 'will', 'app', 'apps', 'very', 'really', 'just', 'more', 'is', 'it', 'to', 'of', 'a', 'an', 'in', 'on', 'for', 'my', 'me', 'we', 'i', 'you', 'he', 'she', 'his', 'her', 'their', 'our', 'be', 'at', 'by', 'as', 'or', 'not', 'no', 'so', 'but', 'if', 'all', 'has', 'had', 'been', 'are', 'was', 'did', 'does', 'can', 'could', 'would', 'should', 'get', 'got', 'like', 'love', 'use', 'using', 'used', 'one', 'two', 'about', 'into', 'out', 'up', 'down', 'over', 'after', 'before']);

  for (const r of reviews) {
    const s = Number(r.rating);
    if (Number.isInteger(s) && s >= 1 && s <= 5) stars[s] += 1;
    if (Number.isFinite(s)) sumRating += s;
    const d = r.date ? new Date(r.date) : null;
    if (d && !Number.isNaN(d.getTime())) {
      if (!dateFrom || d < dateFrom) dateFrom = d;
      if (!dateTo || d > dateTo) dateTo = d;
    }
    const text = `${r.title || ''} ${r.text || ''}`.toLowerCase();
    for (const word of text.match(/[a-z][a-z-]{2,}/gu) || []) {
      if (!STOP.has(word)) termFreq.set(word, (termFreq.get(word) || 0) + 1);
    }
  }
  const topTerms = [...termFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map((e) => e[0]);

  return {
    count,
    stars,
    avgRating: count ? Math.round((sumRating / count) * 10) / 10 : null,
    dateFrom: dateFrom ? dateFrom.toISOString() : null,
    dateTo: dateTo ? dateTo.toISOString() : null,
    topTerms,
  };
}

async function fetchOneLangGroup({ platform, appId, country, lang, max }) {
  const scoped = { platform, appId, country, lang, max, sort: 'newest' };
  const result = platform === 'apple'
    ? await fetchAppleReviews(scoped)
    : await fetchGoogleReviews(scoped);
  return {
    platform,
    lang,
    reviews: result.rows,
    meta: result.meta,
  };
}

// Streams reviews group by group (one group per store×lang task as it completes),
// so the UI can render early results while the rest is still fetching in the background.
export async function fetchAllReviewsStream(params = {}, { onGroup, signal } = {}) {
  const appId = String(params.appId || '').trim();
  if (!appId) throw new Error('appId is required.');

  const country = cleanCountry(params.country);
  const platform = params.platform === 'both' ? 'both' : params.platform === 'apple' ? 'apple' : 'google';

  // Resolve counterpart store when both-stores mode.
  let specs = [];
  if (platform === 'both') {
    const resolved = await resolveBothApps(params);
    if (!resolved.specs.length) throw new Error('No app id available for either store.');
    specs = resolved.specs;
  } else {
    specs = [{ platform, appId }];
  }

  // Build one fetch task per (store, language).
  const tasks = [];
  for (const spec of specs) {
    for (const lang of FULL_LANGUAGES) {
      const maxPerLang = spec.platform === 'apple' ? FULL_APPLE_MAX_PER_LANG : FULL_GOOGLE_MAX_PER_LANG;
      tasks.push({
        spec,
        lang,
        maxPerLang,
        producer: () => fetchOneLangGroup({ platform: spec.platform, appId: spec.appId, country, lang, max: maxPerLang }),
      });
    }
  }

  const langLabels = new Map(FULL_LANGUAGES.map((l) => {
    const label = l === 'en' ? 'English' : l === 'de' ? 'Deutsch' : l === 'fr' ? 'Français' : l === 'es' ? 'Español' : l === 'it' ? 'Italiano' : l === 'tr' ? 'Türkçe' : l === 'ru' ? 'Русский' : l === 'ja' ? '日本語' : l === 'ko' ? '한국어' : l === 'pt-BR' ? 'Português (BR)' : l === 'ar' ? 'العربية' : l === 'hi' ? 'हिन्दी' : l === 'nl' ? 'Nederlands' : l === 'pl' ? 'Polski' : l;
    return [l, label];
  }));

  // Run with bounded concurrency so we don't thundering-herd Google. Each finished
  // task is emitted immediately via onGroup; aborting skips all remaining tasks.
  const emitted = [];
  const errors = [];
  let aborted = false;

  await mapWithConcurrency(tasks, FULL_CONCURRENCY, async (task) => {
    if (aborted || signal?.aborted) {
      aborted = true;
      return;
    }
    try {
      const c = await task.producer();
      const rows = c.reviews.slice(0, FULL_TOTAL_CEILING); // safety net, per-group ceiling already applied upstream
      const stats = computeGroupStats(rows);
      const group = {
        platform: c.platform,
        lang: c.lang,
        langLabel: langLabels.get(c.lang) || c.lang,
        count: stats.count,
        stars: stats.stars,
        avgRating: stats.avgRating,
        dateFrom: stats.dateFrom,
        dateTo: stats.dateTo,
        topTerms: stats.topTerms,
        reviews: rows,
        sources: c.sources || [{ platform: c.platform, appId: c.meta?.source || '' }],
        meta: c.meta,
      };
      emitted.push(group);
      if (onGroup) {
        try { onGroup(group); } catch { /* listener errors must not break the fetch */ }
      }
    } catch (err) {
      errors.push(`${task.spec.platform}:${task.spec.appId}:${task.lang} — ${err.message || String(err)}`);
    }
  });

  // Global aggregate over every emitted group.
  const allRows = emitted.flatMap((g) => g.reviews);
  const globalStats = computeGroupStats(allRows);
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
    totalGroups: emitted.length,
    totalReviews: globalStats.count,
    global: {
      count: globalStats.count,
      stars: globalStats.stars,
      avgRating: globalStats.avgRating,
      dateFrom: globalStats.dateFrom,
      dateTo: globalStats.dateTo,
      topTerms: globalStats.topTerms,
    },
    perStore,
    errors,
    aborted,
  };
}

// Non-streaming variant: collects the streamed groups and returns them in the
// historical shape (groups sorted apple-first, then by lang).
export async function fetchAllReviews(params = {}) {
  const groups = [];
  const summary = await fetchAllReviewsStream(params, { onGroup: (g) => groups.push(g) });
  const ordered = [...groups].sort((a, b) => {
    const pla = a.platform === 'apple' ? 0 : 1;
    const plb = b.platform === 'apple' ? 0 : 1;
    if (pla !== plb) return pla - plb;
    return a.lang.localeCompare(b.lang);
  });
  return { ...summary, groups: ordered };
}
export function dedupeReviews(reviews) {
  const seen = new Set();
  const out = [];
  for (const review of reviews) {
    if (!review) continue;
    const key = [
      review.platform,
      String(review.author || '').toLowerCase(),
      String(review.title || '').toLowerCase(),
      String(review.text || '').slice(0, 60).toLowerCase()
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(review);
  }
  return out;
}

function parseLangList(value, fallback) {
  const raw = (value || '').toLowerCase();
  if (!raw || raw === 'all') return fallback;
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

export async function fetchReviewsMulti(params = {}) {
  const servicePlatform = params.platform === 'apple' ? 'apple' : params.platform === 'google' ? 'google' : 'both';
  const appId = String(params.appId || '').trim();
  const country = cleanCountry(params.country);
  const maxPerSource = asInt(params.max, 200, 1, MAX_REVIEWS);
  const pages = asInt(params.pages, 0, 0, 10);
  const maxLanguages = asInt(params.maxLanguages, 6, 1, ALL_LANGUAGES.length);
  const languages = parseLangList(params.languages, ALL_LANGUAGES).slice(0, maxLanguages);
  const sort = String(params.sort || 'newest').toLowerCase();
  const mock = process.env.MOCK_STORE_DATA === '1';

  if (mock) {
    return fetchReviews({ platform: servicePlatform, appId, max: maxPerSource, pages, country, lang: 'en', sort } );
  }

  if (!appId) throw new Error('appId is required.');

  if (servicePlatform === 'both') {
    const { specs, warnings } = await resolveBothApps(params);
    if (!specs.length) throw new Error('No app id available for either store.');
    const settled = await Promise.allSettled(specs.map((spec) =>
      fetchLanguageGroup({ platform: spec.platform, appId: spec.appId, country, languages, pages, maxPerSource, sort })
    ));
    const merged = dedupeReviews(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
    const errors = [];
    settled.forEach((result, index) => {
      if (result.status === 'rejected') errors.push(`${specs[index].platform}:${specs[index].appId} — ${result.reason?.message || String(result.reason)}`);
    });
    const filtered = applyReviewFilters(merged, params);
    return {
      platform: 'both',
      appId,
      languages,
      reviews: filtered,
      totalFetched: merged.length,
      totalAfterFilters: filtered.length,
      meta: { sources: specs.map((s) => ({ platform: s.platform, appId: s.appId })), errors, warnings }
    };
  }

  const rows = await fetchLanguageGroup({ platform: servicePlatform, appId, country, languages, pages, maxPerSource, sort });
  const filtered = applyReviewFilters(rows, params);
  return {
    platform: servicePlatform,
    appId,
    languages,
    reviews: filtered,
    totalFetched: rows.length,
    totalAfterFilters: filtered.length,
    meta: { sources: [{ platform: servicePlatform, appId }] }
  };
}

async function fetchLanguageGroup({ platform, appId, country, languages, pages, maxPerSource, sort }) {
  const perLang = Math.max(2, Math.floor(maxPerSource / Math.max(1, languages.length)));
  const settled = await Promise.allSettled(languages.map((lang) => {
    const scoped = {
      platform,
      appId,
      country,
      lang,
      sort,
      max: perLang,
      pages
    };
    return platform === 'apple' ? fetchAppleReviews(scoped) : fetchGoogleReviews(scoped);
  }));
  const rows = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') rows.push(...result.value.rows);
    else errors.push(result.reason?.message || String(result.reason));
  }
  if (!rows.length && errors.length) throw new Error(errors.join(' | '));
  return dedupeReviews(rows);
}