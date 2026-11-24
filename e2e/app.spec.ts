import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { assertHitAreas, assertNamed, doImport, firstSet, fresh, importFile, importStats } from './helpers';

const shot = (name: string) => `test-results/screens/${test.info().project.name}/${name}.png`;

test.describe('Shell, offline, install', () => {
  test('FND-05 AC1: 5-tab bottom navigation on a phone; no console/CSP errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await fresh(page);
    const nav = page.getByTestId('nav-tabbar');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveText(['Today', 'History', 'Library', 'Progress', 'More']);
    await expect(page.getByText('No active program yet')).toBeVisible();
    await expect(page.getByTestId('install-banner')).toBeVisible(); // PWA-01 AC2 (not installed)
    await page.screenshot({ path: shot('01-today-empty'), fullPage: true });
    for (const tab of ['History', 'Library', 'Progress', 'More']) { await nav.getByRole('link', { name: tab }).click(); await expect(page.locator('h2').first()).toBeVisible(); }
    expect(errors).toEqual([]);
  });

  test('FND-05 AC1 @desktop: left rail from 1024 px', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium-desktop');
    await fresh(page);
    await expect(page.getByTestId('nav-rail')).toBeVisible();
    await expect(page.getByTestId('nav-tabbar')).toHaveCount(0);
    await page.screenshot({ path: shot('rail') });
  });

  test('PWA-01: manifest, icons and Apple meta are served', async ({ page, request }) => {
    await fresh(page);
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    const m = await (await request.get(new URL(href!, page.url()).toString())).json();
    expect(m).toMatchObject({ name: 'Weight', short_name: 'Weight', display: 'standalone', start_url: './', scope: './', theme_color: '#0E1116' });
    for (const i of m.icons) expect((await request.get(new URL(i.src, page.url()).toString())).status()).toBe(200);
    expect(await page.locator('link[rel=apple-touch-icon]').count()).toBe(1);
    expect(await page.locator('meta[name=apple-mobile-web-app-capable]').getAttribute('content')).toBe('yes');
    const csp = await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
    expect(csp).toContain("connect-src 'self'");
  });

  test('PWA-02: works offline after first load (cold start ≤ 2 s)', async ({ page, context }) => {
    await fresh(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); // controlled by the SW now
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    const t0 = Date.now();
    await page.reload();
    await expect(page.getByTestId('today-date')).toBeVisible();
    const ms = Date.now() - t0;
    console.log(`offline cold start: ${ms} ms`);
    expect(ms).toBeLessThan(2000);
    await page.getByRole('link', { name: 'Library' }).click();
    await page.getByTestId('library-search').fill('plank');
    await expect(page.getByTestId('library-item').first()).toContainText('Plank');
    await page.getByTestId('library-item').first().click();
    await expect(page.getByText('How to do it')).toBeVisible(); // LIB-03 offline instructions
    await expect(page.getByText('Needs internet').first()).toBeVisible();
    await context.setOffline(false);
  });

  test('BAK-05: when the database cannot be opened the recovery screen appears, never a blank page', async ({ page }) => {
    // Force IndexedDB to fail for the app database (upgrade failures themselves are covered by tests/integration/db.test.ts)
    await page.addInitScript(() => {
      const orig = indexedDB.open.bind(indexedDB);
      indexedDB.open = ((name: string, v?: number) => { if (name === 'weight') throw new DOMException('Forced failure for test', 'UnknownError'); return orig(name, v); }) as typeof indexedDB.open;
    });
    await page.goto('./?e2e');
    await expect(page.getByTestId('recovery-screen')).toBeVisible();
    await expect(page.getByText('Forced failure for test')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export raw data (JSON)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore last snapshot' })).toBeVisible();
    await page.screenshot({ path: shot('recovery') });
    await assertHitAreas(page);
  });
});

