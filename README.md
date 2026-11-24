# Weight — personal, local-first gym log (PWA)

Weight is an installable web app for iPhone (iOS 17+, tested target iOS 27) that keeps a training plan, exercise library and workout history **on the device only**. There is no account, server, analytics or network access: the build's content-security policy allows `connect-src 'self'` only.

> **This public repository contains code and generic exercise content only.** Personal data (training plan, logged sessions, body measurements, requirements docs) is never committed. It reaches the phone as a separate import file opened inside the installed app.

## Status
**Phase 1 — Foundation, library, programs, import, backup.** Workout logging (Phase 2), analytics and charts (Phase 3) and later modules follow the roadmap.

| Area | In this build |
|---|---|
| App shell | Today · History · Library · Progress · More; bottom tabs on phones, left rail ≥ 1024 px; dark (default) / light / system theme |
| Offline & install | Service worker precache, works in airplane mode, Home-Screen manifest and icons, safe update prompt (never during a workout), persistent-storage request and usage display |
| Data | IndexedDB (Dexie) schema v1 with 24 stores, versioned migrations with automatic pre-upgrade snapshot and a recovery screen |
| Library | 154 exercises in 14 categories, English + Arabic names, instructions, mistakes, safety and knee tags, load modes, alternatives, search (incl. Arabic), filters, custom exercises, rename, merge, archive, personal notes, per-exercise weight step |
| Videos | Verified YouTube links only (title, channel and date recorded); otherwise a YouTube **search** link; user-added links validated |
| Programs | Programs (one active), duplicate, templates with per-week sets, reps, rest, superset, notes; drag-and-drop and button reorder; warm-ups; weekly pattern, changed days, planned dates, week phases with target RPE |
| Notion import | Validated import file (schema + SHA-256), preview, one-transaction write, idempotent re-import, resolution of ambiguous exercises, migration report |
| Backup | ZIP (manifest with SHA-256 for every file, `data.json`, CSV copies) via share sheet or download; validated atomic restore with snapshot; identical-backup detection; reminders |

## Use it on the iPhone
1. Open the hosted URL in **Safari** → Share → **Add to Home Screen** (keep *Open as Web App* on) → Add.
2. Open **Weight** from the Home Screen.
3. More → **Import from Notion** → choose the `weight-import-….json` file (saved in Files) → Import now.
4. More → Data migration → choose the equipment for any exercise marked *Needs decision*.
5. More → **Backup & restore** → Back up now, and save the ZIP to Files or iCloud Drive. The app reminds you after 7 days.

Safari and the Home-Screen app keep **separate** storage: import inside the installed app.

## Hosting (free)
The build in `dist/` is a static site that works from any sub-path (relative URLs + hash routing).

**A. GitHub Pages (automatic, recommended).** Create a public repository, push this code, then Settings → Pages → Source: *GitHub Actions*. `.github/workflows/ci.yml` lints, type-checks, tests (unit, integration, Playwright on Chromium and WebKit), audits, builds and deploys every push to `main`. The site appears at `https://<user>.github.io/<repo>/`.

**B. Drag-and-drop.** Run `npm run build` (or use a provided `dist` ZIP) and upload the folder to Cloudflare Pages (*Create → Pages → Upload assets*) or Netlify Drop. Both are free and HTTPS.

## Development
```bash
npm ci
npm run dev          # http://localhost:5173
npm run check        # lint + i18n check + strict type-check + unit/integration tests + build (bundle budget) + runtime audit
npm run e2e          # Playwright; serves dist/ under /weight-app/ like GitHub Pages
```
Requirements: Node 22. End-to-end tests run on an iPhone-sized Chromium, desktop Chromium and (in CI) WebKit. Without a personal import file they use a synthetic test fixture.

## Structure
```
src/
  app/          shell, theme (design tokens), DB context, recovery screen
  components/   design-system components (NumberStepper, SetRow, ExerciseCard, RestTimerBar, StatCard, EmptyState, ConfirmSheet), banners, exercise picker
  db/           types, Dexie schema + versions, safe open/snapshot/restore, seed, repositories
  domain/       units, rounding/increments, e1RM, dates (local date rule), schedule, search, hashing, UUID v7, YouTube URL rules
  features/     today, history, library, programs, import, backup, settings/storage, more, dev gallery
  i18n/         UI dictionary (every UI string; checked by scripts/check-i18n.mjs)
  seed/         exercise library (generic content)
tests/          unit + integration (fake-indexeddb)
e2e/            Playwright end-to-end tests
scripts/        i18n check, bundle budget, static server
```

## Privacy and safety rules built in
- No network requests from app code (ESLint blocks `fetch`; CSP blocks other origins). Videos open in YouTube or Safari.
- Never an invented video URL: the seed test fails if any URL lacks a verification record.
- Imports and restores are validated completely before any write, and are written in one transaction.
- Progress photos (later phase) stay in IndexedDB on the device and are only included in your own backup ZIP.
