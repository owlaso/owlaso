import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MOCK_STORE_DATA = '1';
const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owlaso-aso-'));
process.env.RANK_HISTORY_DIR = historyDir;
test.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));

const { analyzeKeyword, getRankHistory, rankHistoryFile, buildSimilarKeywords } = await import('../src/aso.js');

test('history files never leave the history directory, whatever the input', () => {
  for (const input of [
    { keyword: '../../etc/passwd', store: 'both' },
    { keyword: 'x', store: '../../../tmp/owned' },
    { keyword: 'x', store: 'both', country: '../..', lang: '../../..' },
  ]) {
    const file = rankHistoryFile(input);
    assert.equal(path.dirname(file), historyDir);
    assert.match(path.basename(file), /^[a-z0-9-]+\.[0-9a-f]{20}\.json$/);
  }
});

test('non-Latin keywords get distinct history files (no "___" collisions)', () => {
  const a = rankHistoryFile({ keyword: '天気', store: 'both', country: 'jp', lang: 'ja' });
  const b = rankHistoryFile({ keyword: '地図', store: 'both', country: 'jp', lang: 'ja' });
  const c = rankHistoryFile({ keyword: 'hava durumu', store: 'both', country: 'tr', lang: 'tr' });
  const d = rankHistoryFile({ keyword: 'hava_durumu', store: 'both', country: 'tr', lang: 'tr' });
  assert.equal(new Set([a, b, c, d]).size, 4);
});

test('re-analyzing on the same day refreshes one snapshot instead of appending', async () => {
  await analyzeKeyword({ keyword: 'daily snapshot', store: 'both', country: 'us', lang: 'en' });
  await analyzeKeyword({ keyword: 'daily snapshot', store: 'both', country: 'us', lang: 'en' });
  await analyzeKeyword({ keyword: '  Daily   Snapshot ', store: 'both', country: 'us', lang: 'en' });
  assert.equal(getRankHistory({ keyword: 'daily snapshot', store: 'both', country: 'us', lang: 'en' }).length, 1);
});

test('unknown store values are normalised (never used raw)', async () => {
  const result = await analyzeKeyword({ keyword: 'store check', store: '../../x' });
  assert.equal(result.store, 'both');
});

test('similar keywords work for non-Latin and short CJK queries', () => {
  const ja = buildSimilarKeywords('天気', ['天気予報 アプリ', 'Yahoo!天気']);
  assert.ok(ja.length > 0);
  const tr = buildSimilarKeywords('hava durumu', ['Hava Durumu Pro', 'Günlük Hava']);
  assert.ok(tr.includes('hava durumu pro'));
});
