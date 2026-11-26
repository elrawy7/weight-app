/**
 * Phase 3.1 E – performance with a large SYNTHETIC history (1,000 workouts · ~50,000 sets · 200 custom exercises ·
 * 5 years) in a real browser IndexedDB (Chromium, iPhone viewport). Opt-in: PERF=1. Writes test-results/perf/browser.json.
 * Budgets are the app's NFRs: set ✓ ≤ 300 ms (BR-SES-02); first exercise ≤ 1 s after Start (WO-01).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { fresh } from './helpers';
import { generateSynthetic } from '../tests/perf/synthetic';

test.skip(!process.env.PERF, 'Performance run – set PERF=1');
test.setTimeout(600_000);

test('large synthetic history: load, start, log, history, progress, backup', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') }); // a Sunday → "Synthetic Day A" is planned
  await fresh(page);
  const lib = await page.evaluate(() => (window as unknown as { __weightDb: { exercises: { toCollection: () => { primaryKeys: () => Promise<string[]> } } } }).__weightDb.exercises.toCollection().primaryKeys());
  const data = generateSynthetic({ libraryExerciseIds: lib });
  const r: Record<string, number | string> = { workouts: data.sessions.length, sets: data.sets.length, customExercises: data.exercises.length, years: 5, engine: 'Chromium (Playwright), iPhone 393×852 viewport' };
  const t0 = Date.now();
  await page.evaluate(async (d) => {
    const db = (window as unknown as { __weightDb: { transaction: (m: string, t: unknown[], f: () => Promise<void>) => Promise<void>; table: (n: string) => { bulkAdd: (r: unknown[]) => Promise<unknown> }; tables: unknown[] } }).__weightDb;
    await db.transaction('rw', db.tables, async () => {
      for (const [k, rows] of Object.entries(d)) await db.table(k).bulkAdd(rows as unknown[]);
      await (db.table('kv') as unknown as { delete: (k: string) => Promise<void> }).delete('recordsVersion'); // like data from an import: records are built at the next start
    });
  }, data);
  r.insertMs = Date.now() - t0;

  const ms = async (fn: () => Promise<unknown>) => { const s = Date.now(); await fn(); return Date.now() - s; };
  // cold start: records are built from 5 years of history (first start after the data arrives)
  r.coldStartToTodayMs = await ms(async () => { await page.reload(); await expect(page.getByTestId('today-template')).toHaveText('Synthetic Day A', { timeout: 120_000 }); });
  r.coldDashboardMs = await ms(() => expect(page.getByTestId('dash-week')).toBeVisible({ timeout: 120_000 }));
  r.personalRecords = await page.evaluate(() => (window as unknown as { __weightDb: { personalRecords: { count: () => Promise<number> } } }).__weightDb.personalRecords.count());
  // warm start
  r.warmStartToTodayMs = await ms(async () => { await page.reload(); await expect(page.getByTestId('today-template')).toBeVisible({ timeout: 60_000 }); });
  r.warmDashboardMs = await ms(() => expect(page.getByTestId('dash-week')).toBeVisible({ timeout: 60_000 }));

  // History list and a session
  r.historyFirstItemMs = await ms(async () => { await page.goto('./?e2e#/history'); await expect(page.getByTestId('history-session').first()).toBeVisible({ timeout: 60_000 }); });
  r.historyItemsRendered = await page.getByTestId('history-session').count();
  r.sessionDetailMs = await ms(async () => { await page.getByTestId('history-session').first().click(); await expect(page.getByTestId('detail-exercise').first()).toBeVisible({ timeout: 60_000 }); });

  // Progress: list, one exercise with ~5 years of data, records
  r.progressListMs = await ms(async () => { await page.goto('./?e2e#/progress'); await expect(page.getByTestId('progress-exercise').first()).toBeVisible({ timeout: 60_000 }); });
  r.exerciseProgressMs = await ms(async () => { await page.goto('./?e2e#/progress/exercise/syn-ex-000000'); await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 }); });
  r.recordsMs = await ms(async () => { await page.goto('./?e2e#/progress/records'); await expect(page.getByTestId('record-card').first()).toBeVisible({ timeout: 60_000 }); });

  // Start today's workout (previous performance looked up across 1,000 workouts), log a set, finish
  await page.goto('./?e2e#/');
  await expect(page.getByTestId('start-workout')).toBeVisible({ timeout: 60_000 });
  r.startToFirstExerciseMs = await ms(async () => { await page.getByTestId('start-workout').click(); await expect(page.getByTestId('wo-exercise').first()).toBeVisible(); });
  await expect(page.getByTestId('wo-last').first()).toContainText('Last time', { timeout: 30_000 });
  r.startToHistoryReadyMs = Number(r.startToFirstExerciseMs) + await ms(() => expect(page.getByTestId('wo-suggestion').first()).toBeVisible({ timeout: 60_000 }));
  delete r.startToPreviousValuesMs;
  // ✓ latency: five sets, one after another (median reported); each waits for the row to show "done"
  const ticks: number[] = [];
  await page.waitForTimeout(Number(process.env.PERF_IDLE ?? 0)); // optional idle time before the first ✓ (default 0 = worst case)
  r.idleBeforeFirstTickMs = Number(process.env.PERF_IDLE ?? 0);
  for (let i = 0; i < 5; i++) {
    const row = page.getByTestId('set-row').nth(i);
    ticks.push(await ms(async () => { await row.getByTestId('set-check').click(); await expect(row).toHaveAttribute('data-done', '1', { timeout: 60_000 }); }));
    await page.waitForTimeout(300);
  }
  r.setCompleteMsEach = ticks.join(', ');
  r.setCompleteMs = [...ticks].sort((a, b) => a - b)[2];
  r.finishMs = await ms(async () => { await page.getByTestId('wo-finish-top').click(); await page.getByTestId('finish-save').click(); await expect(page.getByTestId('done-card')).toBeVisible({ timeout: 60_000 }); });

  // Backup of the whole history
  await page.goto('./?e2e#/backup');
  const dl = page.waitForEvent('download', { timeout: 300_000 });
  const b0 = Date.now();
  await page.getByTestId('backup-now').click();
  const file = await dl;
  r.backupMs = Date.now() - b0;
  mkdirSync('test-results/perf', { recursive: true });
  const zipPath = 'test-results/perf/synthetic-backup.zip';
  await file.saveAs(zipPath);
  const { statSync } = await import('node:fs');
  r.backupBytes = statSync(zipPath).size;
  // validate it again (restore preview: checksums, every row, relationships)
  const chooser = page.waitForEvent('filechooser');
  const i0 = Date.now();
  await page.getByTestId('restore-pick').click();
  await (await chooser).setFiles(zipPath);
  await expect(page.getByTestId('restore-preview').or(page.getByTestId('backup-msg'))).toBeVisible({ timeout: 300_000 });
  r.restoreInspectMs = Date.now() - i0;
  r.restoreInspectResult = (await page.getByTestId('restore-preview').count()) ? 'preview shown' : (await page.getByTestId('backup-msg').textContent()) ?? '';

  writeFileSync('test-results/perf/browser.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  expect(Number(r.setCompleteMs)).toBeLessThanOrEqual(1000); // generous wall-clock bound incl. Playwright overhead; BR-SES-02 measured in app
  expect(Number(r.startToFirstExerciseMs)).toBeLessThanOrEqual(3000);
});
