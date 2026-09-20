import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFacebookToken, fetchFacebookAdSignals } from '../src/ads.js';

const savedToken = process.env.FB_ADLIB_ACCESS_TOKEN;
const cleanupToken = () => {
  if (savedToken) process.env.FB_ADLIB_ACCESS_TOKEN = savedToken;
  else delete process.env.FB_ADLIB_ACCESS_TOKEN;
};

test('hasFacebookToken returns false when env var is absent', (t) => {
  delete process.env.FB_ADLIB_ACCESS_TOKEN;
  assert.equal(hasFacebookToken(), false);
  cleanupToken();
});

test('hasFacebookToken returns true when env var is set', (t) => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'test_token_abc';
  assert.equal(hasFacebookToken(), true);
  cleanupToken();
});

test('fetchFacebookAdSignals returns null when token is absent', async () => {
  delete process.env.FB_ADLIB_ACCESS_TOKEN;
  const result = await fetchFacebookAdSignals({ name: 'Instagram', countries: ['US'] });
  assert.equal(result, null);
  cleanupToken();
});

test('fetchFacebookAdSignals returns null when name is empty', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'test_token';
  const result = await fetchFacebookAdSignals({ name: '', countries: ['US'] });
  assert.equal(result, null);
  cleanupToken();
});

test('fetchFacebookAdSignals parses active vs inactive ads and picks latest start date', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'mock_token_xyz';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { ad_active_status: 'ACTIVE',   ad_delivery_start_time: '2026-01-15T00:00:00Z', page_name: 'Acme' },
        { ad_active_status: 'ACTIVE',   ad_delivery_start_time: '2026-03-20T00:00:00Z', page_name: 'Acme' },
        { ad_active_status: 'INACTIVE', ad_delivery_start_time: '2025-11-01T00:00:00Z', page_name: 'Acme' },
        { ad_active_status: 'INACTIVE', ad_delivery_start_time: '2025-06-01T00:00:00Z', page_name: 'Acme' },
      ]
    })
  });

  const result = await fetchFacebookAdSignals({ name: 'Acme App', countries: ['US'] });
  globalThis.fetch = originalFetch;
  cleanupToken();

  assert.equal(result.source, 'facebook-ad-library');
  assert.equal(result.totalAds, 4);
  assert.equal(result.activeAds, 2);
  assert.equal(result.lastActiveAt, '2026-03-20T00:00:00.000Z', 'should pick most recent active start');
});

test('fetchFacebookAdSignals returns null when API returns non-ok status', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'bad_token';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid token' } }) });

  const result = await fetchFacebookAdSignals({ name: 'SomeBrand Unique 99z', countries: ['TR'] });
  globalThis.fetch = originalFetch;
  cleanupToken();

  assert.equal(result, null);
});

test('fetchFacebookAdSignals returns null and does not throw when fetch throws', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'throw_token';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => { throw new Error('network error'); };

  const result = await fetchFacebookAdSignals({ name: 'NetworkFailApp 77x', countries: ['DE'] });
  globalThis.fetch = originalFetch;
  cleanupToken();

  assert.equal(result, null);
});

test('fetchFacebookAdSignals handles zero active ads (all inactive)', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'mock_zero';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { ad_active_status: 'INACTIVE', ad_delivery_start_time: '2025-01-01T00:00:00Z', page_name: 'Brand' },
      ]
    })
  });

  const result = await fetchFacebookAdSignals({ name: 'ZeroActiveApp 44q', countries: ['FR'] });
  globalThis.fetch = originalFetch;
  cleanupToken();

  assert.equal(result.totalAds, 1);
  assert.equal(result.activeAds, 0);
  assert.equal(result.lastActiveAt, null);
});

test('fetchFacebookAdSignals handles empty data array', async () => {
  process.env.FB_ADLIB_ACCESS_TOKEN = 'mock_empty';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });

  const result = await fetchFacebookAdSignals({ name: 'EmptyResultApp 55r', countries: ['JP'] });
  globalThis.fetch = originalFetch;
  cleanupToken();

  assert.equal(result.totalAds, 0);
  assert.equal(result.activeAds, 0);
  assert.equal(result.lastActiveAt, null);
});
