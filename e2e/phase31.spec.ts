/** Phase 3.1 regression tests at screen level (A-04 notes autosave, A-05 validation, A-06 skipped/replaced, B-05 why). */
import { test, expect, type Page } from '@playwright/test';
import { assertHitAreas, assertNamed, doImport, fresh, importFile } from './helpers';

const ex = (page: Page, id: string) => page.locator(`[data-testid=wo-exercise][data-exercise=${id}]`);
const bench = (page: Page) => ex(page, 'barbell_bench_press');
const row = (page: Page, i: number) => bench(page).getByTestId('set-row').nth(i);

async function startUpperA(page: Page) {
  await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') }); // Sunday, Week 2
  await fresh(page);
  await doImport(page);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-state')).toHaveText('Imported');
  await page.goto('./?e2e#/');
  await page.getByTestId('start-workout').click();
  await expect(page).toHaveURL(/#\/workout\//);
}

test.describe('Phase 3.1 – stabilisation', () => {
  test.skip(importFile().real, 'Uses the synthetic fixture values – run with E2E_FIXTURE=1 (CI does).');

  test('A-04: an exercise note is saved while typing – leaving the screen without blur keeps it', async ({ page }) => {
    await startUpperA(page);
    const url = page.url();
    await bench(page).getByTestId('wo-ex-menu').click();
    await page.getByRole('menuitem', { name: 'Add note' }).click();
    const note = bench(page).getByTestId('wo-ex-note');
    await note.click();
    await note.pressSequentially('Left shoulder felt tight');
    await page.clock.runFor(1000); // debounce
    await expect(bench(page).getByText('Saved')).toBeVisible();
    await note.pressSequentially(' – lowered the bar slowly');
    // navigate away immediately (no blur, no debounce): the unmount flush saves it
    await page.evaluate(() => { location.hash = '#/'; });
    await expect(page.getByTestId('today-date')).toBeVisible();
    await page.goto(url);
    await expect(bench(page).getByTestId('wo-ex-note')).toHaveValue('Left shoulder felt tight – lowered the bar slowly');
  });

  test('A-04: the workout note in the finish sheet survives closing the sheet', async ({ page }) => {
    await startUpperA(page);
    await page.getByTestId('wo-finish').click();
    await page.getByTestId('finish-notes').fill('Short on time today');
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: 'Keep going' }).click();
    await page.reload();
    await page.getByTestId('wo-finish').click();
    await expect(page.getByTestId('finish-notes')).toHaveValue('Short on time today');
  });

  test('A-05: a weighted set needs a weight; 0 reps is a failed attempt, not a PR', async ({ page }) => {
    await startUpperA(page);
    // the pushdown has no previous values → no prefill → ✓ with reps only is rejected
    const push = ex(page, 'cable_rope_pushdown');
    await push.getByTestId('set-row').first().getByTestId('set-reps').fill('12');
    await push.getByTestId('set-row').first().getByTestId('set-check').click();
    await expect(page.getByText('Enter the weight first.')).toBeVisible();
    await expect(push.getByTestId('set-row').first()).toHaveAttribute('data-done', '0');
    // bench: 70 kg × 0 is recorded as done but does not raise a PR toast
    await row(page, 0).getByTestId('set-weight').fill('70');
    await row(page, 0).getByTestId('set-reps').fill('0');
    await row(page, 0).getByTestId('set-check').click();
    await expect(row(page, 0)).toHaveAttribute('data-done', '1');
    await expect(page.getByTestId('pr-toast')).toHaveCount(0);
  });

  test('A-06: skipping the rest of an exercise keeps its done sets; a replaced exercise keeps its sets', async ({ page }) => {
    await startUpperA(page);
    await row(page, 0).getByTestId('set-weight').fill('50');
    await row(page, 0).getByTestId('set-reps').fill('6');
    await row(page, 0).getByTestId('set-check').click();
    await expect(row(page, 0)).toHaveAttribute('data-done', '1');
    await bench(page).getByTestId('wo-ex-menu').click();
    await page.getByRole('menuitem', { name: 'Skip remaining sets' }).click();
    await expect(bench(page).getByTestId('wo-rest-skipped')).toBeVisible();
    await expect(bench(page)).toHaveAttribute('data-status', 'completed');
    await expect(bench(page).getByTestId('set-row')).toHaveCount(1); // only the done set is shown

    // replace the row exercise after one set: its set stays visible and counted
    const rowEx = ex(page, 'unresolved_chest_supported_row');
    await rowEx.getByTestId('set-row').first().getByTestId('set-weight').fill('25');
    await rowEx.getByTestId('set-row').first().getByTestId('set-reps').fill('10');
    await rowEx.getByTestId('set-row').first().getByTestId('set-check').click();
    await expect(rowEx.getByTestId('set-row').first()).toHaveAttribute('data-done', '1');
    await rowEx.getByTestId('wo-ex-menu').click();
    await page.getByTestId('wo-ex-replace').click();
    await page.getByPlaceholder('Search exercises, muscles, Arabic names').fill('seated cable row');
    await page.getByTestId('picker-item').first().click();
    await expect(page.getByTestId('wo-replaced-kept')).toContainText('replaced after 1 set(s)');
    await page.getByTestId('wo-finish').click();
    await expect(page.getByTestId('sum-sets')).toHaveText('2/9'); // bench 1 (rest skipped) + row 1 (replaced) + 4 + 3 planned
  });

  test('B-05: a suggestion explains what it is based on', async ({ page }) => {
    await startUpperA(page);
    const sug = bench(page).getByTestId('wo-suggestion');
    await expect(sug).toBeVisible();
    await expect(bench(page).getByTestId('wo-why-list')).toBeHidden();
    await bench(page).getByTestId('wo-why').click();
    await expect(bench(page).getByTestId('wo-why-list')).toBeVisible();
    await expect(bench(page).getByTestId('wo-why-list')).toContainText('Last time');
    await expect(bench(page).getByTestId('wo-why-list')).toContainText('of 2 planned sets');
  });
});

