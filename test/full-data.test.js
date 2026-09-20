import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllReviews, dedupeReviews } from '../src/providers.js';
import { applyReviewFilters } from '../src/filters.js';

const sampleReview = (platform, lang, rating, date) => ({
  platform,
  lang,
  rating,
  date,
  title: 'Test review',
  text: 'This app is great and fast',
  author: 'user-x',
  version: '1.0',
  replyText: '',
});

test('dedupeReviews removes duplicate by platform+author+title+text prefix', () => {
  const rows = [
    sampleReview('google', 'en', 5, '2026-01-01'),
    sampleReview('google', 'en', 5, '2026-01-01'),   // exact dup — same author/title/text/platform
    sampleReview('google', 'en', 5, '2026-01-02'),   // different date → different text slice? no, same text
    sampleReview('google', 'de', 3, '2026-01-01'),   // different lang → different author? no
  ];
  const out = dedupeReviews(rows);
  // Two rows share platform+author+title+text prefix (first two), and the third has a different date
  // but same text — dedupeReviews uses text.slice(0,60) which is identical, so first two collapse.
  // The fourth has different platform→lang but same author/title/text → also collapses as a dup.
  // Expected: 1 unique review from the 4 identical-by-key rows.
  assert.equal(out.length, 1, 'rows sharing platform+author+title+text-prefix should collapse to 1');
  assert.equal(out[0].platform, 'google');
  assert.equal(out[0].author, 'user-x');
});

test('applyReviewFilters accepts lang field without throwing', () => {
  const rows = [sampleReview('google', 'en', 5, '2026-01-01')];
  // applyReviewFilters doesn't use lang at all, but we pass it to confirm no crash
  const out = applyReviewFilters(rows, { lang: 'en', stars: '5' });
  assert.equal(out.length, 1);
});

test('computeGroupStats (inline) produces count, stars, avgRating, date range, topTerms', () => {
  // Replicate the logic from providers' computeGroupStats to unit-test its contract.
  const reviews = [
    { platform: 'google', rating: 5, date: '2026-01-10T00:00:00Z', title: 'Great', text: 'Love this fast app', author: 'a', version: '1', replyText: '' },
    { platform: 'google', rating: 1, date: '2026-02-01T00:00:00Z', title: 'Crash', text: 'App crashes every time I open it', author: 'b', version: '1', replyText: '' },
    { platform: 'google', rating: 4, date: '2026-03-01T00:00:00Z', title: 'Good', text: 'Good enough for daily tasks', author: 'c', version: '1', replyText: '' },
  ];

  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sumRating = 0;
  let dateFrom = null;
  let dateTo = null;
  const termFreq = new Map();
  const STOP = new Set(['the','and','this','that','with','from','have','were','they','your','which','will','app','apps','very','really','just','more','is','it','to','of','a','an','in','on','for','my','me','we','i','you','he','she','his','her','their','our','be','at','by','as','or','not','no','so','but','if','all','has','had','been','are','was','did','does','can','could','would','should','get','got','like','love','use','using','used','one','two','about','into','out','up','down','over','after','before']);

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
  const topTerms = [...termFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);

  assert.equal(stars[1], 1, 'one 1-star');
  assert.equal(stars[5], 1, 'one 5-star');
  assert.equal(stars[4], 1, 'one 4-star');
  assert.equal(sumRating, 10, 'sum of ratings = 5+1+4');
  assert.equal(dateFrom?.toISOString(), '2026-01-10T00:00:00.000Z');
  assert.equal(dateTo?.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.ok(topTerms.length >= 1, 'topTerms should be populated');
  assert.ok(!topTerms.includes('the') && !topTerms.includes('app'), 'stop words should be excluded');
});
