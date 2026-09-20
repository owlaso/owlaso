import { searchApps, fetchReviews } from '../src/providers.js';

async function assertProvider(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}: OK`);
    return result;
  } catch (error) {
    console.error(`${label}: FAILED`);
    console.error(error.message || error);
    throw error;
  }
}

const appleApp = await assertProvider('Apple search', async () => {
  const rows = await searchApps({ platform: 'apple', q: 'Instagram', country: 'us', lang: 'en', limit: 1 });
  if (!rows.length) throw new Error('Apple search returned no apps');
  return rows[0];
});

await assertProvider('Apple reviews', async () => {
  const payload = await fetchReviews({ platform: 'apple', appId: appleApp.appId, country: 'us', lang: 'en', pages: 1, max: 20, stars: '1,2,3,4,5' });
  if (!Array.isArray(payload.reviews)) throw new Error('Apple reviews response invalid');
  return payload;
});

const googleApp = await assertProvider('Google search', async () => {
  let rows = await searchApps({ platform: 'google', q: 'Instagram', country: 'us', lang: 'en', limit: 25 });
  if (!rows.length) rows = await searchApps({ platform: 'google', q: 'com.instagram.android', country: 'us', lang: 'en', limit: 1 });
  if (!rows.length) throw new Error('Google search returned no apps after scraper + HTML/direct package fallback');
  return rows[0];
});

await assertProvider('Google reviews', async () => {
  const appId = googleApp.appId || 'com.instagram.android';
  const payload = await fetchReviews({ platform: 'google', appId, country: 'us', lang: 'en', pages: 1, max: 20, stars: '1,2,3,4,5' });
  if (!Array.isArray(payload.reviews)) throw new Error('Google reviews response invalid');
  return payload;
});

console.log('Live smoke test passed. Apple and Google public-store calls returned valid response shapes.');
