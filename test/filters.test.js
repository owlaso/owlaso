import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewFilters, parseStars, toCsv } from '../src/filters.js';

const reviews = [
  { platform: 'google', rating: 1, title: 'Crash', text: 'Login crash happens daily', author: 'a', date: '2026-05-01T10:00:00Z', version: '1.0.1', replyText: '' },
  { platform: 'apple', rating: 3, title: 'Slow', text: 'Slow but usable', author: 'b', date: '2026-05-15T10:00:00Z', version: '1.2.0', replyText: 'Thanks' },
  { platform: 'apple', rating: 5, title: 'Nice', text: 'Works great', author: 'c', date: '2026-05-28T10:00:00Z', version: '2.0.0', replyText: '' }
];

test('parseStars accepts only valid 1-5 ratings', () => {
  assert.deepEqual(parseStars('1,2,9,x,5'), [1, 2, 5]);
});

test('filters by stars and keyword', () => {
  const out = applyReviewFilters(reviews, { stars: '1,3', keyword: 'crash' });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Crash');
});

test('filters by date range and reply presence', () => {
  const out = applyReviewFilters(reviews, { dateFrom: '2026-05-10', dateTo: '2026-05-20', replyOnly: 'true' });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Slow');
});

test('filters by version and min length', () => {
  const out = applyReviewFilters(reviews, { version: '1.0', minLength: '20' });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Crash');
});

test('csv export escapes quoted text', () => {
  const csv = toCsv([{ platform: 'x', text: 'hello, "world"', rating: 1 }]);
  assert.match(csv, /"hello, ""world"""/);
});