test.describe('Notion import and the plan', () => {
  test('MIG-01/02/04 + PROG-03/04/05: import, resolve, Today, idempotency', async ({ page }) => {
    await fresh(page);
    const f = await doImport(page);
    const stats = f.real ? importStats() : null;
    if (f.real) {
      for (const [k, v] of Object.entries({ programs: 1, templates: 5, templateRows: stats.templateRows, plannedSessions: 20, sessions: 2, sets: 45, unresolved: 3, legacy: 0 })) await expect(page.getByTestId(`count-${k}`)).toHaveText(String(v));
    }
    await page.screenshot({ path: shot('02-import-preview'), fullPage: true });
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    const cards = page.getByTestId('unresolved-card');
    await expect(cards).toHaveCount(f.real ? 3 : 1);
    await page.screenshot({ path: shot('03-import-done'), fullPage: true });

    // MIG-02: map the chest-supported row to the dumbbell version
    const row = cards.filter({ hasText: 'Chest-supported row' });
    await row.getByTestId('cand-chest_supported_row_db').click();
    await row.getByTestId('map-unresolved_chest_supported_row').click();
    await expect(row.getByTestId('mapped-text')).toContainText('Chest-Supported Dumbbell Row');

    // MIG-04: second import = nothing added
    await doImport(page);
    await expect(page.getByTestId('import-state')).toHaveText('Already imported – nothing was added.');
    await expect(page.getByTestId('import-confirm')).toHaveCount(0);

    // PROG-03: Today 24 Nov = Conditioning (Week 1); 22 Nov = skipped; PROG-04: 1 Dec = Week 2 · Build
    await page.goto('./?e2e&date=2026-11-24#/?date=2026-11-24');
    await expect(page.getByTestId('today-template')).toHaveText('Conditioning');
    await expect(page.getByTestId('week-phase')).toContainText('Week 1 · Re-entry');
    await page.goto('./?e2e#/?date=2026-11-22');
    await expect(page.getByText('Rest day')).toBeVisible();
    await page.goto('./?e2e#/?date=2026-12-01');
    await expect(page.getByTestId('week-phase')).toContainText('Week 2 · Build · RPE');
    await page.goto('./?e2e#/?date=2026-11-29');
    await expect(page.getByTestId('today-template')).toHaveText('Upper A');
    if (f.real) await expect(page.getByTestId('today-exercise')).toHaveCount(11);
    await expect(page.getByTestId('today-exercise').first()).toContainText('4 sets'); // week-2 set count for bench
    // OPT-01 warm-up checklist (PROG-05)
    const items = page.getByTestId('warmup-item');
    if (f.real) await expect(items).toHaveCount(7);
    await items.first().click();
    await expect(page.getByText(/^1\/\d+ done$/)).toBeVisible();
    await page.screenshot({ path: shot('04-today-upper-a-w2'), fullPage: true });
    await assertHitAreas(page);
    await assertNamed(page);

    // remaining unresolved banner + history from Notion
    if (f.real) await expect(page.getByTestId('unresolved-banner')).toContainText('2 exercises');
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByTestId('history-session')).toHaveCount(f.real ? 2 : 1);
    await page.getByTestId('history-session').last().getByRole('button').click();
    await expect(page.getByText(firstSet(f.path).kg)).toBeVisible();
    await page.screenshot({ path: shot('05-history'), fullPage: true });
    await page.getByRole('link', { name: 'Progress' }).click();
    await page.screenshot({ path: shot('06-progress'), fullPage: true });
    await page.goto('./?e2e#/migration');
    await expect(page.getByTestId('migration-report')).toBeVisible();
    await page.screenshot({ path: shot('07-migration-report'), fullPage: true });
  });

  test('PROG-02: template editor – edit targets, drag + button reorder, add from library; PROG-01 duplicate', async ({ page }) => {
    await fresh(page);
    await doImport(page);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    await page.goto('./?e2e#/programs');
    await page.getByTestId('program-item').first().click();
    await expect(page.getByTestId('week-row')).toHaveCount(4);
    await page.screenshot({ path: shot('08-program'), fullPage: true });
    await page.getByTestId('template-item').filter({ hasText: 'Upper A' }).click();
    const rows = page.getByTestId('template-row');
    const name = (i: number) => rows.nth(i).getByTestId('row-name');
    const first = (await name(0).textContent())!, second = (await name(1).textContent())!;
    if (importFile().real) await expect(rows.nth(0).getByTestId('row-meta')).toHaveText('3/4/4/4 × 6-8 · Rest 120s'); // PROG-02 AC3 identical to Notion
    // button reorder
    await rows.nth(0).getByTestId('row-down').click();
    await expect(name(0)).toHaveText(second);
    await expect(name(1)).toHaveText(first);
    // drag reorder (dnd-kit, pointer)
    const handle = rows.nth(1).locator('.w-drag-handle');
    const target = await rows.nth(0).boundingBox();
    const hb = await handle.boundingBox();
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y - 10, { steps: 5 });
    await page.mouse.move(hb!.x + hb!.width / 2, target!.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect(name(0)).toHaveText(first);
    // persisted (wait for the IndexedDB write to commit, then reload)
    await expect.poll(() => page.evaluate(async (n) => { const db = (window as any).__weightDb; const rows = (await db.templateExercises.toArray()).filter((r: any) => r.orderIndex === 1); const ex = await db.exercises.bulkGet(rows.map((r: any) => r.exerciseId)); return ex.some((e: any) => e?.name === n); }, first)).toBe(true);
    await page.reload();
    await expect(name(0)).toHaveText(first);
    // edit targets
    await page.getByTestId('template-row').nth(0).getByTestId('row-edit').click();
    await page.getByTestId('row-reps').fill('5-7');
    await page.getByTestId('row-rest').fill('150');
    await page.getByTestId('row-save').click();
    await expect(page.getByTestId('template-row').nth(0).getByTestId('row-meta')).toContainText('× 5-7 · Rest 150s');
    // add from library
    const n = await page.getByTestId('template-row').count();
    await page.getByTestId('add-exercise').click();
    await page.getByPlaceholder('Search exercises, muscles, Arabic names').fill('face pull');
    await page.getByTestId('picker-item').first().click();
    await expect(page.getByTestId('template-row')).toHaveCount(n + 1);
    await page.screenshot({ path: shot('09-template-editor'), fullPage: true });
    await assertHitAreas(page);
    // warm-up editable
    await page.getByTestId('edit-warmup').click();
    await page.getByTestId('save-warmup').click();
    // duplicate program → draft
    await page.goto('./?e2e#/programs');
    await page.getByTestId('program-item').first().click();
    await page.getByTestId('program-menu').click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.getByText('Draft')).toBeVisible();
  });
});

