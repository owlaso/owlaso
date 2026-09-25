// Transport-agnostic API router shared by the web server (src/server.js) and the
// Electron main process (electron/main.cjs), so both expose identical behaviour.
//
// handleApiRequest(url) resolves to either
//   { status, contentType, body, headers? }        — a complete response, or
//   { status, contentType, ndjson(write, signal) } — a streamed NDJSON response.
import fs from 'node:fs';
import {
  searchApps,
  fetchReviews,
  fetchReviewsMulti,
  fetchAllReviews,
  fetchAllReviewsStream,
  fetchGoogleAppDetails,
  fetchAppleAppDetails,
  resolveListings,
  cleanCountry,
  cleanLang,
  primaryLanguage,
  inferPlatform,
  assertAppId,
} from './providers.js';
import { analyzeKeyword, getRankHistory, normalizeStore, normalizeKeyword } from './aso.js';
import { toCsv } from './filters.js';
import { HttpError, badRequest } from './errors.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const APP_VERSION = pkg.version;

const JSON_TYPE = 'application/json; charset=utf-8';

function json(status, payload) {
  return { status, contentType: JSON_TYPE, body: JSON.stringify(payload) };
}

// "all" is only meaningful for review fetching; everything else needs a concrete language.
function requestLang(lang, country) {
  return !lang || lang === 'all' ? primaryLanguage(country) : cleanLang(lang);
}

function appPlatformOf(value, appId) {
  return value === 'apple' || value === 'google' ? value : inferPlatform(appId);
}

async function appDetails(q) {
  const appId = String(q.appId || '').trim();
  const platform = appPlatformOf(q.platform, appId);
  assertAppId(platform, appId);
  const country = cleanCountry(q.country);
  const lang = requestLang(q.lang, country);
  const load = (store, id) => (store === 'apple'
    ? fetchAppleAppDetails({ appId: id, country })
    : fetchGoogleAppDetails({ appId: id, country, lang }));

  const primary = await load(platform, appId);
  let counterpart = null;
  const warnings = [];
  if ((q.store || 'both') === 'both') {
    const other = platform === 'apple' ? 'google' : 'apple';
    const { specs, warnings: resolveWarnings } = await resolveListings({
      platform: other, appId, appPlatform: platform, appId2: q.appId2, title: primary.title, developer: primary.developer, country, lang,
    });
    warnings.push(...resolveWarnings);
    if (specs[0]) {
      try {
        counterpart = await load(other, specs[0].appId);
      } catch (error) {
        warnings.push(error.message || String(error));
      }
    }
  }
  return { primary, counterpart, warnings };
}

function reviewParams(q) {
  // Reviews and full data understand country=all (every storefront).
  const country = String(q.country || '').toLowerCase() === 'all' ? 'all' : cleanCountry(q.country);
  return { ...q, country, platform: q.platform || appPlatformOf(q.appPlatform, q.appId) };
}

const routes = {
  '/api/health': async () => json(200, {
    ok: true,
    version: APP_VERSION,
    mock: process.env.MOCK_STORE_DATA === '1',
    time: new Date().toISOString(),
  }),

  '/api/search': async (q) => {
    const country = cleanCountry(q.country);
    const results = await searchApps({ platform: q.platform, q: q.q, country, lang: requestLang(q.lang, country), limit: q.limit });
    return json(200, { results });
  },

  '/api/asosearch': async (q) => {
    if (String(q.country || '').toLowerCase() === 'all') throw badRequest('Keyword analysis runs per country: pick one country.');
    const country = cleanCountry(q.country);
    const data = await analyzeKeyword({
      keyword: q.q ?? q.keyword,
      store: normalizeStore(q.store),
      country,
      lang: requestLang(q.lang, country),
      limit: q.limit,
      lite: q.lite === '1',
      track: q.track === '1',
    });
    return json(200, data);
  },

  '/api/asosearch/history': async (q) => {
    const keyword = normalizeKeyword(q.q ?? q.keyword);
    if (keyword.length < 2) throw badRequest('Keyword must be at least 2 characters.');
    const country = cleanCountry(q.country);
    const params = { keyword, store: normalizeStore(q.store), country, lang: requestLang(q.lang, country) };
    return json(200, { ...params, snapshots: getRankHistory(params) });
  },

  '/api/app-details': async (q) => json(200, await appDetails(q)),

  '/api/reviews': async (q) => {
    const params = reviewParams(q);
    const multi = q.multi === '1' || q.lang === 'all';
    return json(200, multi ? await fetchReviewsMulti(params) : await fetchReviews(params));
  },

  '/api/reviews.full': async (q) => json(200, await fetchAllReviews(reviewParams(q))),

  '/api/reviews.full.stream': async (q) => ({
    status: 200,
    contentType: 'application/x-ndjson; charset=utf-8',
    // NDJSON: a "plan" line (sources to read), then "group" (reviews) and "progress"
    // lines as sources finish, then a final "done" (or "error") line.
    ndjson: async (write, signal) => {
      try {
        const summary = await fetchAllReviewsStream(reviewParams(q), {
          signal,
          onPlan: (plan) => write({ type: 'plan', ...plan }),
          onGroup: (group) => write({ type: 'group', group }),
          onProgress: (progress) => write({ type: 'progress', ...progress }),
        });
        write({ type: 'done', ...summary });
      } catch (error) {
        write({ type: 'error', error: error.message || String(error) });
      }
    },
  }),

  '/api/reviews.csv': async (q) => {
    const payload = await fetchReviews(reviewParams(q));
    return {
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: { 'content-disposition': 'attachment; filename="reviews.csv"' },
      body: `﻿${toCsv(payload.reviews)}`,
    };
  },
};

export async function handleApiRequest(url) {
  const route = routes[url.pathname];
  if (!route) return json(404, { error: 'API route not found.' });
  try {
    return await route(Object.fromEntries(url.searchParams.entries()));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json(status, { error: error.message || String(error) });
  }
}
