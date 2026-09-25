# OwlASO ASO Keyword Tracking & App Store Review Analytics

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**OwlASO** is a desktop (and local web) app for ASO keyword research and app store review monitoring across **Google Play** and the **App Store**.

- **Keywords** — popularity, difficulty and opportunity scores, the apps ranking for a keyword, similar keywords, and the keywords competitors also rank for
- **Rank tracking** — the position of the app selected in the sidebar for every keyword, per store, with a daily history (trend arrows and charts)
- **Reviews** — both stores in one table (store column per review), instant keyword/star filtering with highlighted matches, compare up to 5 apps (Ctrl/⌘-click)
- **Full data** — every reachable review across stores and languages, streamed as it loads, with rating distribution and top terms
- **Export** — CSV (UTF-8 with BOM, formula-injection safe) for keywords, reviews and full data; JSON for full data
- **Desktop** — Windows (NSIS), macOS (DMG) and Linux (AppImage) installers via Electron; light/dark/system theme

> Landing page: <https://owlaso.github.io> — Source: <https://github.com/owlaso/owlaso>

## How the numbers are made

| Metric | How OwlASO computes it |
|---|---|
| Popularity (0–100) | Proxy from the ranking apps: breadth of results, rating volume (log scale), average rating, share of apps with ads (`src/aso.js`) |
| Difficulty (0–100) | Share of "authority" apps (≥50K ratings), apps with ads, strong ratings (≥4★) and result breadth |
| Opportunity | `popularity × (100 − difficulty) / 100` |
| Position | Rank of your selected app in the store's search results for the keyword (top 50 per store) |
| History | One snapshot per keyword × store × country × language per day (kept for 180 days) |
| Competitor keywords | Related searches are probed and the top apps that actually appear in their results are recorded |

These are free, public-data estimates — not Apple Search Ads' first-party popularity data.

## Reality check

