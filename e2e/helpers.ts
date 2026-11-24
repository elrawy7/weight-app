import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
};

/** The real personal import file when present (local), otherwise a synthetic TEST fixture (CI). */
export function importFile(): { path: string; real: boolean } {
  const dir = 'data/import';
  const real = !process.env.E2E_FIXTURE && existsSync(dir) ? readdirSync(dir).find((f) => /^weight-import-.*\.json$/.test(f)) : undefined;
  if (real) return { path: `${dir}/${real}`, real: true };
  const payload = {
    profile: { name: 'Test User', timezone: 'Etc/GMT-3', weekStartsOn: 'SUN', injuries: [] },
    bodyMeasurements: [{ date: '2026-11-21', dateSource: 'test fixture', weightKg: 90, waistCm: null, source: 'fixture' }],
    goals: [{ type: 'target_body_weight', target: 85, unit: 'kg', start: 90, startDate: '2026-11-21', source: 'fixture' }],
    program: {
      id: 'fixture_prog', name: 'Fixture Plan', status: 'active', split: 'upper_lower', startDate: '2026-11-21', endDate: '2026-12-19', weeksCount: 4, progressionRule: 'fixture', notionPageId: 'np',
      weeks: [1, 2, 3, 4].map((w) => ({ week: w, startDate: ['2026-11-21', '2026-11-29', '2026-12-06', '2026-12-13'][w - 1], endDate: ['2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19'][w - 1], phase: ['Re-entry', 'Build', 'Push', 'Peak'][w - 1], rpe: ['6-7', '7-8', '8', '8-9'][w - 1], note: null })),
      templates: [
        { id: 'fixture_prog__upper_a', key: 'upper_a', name: 'Upper A', focus: 'Push', order: 1, weekday: 'SUN', warmup: [{ order: 1, exerciseId: 'stationary_bike', altExerciseIds: [], label: null, prescription: '5 min' }],
          exercises: [
            { order: 1, exerciseId: 'barbell_bench_press', targetSetsByWeek: [3, 4, 4, 4], targetReps: '6-8', restSec: 120, notes: '', supersetGroup: null, role: 'working' },
            { order: 2, exerciseId: 'unresolved_chest_supported_row', targetSetsByWeek: [3, 4, 4, 4], targetReps: '8-10', restSec: 90, notes: '', supersetGroup: null, role: 'working' },
            { order: 3, exerciseId: 'cable_rope_pushdown', targetSetsByWeek: [2, 3, 3, 3], targetReps: '10-12', restSec: 60, notes: '', supersetGroup: 'A', role: 'working' },
          ] },
        { id: 'fixture_prog__conditioning', key: 'conditioning', name: 'Conditioning', focus: 'Swim or box', order: 2, weekday: 'TUE', warmup: [{ order: 1, exerciseId: 'leg_swings', altExerciseIds: [], label: null, prescription: '10 each' }],
          exercises: [{ order: 1, exerciseId: 'swimming', targetSetsByWeek: [1, 1, 1, 1], targetReps: '30 min', restSec: 0, notes: '', supersetGroup: null, role: 'cardio' }] },
      ],
      schedule: { pattern: { SUN: 'fixture_prog__upper_a', MON: null, TUE: 'fixture_prog__conditioning', WED: null, THU: null, FRI: null, SAT: null }, exceptions: [{ date: '2026-11-21', templateId: 'fixture_prog__upper_a', note: 'Week 1 started on Saturday' }, { date: '2026-11-22', templateId: null, note: 'Skipped' }],
        planned: [{ date: '2026-11-24', templateId: 'fixture_prog__conditioning', week: 1, targetRpe: 'Moderate', notionPageId: 'p24', doneInNotion: false }] },
    },
    sessions: [{ id: 'notion_fx1', localDate: '2026-11-21', dateSource: 'fixture', programId: 'fixture_prog', templateId: 'fixture_prog__upper_a', week: 1, startedAt: null, endedAt: null, durationMin: null, kneePain: null, energy: null, notes: null, notionPageId: 'fx1', lastEditedInNotion: 'x',
      exercises: [
        { order: 1, exerciseId: 'barbell_bench_press', supersetGroup: null, status: 'completed', sets: [{ order: 1, setType: 'working', setTypeConfidence: 'assumed', weightKg: 50, reps: 5, completed: true, rpe: null, rawCell: '50 x 5' }, { order: 2, setType: 'working', setTypeConfidence: 'assumed', weightKg: 55, reps: 5, completed: true, rpe: null, rawCell: '55 x 5' }] },
        { order: 2, exerciseId: 'unresolved_chest_supported_row', supersetGroup: null, status: 'completed', sets: [{ order: 1, setType: 'working', setTypeConfidence: 'assumed', weightKg: 25, reps: 12, completed: true, rpe: null, rawCell: '25 x 12' }] },
      ] }],
    unresolved: [{ provisionalId: 'unresolved_chest_supported_row', notionName: 'Chest-supported row (machine or dumbbells)', name: 'Chest-Supported Row (machine or dumbbell?)', issue: 'I-01', candidates: ['chest_supported_row_machine', 'chest_supported_row_db'], loadMode: 'stack', category: 'back', primary: ['upper_back'], secondary: ['lats'], usedInTemplates: ['Upper A'], logged: [{ date: '2026-11-21', sets: ['25 x 12'] }] }],
    issues: [{ id: 'I-01', type: 'ambiguous_exercise', description: 'fixture' }],
    excluded: [{ item: 'Old plan', reason: 'fixture' }],
  };
  const sha = createHash('sha256').update(canonical(payload)).digest('hex');
  mkdirSync('test-results', { recursive: true });
  const path = 'test-results/weight-import-fixture.json';
  writeFileSync(path, JSON.stringify({ format: 'weight-notion-import', formatVersion: 1, packageId: `notion-fixture-${sha.slice(0, 12)}`, payloadSha256: sha, createdAt: '2026-11-24T00:00:00Z', source: { rootPageId: 'r', rootPageTitle: 'Fixture' }, payload }));
  return { path, real: false };
}