test.describe('Library', () => {
  test('LIB-02/03/05/07/08: search, filter, detail, video fallback, custom link, custom exercise, rename', async ({ page }) => {
    await fresh(page, '/library');
    await page.getByTestId('library-search').fill('pushdown');
    await expect(page.getByTestId('library-item').first()).toContainText('Cable Rope Triceps Pushdown');
    await page.getByTestId('library-search').fill('الترايسبس');
    await expect(page.getByTestId('library-item').filter({ hasText: 'Cable Rope Triceps Pushdown' })).toHaveCount(1);
    await page.getByTestId('library-search').fill('');
    await page.locator('label', { hasText: /^Back$/ }).click();
    await page.getByTestId('filter-equipment').click();
    await page.getByRole('option', { name: 'Cable pulley' }).click();
    const items = page.getByTestId('library-item');
    await expect(items.first()).toBeVisible();
    for (const txt of await items.allInnerTexts()) expect(txt).toContain('Back');
    await page.screenshot({ path: shot('10-library-filter'), fullPage: true });
    await page.goto('./?e2e#/library');
    await page.screenshot({ path: shot('11-library'), fullPage: false });
    await assertHitAreas(page);

    await page.goto('./?e2e#/library/goblet_box_squat');
    await expect(page.getByText('Knee caution – keep pain ≤ 3/10')).toBeVisible();
    await expect(page.getByTestId('alt-item').filter({ hasText: 'Leg Press' })).toContainText('Knee-friendly'); // LIB-08 AC1
    // LIB-04 AC1: verified link opens the exact URL and shows channel + date
    await expect(page.getByTestId('video-watch')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=1naZfu0lCiw');
    await expect(page.getByText('Verified 2026-11-24 · Rut to Routine Fitness')).toBeVisible();
    await page.screenshot({ path: shot('12-exercise-detail'), fullPage: true });
    await assertHitAreas(page);
    await assertNamed(page);
    // LIB-05 AC1: no verified link → search fallback
    await page.goto('./?e2e#/library/leg_press');
    await expect(page.getByTestId('video-search')).toHaveAttribute('href', 'https://www.youtube.com/results?search_query=Leg%20Press%20form');
    // LIB-05 AC2 user link
    await page.getByRole('button', { name: 'Add your YouTube link' }).click();
    await page.getByTestId('video-input').fill('https://example.com/x');
    await page.getByTestId('video-save').click();
    await expect(page.getByText(/not a YouTube video link/)).toBeVisible();
    await page.getByTestId('video-input').fill('https://youtu.be/AAAAAAAAAAA');
    await page.getByTestId('video-save').click();
    await expect(page.getByTestId('video-watch')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await expect(page.getByText('Your link')).toBeVisible();
    // SET-02: per-exercise step
    await page.getByTestId('ex-increment').fill('6.5');
    await page.getByTestId('ex-increment').blur();
    await expect(page.getByText('6.5 kg')).toBeVisible();

    // LIB-07 custom exercise + rename
    await page.goto('./?e2e#/library/new');
    await page.getByTestId('new-name').fill('Viking Press');
    await page.getByTestId('new-primary').click();
    await page.getByRole('option', { name: 'Front delts' }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('new-create').click();
    await expect(page.locator('h2')).toHaveText('Viking Press');
    await expect(page.getByText('Custom')).toBeVisible();
    await page.getByTestId('ex-menu').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Name').fill('Viking Shoulder Press');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('h2')).toHaveText('Viking Shoulder Press');
  });
});

test.describe('Settings, storage, backup', () => {
  test('SET-01: lb display and back; theme; PWA-04 storage status', async ({ page }) => {
    await fresh(page);
    const f = await doImport(page);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    await page.goto('./?e2e#/settings');
    await page.getByTestId('unit-toggle').getByText('lb').click();
    await page.goto('./?e2e#/history');
    await page.getByTestId('history-session').last().getByRole('button').click();
    await expect(page.getByText(firstSet(f.path).lb)).toBeVisible();
    await page.goto('./?e2e#/settings');
    await page.getByTestId('unit-toggle').getByText('kg').click();
    await page.goto('./?e2e#/history');
    await page.getByTestId('history-session').last().getByRole('button').click();
    await expect(page.getByText(firstSet(f.path).kg)).toBeVisible();
    await page.goto('./?e2e#/settings');
    await page.getByTestId('theme-toggle').getByText('Light').click();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
    await page.screenshot({ path: shot('13-settings-light'), fullPage: true });
    await page.getByTestId('theme-toggle').getByText('Dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await page.screenshot({ path: shot('14-settings'), fullPage: true });
    await assertHitAreas(page);
    await page.goto('./?e2e#/settings/storage');
    await expect(page.getByTestId('storage-usage')).toContainText(/Used .* of /);
    await page.screenshot({ path: shot('15-storage'), fullPage: true });
    await page.goto('./?e2e#/settings/equipment');
    await page.screenshot({ path: shot('16-equipment'), fullPage: true });
  });

  test('BAK-01/02 + DASH-06: backup ZIP, identical restore, real restore', async ({ page }) => {
    await fresh(page);
    await doImport(page);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('backup-due')).toBeVisible(); // never backed up + has data
    await page.goto('./?e2e#/backup');
    const dl = page.waitForEvent('download');
    await page.getByTestId('backup-now').click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/^weight-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    const path = `test-results/${file.suggestedFilename()}`;
    await file.saveAs(path);
    await expect(page.getByTestId('backup-msg')).toContainText('Backup created');
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('backup-due')).toHaveCount(0);
    // identical restore → nothing to do
    await page.goto('./?e2e#/backup');
    let chooser = page.waitForEvent('filechooser');
    await page.getByTestId('restore-pick').click();
    await (await chooser).setFiles(path);
    await expect(page.getByTestId('restore-identical')).toBeVisible();
    // change data, then restore for real
    await page.evaluate(async () => { const db = (window as any).__weightDb; await db.sets.toCollection().modify({ weightKg: 999 }); });
    chooser = page.waitForEvent('filechooser');
    await page.getByTestId('restore-pick').click();
    await (await chooser).setFiles(path);
    await expect(page.getByTestId('restore-preview')).toBeVisible();
    await page.screenshot({ path: shot('17-restore-preview'), fullPage: true });
    await page.getByTestId('restore-go').click();
    await page.getByTestId('confirm-sheet-confirm').click();
    await expect(page.getByTestId('backup-msg')).toContainText('Restored');
    expect(await page.evaluate(async () => (await (window as any).__weightDb.sets.filter((s: any) => s.weightKg === 999).count()))).toBe(0);
    // corrupted ZIP refused
    const bytes = readFileSync(path); bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    chooser = page.waitForEvent('filechooser');
    await page.getByTestId('restore-pick').click();
    await (await chooser).setFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: bytes });
    await expect(page.getByTestId('backup-msg')).toBeVisible();
    await expect(page.getByTestId('restore-preview')).toHaveCount(0);
  });

  test('FND-02: component gallery dark + light snapshots', async ({ page }) => {
    await fresh(page, '/dev/components');
    await expect(page.getByTestId('gallery')).toBeVisible();
    await page.screenshot({ path: shot('18-gallery-dark'), fullPage: true });
    await assertHitAreas(page);
    await page.goto('./?e2e#/settings');
    await page.getByTestId('theme-toggle').getByText('Light').click();
    await page.goto('./?e2e#/dev/components');
    await page.screenshot({ path: shot('19-gallery-light'), fullPage: true });
    await page.goto('./?e2e#/install');
    await page.screenshot({ path: shot('20-install-guide'), fullPage: true });
  });
});
