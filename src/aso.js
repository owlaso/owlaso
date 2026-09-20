import {
  searchAppleApps,
  searchGoogleApps,
  fetchAppleAppDetails,
  fetchGoogleAppDetails,
} from './providers.js';
import { fetchFacebookAdSignals, hasFacebookToken } from './ads.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_DETAILS_PER_STORE = 8;
const MAX_MERGED_APPS = 15;
const ADS_PROBE_LIMIT = 6;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function toScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roundToK(value) {
  if (!value) return 0;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
  return Math.round(value).toString();
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

async function fetchAppDetails(store, app, country, lang) {
  try {
    return store === 'google'
      ? await fetchGoogleAppDetails({ appId: app.appId, country, lang })
      : await fetchAppleAppDetails({ appId: app.appId, country });
  } catch (error) {
    return { ...app, platform: store, fetchError: error.message || String(error) };
  }
}

// Similar-keyword suggestions derived from real ranking apps + ASO patterns.
const KEYWORD_SUFFIXES = ['app', 'apps', 'premium', 'free', 'best', 'for android', 'for ios', 'maker', 'planner', 'tracker'];
const MODIFIERS = ['daily', 'best', 'simple', 'easy', 'my', 'free', 'personal', 'digital', 'smart', 'ultimate'];

function buildSimilarKeywords(q, appTitles, count = 8) {
  const queryLower = String(q || '').trim().toLowerCase();
  const queryTokens = queryLower.split(/\s+/u).filter((t) => t.length >= 3);
  const seen = new Set([queryLower]);
  const out = [];

  if (!queryTokens.length) return out;

  const titleWordArrays = [];
  for (const title of appTitles) {
    const words = String(title || '').toLowerCase().split(/[^a-z0-9+]+/u).filter((w) => w.length >= 3);
    if (words.length) titleWordArrays.push(words);
  }

  // 1) Phrases (2-3 words) ripped straight from real titles that contain the full query.
  const isRunOn = (phrase) => phrase.split(' ').some((word) =>
    queryTokens.some((t) => word.includes(t) && word.length - t.length >= 3));
  for (const words of titleWordArrays) {
    if (out.length >= count) break;
    for (let i = 0; i < words.length - 1; i += 1) {
      for (const size of [3, 2]) {
        if (i + size > words.length) continue;
        const phrase = words.slice(i, i + size).join(' ');
        if (phrase.includes(queryLower) && !seen.has(phrase) && !isRunOn(phrase)) {
          seen.add(phrase);
          out.push(phrase);
          break;
        }
      }
    }
  }

  // 2) Prefix modifiers ("best habit tracker", "daily habit tracker app").
  for (const mod of MODIFIERS) {
    if (out.length >= count) break;
    const candidate = `${mod} ${queryLower}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }

  // 3) Suffix expansions.
  for (const suffix of KEYWORD_SUFFIXES) {
    if (out.length >= count) break;
    const candidate = `${queryLower} ${suffix}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }

  // 4) Fallback single-token expansions from real titles.
  if (out.length < count) {
    const token = queryTokens[0];
    for (const words of titleWordArrays) {
      if (out.length >= count) break;
      for (const word of words) {
        const candidate = `${token} ${word}`;
        if (!seen.has(candidate) && !candidate.includes(`${token} ${token}`)) {
          seen.add(candidate);
          out.push(candidate);
        }
        if (out.length >= count) break;
      }
    }
  }

  return out.slice(0, count);
}

function computeMetrics(apps) {
  const breadth = apps.length;
  const totalReviews = apps.reduce((sum, app) => sum + app.totalReviews, 0);
  const logDemand = clamp(Math.log10(1 + totalReviews) / 8, 0, 1);
  const avgRating = breadth
    ? apps.reduce((sum, app) => sum + app.avgRating, 0) / breadth
    : 0;
  const avgScore = clamp((avgRating - 1) / 4, 0, 1);
  const adsFraction = breadth
    ? apps.filter((app) => app.adsActive).length / breadth
    : 0;
  const authority = breadth
    ? apps.filter((app) => app.totalReviews >= 50000).length / breadth
    : 0;
  const strongRatings = breadth
    ? apps.filter((app) => app.avgRating >= 4).length / breadth
    : 0;

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

  const opportunity = Math.round((popularity * (100 - difficulty)) / 100);
  const position = breadth
    ? Math.max(1, Math.round(apps.reduce((sum, app) => sum + app.bestRank, 0) / breadth))
    : 0;

  return {
    breadth,
    totalReviews,
    logDemand,
    avgRating: Math.round(avgRating * 100) / 100,
    adsFraction: Math.round(adsFraction * 100),
    authority: Math.round(authority * 100),
    popularity,
    difficulty,
    opportunity,
    position
  };
}

// --- Rank history persistence (per keyword, per store) ---

const RANK_HISTORY_DIR = process.env.RANK_HISTORY_DIR
  ? path.resolve(process.env.RANK_HISTORY_DIR)
  : path.resolve(__dirname, '..', 'data', 'rank-history');

function ensureRankHistoryDir() {
  if (process.env.DISABLE_RANK_HISTORY === '1') return false;
  try {
    fs.mkdirSync(RANK_HISTORY_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function rankHistoryPath(keyword, store) {
  const safe = String(keyword || '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 120) || 'untitled';
  return path.join(RANK_HISTORY_DIR, `${safe}.${store}.json`);
}

function loadRankHistory(keyword, store) {
  if (process.env.DISABLE_RANK_HISTORY === '1') return null;
  try {
    const p = rankHistoryPath(keyword, store);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRankSnapshot(keyword, store, apps, metrics) {
  if (process.env.DISABLE_RANK_HISTORY === '1') return null;
  ensureRankHistoryDir();
  const hist = loadRankHistory(keyword, store) || { keyword, store, snapshots: [] };
  const snapshot = {
    at: new Date().toISOString(),
    position: metrics.position || null,
    popularity: metrics.popularity,
    difficulty: metrics.difficulty,
    opportunity: metrics.opportunity,
    appCount: apps.length,
    topApp: apps[0]?.name || null,
    topAppRank: apps[0]?.bestRank || null,
  };
  hist.snapshots.push(snapshot);
  // keep last 180 daily snapshots
  if (hist.snapshots.length > 180) hist.snapshots = hist.snapshots.slice(-180);
  try {
    fs.writeFileSync(rankHistoryPath(keyword, store), JSON.stringify(hist, null, 2), 'utf8');
    return hist;
  } catch {
    return null;
  }
}

export function getRankHistory(keyword, store) {
  if (process.env.DISABLE_RANK_HISTORY === '1') return [];
  const hist = loadRankHistory(keyword, store);
  return hist && Array.isArray(hist.snapshots) ? hist.snapshots : [];
}

export function formatHistoryChart(snapshots) {
  return snapshots.slice().reverse().map((s) => ({
    date: new Date(s.at).toLocaleDateString(),
    position: s.position,
    popularity: s.popularity,
    difficulty: s.difficulty,
    opportunity: s.opportunity,
  }));
}

// app across stores into a single row and computes ASO metrics.
export async function analyzeKeyword({
  keyword,
  store = 'both',
  country = 'us',
  lang = 'en',
  limit = 12,
  fbToken = null,
} = {}) {
  const q = String(keyword || '').trim();
  if (q.length < 2) throw new Error('Keyword must be at least 2 characters.');

  if (process.env.MOCK_STORE_DATA === '1') {
    const mockApps = [
      { name: 'Instagram', icon: '', url: '', stores: [{ platform: 'google', appId: 'com.instagram.android', rating: 4.1, reviews: 50000, icon: '', url: '', containsAds: true, installs: '5B+', free: true, price: 0, genre: 'Social', updated: '2026-01-01T00:00:00.000Z' }, { platform: 'apple', appId: '389801252', rating: 4.7, reviews: 30000, icon: '', url: '', containsAds: false, installs: '', free: true, price: 0, genre: 'Social', updated: '2026-01-01T00:00:00.000Z' }], totalReviews: 80000, avgRating: 4.4, adsActive: true, bestRank: 1, fbAds: null },
      { name: 'Habitica', icon: '', url: '', stores: [{ platform: 'apple', appId: '994882113', rating: 4.5, reviews: 20000, icon: '', url: '', containsAds: false, installs: '', free: true, price: 0, genre: 'Health', updated: '2026-02-01T00:00:00.000Z' }], totalReviews: 20000, avgRating: 4.5, adsActive: false, bestRank: 2, fbAds: null },
    ];
    const filteredApps = store === 'both' ? mockApps : mockApps
      .map((app) => ({ ...app, stores: app.stores.filter((s) => s.platform === store) }))
      .filter((app) => app.stores.length > 0);
    saveRankSnapshot(q, store, filteredApps, computeMetrics(filteredApps));
    return {
      keyword: q,
      similar: [`best ${q}`, `${q} app`, `free ${q}`, `daily ${q}`],
      competitorKeywords: [{ app: 'Instagram', keywords: ['instagram', 'instagram app', 'instagram free', 'best instagram'] }],
      analyzedAt: new Date().toISOString(),
      country,
      lang,
      store,
      apps: filteredApps,
      metrics: computeMetrics(filteredApps),
      errors: []
    };
  }

  const wants = store === 'google' ? ['google'] : store === 'apple' ? ['apple'] : ['google', 'apple'];
  const settled = await Promise.allSettled(wants.map(async (platform) => {
    try {
      const rows = platform === 'google'
        ? await searchGoogleApps({ q, country, lang, limit: Math.max(limit, 10), concurrency: 12 })
        : await searchAppleApps({ q, country, lang, limit: Math.max(limit, 10) });
      return { platform, rows };
    } catch (error) {
      return { platform, rows: [], error: error.message || String(error) };
    }
  }));

  const errors = [];
  const gathered = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      errors.push(result.reason?.message || String(result.reason));
      continue;
    }
    const { platform, rows, error } = result.value;
    if (error) errors.push(`${platform}: ${error}`);
    for (const row of rows) gathered.push({ ...row, platform });
  }

  const toDetail = gathered.slice(0, MAX_DETAILS_PER_STORE * wants.length);
  const detailed = [];
  const detailErrors = [];
  await mapWithConcurrency(toDetail, 8, async (app) => {
    const result = await fetchAppDetails(app.platform, app, country, lang);
    if (result.fetchError) detailErrors.push(`${app.platform}:${app.appId} — ${result.fetchError}`);
    else detailed.push(result);
  });
  if (detailErrors.length) errors.push(...detailErrors);

  // Merge the same title across stores into one group.
  const groups = new Map();
  detailed.forEach((app, index) => {
    const key = app.title ? normName(app.title) : `${app.platform}:${app.appId}`;
    if (!groups.has(key)) groups.set(key, { name: app.title || app.appId, stores: [], firstIndex: index });
    const group = groups.get(key);
    group.stores.push({ ...app, searchIndex: index });
  });

  const merged = [...groups.values()].map((group) => {
    const stores = group.stores
      .map((store) => ({
        platform: store.platform,
        appId: store.appId,
        rating: toScore(store.score),
        reviews: toScore(store.reviews),
        icon: store.icon || '',
        url: store.url || '',
        containsAds: Boolean(store.containsAds),
        installs: store.installs || '',
        free: store.free,
        price: toScore(store.price),
        genre: store.genre || '',
        updated: store.updated || null,
        searchIndex: store.searchIndex
      }))
      .sort((a, b) => b.reviews - a.reviews);
    const totalReviews = stores.reduce((sum, store) => sum + store.reviews, 0);
    const avgRating = stores.length
      ? stores.reduce((sum, store) => sum + store.rating, 0) / stores.length
      : 0;
    const bestRank = Math.min(...stores.map((store) => store.searchIndex + 1), 99);
    const mostRecentUpdate = stores
      .map((store) => store.updated)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null;
    return {
      name: group.name,
      icon: stores[0]?.icon || '',
      url: stores[0]?.url || '',
      stores,
      totalReviews,
      avgRating: Math.round(avgRating * 100) / 100,
      adsFlagged: stores.some((store) => store.containsAds),
      updated: mostRecentUpdate,
      bestRank
    };
  })
    .sort((a, b) => b.totalReviews - a.totalReviews)
    .slice(0, MAX_MERGED_APPS);

  // Best-effort Meta ad-archive probes for the strongest candidates.
  const effectiveFbToken = fbToken || (hasFacebookToken() ? process.env.FB_ADLIB_ACCESS_TOKEN : null);
  if (effectiveFbToken) {
    await mapWithConcurrency(merged.slice(0, ADS_PROBE_LIMIT), 2, async (app) => {
      const signals = await fetchFacebookAdSignals({ name: app.name, countries: [country.toUpperCase()], token: effectiveFbToken });
      if (signals) app.fbAds = signals;
    });
  }

  for (const app of merged) {
    app.adsActive = app.adsFlagged || Boolean(app.fbAds && app.fbAds.activeAds > 0);
  }

  const apps = merged.map((app) => ({
    name: app.name,
    icon: app.icon,
    url: app.url,
    stores: app.stores,
    totalReviews: app.totalReviews,
    totalReviewsLabel: roundToK(app.totalReviews),
    avgRating: app.avgRating,
    adsActive: app.adsActive,
    updated: app.updated,
    bestRank: app.bestRank,
    fbAds: app.fbAds || null
  }));

  const similar = buildSimilarKeywords(q, apps.map((app) => app.name));

  // Rank history: persist a daily snapshot for this keyword + store.
  saveRankSnapshot(q, store, apps, computeMetrics(apps));

  // Competitor keywords: for each top ranking app, fetch what else it ranks for.
  const competitorKeywords = await buildCompetitorKeywords(q, apps.slice(0, 5), store, country, lang);

  return {
    keyword: q,
    similar,
    competitorKeywords,
    analyzedAt: new Date().toISOString(),
    country,
    lang,
    store,
    apps,
    metrics: computeMetrics(apps),
    errors
  };
}

// --- Competitor keywords (real ranking data) ---

async function buildCompetitorKeywords(keyword, topApps, store, country, lang) {
  if (!topApps.length) return [];
  const wanted = store === 'google' ? ['google'] : store === 'apple' ? ['apple'] : ['google', 'apple'];
  const results = new Map(); // appName -> Set of keywords they rank for

  for (const app of topApps) {
    results.set(app.name, new Set([keyword]));
  }

  // For each store we have data for, search a set of probe keywords and record
  // which of our top apps appear — those are real keywords the competitor ranks for.
  const probeKeywords = [
    keyword,
    ...buildSimilarKeywords(keyword, topApps.map(a => a.name), 6),
    ...['free', 'best', 'popular', 'top', 'recommended', 'new', '2026'].map(m => `${m} ${keyword}`),
  ];

  for (const platform of wanted) {
    for (const probe of probeKeywords.slice(0, 12)) {
      try {
        const rows = platform === 'google'
          ? await searchGoogleApps({ q: probe, country, lang, limit: 15, concurrency: 8 })
          : await searchAppleApps({ q: probe, country, lang, limit: 15 });

        const normApp = new Map();
        for (const app of topApps) {
          normApp.set(normName(app.name), app.name);
        }

        for (const row of rows) {
          const match = normApp.get(normName(row.title));
          if (match && !results.get(match)?.has(probe)) {
            results.get(match)?.add(probe);
          }
        }
      } catch {
        // probe failed — skip, keep partial data
      }
    }
  }

  return topApps.map((app) => ({
    app: app.name,
    keywords: [...(results.get(app.name) || new Set([keyword]))].slice(0, 15),
  }));
}