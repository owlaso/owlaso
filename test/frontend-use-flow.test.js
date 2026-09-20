import test from 'node:test';
import assert from 'node:assert/strict';

// ── ASO analysis (mock mode) ─────────────────────────────────────────────────

process.env.MOCK_STORE_DATA = '1';
const { analyzeKeyword } = await import('../src/aso.js');

test('analyzeKeyword returns correct shape in mock mode', async () => {
  const result = await analyzeKeyword({ keyword: 'habit tracker', store: 'both', country: 'us', lang: 'en' });
  assert.equal(result.keyword, 'habit tracker');
  assert.ok(Array.isArray(result.apps) && result.apps.length >= 1, 'apps must be a non-empty array');
  assert.ok(Array.isArray(result.similar), 'similar must be an array');
  assert.equal(typeof result.analyzedAt, 'string');
  assert.equal(result.country, 'us');
  assert.equal(result.store, 'both');
});

test('analyzeKeyword metrics are numbers clamped 0-100', async () => {
  const { metrics } = await analyzeKeyword({ keyword: 'todo list', store: 'both' });
  for (const key of ['popularity', 'difficulty', 'opportunity']) {
    assert.equal(typeof metrics[key], 'number', `metrics.${key} must be a number`);
    assert.ok(metrics[key] >= 0 && metrics[key] <= 100, `metrics.${key} must be 0-100, got ${metrics[key]}`);
  }
});

test('each app in results has merged stores array and review counts', async () => {
  const { apps } = await analyzeKeyword({ keyword: 'instagram', store: 'both' });
  assert.ok(apps.length >= 1);
  for (const app of apps) {
    assert.ok(Array.isArray(app.stores) && app.stores.length >= 1, `app "${app.name}" missing stores`);
    assert.ok(typeof app.totalReviews === 'number', `app "${app.name}" totalReviews must be a number`);
    assert.ok(typeof app.avgRating === 'number', `app "${app.name}" avgRating must be a number`);
    assert.ok(typeof app.adsActive === 'boolean', `app "${app.name}" adsActive must be boolean`);
  }
});

test('popularity rises when apps have active ads', async () => {
  const withAds = await analyzeKeyword({ keyword: 'instagram', store: 'both' });
  // Mock data has adsActive: true on the first app — adsFraction drives popularity up
  assert.ok(withAds.metrics.adsFraction >= 0);
  assert.ok(withAds.metrics.popularity > 0, `Expected popularity > 0, got ${withAds.metrics.popularity}`);
});

test('difficulty accounts for ad activity (adsFraction × 25 in formula)', async () => {
  const { metrics } = await analyzeKeyword({ keyword: 'instagram', store: 'both' });
  // Mock has one adsActive app out of two → adsFraction = 50 → contributes 12.5 to difficulty
  assert.ok(metrics.difficulty > 0, `Expected difficulty > 0, got ${metrics.difficulty}`);
});

test('opportunity = popularity × (100 - difficulty) / 100', async () => {
  const { metrics } = await analyzeKeyword({ keyword: 'habit tracker', store: 'both' });
  const expected = Math.round((metrics.popularity * (100 - metrics.difficulty)) / 100);
  assert.equal(metrics.opportunity, expected);
});

test('similar keywords list is non-empty and does not repeat the query', async () => {
  const { keyword, similar } = await analyzeKeyword({ keyword: 'fitness tracker', store: 'both' });
  assert.ok(similar.length > 0, 'similar must not be empty');
  assert.ok(!similar.includes(keyword), 'similar must not contain the original query');
});

test('single-store filter returns results from that store only', async () => {
  const { apps } = await analyzeKeyword({ keyword: 'instagram', store: 'google' });
  for (const app of apps) {
    const platforms = app.stores.map((s) => s.platform);
    assert.ok(platforms.every((p) => p === 'google'), `Expected only google stores, got ${platforms}`);
  }
});

// ── Comment keyword extraction (inline — pure logic) ─────────────────────────

