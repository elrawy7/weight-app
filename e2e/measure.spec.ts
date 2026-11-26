/**
 * D-01 / D-07 evidence: measured layout of the workout and Today screens on the iPhone viewport (393×852 CSS px),
 * light and dark, with the synthetic fixture. Writes test-results/measure/<label>.json and screenshots.
 * Run: E2E_FIXTURE=1 MEASURE_LABEL=before npx playwright test e2e/measure.spec.ts --project=chromium-iphone
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { doImport, fresh, importFile } from './helpers';

const label = process.env.MEASURE_LABEL ?? 'current';
const dir = `test-results/measure/${label}`;

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-11-29T10:00:00+03:00') });
  await fresh(page);
  await doImport(page);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-state')).toHaveText('Imported');
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid=wo-exercise]')].map((c) => ({ exercise: c.dataset.exercise, height: Math.round(c.getBoundingClientRect().height), sets: c.querySelectorAll('[data-testid=set-row]').length }));
    const firstCheck = document.querySelector<HTMLElement>('[data-testid=set-check]')?.getBoundingClientRect();
    return { pageHeight: document.documentElement.scrollHeight, viewport: innerHeight, cards, firstSetCheckTop: firstCheck ? Math.round(firstCheck.top) : null,
      setRowsInFirstViewport: [...document.querySelectorAll<HTMLElement>('[data-testid=set-row]')].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight - 70; }).length };
  });
}

test.describe('layout measurements', () => {
  test.skip(importFile().real, 'Synthetic fixture only.');
  for (const scheme of ['dark', 'light'] as const) {
    test(`workout + today layout (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await setup(page);
      await page.goto('./?e2e#/settings');
      await page.getByTestId('theme-toggle').getByText(scheme === 'dark' ? 'Dark' : 'Light', { exact: true }).click();
      await page.goto('./?e2e#/');
      await expect(page.getByTestId('start-workout')).toBeVisible();
      mkdirSync(dir, { recursive: true });
      const start = await page.getByTestId('start-workout').boundingBox();
      await page.screenshot({ path: `${dir}/today-${scheme}.png` });
      await page.getByTestId('start-workout').click();
      await expect(page.getByTestId('wo-exercise').first()).toBeVisible();
      const out: Record<string, unknown> = { label, scheme, todayStartButtonTop: start ? Math.round(start.y) : null };
      const modes = (await page.getByTestId('wo-density').count()) ? ['expanded', 'compact'] : ['baseline'];
      for (const mode of modes) {
        if (mode !== 'baseline') {
          const cur = await page.getByTestId('wo-density').getAttribute('data-density');
          if (cur !== mode) await page.getByTestId('wo-density').click();
          await expect(page.getByTestId('wo-density')).toHaveAttribute('data-density', mode);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        out[mode] = await layout(page);
        await page.screenshot({ path: `${dir}/workout-${mode}-${scheme}.png` });
        await page.screenshot({ path: `${dir}/workout-${mode}-${scheme}-full.png`, fullPage: true });
      }
      // first set done → rest timer visible
      await page.getByTestId('set-row').first().getByTestId('set-weight').fill('50');
      await page.getByTestId('set-row').first().getByTestId('set-reps').fill('6');
      await page.getByTestId('set-row').first().getByTestId('set-check').click();
      await expect(page.getByTestId('set-row').first()).toHaveAttribute('data-done', '1');
      await expect(page.getByTestId('rest-panel')).toBeVisible();
      await expect(page.getByTestId('wo-progress')).toContainText('1/11 sets');
      await page.screenshot({ path: `${dir}/workout-rest-${scheme}.png` });
      writeFileSync(`${dir}/layout-${scheme}.json`, JSON.stringify(out, null, 2));
    });
  }
});
