# OwlASO v1.7.0 — Release Notes (Draft)

> **Draft — not published.** Generated on 2026-11-05 from changes since `v1.6.0`.
> Proposed version: **1.7.0** (new feature: localization). `package.json` is still at
> `1.6.0`, and no `v1.7.0` tag exists yet.

## Highlights

- **Türkçe arayüz** — the whole interface is now available in English and Turkish.
  Pick **Settings → Language** to switch instantly, with no reload. The choice is
  saved and restored before first paint, dates are formatted for the selected
  locale (`en-US` / `tr-TR`), and the guided tour, help tooltips and contextual
  tips are translated too. Untranslated strings fall back to English.
- **New icon and reliable Windows taskbar icon** — OwlASO has a new minimal
  monochrome icon. The desktop app now sets an explicit AppUserModelID, bundles
  `icon.ico` as a resource, passes an explicit window icon, and serves the
  favicon with `no-store`, so Windows can no longer keep showing the old icon
  from its cache after an update.
- **Demo assets** — the repository now includes a Remotion demo-video project
  plus Playwright scripts that capture screenshots and a live session. These are
  development-only and are not shipped in the app.

## Fixes

- `.woff2` files are served with the correct `font/woff2` MIME type, so the
  bundled Inter / Geist Mono fonts load correctly in web mode.
- Window background color now matches the refreshed light / dark palette,
  avoiding a flash of the old surface color on launch.

## Documentation and repository

- `SECURITY.md` consolidated into a single security-model document.
- Added issue and pull request templates.
- README cleanup; removed the Windows release workflow and the old release
  notes file (releases are built manually now).

## Assets

No builds have been produced for this draft yet. Installers can be generated
locally and appear in `dist/`:

```bash
npm run dist:win      # Windows NSIS installer (x64)
npm run dist:mac      # macOS DMG (arm64 + x64)
npm run dist:linux    # Linux AppImage
```

## Notes

- Rank history and settings remain local-only.
- Google Play data still depends on `google-play-scraper`; Google layout changes
  can break or throttle it. Apple shares at most ~500 reviews per storefront.
- The application version has not been bumped yet.

## Publishing checklist

1. Bump the version in `package.json` to `1.7.0` (and update `package-lock.json`).
2. Build and smoke-test the installers.
3. Commit the version bump and these notes.
4. Tag `v1.7.0` and push the commit and tag.
5. Create the GitHub release from this file as a **draft** until the assets are
   uploaded and verified.
