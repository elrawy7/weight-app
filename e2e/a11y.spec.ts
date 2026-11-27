/**
 * Phase 3.1 E – automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on the main screens, dark and light,
 * iPhone viewport, synthetic fixture. Automated checks find only part of the problems – VoiceOver on a real iPhone is
 * in the manual checklist. Writes test-results/a11y/<scheme>.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { doImport, fresh, importFile } from './helpers';

type Found = { screen: string; id: string; impact: string | null | undefined; nodes: number; help: string; targets: string[]; detail?: unknown[] };

async function scan(page: Page, screen: string, out: Found[]) {
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of r.violations) out.push({ screen, id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')), detail: v.nodes.slice(0, 5).map((n) => (n.any[0]?.data as Record<string, unknown> | undefined) ?? n.failureSummary) });
}

test.describe('accessibility (axe)', () => {
  test.skip(importFile().real, 'Synthetic fixture only.');
  for (const scheme of ['dark', 'light'] as const) {
    test(`main screens – ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') });
      await fresh(page);
      await doImport(page);
      await page.getByTestId('import-confirm').click();
      await expect(page.getByTestId('import-state')).toHaveText('Imported');
      await page.goto('./?e2e#/settings');
      await page.getByTestId('theme-toggle').getByText(scheme === 'dark' ? 'Dark' : 'Light', { exact: true }).click();
      const out: Found[] = [];
      await page.goto('./?e2e#/'); await expect(page.getByTestId('start-workout')).toBeVisible(); await scan(page, 'Today', out);
      await page.getByTestId('start-workout').click(); await expect(page.getByTestId('wo-exercise').first()).toBeVisible();
      await expect(page.getByTestId('wo-suggestion').first()).toBeVisible();
      await scan(page, 'Workout (compact)', out);
      await page.getByTestId('set-row').first().getByTestId('set-check').click(); await expect(page.getByTestId('rest-panel')).toBeVisible();
      await scan(page, 'Workout + rest timer', out);
      await page.getByTestId('wo-density').click(); await scan(page, 'Workout (expanded)', out);
      await page.getByTestId('wo-finish-top').click(); await expect(page.getByTestId('finish-sheet')).toBeVisible(); await scan(page, 'Finish sheet', out);
      await page.getByTestId('finish-save').click(); await expect(page.getByTestId('done-card')).toBeVisible();
      for (const [screen, path, id] of [['History', '/history', 'history-session'], ['Progress', '/progress', 'progress-exercise'], ['Records', '/progress/records', 'records-page'],
        ['Library', '/library', 'library-item'], ['Backup', '/backup', 'backup-now'], ['Settings', '/settings', 'theme-toggle'], ['Plan', '/plan', 'plan-day']] as const) {
        await page.goto(`./?e2e#${path}`);
        await page.getByTestId(id).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
        await scan(page, screen, out);
      }
      mkdirSync('test-results/a11y', { recursive: true });
      writeFileSync(`test-results/a11y/${scheme}.json`, JSON.stringify(out, null, 2));
      const serious = out.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, JSON.stringify(serious, null, 1)).toEqual([]);
    });
  }
});