Apple data comes from the public iTunes Search API and customer-review RSS feed (capped by Apple at ~500 reviews per storefront). Google Play has no official public reviews API, so OwlASO uses [`google-play-scraper`](https://github.com/facundoolano/google-play-scraper); Google layout changes can break it, and Google may throttle requests. OwlASO caches results, coalesces duplicate requests, retries with backoff (honouring `Retry-After`) and only falls back to HTML scraping when the scraper fails — but please do not hammer the stores.

## Requirements

- Node.js 22.12+
- Internet access from the machine running the app

## Install & run

```bash
npm install
npm start            # web mode → http://localhost:3000
npm run dev          # web mode with auto-restart
npm run electron     # desktop mode
```

## Build installers

```bash
npm run dist:win      # Windows NSIS installer
npm run dist:mac      # macOS DMG (arm64 + x64)
npm run dist:linux    # Linux AppImage
```

Outputs land in `dist/`.

## Usage

1. **Add apps** — click **+** in the sidebar and search by name, package name (`com.spotify.music`) or App Store id (`324684580`). Apps found on both stores are merged into one entry.
2. **Keywords** — type a keyword and press Enter. The analyzed keyword and 5 similar ones are scored; the **Position** column shows where the selected app ranks on each store. Click a row for details, trend charts and competitor keywords.
3. **Reviews** — select an app. Filter by keyword (all words must match) and star range instantly; change store, country, language or the fetch size to load new data. **Load more** raises the fetch size. **Full data** pulls everything in every language.
4. **Export** — `Ctrl/⌘+E` exports what you are looking at as CSV.

Shortcuts: `/` focus search · `A` add app · `←/→` previous/next review · `Esc` close dialog.

## Security model

- The web server binds to **127.0.0.1** by default. Requests whose `Host` is not `localhost`/an IP literal are rejected (DNS-rebinding protection) and cross-site browser requests to `/api/*` are refused (CSRF protection).
- Strict Content-Security-Policy, `nosniff`, `frame-ancestors 'none'`, no inline scripts.
- The Electron renderer is sandboxed with context isolation; only `http(s)` links are opened externally, in-app navigation away from the app is blocked, and permission requests are denied.
- Rank-history files are named from a hash of the query, so request parameters can never pick the file path.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `HOST` | `127.0.0.1` | Bind address. Exposing on a LAN also needs `ALLOWED_HOSTS` if you use a hostname |
| `ALLOWED_HOSTS` | — | Comma-separated extra hostnames accepted in the `Host` header |
| `RANK_HISTORY_DIR` | `data/rank-history` (desktop: user data folder) | Where keyword history is stored |
| `DISABLE_RANK_HISTORY` | — | `1` disables history |
| `SEARCH_CACHE_TTL_MS` / `REVIEW_CACHE_TTL_MS` / `DETAILS_CACHE_TTL_MS` | 5 / 5 / 15 min | Cache lifetimes |
| `CACHE_MAX_WEIGHT` | `100000` | Cache size bound (≈ number of cached rows) |
| `DISABLE_CACHE` | — | `1` disables caching |
| `MOCK_STORE_DATA` | — | `1` serves built-in demo data (no network) |
| `FB_ADLIB_ACCESS_TOKEN` | — | Optional Meta Ad Library token for ad signals |

## Validation

```bash
npm test              # unit + integration tests (no network)
npm run smoke:mock    # boots the server with demo data and hits every route
npm run smoke:live    # real Apple/Google calls — needs internet, can fail on throttling
```

## API

All endpoints are `GET` and return JSON unless noted. Invalid input returns `400`.

| Endpoint | Parameters |
|---|---|
| `/api/health` | — (returns `version`, `mock`) |
| `/api/search` | `q`, `platform=all\|google\|apple`, `country`, `lang`, `limit` |
| `/api/asosearch` | `q`, `store=both\|google\|apple`, `country`, `lang`, `lite=1` (skip competitor probes + history) |
| `/api/asosearch/history` | `q`, `store`, `country`, `lang` → daily snapshots incl. per-store rankings |
| `/api/app-details` | `appId`, `platform`, `appId2`, `store=both`, `country`, `lang` |
| `/api/reviews` | `appId`, `platform=google\|apple\|both`, `appPlatform`, `appId2`, `title`, `developer`, `country`, `lang` (`all` = multi-language), `max`, `sort`, filters: `stars`, `minRating`, `maxRating`, `allKeywords`, `anyKeyword`, `keyword`, `dateFrom`, `dateTo`, `version`, `minLength`, `replyOnly` |
| `/api/reviews.csv` | Same as `/api/reviews`; CSV download |
| `/api/reviews.full.stream` | `appId`, `platform`, `appPlatform`, `appId2`, `title`, `country` → NDJSON: `group` lines, then `done` |
| `/api/reviews.full` | Same, as one JSON document |

`appPlatform` tells the server which store `appId` belongs to (inferred from the id format when omitted). `appId2` pins the listing on the other store; without it the counterpart is looked up by `title` (+ `developer`) and only accepted on a confident match.

## Patch notes

### 1.6.0

- **Security**: fixed path traversal in rank-history writes (`store` parameter), a crash on malformed `Host` headers, CSRF/DNS-rebinding exposure of the local API, CSV formula injection and a broken CSV quote in full-data exports; added CSP and security headers, Electron sandboxing, navigation/permission lockdown and an `http(s)`-only external-link allowlist; upgraded Electron 31 → 44 and electron-builder 24 → 26 (0 known vulnerabilities).
- **Correctness**: "All stores" now really fetches both stores (the app's store and known counterpart are sent to the server); the Add-app modal searches both stores; ranks come from real search order (they used to follow request completion order); Position is your app's rank instead of an average; history is keyed by country and language, one snapshot per day, and no longer collides for non-Latin keywords; counterpart matching no longer falls back to unrelated apps; unrated listings no longer drag ratings down; duplicate reviews are removed by store review id; App Store reviews are fetched once per storefront; "Show more", Escape handling and stale-response races fixed.
- **Performance**: shared, size-bounded cache with request coalescing; far fewer store requests per keyword analysis (App Store search already carries listing details, similar-keyword rows skip competitor probes, HTML fallback only when needed); review filtering is instant and local.
- **UX**: Keywords/Reviews tabs with a contextual filter bar, store column and match highlighting in reviews, multi-app comparison, review navigation with ←/→, toasts with undo, keyboard support and screen-reader labels throughout, trend charts, better empty/error states with retry, dark-mode flash fix, native Edit menu on macOS.
- One shared API router for the web server and the desktop app (the desktop app was missing the history route).