test.describe('Phase 3.1 – D: workout & Today UX', () => {
  test.skip(importFile().real, 'Uses the synthetic fixture values – run with E2E_FIXTURE=1 (CI does).');

  test('D-07: start today’s workout in 1 tap; complete an unchanged set in 1 tap', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') });
    await fresh(page);
    await doImport(page);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    await page.goto('./?e2e#/'); // the app opens on Today
    let taps = 0;
    await page.getByTestId('start-workout').click(); taps++;
    await expect(page).toHaveURL(/#\/workout\//);
    expect(taps).toBeLessThanOrEqual(2);
    // set 1 is prefilled from last time (50×5): one tap on ✓ stores exactly those values
    await row(page, 0).getByTestId('set-check').click();
    await expect(row(page, 0)).toHaveAttribute('data-done', '1');
    await expect(row(page, 0).getByTestId('set-weight')).toHaveValue('50');
    await expect(row(page, 0).getByTestId('set-reps')).toHaveValue('5');
  });

  test('D-01…D-04, D-06: compact/expanded, navigator, progress bar, form video, docked rest timer', async ({ page }) => {
    await startUpperA(page);
    const bar = page.getByTestId('wo-bar');
    // D-03 progress header
    await expect(page.getByTestId('wo-progress')).toHaveText('0/3 exercises · 0/11 sets');
    await expect(bar.getByTestId('wo-clock')).toBeVisible();
    await expect(bar.getByTestId('wo-pause')).toBeVisible();
    await expect(bar.getByTestId('wo-finish-top')).toBeVisible();
    // D-01 compact is the default; one line per set
    await expect(page.getByTestId('wo-density')).toHaveAttribute('data-density', 'compact');
    await expect(row(page, 0)).toHaveAttribute('data-compact', '1');
    const compactH = (await bench(page).boundingBox())!.height;
    await page.getByTestId('wo-density').click();
    await expect(page.getByTestId('wo-density')).toHaveAttribute('data-density', 'expanded');
    const expandedH = (await bench(page).boundingBox())!.height;
    expect(compactH).toBeLessThan(expandedH * 0.6); // measured: ≥ 40 % shorter
    await page.reload(); // persisted
    await expect(page.getByTestId('wo-density')).toHaveAttribute('data-density', 'expanded');
    // D-04 form video: the verified video when the library has one; otherwise an honest YouTube search, labelled as such
    await expect(bench(page).getByTestId('wo-video')).toHaveText('Watch form');
    await expect(bench(page).getByTestId('wo-video')).toHaveAttribute('data-verified', '1');
    await expect(bench(page).getByTestId('wo-video')).toHaveAttribute('href', /^https:\/\/www\.youtube\.com\/watch\?v=/);
    const unresolved = page.locator('[data-testid=wo-exercise][data-exercise=unresolved_chest_supported_row]');
    await expect(unresolved.getByTestId('wo-video')).toHaveText('Find form video');
    await expect(unresolved.getByTestId('wo-video')).toHaveAttribute('data-verified', '0');
    await expect(unresolved.getByTestId('wo-video')).toHaveAttribute('href', /youtube\.com\/results\?search_query=/);
    await page.getByTestId('wo-density').click();
    await expect(page.getByTestId('wo-density')).toHaveAttribute('data-density', 'compact');
    await expect(bench(page).getByTestId('wo-video')).toHaveAttribute('aria-label', 'Watch form video for Flat Barbell Bench Press (opens YouTube)');
    await expect(unresolved.getByTestId('wo-video')).toHaveAttribute('aria-label', /^Find form video for .* \(YouTube search\)$/);

    // D-02 navigator: one chip per exercise; the current one is marked; a tap jumps to the card below the bar
    const chips = page.getByTestId('wo-nav-item');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAttribute('aria-current', 'step');
    await chips.nth(2).click();
    const push = page.locator('[data-testid=wo-exercise][data-exercise=cable_rope_pushdown]');
    await expect.poll(async () => { const b = await push.boundingBox(); const t = await bar.boundingBox(); return b && t ? Math.round(b.y - (t.y + t.height)) : -1; }).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => (await push.boundingBox())!.y).toBeLessThan(400);

    // D-06 docked rest timer with what comes next, above the tab bar
    await chips.nth(0).click();
    await row(page, 0).getByTestId('set-check').click();
    await expect(page.getByTestId('wo-progress')).toHaveText('0/3 exercises · 1/11 sets');
    const dock = page.getByTestId('rest-panel');
    await expect(dock).toBeVisible();
    await expect(page.getByTestId('rest-next')).toContainText('Next: Flat Barbell Bench Press · set 2');
    const tab = await page.getByTestId('nav-tabbar').boundingBox();
    const d = await dock.boundingBox();
    expect(d!.y + d!.height).toBeLessThanOrEqual(tab!.y + 1);
    await assertHitAreas(page);
    await assertNamed(page);
    // a toast never covers the sticky bar (Finish / Pause stay reachable)
    const pushRow = push.getByTestId('set-row').first();
    await pushRow.getByTestId('set-reps').fill('12');
    await pushRow.getByTestId('set-check').click();
    const toast = page.locator('.mantine-Notification-root').first();
    await expect(toast).toBeVisible();
    const bb = await bar.boundingBox();
    await expect.poll(async () => (await toast.boundingBox())!.y, { timeout: 2000 }).toBeGreaterThanOrEqual(bb!.y + bb!.height - 1); // after its slide-in
    await page.getByTestId('rest-skip').click();
    await expect(dock).toHaveCount(0);
  });

  test('D-05: Today order – resume/start first, then the backup row, instructions, recent, stats', async ({ page }) => {
    await startUpperA(page);
    await row(page, 0).getByTestId('set-check').click();
    await page.getByTestId('wo-finish-top').click();
    await page.getByTestId('finish-save').click();
    await page.goto('./?e2e#/');
    const y = async (id: string) => (await page.getByTestId(id).first().boundingBox())!.y;
    await expect(page.getByTestId('backup-due')).toBeVisible();
    const order = [await y('today-card'), await y('backup-due'), await y('today-exercise'), await y('dash-week'), await y('upcoming-row')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(await page.getByTestId('install-banner').count() ? await y('install-banner') : Infinity).toBeGreaterThan(order[4]);
  });
});
