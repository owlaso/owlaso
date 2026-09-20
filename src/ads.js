// Free ad-activity signals for the difficulty / popularity metrics.
//
// 1. Google Play Apps: the `containsAds` flag returned by google-play-scraper
//    (free, part of the app listing) — indicates the app runs ads.
// 2. Meta / Facebook Ad Library API (free): active public ads on Facebook,
//    Instagram, Messenger and the Audience Network. Requires a free Meta app
//    access token; set it in the environment variable FB_ADLIB_ACCESS_TOKEN.
//    Without a token this module degrades gracefully to `null`.

const FB_GRAPH = 'https://graph.facebook.com';
const FB_VERSION = 'v21.0';
const SIGNAL_CACHE_TTL_MS = 60 * 60 * 1000;

const signalCache = new Map();

export function hasFacebookToken() {
  return Boolean(process.env.FB_ADLIB_ACCESS_TOKEN);
}

export function facebookTokenPresent() {
  return hasFacebookToken();
}

// Probes the Meta Ad Library for a brand/app name and reports how many of its
// ads are currently ACTIVE and when the most recent one started running.
export async function fetchFacebookAdSignals({ name, countries = ['US', 'TR'], token: explicitToken }) {
  const token = explicitToken || process.env.FB_ADLIB_ACCESS_TOKEN;
  if (!token || !name) return null;

  const key = `${name}:${countries.join(',')}`;
  const hit = signalCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const url = new URL(`${FB_GRAPH}/${FB_VERSION}/ads_archive`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'page_name,ad_delivery_start_time,ad_creation_time,ad_active_status');
  url.searchParams.set('ad_reached_countries', JSON.stringify(countries.slice(0, 5)));
  url.searchParams.set('search_terms', name);
  url.searchParams.set('ad_type', 'ALL');
  url.searchParams.set('limit', '100');

  try {
    const response = await fetch(url, { headers: { 'user-agent': 'store-review-filter-app/1.5' } });
    if (!response.ok) return null;
    const json = await response.json();
    const data = Array.isArray(json.data) ? json.data : [];
    const active = data.filter((ad) => String(ad.ad_active_status || '').toUpperCase() === 'ACTIVE');
    const starts = [];
    for (const ad of active) {
      const start = Date.parse(ad.ad_delivery_start_time || ad.ad_creation_time || '');
      if (Number.isFinite(start)) starts.push(start);
    }
    starts.sort((a, b) => b - a);
    const value = {
      source: 'facebook-ad-library',
      totalAds: data.length,
      activeAds: active.length,
      lastActiveAt: starts.length ? new Date(starts[0]).toISOString() : null
    };
    signalCache.set(key, { value, expires: Date.now() + SIGNAL_CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}