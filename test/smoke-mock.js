import { spawn } from 'node:child_process';

const port = 3333;
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), MOCK_STORE_DATA: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWhenReady(url, retries = 30) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error('Server did not become ready');
}

async function fetchTextWhenReady(url, retries = 30) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error('Server did not become ready');
}

try {
  const health = await fetchJsonWhenReady(`http://localhost:${port}/api/health`);
  if (!health.ok || !health.mock) throw new Error('Health check failed');

  const root = await fetchTextWhenReady(`http://localhost:${port}/`);
  if (!root.includes('OwlASO')) throw new Error('Static root failed');

  const fallback = await fetchTextWhenReady(`http://localhost:${port}/deep/link/path`);
  if (!fallback.includes('OwlASO')) throw new Error('Static SPA fallback failed');

  const search = await fetchJsonWhenReady(`http://localhost:${port}/api/search?platform=all&q=instagram&country=us&lang=en&limit=200`);
  if (!Array.isArray(search.results) || search.results.length < 4) throw new Error('Mock broad search failed');

  const reviews = await fetchJsonWhenReady(`http://localhost:${port}/api/reviews?platform=google&appId=com.instagram.android&stars=1&keyword=crash`);
  if (!Array.isArray(reviews.reviews) || reviews.reviews.length !== 1) throw new Error('Mock review filtering failed');

  const reviewsBoth = await fetchJsonWhenReady(`http://localhost:${port}/api/reviews?platform=both&appId=com.example.app&appPlatform=google&title=Example&stars=1,2,3,4,5`);
  if (!Array.isArray(reviewsBoth.reviews) || reviewsBoth.reviews.length !== 6 || reviewsBoth.platform !== 'both') throw new Error('Mock both-store parallel merge failed');

  const aso = await fetchJsonWhenReady(`http://localhost:${port}/api/asosearch?q=instagram&store=both&country=us&lang=en&limit=12`);
  if (!aso.keyword || !Array.isArray(aso.apps) || !aso.apps.length) throw new Error('ASO search: missing keyword or apps');
  if (typeof aso.metrics?.popularity !== 'number') throw new Error('ASO search: metrics.popularity must be a number');
  if (typeof aso.metrics?.difficulty !== 'number') throw new Error('ASO search: metrics.difficulty must be a number');
  if (!Array.isArray(aso.similar)) throw new Error('ASO search: similar keywords must be an array');
  if (aso.competitorKeywords && !Array.isArray(aso.competitorKeywords)) throw new Error('ASO search: competitorKeywords must be an array');

  console.log('Mock smoke test passed. Server, routes, broad app search, static files, filters, both-store merge, and ASO keyword analysis work.');
  process.exitCode = 0;
} catch (error) {
  console.error(error);
  if (stdout.trim()) console.error(`server stdout:\n${stdout}`);
  if (stderr.trim()) console.error(`server stderr:\n${stderr}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
