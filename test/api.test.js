import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOCK_STORE_DATA = '1';
const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owlaso-api-'));
process.env.RANK_HISTORY_DIR = historyDir;
test.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));

const { handleApiRequest, APP_VERSION } = await import('../src/api.js');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function call(pathAndQuery) {
  const result = await handleApiRequest(new URL(pathAndQuery, 'http://localhost'));
  const body = result.body !== undefined && result.contentType.startsWith('application/json') ? JSON.parse(result.body) : result.body;
  return { ...result, json: body };
}

test('health reports the package version (not a hard-coded one)', async () => {
  const { status, json } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(json.version, pkg.version);
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(json.mock, true);
  assert.equal(json.node, undefined, 'no runtime fingerprinting');
});

test('unknown routes are 404, validation errors are 400 (not 500)', async () => {
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal((await call('/api/asosearch?q=a')).status, 400);
  assert.equal((await call(`/api/asosearch?q=${'x'.repeat(101)}`)).status, 400);
  assert.equal((await call('/api/asosearch/history?q=a')).status, 400);
  assert.equal((await call('/api/app-details')).status, 400);
  assert.equal((await call('/api/reviews?platform=apple&appId=com.instagram.android')).status, 400);
  assert.equal((await call('/api/reviews?platform=google&appId=not%20a%20package')).status, 400);
});

test('fbToken is no longer accepted from the query string', async () => {
  const src = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fbToken/);
});

test('analysis returns per-store rankings and no meaningless average "position"', async () => {
  const { json } = await call('/api/asosearch?q=habit%20tracker&store=both&country=us');
  assert.ok(Array.isArray(json.rankings.google));
  assert.ok(Array.isArray(json.rankings.apple));
  assert.equal(json.metrics.position, undefined);
  for (const app of json.apps) {
    for (const s of app.stores) assert.equal(typeof s.rank, 'number');
  }
});

test('rank history is keyed by keyword + store + country + language', async () => {
  await call('/api/asosearch?q=weather&store=both&country=us&lang=en');
  await call('/api/asosearch?q=weather&store=both&country=tr&lang=tr');
  const us = await call('/api/asosearch/history?q=weather&store=both&country=us&lang=en');
  const tr = await call('/api/asosearch/history?q=weather&store=both&country=tr&lang=tr');
  const jp = await call('/api/asosearch/history?q=weather&store=both&country=jp');
  assert.equal(us.json.snapshots.length, 1);
  assert.equal(tr.json.snapshots.length, 1);
  assert.equal(jp.json.snapshots.length, 0);
  assert.ok(us.json.snapshots[0].rankings, 'snapshots keep rankings so positions can be replayed');
});

test('similar-keyword (lite) analyses do not write history', async () => {
  await call('/api/asosearch?q=lite%20only%20keyword&lite=1');
  const { json } = await call('/api/asosearch/history?q=lite%20only%20keyword');
  assert.equal(json.snapshots.length, 0);
});

test('reviews default to the store implied by the app id and lang=all uses multi-language mode', async () => {
  const single = await call('/api/reviews?appId=com.instagram.android');
  assert.equal(single.json.platform, 'google');
  const multi = await call('/api/reviews?appId=389801252&platform=both&lang=all');
  assert.ok(Array.isArray(multi.json.languages));
  assert.equal(multi.json.platform, 'both');
});

test('reviews.csv has a BOM, attachment disposition and formula-safe cells', async () => {
  const res = await call('/api/reviews.csv?platform=google&appId=com.instagram.android');
  assert.equal(res.status, 200);
  assert.ok(res.body.startsWith('﻿'));
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.match(res.body, /^﻿platform,appId,country,lang,rating/);
});

test('full-data stream emits groups then a done line', async () => {
  const result = await handleApiRequest(new URL('http://localhost/api/reviews.full.stream?appId=com.instagram.android&platform=both'));
  assert.match(result.contentType, /ndjson/);
  const lines = [];
  await result.ndjson((obj) => lines.push(obj), new AbortController().signal);
  assert.ok(lines.filter((l) => l.type === 'group').length >= 1);
  assert.equal(lines.at(-1).type, 'done');
  assert.ok(lines.at(-1).totalReviews > 0);
});

test('"All countries": keyword analysis is per country, reviews cover every storefront', async () => {
  assert.equal((await call('/api/asosearch?q=habit%20tracker&country=all')).status, 400);
  const { status, json } = await call('/api/reviews?appId=com.instagram.android&platform=both&country=all&appId2=389801252');
  assert.equal(status, 200);
  assert.equal(json.countries.length, 20);
  const apple = json.reviews.filter((r) => r.platform === 'apple');
  assert.ok(apple.length > 0 && apple.every((r) => r.country), 'App Store reviews carry their storefront');
  assert.ok(json.reviews.filter((r) => r.platform === 'google').every((r) => r.lang), 'Google Play reviews carry their language');
  // Single-storefront endpoints fall back to the US store instead of "al" (Albania).
  assert.equal((await call('/api/search?q=instagram&platform=all&country=all')).status, 200);
});

test('lite analyses keep history when asked to (per-country comparison)', async () => {
  await call('/api/asosearch?q=tracked%20lite&country=tr&lite=1&track=1');
  const { json } = await call('/api/asosearch/history?q=tracked%20lite&country=tr');
  assert.equal(json.snapshots.length, 1);
});

test('full-data stream announces a plan, reports per-source progress and supports depth', async () => {
  const result = await handleApiRequest(new URL('http://localhost/api/reviews.full.stream?appId=com.instagram.android&platform=both&depth=2'));
  const lines = [];
  await result.ndjson((obj) => lines.push(obj), new AbortController().signal);
  const plan = lines.find((l) => l.type === 'plan');
  assert.ok(plan && plan.total > 0 && plan.sources.length === plan.total);
  const progress = lines.filter((l) => l.type === 'progress');
  assert.equal(progress.at(-1).done, plan.total);
  assert.ok(progress.every((p) => p.source?.id && ['ok', 'failed'].includes(p.source.status)));
  assert.equal(lines.at(-1).depth, 2);
  assert.equal(lines.at(-1).type, 'done');
});
