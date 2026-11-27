# Weight — personal, local-first gym log (PWA)

Weight is an installable web app for iPhone (iOS 17+, tested target iOS 27) that keeps a training plan, exercise library and workout history **on the device only**. There is no account, server, analytics or network access: the build's content-security policy allows `connect-src 'self'` only.

> **This public repository contains code and generic exercise content only.** Personal data (training plan, logged sessions, body measurements, requirements docs) is never committed. It reaches the phone as a separate import file opened inside the installed app.

## Status
**Phases 1–3 built; Phase 3.1 (stabilisation, reliability and UX) implemented and submitted for external review – not closed.** Phase 4 has not started.

| Area | In this build |
|---|---|
| App shell | Today · History · Library · Progress · More; bottom tabs on phones, left rail ≥ 1024 px; dark (default) / light / system theme; WCAG 2.1 AA contrast (axe: 0 violations on 12 screens, both themes) |
| Offline & install | Service worker precache, works in airplane mode, Home-Screen manifest and icons, safe update prompt (never during a workout), persistent-storage request and usage display |
| Data | IndexedDB (Dexie) schema v1, versioned migrations with automatic pre-upgrade snapshot and a recovery screen; workout writes in single transactions; start-up repair (records, stale rest timer) |
| Workout | Set-by-set logging with previous values, compact (default) or expanded layout, exercise navigator, progress bar (exercises, sets, time, pause, finish), docked rest timer with "next", superset rounds, skip-remaining / replace keep completed sets, notes saved while typing |
| Progression | Double progression / linear / RPE strategies, assisted-exercise direction, partial-workout hold, equipment limits, exact plate maths (optional pair counts), "Why?" factors on every suggestion |
| Library | 154 exercises in 14 categories, English + Arabic names, instructions, mistakes, safety and knee tags, load modes, alternatives, search (incl. Arabic), filters, custom exercises, rename, merge, archive, personal notes, per-exercise weight step |
| Videos | Verified YouTube links only ("Watch form"); otherwise a labelled YouTube **search** ("Find form video"); user-added links validated |
| Programs | Programs (one active), duplicate, templates with per-week sets, reps, rest, superset, notes; reorder; warm-ups; weekly pattern, changed days, planned dates, week phases with target RPE; logged workouts keep the name they were done under |
| History & progress | History list (paged) and calendar, session detail, compare, repeat; charts, records, muscle volume, dashboard and recommendations |
| Notion import | Validated import file (schema + SHA-256), preview, one-transaction write, idempotent re-import, resolution of ambiguous exercises, migration report |
| Backup | ZIP (manifest with SHA-256 for every file, `data.json`, CSV copies) via share sheet or download; restore validates size limits, checksums, every row, every relationship and versions before one atomic write with a snapshot |

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
E2E_FIXTURE=1 npx playwright test                     # force the synthetic fixture (what CI runs)
PERF=1 npx playwright test e2e/perf.spec.ts --project=chromium-iphone   # 1,000 workouts / 50,000 sets / 5 years (synthetic)
E2E_FIXTURE=1 npx playwright test e2e/a11y.spec.ts    # axe-core WCAG 2.1 A/AA, dark + light
```
Requirements: Node 22. End-to-end tests run on an iPhone-sized Chromium, desktop Chromium and (in CI) WebKit. Without a personal import file they use a synthetic test fixture. CI also runs the dependency audit (shipped code blocks at moderate), the synthetic performance run and keeps the audit reports as artifacts; GitHub Actions are pinned to commit SHAs and updated by Dependabot.

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
tests/          unit + integration (fake-indexeddb); tests/perf = synthetic large data set
e2e/            Playwright end-to-end tests
scripts/        i18n check, bundle budget, static server
```

## Privacy and safety rules built in
- No network requests from app code (ESLint blocks `fetch`; CSP blocks other origins). Videos open in YouTube or Safari.
- Never an invented video URL: the seed test fails if any URL lacks a verification record.
- Imports and restores are validated completely before any write, and are written in one transaction.
- Progress photos (later phase) stay in IndexedDB on the device and are only included in your own backup ZIP.