/** First logged set of the first session as displayed (real file vs. fixture). */
export function firstSet(path: string) {
  const p = JSON.parse(readFileSync(path, 'utf8')).payload;
  const s = [...p.sessions].sort((a: any, b: any) => a.localDate.localeCompare(b.localDate))[0];
  const set = s.exercises.find((e: any) => e.sets.length).sets[0];
  const fmt = (v: number) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1); };
  return { kg: `${fmt(set.weightKg)} kg × ${set.reps}`, lb: `${fmt(set.weightKg / 0.45359237)} lb × ${set.reps}` };
}

export const importStats = () => (existsSync('data/import/import-stats.json') ? JSON.parse(readFileSync('data/import/import-stats.json', 'utf8')) : null);

export async function fresh(page: Page, path = '') {
  await page.goto('./?e2e');
  await expect(page.getByTestId('today-date')).toBeVisible();
  if (path) await page.goto(`./?e2e#${path}`);
}

export async function doImport(page: Page) {
  const f = importFile();
  await page.goto('./?e2e#/import');
  await page.getByTestId('import-pick').waitFor();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-pick').click();
  await (await chooser).setFiles(f.path);
  await expect(page.getByTestId('import-preview')).toBeVisible();
  return f;
}

/** FND-02 AC2: every visible interactive element is at least 44×44 CSS px (inputs: 44 high). */
export async function assertHitAreas(page: Page) {
  const small = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button], .mantine-Checkbox-body, .mantine-Radio-body, .mantine-Switch-body')];
    return els.filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden' || e.closest('[aria-hidden=true]')) return false;
      const isInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName);
      const isLabelled = e.matches('.mantine-Checkbox-body, .mantine-Radio-body, .mantine-Switch-body');
      return isInput || isLabelled ? r.height < 43.5 : r.width < 43.5 || r.height < 43.5;
    }).map((e) => `${e.tagName}.${e.className.toString().slice(0, 60)} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`);
  });
  expect(small, small.join('\n')).toEqual([]);
}

export async function assertNamed(page: Page) {
  const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href], [role=button]')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !(e.getAttribute('aria-label') || e.textContent?.trim() || e.getAttribute('title') || e.getAttribute('aria-labelledby'));
  }).map((e) => e.outerHTML.slice(0, 120)));
  expect(unnamed, unnamed.join('\n')).toEqual([]);
}
