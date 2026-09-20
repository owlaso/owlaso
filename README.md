# OwlASO — ASO Keyword Tracking & App Store Review Analytics

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**OwlASO** is a desktop (and web) app for ASO keyword analysis and app store review monitoring. Track keyword rankings, popularity and difficulty scores, and monitor user reviews from **Google Play** and the **App Store** — all in one place.

- **Dual-store reviews** — fetch and compare Google Play + App Store reviews side by side, auto-detecting matching apps across stores
- **ASO keyword tracking** — analyze keywords with popularity, difficulty, and opportunity metrics, and see which apps rank for each keyword
- **Advanced filtering** — platform, country/storefront, language, star rating, sort order, date range, app version, keyword, minimum review length, developer replies
- **Export** — filtered reviews as CSV or JSON with one click
- **Cross-platform** — native installers for Windows, macOS, and Linux (Electron)
- **Dark mode** — manual toggle, persisted, defaults to OS preference

> Landing page: <https://owlaso.github.io> — Source: <https://github.com/owlaso/owlaso>

## Features

| Feature | Apple Search Ads | OwlASO (ours) |
|---|---|---|
| Popularity | Apple's own Search Ads popularity score — first-party search-volume data | Proxy: breadth + review volume + ratings (src/aso.js:150) |
| Difficulty | Computed for "ranking in top 10" feasibility per term | Heuristic: authority + ads + strong ratings + breadth (src/aso.js:157) |
| Rank tracking | Daily, 60+ App Store regions, position history charts | None — snapshot per search |
| Competitor keywords | Extracts what competitors actually rank for | Generates similar keywords from title phrases + modifiers (src/aso.js:61) — not real ranking data |
| Stores | Apple only | Both stores + review monitoring |
| Price | $9/mo | Free, self-hosted |

## Reality check

Apple review fetching uses public iTunes/RSS endpoints. Google Play does **not** provide a simple public official reviews API, so this app uses `google-play-scraper`. The upstream project warns that Google Play layout changes can break parsers. This app adds a search fallback, but Google reviews can still be throttled or broken by store-side changes.

For production-scale/commercial scraping, add caching, backoff, request queues, and a compliant data provider. Do not hammer the stores.

## Requirements

- Node.js 20+
- Internet access from the machine running the app

Tested locally in this package with:

```bash
npm test
npm run smoke:mock
```

`npm run smoke:live` needs outbound internet from your own machine. The build sandbox used to package this app blocks live Apple/Google fetches, so live validation must run on your Windows box.

## Install

```bash
npm install
```

## Run

Web mode:

```bash
npm start
```

Dev mode (auto-restart on change):

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Desktop mode (Electron):

```bash
npm run electron
```

## Build installers

```bash
npm run dist:win      # Windows NSIS installer
npm run dist:mac      # macOS DMG (arm64 + x64)
npm run dist:linux    # Linux AppImage
```

Outputs land in `dist/`. `electron-builder` packages `src/`, `public/`, and `electron/`.

## Usage

1. Pick **Google Play**, **App Store**, or **All**.
2. Set **Max app results per store**. Default is 200. Google is capped at 250; Apple public search is capped at 200.
3. Search for an app. The result list now returns the broadest related-app set exposed by the public endpoints instead of only a small top-result slice.
4. Click **Use** on a result. The selected app id/platform are copied into the review filters and the filter panel is highlighted.
   - Google Play id example: `com.instagram.android`
   - App Store id example: `389801252`
5. Set filters.
6. Click **Fetch reviews**.
7. Use **Export CSV** or **Export JSON** for the currently filtered table.

To see Google Play and App Store reviews side by side in one table: pick a result with **Use**, switch **Review platform** to **Both stores**, and click **Fetch reviews**. The server auto-detects the matching app on the other store by title (paste an id in **Second app id** to override) and fetches both stores **in parallel**, merging them into one view tagged per store.

### ASO keyword analysis

Type a keyword into the ASO view to get per-store ranking apps plus computed **popularity**, **difficulty**, and **opportunity** metrics, along with similar-keyword suggestions — handy for picking terms worth targeting on Google Play and the App Store.

## Filters

- Platform
- Country / storefront
- Language
- Star ratings: 1 to 5, multi-select
- Sort order
- Pages / max reviews
- Date from / date to
- App version
- Keyword search in title/body/author/version
- Minimum text length
- With developer reply only

## Validation

Unit tests:

```bash
npm test
```

Mock smoke test, no live store calls:

