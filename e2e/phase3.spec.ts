import { test, expect, type Page } from '@playwright/test';
import { assertHitAreas, assertNamed, doImport, fresh, importFile } from './helpers';

const shot = (name: string) => `test-results/screens/${test.info().project.name}/${name}.png`;
const bench = (page: Page) => page.locator('[data-testid=wo-exercise][data-exercise=barbell_bench_press]');
const row = (page: Page, i: number) => bench(page).getByTestId('set-row').nth(i);
async function logSet(page: Page, i: number, kg: string, reps: string) {
  await row(page, i).getByTestId('set-weight').fill(kg);
  await row(page, i).getByTestId('set-reps').fill(reps);
  await row(page, i).getByTestId('set-check').click();
  await expect(row(page, i)).toHaveAttribute('data-done', '1');
}

test.describe('Phase 3 – analytics & progression', () => {
  test('TC-CRIT-01…12: template → log → previous values → close/resume → offline → progress & records', async ({ page, context }) => {
    await page.clock.install({ time: new Date('2026-11-10T09:00:00+03:00') });
    await fresh(page);
    // 01 create a workout template containing Barbell Bench Press
    await page.goto('./?e2e#/programs');
    await page.getByTestId('new-program-name').fill('Crit plan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Workout name').fill('Push');
    await page.getByRole('button', { name: 'Add workout' }).click();
    await page.getByTestId('program-menu').click();
    await page.getByRole('menuitem', { name: 'Make active' }).click();
    await page.getByTestId('template-item').filter({ hasText: 'Push' }).click();
    await page.getByTestId('add-exercise').click();
    await page.getByPlaceholder('Search exercises, muscles, Arabic names').fill('flat barbell bench');
    await page.getByTestId('picker-item').first().click();
    await expect(page.getByTestId('row-name').first()).toHaveText('Flat Barbell Bench Press');
    // 02 start it and log 40×12, 45×10, 50×8
    await page.goto('./?e2e#/');
    await page.getByTestId('start-any').click();
    await page.getByTestId('start-pick').filter({ hasText: 'Push' }).click();
    await expect(bench(page).getByTestId('wo-first-time')).toBeVisible(); // TC-FIRST-01
    await logSet(page, 0, '40', '12');
    await logSet(page, 1, '45', '10');
    await logSet(page, 2, '50', '8');
    await expect(page.getByTestId('pr-toast')).toHaveCount(0); // TC-FIRST-01: no PR toast on the first-ever sets
    // 03 finish → Today shows it
    await page.getByTestId('wo-finish').click();
    await page.getByTestId('finish-save').click();
    await expect(page.getByTestId('other-session')).toContainText('Also logged: Push');
    // 04 three days later, a new workout with bench
    await page.clock.setSystemTime(new Date('2026-11-13T09:00:00+03:00'));
    await page.goto('./?e2e#/');
    await page.reload();
    await page.getByTestId('start-any').click();
    await page.getByTestId('start-pick').filter({ hasText: 'Push' }).click();
    // 05 previous values per set, last date, prefill
    await expect(bench(page).getByTestId('wo-last')).toContainText('Last time · Tue 10 Nov');
    await expect(row(page, 0).getByTestId('set-prev')).toHaveText('Prev 40×12');
    await expect(row(page, 1).getByTestId('set-prev')).toHaveText('Prev 45×10');
    await expect(row(page, 2).getByTestId('set-prev')).toHaveText('Prev 50×8');
    await expect(row(page, 1).getByTestId('set-weight')).toHaveAttribute('placeholder', '45');
    await expect(row(page, 2).getByTestId('set-reps')).toHaveAttribute('placeholder', '8');
    // 06 set 1 = 42.5×12
    await row(page, 0).getByTestId('set-weight').fill('42.5');
    await row(page, 0).getByTestId('set-check').click();
    await expect(row(page, 0).getByTestId('set-reps')).toHaveValue('12');
    // 07 the first session is unchanged
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByTestId('history-session').first().getByRole('button').click();
    await expect(page.getByTestId('detail-set')).toHaveText([/40 kg × 12/, /45 kg × 10/, /50 kg × 8/]);
    // 08 close the page mid-workout; 09 reopen → Resume
    await page.close();
    const p2 = await context.newPage();
    await p2.goto('./?e2e#/');
    await expect(p2.getByTestId('resume-go')).toBeVisible();
    // 10 resume: set 1 done at 42.5×12, sets 2–3 still prefilled, rest timer state kept
    await p2.getByTestId('resume-go').click();
    await expect(row(p2, 0)).toHaveAttribute('data-done', '1');
    await expect(row(p2, 0).getByTestId('set-weight')).toHaveValue('42.5');
    await expect(row(p2, 1).getByTestId('set-weight')).toHaveAttribute('placeholder', '45');
    await expect(p2.getByTestId('rest-panel')).toBeVisible();
    // 11 offline: complete sets 2–3 and finish
    await context.setOffline(true);
    await row(p2, 1).getByTestId('set-check').click();
    await row(p2, 2).getByTestId('set-check').click();
    await p2.getByTestId('rest-skip').click();
    await p2.getByTestId('wo-finish').click();
    await p2.getByTestId('finish-save').click();
    await expect(p2.getByTestId('other-session')).toBeVisible();
    await context.setOffline(false);
    // 12 Progress → Bench Press and Records
    await p2.getByRole('link', { name: 'Progress' }).click();
    await p2.getByTestId('progress-exercise').filter({ hasText: 'Flat Barbell Bench Press' }).click();
    await expect(p2.getByTestId('chart-point')).toHaveCount(2);
    await expect(p2.getByTestId('stat-max-weight')).toHaveText('50 kg');
    await p2.goto('./?e2e#/progress/records');
    const card = p2.locator('[data-testid=record-card][data-exercise=barbell_bench_press]');
    await expect(card.getByTestId('record-max_weight')).toContainText('50 kg · Tue 10 Nov');
    await expect(card.getByTestId('record-e1rm')).toContainText('63.3 kg');
  });

  test('history views, detail, compare, repeat, delete; progress chart, ranges, records, muscles; PR toast; dashboard; strategy', async ({ page }) => {
    test.skip(importFile().real, 'Uses the synthetic fixture values – run with E2E_FIXTURE=1 (CI does).');
    await page.clock.install({ time: new Date('2026-11-24T18:00:00+03:00') });
    await fresh(page);
    await doImport(page);
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('import-state')).toHaveText('Imported');
    // an extra Upper A today: suggestion shown as ✦ hint; PR toast when beating 55 kg
    await page.goto('./?e2e#/');
    await page.getByTestId('start-other').click();
    await page.getByTestId('start-pick').filter({ hasText: 'Upper A' }).click();
    await expect(bench(page).getByTestId('wo-suggestion')).toContainText('✦');
    await expect(bench(page).getByTestId('wo-suggestion')).toContainText('missed the range once');
    await expect(row(page, 0).getByTestId('set-weight')).toHaveAttribute('placeholder', '50'); // PO-03: prefill untouched
    await row(page, 0).getByTestId('set-weight').fill('57.5');
    await row(page, 0).getByTestId('set-reps').fill('6');
    // PR-02 AC1: measure tap → toast inside the page
    await page.evaluate(() => {
      const w = window as unknown as { __t: { click?: number; toast?: number } };
      w.__t = {};
      document.addEventListener('click', () => { w.__t.click ??= performance.now(); }, { capture: true, once: true });
      new MutationObserver((_, o) => { if (document.querySelector('[data-testid=pr-toast]')) { w.__t.toast = performance.now(); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
    });
    await row(page, 0).getByTestId('set-check').click();
    await expect(page.getByTestId('pr-toast')).toContainText('Flat Barbell Bench Press · 57.5 kg');
    const ms = await page.evaluate(() => { const w = window as unknown as { __t: { click: number; toast: number } }; return w.__t.toast - w.__t.click; });
    console.log(`PR toast after ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(300);
    const push = page.locator('[data-testid=wo-exercise][data-exercise=cable_rope_pushdown]');
    await push.getByTestId('set-weight').first().fill('20');
    await push.getByTestId('set-reps').first().fill('12');
    await push.getByTestId('set-check').first().click();
    await expect(page.getByTestId('pr-toast')).toHaveCount(1); // first-ever pushdown → no toast (TC-FIRST-01)
    await page.getByTestId('rest-skip').click();
    await page.getByTestId('wo-finish').click();
    await expect(page.getByTestId('sum-prs')).toContainText('Flat Barbell Bench Press · 57.5 kg');
    await page.getByTestId('finish-save').click();

    // DASH-01…03 on Today
    await page.goto('./?e2e#/');
    await expect(page.getByTestId('dash-completion')).toHaveText('1 of 2 planned workouts done');
    await expect(page.getByTestId('dash-total')).toHaveText('2');
    await expect(page.getByTestId('dash-prs')).toContainText('Flat Barbell Bench Press');
    await assertHitAreas(page);
    await page.screenshot({ path: shot('40-dashboard'), fullPage: true });

    // HIST-01 calendar + filters
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByTestId('history-session')).toHaveCount(2);
    await page.getByTestId('history-view').getByText('Calendar').click();
    await page.getByTestId('cal-2026-11-24').click();
    await expect(page.getByTestId('history-session')).toHaveCount(1);
    await page.screenshot({ path: shot('41-history-calendar'), fullPage: true });
    await page.getByTestId('history-view').getByText('List').click();
    await page.getByTestId('filter-exercise').click();
    await page.getByRole('option', { name: 'Cable Rope Triceps Pushdown' }).click();
    await expect(page.getByTestId('history-session')).toHaveCount(1);
    await expect(page.getByTestId('filter-count')).toHaveText('Showing 1 of 2 workouts');
    await page.goto('./?e2e#/history');

    // HIST-02 detail, HIST-06 compare
    await page.getByTestId('history-session').first().getByRole('button').click();
    await expect(page.getByTestId('detail-prs')).toContainText('Heaviest weight');
    await page.getByTestId('history-compare-with').click();
    await page.getByTestId('compare-pick').first().click();
    await expect(page.getByTestId('compare-row')).toHaveCount(1);
    await expect(page.getByTestId('compare-row').getByTestId('compare-delta').first()).toContainText('▲ 2.5 kg');
    await expect(page.getByTestId('compare-unmatched')).toContainText('Cable Rope Triceps Pushdown');
    await page.screenshot({ path: shot('42-compare'), fullPage: true });

    // AN-01/02 progress page: chart, ranges, table, tap point → session
    await page.goto('./?e2e#/progress/exercise/barbell_bench_press');
    await expect(page.getByTestId('chart-point')).toHaveCount(2);
    await expect(page.getByTestId('chart-point').nth(1)).toHaveAttribute('data-pr', '1');
    await expect(page.getByTestId('stat-improvement')).not.toHaveText('—');
    await page.getByTestId('range-chips').getByText('Custom', { exact: true }).click();
    await page.getByTestId('range-from').fill('2026-11-22');
    await expect(page.getByTestId('chart-empty')).toContainText('Only one workout');
    await page.getByTestId('range-chips').getByText('All', { exact: true }).click();
    await page.getByTestId('progress-chart-table-toggle').click();
    await expect(page.getByTestId('progress-chart-table').locator('tr')).toHaveCount(2);
    await assertHitAreas(page);
    await assertNamed(page);
    await page.screenshot({ path: shot('43-exercise-progress'), fullPage: true });
    await page.getByTestId('progress-chart').locator('svg').click({ position: { x: 300, y: 80 } });
    await expect(page.getByTestId('session-detail')).toBeVisible();

    // PR-01 records, MG-01 muscles + SET-03 AC1 secondary weight
    await page.goto('./?e2e#/progress/records');
    await expect(page.locator('[data-testid=record-card][data-exercise=barbell_bench_press]').getByTestId('record-max_weight')).toContainText('57.5 kg');
    await page.getByText('Timeline').click();
    await expect(page.getByTestId('record-event').first()).toContainText('was');
    await page.goto('./?e2e#/progress/muscles');
    await expect(page.getByTestId('muscle-method')).toContainText('Fractional sets');
    await expect(page.locator('[data-testid=bar-row][data-key=chest]')).toContainText('1 set');
    await expect(page.locator('[data-testid=bar-row][data-key=chest]')).toContainText('limited');
    await page.screenshot({ path: shot('44-muscles'), fullPage: true });
    const shoulders = page.locator('[data-testid=bar-row][data-key=shoulders]');
    await expect(shoulders).toHaveCount(1);
    await page.goto('./?e2e#/settings');
    await page.getByTestId('set-secondary').fill('0');
    await page.goto('./?e2e#/progress/muscles');
    await expect(page.locator('[data-testid=bar-row][data-key=chest]')).toBeVisible();
    await expect(shoulders).toHaveCount(0);

    // PO-04 manual strategy → no suggestion; HIST-05 repeat
    await page.goto('./?e2e#/library/barbell_bench_press');
    await page.getByTestId('ex-strategy').click();
    await page.getByRole('option', { name: 'Manual (no suggestions)' }).click();
    await page.goto('./?e2e#/history');
    await page.getByTestId('history-session').first().getByRole('button').click();
    await page.getByTestId('history-repeat').click();
    await expect(bench(page).getByTestId('wo-last')).toContainText('Tue 24 Nov');
    await expect(bench(page).getByTestId('wo-suggestion')).toHaveCount(0);
    await page.getByTestId('wo-discard').click();
    await page.getByTestId('confirm-sheet-confirm').click();
    await expect(page).toHaveURL(/#\/\?date=2026-11-24/);

    // HIST-04 delete with confirmation → recently discarded
    await page.goto('./?e2e#/history');
    await page.getByTestId('history-session').first().getByRole('button').click();
    await page.getByTestId('history-delete').click();
    await page.getByTestId('confirm-sheet-confirm').click();
    await expect(page.getByTestId('history-session')).toHaveCount(1);
    await expect(page.getByTestId('discarded-list')).toBeVisible();
  });

  test('TC-MIDNIGHT-01: started 23:50, finished 00:40 → listed on the start date', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T23:50:00+03:00') });
    await fresh(page);
    await page.goto('./?e2e#/');
    await page.getByTestId('start-empty').click(); // FR-PROG-07 without any program
    await page.getByTestId('wo-add-exercise').click();
    await page.getByPlaceholder('Search exercises').fill('flat barbell bench');
    await page.getByTestId('picker-item').first().click();
    await logSet(page, 0, '40', '10');
    await page.getByTestId('rest-skip').click();
    await page.clock.fastForward('50:00');
    await page.getByTestId('wo-finish').click();
    await expect(page.getByTestId('finish-minutes')).toHaveValue('50');
    await page.getByTestId('finish-save').click();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByTestId('history-session').first()).toContainText('24 Nov 2026');
  });
});
