import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  searchAppleApps,
  searchGoogleApps,
  fetchGoogleAppDetails,
  mapWithConcurrency,
  normalizeTitle,
  developerSimilarity,
  cleanCountry,
  cleanLang,
} from './providers.js';
import { fetchFacebookAdSignals, hasFacebookToken } from './ads.js';
import { badRequest } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RANKING_DEPTH = 50;        // search results kept per store to compute positions
const MAX_DETAILS_PER_STORE = 8;
const MAX_MERGED_APPS = 15;
const ADS_PROBE_LIMIT = 6;
const MAX_HISTORY_SNAPSHOTS = 180;      // one per day
const MAX_KEYWORD_LENGTH = 100;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function toScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundToK(value) {
  if (!value) return 0;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
  return Math.round(value).toString();
}

export function normalizeStore(store) {
  return store === 'google' || store === 'apple' ? store : 'both';
}

export function normalizeKeyword(keyword) {
  return String(keyword || '').trim().replace(/\s+/gu, ' ');
}

// ── Similar keywords ──────────────────────────────────────────────────────

const KEYWORD_SUFFIXES = ['app', 'apps', 'premium', 'free', 'best', 'for android', 'for ios', 'maker', 'planner', 'tracker'];
const MODIFIERS = ['daily', 'best', 'simple', 'easy', 'my', 'free', 'personal', 'digital', 'smart', 'ultimate'];

// Latin words need 3+ letters to be meaningful; CJK words are often 2 characters.
function meaningfulToken(token) {
  return token.length >= 3 || (token.length >= 2 && /[^\u0000-ɏ]/u.test(token));
}

function tokenize(value) {
  return String(value || '').toLowerCase().split(/[^\p{L}\p{N}+]+/u).filter(meaningfulToken);
}

export function buildSimilarKeywords(q, appTitles, count = 8) {
  const queryLower = normalizeKeyword(q).toLowerCase();
  const queryTokens = queryLower.split(/\s+/u).filter(meaningfulToken);
  const seen = new Set([queryLower]);
  const out = [];
  if (!queryTokens.length) return out;

  const titleWordArrays = appTitles.map(tokenize).filter((words) => words.length);
  const push = (candidate) => {
    if (out.length >= count || seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  // 1) Phrases (2-3 words) from real titles that contain the full query.
  const isRunOn = (phrase) => phrase.split(' ').some((word) =>
    queryTokens.some((t) => word.includes(t) && word.length - t.length >= 3));
  for (const words of titleWordArrays) {
    for (let i = 0; i < words.length - 1 && out.length < count; i += 1) {
      for (const size of [3, 2]) {
        if (i + size > words.length) continue;
        const phrase = words.slice(i, i + size).join(' ');
        if (phrase.includes(queryLower) && !seen.has(phrase) && !isRunOn(phrase)) {
          push(phrase);
          break;
        }
      }
    }
  }

  // 2) Prefix modifiers ("best habit tracker"), 3) suffix expansions ("habit tracker app").
  for (const mod of MODIFIERS) push(`${mod} ${queryLower}`);
  for (const suffix of KEYWORD_SUFFIXES) push(`${queryLower} ${suffix}`);

  // 4) Fallback single-token expansions from real titles.
  const token = queryTokens[0];
  for (const words of titleWordArrays) {
    for (const word of words) {
      if (word !== token) push(`${token} ${word}`);
    }
  }

  return out.slice(0, count);
}

// ── Metrics ───────────────────────────────────────────────────────────────

function computeMetrics(apps) {
  const breadth = apps.length;
  const totalReviews = apps.reduce((sum, app) => sum + app.totalReviews, 0);
  const logDemand = clamp(Math.log10(1 + totalReviews) / 8, 0, 1);
  const rated = apps.filter((app) => app.avgRating > 0);
  const avgRating = rated.length ? rated.reduce((sum, app) => sum + app.avgRating, 0) / rated.length : 0;
  const avgScore = clamp((avgRating - 1) / 4, 0, 1);
  const share = (predicate) => (breadth ? apps.filter(predicate).length / breadth : 0);
  const adsFraction = share((app) => app.adsActive);
  const authority = share((app) => app.totalReviews >= 50000);
  const strongRatings = share((app) => app.avgRating >= 4);

  const popularity = Math.round(
    Math.min(1, breadth / 12) * 22 +
    logDemand * 40 +
    avgScore * 20 +
    adsFraction * 18
  );

  const difficulty = Math.round(
    authority * 40 +
    adsFraction * 25 +
    strongRatings * 15 +
    Math.min(1, breadth / 20) * 20
  );

  return {
    breadth,
    totalReviews,
    logDemand,
    avgRating: Math.round(avgRating * 100) / 100,
    adsFraction: Math.round(adsFraction * 100),
    authority: Math.round(authority * 100),
    popularity: clamp(popularity, 0, 100),
    difficulty: clamp(difficulty, 0, 100),
    opportunity: Math.round((popularity * (100 - difficulty)) / 100),
  };
}

// ── Rank history (one file per keyword × store × country × language) ─────

function rankHistoryDir() {
  return process.env.RANK_HISTORY_DIR
    ? path.resolve(process.env.RANK_HISTORY_DIR)
    : path.resolve(__dirname, '..', 'data', 'rank-history');
}

export function rankHistoryFile({ keyword, store, country, lang }) {
  const kw = normalizeKeyword(keyword).toLowerCase();
  const identity = [kw, normalizeStore(store), cleanCountry(country), cleanLang(lang)].join('\u0000');
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 20);
  // The file name is built only from [a-z0-9-] and hex, so no input can escape the directory.
  const slug = kw.normalize('NFKD').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || 'keyword';
  return path.join(rankHistoryDir(), `${slug}.${hash}.json`);
}

function readHistory(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && Array.isArray(parsed.snapshots) ? parsed : null;
  } catch {
    return null;
  }
}