```bash
npm run smoke:mock
```

Live smoke test, requires internet and can fail if Apple or Google throttles/changes responses:

```bash
npm run smoke:live
```

On npm, custom scripts must be run with `npm run`:

```bash
npm run smoke:live
```

Not:

```bash
npm smoke:live
```

## API

### `GET /api/search`

Query params:

- `platform=google|apple|all`
- `q=instagram`
- `country=us`
- `lang=en`
- `limit=200` / configurable app-search result cap. Apple is capped at 200 per request; Google is best-effort through scraper/search-page results.

### `GET /api/reviews`

Query params:

- `platform=google|apple|both`
- `appId=com.instagram.android` or `appId=389801252`
- `appPlatform=google|apple` — store the primary `appId` belongs to (only used with `platform=both`)
- `title=Instagram` — used to auto-detect the counterpart store id (only used with `platform=both`)
- `appId2=...` — optional override for the counterpart store id (only used with `platform=both`)
- `country=us`
- `lang=en`
- `stars=1,2,3`
- `sort=newest|rating|helpfulness`
- `pages=1`
- `max=200`
- `dateFrom=2026-01-01`
- `dateTo=2026-05-31`
- `version=1.0.0`
- `keyword=crash`
- `minLength=20`
- `replyOnly=true`

### `GET /api/reviews.csv`

Same query params as `/api/reviews`, but returns CSV.

### `GET /api/asosearch`

Query params:

- `keyword=camera`
- `country=us`
- `lang=en`
- `store=google|apple` (optional)

Returns ranking apps per store plus popularity / difficulty / opportunity metrics and similar-keyword suggestions.

## Notes

- App Store review RSS usually returns a limited page of reviews per country/storefront.
- Google Play language/country strongly impacts review availability.
- "All reviews" is not guaranteed for huge apps because stores paginate, localize, throttle, and sometimes cap accessible results.
- The **Use** button writes the selected platform + app id into the review filter form and highlights the selected result.
- App search now requests broad result sets instead of a fixed top-12 list. "Every related app" still depends on what Apple/Google expose publicly for the query/country/language; the app does not invent hidden/private store results.
- If Google search fails but you know the package id, paste it directly, for example `com.spotify.music` or `com.instagram.android`.

## Patch notes

### 1.5.0

- Packaged as a desktop app: native Electron shell with **Windows (NSIS), macOS (DMG), and Linux (AppImage)** installers via `electron-builder`.
- Added **ASO keyword analysis**: keyword search across stores with computed popularity, difficulty, and opportunity metrics plus similar-keyword suggestions.

### 1.4.0

- Added **Both stores** mode: fetch Google Play + App Store reviews in parallel and see them merged in one comment table, tagged per store. The server auto-detects the matching app on the other store from the app title (capped by the in-memory cache), or you can override with a manual **Second app id**. Store lookup failures are surfaced in the summary instead of aborting the other store's fetch.

### 1.3.0

- Added dark mode with a manual sun/moon toggle (persisted in `localStorage`, defaults to the OS preference) plus a full visual refresh: colored rating badges, sticky review table, hover states, focus rings, busy status pulse, and review summary stats (average rating, reply count, app count).
- Scraper hardening:
  - Retries with exponential backoff + jitter on all Apple/Google HTML fetches (handles transient 429 / 5xx throttling and timeouts).
  - Google Play HTML fallback now parses the page's embedded JSON payloads (escaped `\/store\/apps\/details` URLs) so more search results are recovered; detects and reports Google consent interstitials clearly.
  - Google Play app details HTML fallback now reads `application/ld+json` metadata (name, developer, rating, icon) instead of returning blank fields.
  - Google Play review pagination is retried and throttled between pages; Apple review dates are normalized to ISO and both `im:rating` and `rating` field shapes are handled.
  - Added a small in-memory TTL cache for search and review fetches (5 min default) so repeated UI actions do not hammer the stores. Disable with `DISABLE_CACHE=1`; tune with `SEARCH_CACHE_TTL_MS` / `REVIEW_CACHE_TTL_MS`.

### 1.2.0

- Fixed **Use** button wiring by replacing fragile serialized JSON attributes with delegated plain data attributes.
- Added selected-result feedback and filter-panel highlight after using an app result.
- Added broad app-search cap control: default 200 per store, Google max 250, Apple max 200.
- Search API no longer slices combined Google/App Store results down to a tiny top set.
- Added frontend static regression tests for the Use button and broad search cap.