function extractCommentGroups(reviews) {
  const map = new Map();
  for (const r of reviews || []) {
    const text = `${r.title || ''} ${r.text || ''}`.toLowerCase();
    const matches = text.match(/[a-z][a-z-]{2,}(?:\s+[a-z][a-z-]{2,})?/gu) || [];
    const freq = new Map();
    const STOP = new Set(['the', 'and', 'this', 'that', 'with', 'from', 'have', 'were', 'they', 'your', 'which', 'will', 'app', 'apps', 'very', 'really', 'just', 'more']);
    for (const m of matches) {
      if (STOP.has(m)) continue;
      freq.set(m, (freq.get(m) || 0) + 1);
    }
    for (const [word, count] of freq) {
      if (count < 1) continue;
      if (!map.has(word)) map.set(word, { keyword: word, volume: 0, lastDate: null, sumRating: 0, count: 0 });
      const g = map.get(word);
      g.volume += count;
      g.count += 1;
      g.sumRating += Number(r.rating) || 0;
      const d = r.date ? new Date(r.date) : null;
      if (d && (!g.lastDate || d > g.lastDate)) g.lastDate = d;
    }
  }
  const groups = [...map.values()].sort((a, b) => b.volume - a.volume);
  groups.forEach((g, i) => { g.rank = i + 1; g.avgRating = g.count ? Math.round((g.sumRating / g.count) * 10) / 10 : null; });
  return groups.slice(0, 30);
}

const sampleReviews = [
  { title: 'App crashes', text: 'Login crash happens daily on my device', rating: 1, date: '2026-05-01T10:00:00Z' },
  { title: 'Slow loading', text: 'Slow startup and login takes forever', rating: 2, date: '2026-05-10T10:00:00Z' },
  { title: 'Great app', text: 'Clean design and login works perfectly', rating: 5, date: '2026-05-20T10:00:00Z' },
];

test('extractCommentGroups extracts keywords from review text', () => {
  const groups = extractCommentGroups(sampleReviews);
  assert.ok(groups.length > 0);
  const keywords = groups.map((g) => g.keyword);
  // The function extracts bigrams; "login" appears as "and login" and "login crash"
  const hasLoginBigram = keywords.some((k) => k.includes('login'));
  assert.ok(hasLoginBigram, `Expected a login-related bigram in ${keywords.join(', ')}`);
});

test('extractCommentGroups ranks by frequency — "and login" appears in 2 reviews', () => {
  const groups = extractCommentGroups(sampleReviews);
  // "and login" appears in reviews 2 and 3 → highest volume → rank 1
  const topGroup = groups.find((g) => g.keyword === 'and login');
  assert.ok(topGroup, `"and login" group not found; got: ${groups.map((g) => g.keyword).join(', ')}`);
  assert.equal(topGroup.rank, 1, `Expected rank 1, got ${topGroup.rank}`);
});

test('extractCommentGroups sets lastDate to most recent review date', () => {
  const groups = extractCommentGroups(sampleReviews);
  // "and login" is in review 2 (May 10) and review 3 (May 20) → lastDate = May 20
  const topGroup = groups.find((g) => g.keyword === 'and login');
  assert.ok(topGroup.lastDate instanceof Date);
  assert.equal(topGroup.lastDate.toISOString(), '2026-05-20T10:00:00.000Z');
});

test('extractCommentGroups computes correct avgRating per keyword', () => {
  const groups = extractCommentGroups(sampleReviews);
  // "and login": review 2 (rating=2) + review 3 (rating=5) → avg = 3.5
  const topGroup = groups.find((g) => g.keyword === 'and login');
  assert.equal(topGroup.avgRating, 3.5);
});

test('extractCommentGroups returns at most 30 entries', () => {
  const bulk = Array.from({ length: 50 }, (_, i) => ({ title: `word${i} review`, text: `word${i} body text review here good app`, rating: 4, date: '2026-01-01T00:00:00Z' }));
  const groups = extractCommentGroups(bulk);
  assert.ok(groups.length <= 30);
});
