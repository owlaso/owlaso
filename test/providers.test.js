import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickCounterpart,
  titleSimilarity,
  developerSimilarity,
  normalizeTitle,
  dedupeReviews,
  languagesForCountry,
  primaryLanguage,
  cleanLang,
  inferPlatform,
  assertAppId,
  resolveListings,
  extractGoogleAppIds,
  withCache,
  clearCache,
  computeGroupStats,
} from '../src/providers.js';

delete process.env.MOCK_STORE_DATA;
delete process.env.DISABLE_CACHE;

test('normalizeTitle is Unicode-aware', () => {
  assert.equal(normalizeTitle('Ölçüm PRO!'), 'olcumpro');
  assert.equal(normalizeTitle('天気 予報'), '天気予報');
  assert.equal(normalizeTitle('İstanbul'), 'istanbul');
});

test('counterpart matching prefers the same app and never falls back to an unrelated top result', () => {
  const rows = [
    { appId: '1', title: 'Totally Different Game', developer: 'X', score: 5 },
    { appId: '2', title: 'Spotify - Music and Podcasts', developer: 'Spotify AB', score: 4.5 },
  ];
  assert.equal(pickCounterpart(rows, { title: 'Spotify: Music and Podcasts', developer: 'Spotify' })?.appId, '2');
  assert.equal(pickCounterpart(rows, { title: 'My Tiny Unique App' }), null);
  // Same generic title from a different developer is not the same app.
  const generic = [{ appId: '9', title: 'Calculator', developer: 'Someone Else LLC' }];
  assert.equal(pickCounterpart(generic, { title: 'Calculator', developer: 'Acme Tools' }), null);
  assert.equal(pickCounterpart(generic, { title: 'Calculator' })?.appId, '9');
});

test('title/developer similarity helpers', () => {
  assert.equal(titleSimilarity('Instagram', 'instagram'), 1);
  assert.ok(titleSimilarity('Notion: Notes, Docs, Tasks', 'Notion') >= 0.9);
  assert.equal(titleSimilarity('Foo', 'Bar'), 0);
  assert.equal(developerSimilarity('Instagram, Inc.', 'Instagram'), 1);
  assert.equal(developerSimilarity('WhatsApp LLC', 'WhatsApp Inc.'), 1);
  assert.equal(developerSimilarity('Acme', 'Globex'), -1);
  assert.equal(developerSimilarity('', 'Globex'), 0);
});

test('dedupeReviews keys on the store review id, so short anonymous reviews survive', () => {
  const a = { id: 'g1', platform: 'google', author: 'A Google user', title: '', text: 'Good' };
  const b = { id: 'g2', platform: 'google', author: 'A Google user', title: '', text: 'Good' };
  assert.equal(dedupeReviews([a, b, { ...a }]).length, 2);
});

test('languages are ordered by storefront relevance', () => {
  assert.equal(languagesForCountry('jp')[0], 'ja');
  assert.equal(languagesForCountry('tr')[0], 'tr');
  assert.equal(languagesForCountry('us')[0], 'en');
  assert.equal(new Set(languagesForCountry('br')).size, languagesForCountry('br').length);
  assert.equal(primaryLanguage('br'), 'pt-BR');
  assert.equal(cleanLang('PT-br'), 'pt-BR');
});

test('app id validation and store inference', () => {
  assert.equal(inferPlatform('389801252'), 'apple');
  assert.equal(inferPlatform('com.spotify.music'), 'google');
  assert.throws(() => assertAppId('apple', 'com.spotify.music'), (e) => e.status === 400);
  assert.throws(() => assertAppId('google', 'x&hl=evil'), (e) => e.status === 400);
  assert.throws(() => assertAppId('google', ''), (e) => e.status === 400);
  assert.equal(assertAppId('google', ' com.spotify.music '), 'com.spotify.music');
});

test('resolveListings uses the pinned counterpart id and the declared primary store', async () => {
  const both = await resolveListings({ platform: 'both', appId: '324684580', appPlatform: 'apple', appId2: 'com.spotify.music' });
  assert.deepEqual(both.specs.map((s) => `${s.platform}:${s.appId}`), ['apple:324684580', 'google:com.spotify.music']);
  // Apple-primary app, Google-only view, counterpart known → no title search needed.
  const googleOnly = await resolveListings({ platform: 'google', appId: '324684580', appPlatform: 'apple', appId2: 'com.spotify.music' });
  assert.deepEqual(googleOnly.specs, [{ platform: 'google', appId: 'com.spotify.music' }]);
  // No counterpart and no title: fetch what we have and say so.
  const partial = await resolveListings({ platform: 'both', appId: '324684580' });
  assert.equal(partial.specs.length, 1);
  assert.match(partial.warnings[0], /No Google Play listing/);
});

test('Google HTML fallback only extracts app detail links, not hostnames', () => {
  const html = '<a href="/store/apps/details?id=com.good.app">x</a> "play.google.com" "fonts.googleapis.com" "window.WIZ_global.data"';
  assert.deepEqual(extractGoogleAppIds(html, 10), ['com.good.app']);
});

test('withCache coalesces concurrent identical requests and does not cache failures', async () => {
  clearCache();
  let calls = 0;
  const producer = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return ['x']; };
  const [a, b] = await Promise.all([withCache('t', { k: 1 }, 1000, producer), withCache('t', { k: 1 }, 1000, producer)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await withCache('t', { k: 1 }, 1000, producer);
  assert.equal(calls, 1, 'served from cache');

  let failures = 0;
  const failing = async () => { failures += 1; throw new Error('boom'); };
  await assert.rejects(withCache('t', { k: 2 }, 1000, failing));
  await assert.rejects(withCache('t', { k: 2 }, 1000, failing));
  assert.equal(failures, 2);
  clearCache();
});

test('group stats: Unicode top terms, stopwords removed, ratings outside 1-5 ignored', () => {
  const stats = computeGroupStats([
    { rating: 5, title: 'Harika', text: 'Güncelleme sonrası çok güzel çalışıyor', date: '2026-01-01T00:00:00Z' },
    { rating: 1, title: 'Hata', text: 'Güncelleme sonrası uygulama çöküyor', date: '2026-02-01T00:00:00Z' },
    { rating: 0, title: '', text: '', date: 'not a date' },
  ]);
  assert.ok(stats.topTerms.includes('güncelleme'));
  assert.ok(!stats.topTerms.includes('çok'), 'Turkish stopword removed');
  assert.ok(!stats.topTerms.some((t) => t.length < 3));
  assert.equal(stats.avgRating, 3);
  assert.equal(stats.dateFrom, '2026-01-01T00:00:00.000Z');
});

test('"all" country handling: never silently becomes Albania, Google read once per language', async () => {
  const { cleanCountry, isAllCountries, googleLanguageStorefronts, STOREFRONTS } = await import('../src/providers.js');
  assert.equal(cleanCountry('all'), 'us');
  assert.equal(cleanCountry('ALL'), 'us');
  assert.equal(isAllCountries('All'), true);
  const targets = googleLanguageStorefronts(STOREFRONTS);
  const langs = targets.map((t) => t.lang);
  assert.equal(new Set(langs).size, langs.length, 'one Google fetch per language');
  assert.ok(langs.length < STOREFRONTS.length, 'fewer Google fetches than storefronts');
  assert.deepEqual(targets.find((t) => t.lang === 'tr'), { lang: 'tr', country: 'tr' });
});
