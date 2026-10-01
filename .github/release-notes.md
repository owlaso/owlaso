## Highlights

- **Full data explorer** — every reachable review across both stores and all languages, streamed with live progress. Click-to-filter rating / store / language facets, search, sort, "what users complain about" vs "what users love" terms, per-source status and **Go deeper** when Google Play has more.
- **All countries** — analyze a keyword in all 20 storefronts at once (best markets first), and read reviews from every App Store country plus every Google Play language.
- **Rank tracking** — the Position column shows *your* app's rank per store, with daily history, trend arrows and charts.
- **Guidance** — an 11-step guided tour, help tooltips on every control and column, and one-time contextual tips.
- **Redesigned UI** — Keywords / Reviews tabs, store column and match highlighting in reviews, compare up to 5 apps, ←/→ review navigation, light / dark / system theme.

## Security

- Fixed path traversal in rank-history writes, a crash on malformed `Host` headers, CSRF / DNS-rebinding exposure of the local API, and CSV formula injection.
- Strict Content-Security-Policy and security headers; sandboxed Electron renderer with navigation, permission and external-link lockdown.
- The Meta Ad Library token is no longer accepted in the query string (`FB_ADLIB_ACCESS_TOKEN` env var only).
- Electron 31 → 44, electron-builder 24 → 26 (0 known vulnerabilities).

## Fixes

- "All stores" really fetches both stores; ranks follow the real search order; history is kept per keyword × store × country × language, one snapshot per day.
- Counterpart matching no longer falls back to unrelated apps; duplicate reviews are removed by store review id; unrated listings no longer drag ratings down.
- Faster: shared size-bounded cache with request coalescing, far fewer store requests per analysis, instant local review filtering.

## Assets

- `OwlASO.Setup.1.6.0-beta.1.exe` — Windows installer (x64)
- `owlaso-unpacked-windows.zip` — portable build, unzip and run `OwlASO.exe`

## Notes

- Beta: Google Play parsing can break or throttle when the store changes its layout. Apple shares at most ~500 reviews per country.
- Rank history and settings are stored locally only.