function saveRankSnapshot(params, analysis) {
  if (process.env.DISABLE_RANK_HISTORY === '1') return null;
  try {
    const file = rankHistoryFile(params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const hist = readHistory(file) || { snapshots: [] };
    const snapshot = {
      at: analysis.analyzedAt,
      popularity: analysis.metrics.popularity,
      difficulty: analysis.metrics.difficulty,
      opportunity: analysis.metrics.opportunity,
      appCount: analysis.apps.length,
      topApp: analysis.apps[0]?.name || null,
      rankings: analysis.rankings,
    };
    const snapshots = hist.snapshots.filter((s) => s && typeof s.at === 'string');
    // One snapshot per day: re-running an analysis refreshes today's point.
    if (snapshots.length && snapshots.at(-1).at.slice(0, 10) === snapshot.at.slice(0, 10)) snapshots.pop();
    snapshots.push(snapshot);
    const body = {
      keyword: normalizeKeyword(params.keyword),
      store: normalizeStore(params.store),
      country: cleanCountry(params.country),
      lang: cleanLang(params.lang),
      snapshots: snapshots.slice(-MAX_HISTORY_SNAPSHOTS),
    };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf8');
    fs.renameSync(tmp, file);
    return body.snapshots;
  } catch {
    return null; // history is best-effort; never fail an analysis over it
  }
}

// Snapshots oldest → newest. Each carries per-store rankings (app ids in search
// order), so the position of any tracked app can be read back for every day.
export function getRankHistory({ keyword, store = 'both', country = 'us', lang = 'en' } = {}) {
  if (process.env.DISABLE_RANK_HISTORY === '1') return [];
  if (normalizeKeyword(keyword).length < 2) return [];
  return readHistory(rankHistoryFile({ keyword, store, country, lang }))?.snapshots || [];
}

// ── Keyword analysis ──────────────────────────────────────────────────────

function mockAnalysis({ q, store, country, lang }) {
  const updated = '2026-01-01T00:00:00.000Z';
  const apps = [
    {
      name: 'Instagram', icon: '', url: '',
      stores: [
        { platform: 'google', appId: 'com.instagram.android', rank: 1, rating: 4.1, reviews: 50000, icon: '', url: '', developer: 'Instagram', containsAds: true, installs: '5B+', free: true, price: 0, genre: 'Social', updated },
        { platform: 'apple', appId: '389801252', rank: 2, rating: 4.7, reviews: 30000, icon: '', url: '', developer: 'Instagram, Inc.', containsAds: false, installs: '', free: true, price: 0, genre: 'Social', updated },
      ],
      totalReviews: 80000, avgRating: 4.33, adsActive: true, updated, bestRank: 1, fbAds: null,
    },
    {
      name: 'Habitica', icon: '', url: '',
      stores: [
        { platform: 'apple', appId: '994882113', rank: 1, rating: 4.5, reviews: 20000, icon: '', url: '', developer: 'HabitRPG, Inc.', containsAds: false, installs: '', free: true, price: 0, genre: 'Health', updated: '2026-02-01T00:00:00.000Z' },
      ],
      totalReviews: 20000, avgRating: 4.5, adsActive: false, updated: '2026-02-01T00:00:00.000Z', bestRank: 1, fbAds: null,
    },
  ];
  const filtered = store === 'both' ? apps : apps
    .map((app) => ({ ...app, stores: app.stores.filter((s) => s.platform === store) }))
    .filter((app) => app.stores.length > 0);
  const rankings = {};
  if (store !== 'apple') rankings.google = ['com.instagram.android'];
  if (store !== 'google') rankings.apple = ['994882113', '389801252'];
  return {
    keyword: q,
    similar: [`best ${q}`, `${q} app`, `free ${q}`, `daily ${q}`],
    competitorKeywords: [{ app: 'Instagram', keywords: ['instagram', 'instagram app', 'instagram free', 'best instagram'] }],
    analyzedAt: new Date().toISOString(),
    country,
    lang,
    store,
    apps: filtered,
    rankings,
    metrics: computeMetrics(filtered),
    errors: [],
    warnings: [],
  };
}

function toStoreListing(app) {
  return {
    platform: app.platform,
    appId: app.appId,
    rank: app.rank,
    rating: toScore(app.score),
    reviews: toScore(app.reviews),
    icon: app.icon || '',
    url: app.url || '',
    developer: app.developer || '',
    containsAds: Boolean(app.containsAds),
    installs: app.installs || '',
    free: app.free !== false,
    price: toScore(app.price),
    genre: app.genre || '',
    updated: app.updated || null,
  };
}

// Same title on both stores (and not a different developer) → one row.
function mergeAcrossStores(listings) {
  const groups = [];
  const byTitle = new Map();
  for (const listing of listings) {
    const key = normalizeTitle(listing.title) || `${listing.platform}:${listing.appId}`;
    const candidates = byTitle.get(key) || [];
    let group = candidates.find((g) => !g.listings.some((l) => l.platform === listing.platform)
      && g.listings.every((l) => developerSimilarity(l.developer, listing.developer) >= 0));
    if (!group) {
      group = { name: listing.title || listing.appId, listings: [] };
      candidates.push(group);
      byTitle.set(key, candidates);
      groups.push(group);
    }
    group.listings.push(listing);
  }

  return groups.map((group) => {
    const stores = group.listings.map(toStoreListing).sort((a, b) => b.reviews - a.reviews);
    const totalReviews = stores.reduce((sum, s) => sum + s.reviews, 0);
    // Rating across stores = weighted by rating count; unrated listings don't count as 0★.
    const rated = stores.filter((s) => s.rating > 0);
    const weight = rated.reduce((sum, s) => sum + s.reviews, 0);
    const avgRating = !rated.length ? 0 : weight > 0
      ? rated.reduce((sum, s) => sum + s.rating * s.reviews, 0) / weight
      : rated.reduce((sum, s) => sum + s.rating, 0) / rated.length;
    const updated = stores.map((s) => s.updated).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    return {
      name: group.name,
      icon: stores[0]?.icon || '',
      url: stores[0]?.url || '',
      stores,
      totalReviews,
      avgRating: Math.round(avgRating * 100) / 100,
      adsFlagged: stores.some((s) => s.containsAds),
      updated,
      bestRank: Math.min(...stores.map((s) => s.rank)),
    };
  });
}

async function searchStore(platform, q, country, lang) {
  return platform === 'google'
    ? searchGoogleApps({ q, country, lang, limit: RANKING_DEPTH })
    : searchAppleApps({ q, country, lang, limit: RANKING_DEPTH });
}

// Searches the store(s) for a keyword, merges the same app across stores and
// computes ASO metrics. `lite` (used for the similar-keyword rows) skips the
// competitor probes and — unless `track` is set — the history snapshot.
export async function analyzeKeyword({
  keyword,
  store = 'both',
  country = 'us',
  lang = 'en',
  limit = MAX_DETAILS_PER_STORE,
  lite = false,
  track = false,
} = {}) {
  const q = normalizeKeyword(keyword);
  if (String(country).toLowerCase() === 'all') throw badRequest('Keyword analysis runs per country: pick one country (the app compares all countries by analyzing each one).');
  if (q.length < 2) throw badRequest('Keyword must be at least 2 characters.');
  if (q.length > MAX_KEYWORD_LENGTH) throw badRequest(`Keyword must be at most ${MAX_KEYWORD_LENGTH} characters.`);
  const params = { keyword: q, store: normalizeStore(store), country: cleanCountry(country), lang: cleanLang(lang) };
  const detailsPerStore = clamp(Number.parseInt(limit, 10) || MAX_DETAILS_PER_STORE, 1, MAX_DETAILS_PER_STORE);

  if (process.env.MOCK_STORE_DATA === '1') {
    const analysis = mockAnalysis({ q, ...params });
    if (!lite || track) saveRankSnapshot(params, analysis);
    return analysis;
  }

  const wants = params.store === 'both' ? ['google', 'apple'] : [params.store];
  const searches = await Promise.all(wants.map(async (platform) => {
    try {
      return { platform, rows: await searchStore(platform, q, params.country, params.lang) };
    } catch (error) {
      return { platform, rows: [], error: `${platform === 'apple' ? 'App Store' : 'Google Play'}: ${error.message || String(error)}` };
    }
  }));
  const errors = searches.filter((s) => s.error).map((s) => s.error);
  if (errors.length === wants.length) throw new Error(errors.join(' | '));

  const rankings = Object.fromEntries(searches.map((s) => [s.platform, s.rows.map((row) => row.appId)]));

  // Apple search rows already carry full listing data; Google rows need a details call.
  const warnings = [];
  const toDetail = searches.flatMap((s) => s.rows.slice(0, detailsPerStore).map((row, index) => ({ ...row, platform: s.platform, rank: index + 1 })));
  const listings = await mapWithConcurrency(toDetail, 6, async (row) => {
    if (row.platform !== 'google') return row;
    try {
      const details = await fetchGoogleAppDetails({ appId: row.appId, country: params.country, lang: params.lang });
      return { ...row, ...details, rank: row.rank };
    } catch (error) {
      warnings.push(`Google Play details for ${row.appId} unavailable: ${error.message || String(error)}`);
      return row; // keep the search-row data rather than dropping a ranked app
    }
  });

  const merged = mergeAcrossStores(listings)
    .sort((a, b) => a.bestRank - b.bestRank || b.totalReviews - a.totalReviews)
    .slice(0, MAX_MERGED_APPS);

  // Best-effort Meta ad-archive probes for the strongest candidates.
  const fbToken = hasFacebookToken() ? process.env.FB_ADLIB_ACCESS_TOKEN : null;
  if (fbToken && !lite) {
    await mapWithConcurrency(merged.slice(0, ADS_PROBE_LIMIT), 2, async (app) => {
      const signals = await fetchFacebookAdSignals({ name: app.name, countries: [params.country.toUpperCase()], token: fbToken });
      if (signals) app.fbAds = signals;
    });
  }

  const apps = merged.map((app) => ({
    name: app.name,
    icon: app.icon,
    url: app.url,
    stores: app.stores,
    totalReviews: app.totalReviews,
    totalReviewsLabel: roundToK(app.totalReviews),
    avgRating: app.avgRating,
    adsActive: app.adsFlagged || Boolean(app.fbAds && app.fbAds.activeAds > 0),
    updated: app.updated,
    bestRank: app.bestRank,
    fbAds: app.fbAds || null,
  }));

  const similar = buildSimilarKeywords(q, apps.map((app) => app.name));
  const analysis = {
    keyword: q,
    similar,
    competitorKeywords: [],
    analyzedAt: new Date().toISOString(),
    country: params.country,
    lang: params.lang,
    store: params.store,
    apps,
    rankings,
    metrics: computeMetrics(apps),
    errors,
    warnings,
  };

  if (!lite) analysis.competitorKeywords = await buildCompetitorKeywords({ keyword: q, topApps: apps.slice(0, 5), stores: wants, similar, ...params });
  // `track` keeps history for quick analyses too (used by the all-countries comparison).
  if (!lite || track) saveRankSnapshot(params, analysis);
  return analysis;
}

// ── Competitor keywords (real ranking data) ───────────────────────────────
// Probe related search terms and record which of the top apps show up for them.

async function buildCompetitorKeywords({ keyword, topApps, stores, similar, country, lang }) {
  if (!topApps.length) return [];
  const year = new Date().getUTCFullYear();
  const probes = [...new Set([
    keyword,
    ...similar.slice(0, 5),
    ...['free', 'best', 'top', 'new'].map((m) => `${m} ${keyword}`),
    `${keyword} ${year}`,
  ].map((p) => p.toLowerCase()))].slice(0, 10);

  const owner = new Map();
  for (const app of topApps) {
    for (const s of app.stores) owner.set(`${s.platform}:${s.appId}`, app.name);
  }
  const found = new Map(topApps.map((app) => [app.name, new Set([keyword.toLowerCase()])]));

  const jobs = stores.flatMap((platform) => probes.map((probe) => ({ platform, probe })));
  await mapWithConcurrency(jobs, 4, async ({ platform, probe }) => {
    try {
      const rows = await searchStore(platform, probe, country, lang);
      for (const row of rows.slice(0, 20)) {
        const name = owner.get(`${platform}:${row.appId}`);
        if (name) found.get(name).add(probe);
      }
    } catch {
      // probe failed — keep partial data
    }
  });

  return topApps.map((app) => ({ app: app.name, keywords: [...found.get(app.name)].slice(0, 15) }));
}
