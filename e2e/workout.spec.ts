import { test, expect, type Page } from '@playwright/test';
import { assertHitAreas, assertNamed, doImport, fresh, importFile } from './helpers';

const shot = (name: string) => `test-results/screens/${test.info().project.name}/${name}.png`;
const bench = (page: Page) => page.locator('[data-testid=wo-exercise][data-exercise=barbell_bench_press]');
const row = (page: Page, i: number) => bench(page).getByTestId('set-row').nth(i);

async function importFixture(page: Page) {
  await fresh(page);
  await doImport(page);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-state')).toHaveText('Imported');
}

test.describe('Phase 2 – workout logging (WO-01…17, TMR-01…03, QA-02)', () => {
  test.skip(importFile().real, 'Uses the synthetic fixture values – run with E2E_FIXTURE=1 (CI does).');

  test('Week 2 Upper A shows Week 1 sets, logs sets with rest timer, finish summary, history', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') }); // Sunday, Week 2
    await importFixture(page);
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('today-template')).toHaveText('Upper A');
    await expect(page.getByTestId('today-estimate')).toHaveText(/^3 exercises · ≈ \d+ min$/);
    const t0 = performance.now();
    await page.getByTestId('start-workout').click();
    await expect(page.getByTestId('wo-ex-name').first()).toHaveText('Flat Barbell Bench Press');
    expect(performance.now() - t0).toBeLessThan(1000); // WO-01 AC1: first exercise shown in ≤ 1 s
    await expect(page).toHaveURL(/#\/workout\//);
    await expect(page.getByTestId('wo-subtitle')).toContainText('Week 2');
    await expect(page.getByTestId('wo-clock')).toBeVisible(); // WO-13 AC2 session clock

    // WO-03 AC1: previous performance from Week 1 (21 Nov), per set; WO-02 targets snapshot for week 2
    await expect(bench(page).getByTestId('wo-last')).toContainText('Last time · Sat 21 Nov · Upper A');
    await expect(bench(page).getByTestId('wo-last-sets')).toHaveText('50×5 · 55×5');
    await expect(bench(page).getByTestId('wo-targets')).toHaveText('4 sets · 6-8 reps · Rest 120s');
    await expect(bench(page).getByTestId('set-row')).toHaveCount(4);
    await expect(row(page, 0).getByTestId('set-prev')).toHaveText('Prev 50×5');
    await expect(row(page, 2).getByTestId('set-prev')).toHaveText('Prev —'); // AC3
    // WO-04 ghost prefill: set 3 prefilled from the previous last set
    await expect(row(page, 0).getByTestId('set-weight')).toHaveAttribute('placeholder', '50');
    await expect(row(page, 2).getByTestId('set-weight')).toHaveAttribute('placeholder', '55');
    await expect(bench(page).getByTestId('wo-suggestion')).toContainText('missed the range once');
    await assertHitAreas(page);
    await assertNamed(page);
    await page.screenshot({ path: shot('30-workout-start'), fullPage: true });

    // WO-05 AC1: one tap logs the ghost values; TMR-01 AC1: rest starts at 2:00
    await row(page, 0).getByTestId('set-check').click();
    await expect(row(page, 0)).toHaveAttribute('data-done', '1');
    await expect(row(page, 0).getByTestId('set-weight')).toHaveValue('50');
    await expect(row(page, 0).getByTestId('set-reps')).toHaveValue('5');
    await expect(page.getByTestId('rest-left')).toHaveText('2:00');
    await page.clock.fastForward(30_000);
    await expect(page.getByTestId('rest-left')).toHaveText('1:30');
    await page.getByTestId('rest-plus').click();
    await expect(page.getByTestId('rest-left')).toHaveText('1:45');
    await page.getByTestId('rest-minus').click();
    await page.getByTestId('rest-pause').click();
    await page.clock.fastForward(20_000);
    await expect(page.getByTestId('rest-left')).toHaveText('1:30');
    await page.getByTestId('rest-resume').click();
    await page.screenshot({ path: shot('31-workout-rest'), fullPage: false });
    await page.getByTestId('rest-skip').click();
    await expect(page.getByTestId('rest-panel')).toHaveCount(0);

    // WO-05 AC2: ± uses the exercise increment (2.5 kg) starting from the ghost value; edit reps by typing
    await row(page, 1).getByTestId('set-weight-plus').click();
    await expect(row(page, 1).getByTestId('set-weight')).toHaveValue('57.5');
    await row(page, 1).getByTestId('set-reps').fill('6');
    await row(page, 1).getByTestId('set-check').click();
    await expect(row(page, 1).getByTestId('pr-badge')).toBeVisible(); // heavier than ever before
    await page.getByTestId('rest-skip').click();

    // WO-05 AC3: add set (copies last), delete with undo
    await bench(page).getByTestId('wo-add-set').click();
    await expect(bench(page).getByTestId('set-row')).toHaveCount(5);
    await row(page, 4).getByTestId('set-badge').click();
    await page.getByTestId('set-delete').click();
    await expect(bench(page).getByTestId('set-row')).toHaveCount(4);
    await page.getByTestId('undo-set').click();
    await expect(bench(page).getByTestId('set-row')).toHaveCount(5);
    await row(page, 4).getByTestId('set-badge').click();
    await page.getByTestId('set-delete').click();
    await expect(bench(page).getByTestId('set-row')).toHaveCount(4);

    // WO-06: mark a warm-up set type
    await bench(page).getByTestId('wo-add-warmup').click();
    await expect(bench(page).getByTestId('set-row')).toHaveCount(5);
    await expect(row(page, 4).getByTestId('set-badge')).toHaveText('W');

    // TMR-02 AC2: mini-bar on other screens, tap to return
    await row(page, 2).getByTestId('set-check').click();
    await expect(page.getByTestId('rest-panel')).toBeVisible();
    await page.getByRole('link', { name: 'Library' }).click();
    await expect(page.getByTestId('rest-minibar')).toBeVisible();
    await page.getByTestId('rest-minibar').click();
    await expect(page).toHaveURL(/#\/workout\//);
    // TMR-03 AC2: finished while away → "finished … ago"
    await page.clock.fastForward(180_000);
    await expect(page.getByTestId('rest-finished')).toContainText('Rest finished');
    await page.getByTestId('rest-dismiss').click();

    // WO-12 in-workout history sheet
    await bench(page).getByTestId('wo-ex-menu').click();
    await page.getByTestId('wo-ex-history').click();
    await expect(page.getByTestId('exercise-history-item')).toHaveCount(1);
    await expect(page.getByTestId('history-sets').first()).toHaveText('50×5 · 55×5');
    await page.keyboard.press('Escape');

    // WO-08: a note for this exercise in this workout
    await bench(page).getByTestId('wo-ex-menu').click();
    await page.getByRole('menuitem', { name: 'Add note' }).click();
    await bench(page).getByTestId('wo-ex-note').fill('Elbows tucked, felt strong');
    await bench(page).getByTestId('wo-ex-note').blur();

    // WO-10 AC2: summary; save
    await page.getByTestId('wo-finish').click();
    await expect(page.getByTestId('sum-sets')).toHaveText('3/11');
    await expect(page.getByTestId('sum-volume')).toHaveText('870 kg'); // 50×5 + 57.5×6 + 55×5
    await expect(page.getByTestId('sum-prs')).toContainText('Flat Barbell Bench Press · 57.5 kg');
    await expect(page.getByTestId('sum-incomplete')).toContainText('Cable Rope Triceps Pushdown');
    await page.getByTestId('finish-knee').getByRole('radio', { name: '1', exact: true }).click();
    await page.getByTestId('finish-energy').getByRole('radio', { name: '4' }).click();
    await assertHitAreas(page);
    await page.screenshot({ path: shot('32-workout-finish') });
    await page.getByTestId('finish-save').click();
    await expect(page.getByTestId('pr-backup')).toBeVisible(); // BAK-03: PR session → backup reminder
    await expect(page.getByTestId('done-card')).toBeVisible();
    await expect(page.getByTestId('open-session')).toBeVisible();

    // History lists the sets; reopening shows them (edit mode, no clock)
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByTestId('history-session').first().getByRole('button').first().click();
    await expect(page.getByTestId('history-session').first()).toContainText('57.5 kg × 6');
    await page.getByTestId('history-open').first().click();
    await expect(page.getByTestId('wo-logged')).toBeVisible();
    await expect(page.getByTestId('wo-clock')).toHaveCount(0);
    await expect(row(page, 1).getByTestId('set-weight')).toHaveValue('57.5');

    // Library detail: exercise history newest first
    await page.goto('./?e2e#/library/barbell_bench_press');
    await expect(page.getByTestId('exercise-history-item')).toHaveCount(2);
    await expect(page.getByTestId('exercise-history-item').first()).toContainText('Sun 29 Nov');
    await expect(page.getByTestId('exercise-history-item').first()).toContainText('Elbows tucked, felt strong');

    // Back-log a past day (22 Nov, rest day): only earlier sessions count as "previous" (BR-PP-01)
    await page.goto('./?e2e#/?date=2026-11-22');
    await page.getByTestId('start-any').click();
    await page.getByTestId('start-pick').filter({ hasText: 'Upper A' }).click();
    await expect(page.getByTestId('wo-backlog-note')).toBeVisible();
    await expect(page.getByTestId('wo-clock')).toHaveCount(0);
    await expect(bench(page).getByTestId('wo-last')).toContainText('Sat 21 Nov');
    await row(page, 0).getByTestId('set-check').click();
    await expect(page.getByTestId('rest-panel')).toHaveCount(0); // no rest timer when logging afterwards
    await page.getByTestId('wo-finish').click();
    await page.getByTestId('finish-minutes').fill('50');
    await page.getByTestId('finish-save').click();
    await expect(page.getByTestId('other-session')).toContainText('Also logged: Upper A');
  });

  test('quick log → add sets, cardio, empty workout, resume after reload, discard + restore', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T10:00:00+03:00') });
    await importFixture(page);
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('today-template')).toHaveText('Conditioning');
    // quick log first, then convert to a full log (QL-01 → WO)
    await page.getByTestId('mark-done').click();
    await page.getByTestId('ql-save').click();
    await page.getByTestId('ql-add-sets').click();
    const swim = page.locator('[data-testid=wo-exercise][data-exercise=swimming]');
    await expect(swim.getByTestId('wo-cardio')).toBeVisible();
    await swim.getByTestId('cardio-min').fill('30');
    await swim.getByTestId('cardio-km').fill('1');
    await swim.getByTestId('cardio-done').click();
    await expect(swim).toHaveAttribute('data-status', 'completed');
    await page.getByTestId('wo-done').click();
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByTestId('history-session').first().getByRole('button').first().click();
    await expect(page.getByTestId('history-session').first()).toContainText('30 min · 1 km');

    // QA-02 AC2: the whole next workout runs offline (airplane mode)
    await page.context().setOffline(true);
    // Empty workout on yesterday (rest day), add an exercise from the library (WO-01 AC2, WO-07)
    await page.goto('./?e2e#/?date=2026-11-23');
    await page.getByTestId('start-any').click();
    await page.getByTestId('start-pick').filter({ hasText: 'Empty workout' }).click();
    await page.getByTestId('wo-add-exercise').click();
    await page.getByPlaceholder('Search exercises').fill('plank');
    await page.getByTestId('picker-item').filter({ hasText: /^Plank/ }).first().click();
    const plank = page.locator('[data-testid=wo-exercise][data-exercise=plank]');
    await expect(plank.getByTestId('wo-first-time')).toBeVisible();
    await plank.getByTestId('set-sec').first().fill('40');
    await plank.getByTestId('set-check').first().click();
    await expect(plank.getByTestId('set-row').first()).toHaveAttribute('data-done', '1');

    // WO-11 AC2: reload → full-screen resume with the same values
    await page.goto('./?e2e#/');
    await page.reload();
    await expect(page.getByTestId('resume-go')).toBeVisible();
    await page.getByTestId('resume-go').click();
    await expect(plank.getByTestId('set-row').first()).toHaveAttribute('data-done', '1');
    await expect(plank.getByTestId('set-sec').first()).toHaveValue('40');

    // WO-10 AC3: discard needs confirmation; restorable from History
    await page.getByTestId('wo-discard').click();
    await page.getByTestId('confirm-sheet-confirm').click();
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByTestId('restore-session').click();
    await expect(page.getByTestId('discarded-list')).toHaveCount(0);
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('active-card')).toBeVisible();
    await page.getByTestId('active-continue').click();
    await page.getByTestId('wo-finish').click();
    await page.getByTestId('finish-save').click();
    await expect(page.getByTestId('other-session')).toBeVisible();
    await page.context().setOffline(false);
  });

  test('PROG-07: do tomorrow\'s workout today → plan shifts (preview, confirm, undo)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T18:00:00+03:00') });
    await importFixture(page);
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('today-template')).toHaveText('Conditioning');
    // Sheets stay below the iPhone status bar: simulate a 59 px safe area and open the tall "Other workout" list
    await page.addStyleTag({ content: ':root { --w-safe-top: 59px !important; }' });
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: 560 }); // list taller than the screen, like on a real iPhone
    await page.getByTestId('start-other').click();
    await expect(page.getByTestId('start-day').first()).toBeVisible();
    const sheet = page.locator('.mantine-Drawer-content').filter({ has: page.getByTestId('start-day') });
    await expect.poll(async () => { const b = await sheet.boundingBox(); return b ? Math.round(b.y + b.height) : 0; }).toBe(560); // slide-in finished
    const close = sheet.locator('.mantine-Drawer-close');
    const box = await close.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(59);
    await page.screenshot({ path: shot('34-start-sheet-safe-area') });
    await close.click();
    await expect(page.getByTestId('start-day')).toHaveCount(0);
    await page.setViewportSize(vp);
    await page.getByTestId('day-next').click();
    await expect(page.getByTestId('today-template')).toHaveText('Upper A');
    await page.getByTestId('do-today').click();
    await expect(page.getByTestId('shift-change')).toHaveCount(2);
    await expect(page.getByTestId('shift-change').nth(0)).toContainText('Conditioning');
    await expect(page.getByTestId('shift-change').nth(0)).toContainText('Upper A');
    await expect(page.getByTestId('shift-end')).toHaveText('The plan’s end date stays the same.');
    await assertHitAreas(page);
    await page.screenshot({ path: shot('33-shift-preview') });
    await page.getByTestId('shift-confirm').click();
    await expect(page.getByTestId('wo-ex-name').first()).toHaveText('Flat Barbell Bench Press');
    await expect(bench(page).getByTestId('wo-last')).toContainText('Sat 21 Nov');
    await row(page, 0).getByTestId('set-check').click();
    await page.getByTestId('wo-finish').click();
    await page.getByTestId('finish-save').click();
    // Today is now Upper A (done); tomorrow is Conditioning
    await expect(page.getByTestId('today-template')).toHaveText('Upper A');
    await expect(page.getByTestId('done-card')).toBeVisible();
    await page.getByTestId('day-next').click();
    await expect(page.getByTestId('today-template')).toHaveText('Conditioning');
    // Full plan shows the new order; undo restores it
    await page.getByTestId('open-plan').click();
    await expect(page.getByTestId('status-2026-11-24')).toHaveText('Done');
    await expect(page.getByTestId('plan-day').filter({ hasText: '25 Nov' })).toContainText('Conditioning');
    await page.getByTestId('plan-undo').click();
    await expect(page.getByTestId('plan-day').filter({ hasText: '25 Nov' })).toContainText('Upper A');
    await expect(page.getByTestId('plan-undo-card')).toHaveCount(0);
  });
});
