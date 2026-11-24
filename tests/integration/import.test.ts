import { describe, it, expect, beforeEach } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import { parsePackage, previewImport, applyImport, resolveExercise, countImported, countsForRecords, ImportError } from '../../src/features/import/importPackage';
import { canonicalJson, sha256Hex } from '../../src/domain/hash';

let n = 0;
const fresh = async () => { const db = new WeightDB(`t-imp-${++n}-${Math.random()}`); await db.open(); await ensureSeed(db); return db; };

/** Small synthetic TEST FIXTURE (not user data) so CI can run without the personal import file. */
async function fixture(mutate?: (p: Record<string, any>) => void) {
  const payload: Record<string, any> = {
    profile: { name: 'Test', timezone: 'Etc/GMT-3', weekStartsOn: 'SUN', injuries: [] },
    bodyMeasurements: [{ date: '2030-01-01', dateSource: 'test', weightKg: 80, waistCm: null, source: 'test' }],
    goals: [{ type: 'target_body_weight', target: 75, unit: 'kg', start: 80, startDate: '2030-01-01', source: 'test' }],
    program: {
      id: 'fx_prog', name: 'Fixture', status: 'active', split: 'full', startDate: '2030-01-01', endDate: '2030-01-14', weeksCount: 2, progressionRule: 'x', notionPageId: 'np',
      weeks: [{ week: 1, startDate: '2030-01-01', endDate: '2030-01-07', phase: 'A', rpe: '7', note: null }, { week: 2, startDate: '2030-01-08', endDate: '2030-01-14', phase: 'B', rpe: '8', note: null }],
      templates: [{ id: 'fx_prog__t', key: 't', name: 'T', focus: 'f', order: 1, weekday: 'TUE', warmup: [{ order: 1, exerciseId: 'stationary_bike', altExerciseIds: [], label: null, prescription: '5 min' }, { order: 2, exerciseId: null, altExerciseIds: [], label: 'Ramp', prescription: '50%' }],
        exercises: [{ order: 1, exerciseId: 'barbell_bench_press', targetSetsByWeek: [3, 4], targetReps: '6-8', restSec: 120, notes: '', supersetGroup: null, role: 'working' }, { order: 2, exerciseId: 'unresolved_x', targetSetsByWeek: [2, 2], targetReps: '10', restSec: 60, notes: '', supersetGroup: 'A', role: 'working' }] }],
      schedule: { pattern: { SUN: null, MON: null, TUE: 'fx_prog__t', WED: null, THU: null, FRI: null, SAT: null }, exceptions: [{ date: '2030-01-02', templateId: null, note: 'skip' }], planned: [{ date: '2030-01-01', templateId: 'fx_prog__t', week: 1, targetRpe: '7', notionPageId: 'pp', doneInNotion: true }] },
    },
    sessions: [{ id: 'notion_s1', localDate: '2030-01-01', dateSource: 'test', programId: 'fx_prog', templateId: 'fx_prog__t', week: 1, startedAt: null, endedAt: null, durationMin: null, kneePain: null, energy: null, notes: null, notionPageId: 's1', lastEditedInNotion: 'x',
      exercises: [
        { order: 1, exerciseId: 'barbell_bench_press', supersetGroup: null, status: 'completed', sets: [{ order: 1, setType: 'working', setTypeConfidence: 'assumed', weightKg: 40, reps: 8, completed: true, rpe: null, rawCell: '40 x 8' }] },
        { order: 2, exerciseId: 'unresolved_x', supersetGroup: 'A', status: 'completed', sets: [{ order: 1, setType: 'working', setTypeConfidence: 'assumed', weightKg: 20, reps: 10, completed: true, rpe: null, rawCell: '20 x 10' }] },
      ] }],
    unresolved: [{ provisionalId: 'unresolved_x', notionName: 'Row (machine or db)', name: 'Row?', issue: 'I-1', candidates: ['chest_supported_row_machine', 'chest_supported_row_db'], loadMode: 'stack', category: 'back', primary: ['upper_back'], secondary: ['lats'], usedInTemplates: ['T'], logged: [{ date: '2030-01-01', sets: ['20 x 10'] }] }],
    issues: [{ id: 'I-1', type: 'ambiguous_exercise', description: 'd' }],
    excluded: [{ item: 'Old plan', reason: 'scope' }],
  };
  mutate?.(payload);
  const sha = await sha256Hex(canonicalJson(payload));
  return JSON.stringify({ format: 'weight-notion-import', formatVersion: 1, packageId: `notion-fx-${sha.slice(0, 12)}`, payloadSha256: sha, createdAt: '2030-01-03T00:00:00Z', source: { rootPageId: 'r', rootPageTitle: 'Root' }, payload });
}

describe('MIG-01 / MIG-04 import (fixture)', () => {
  let db: WeightDB;
  beforeEach(async () => { db = await fresh(); });

  it('rejects non-JSON, wrong format and tampered files', async () => {
    await expect(parsePackage('nope')).rejects.toThrow(ImportError);
    await expect(parsePackage('{"format":"x"}')).rejects.toThrow(/Not a Weight import file/);
    const txt = await fixture();
    const tampered = txt.replace('"40 x 8"', '"45 x 8"');
    await expect(parsePackage(tampered)).rejects.toThrow(/Checksum mismatch/);
  });

  it('AC2: all-or-nothing – an error mid-import writes nothing', async () => {
    const pkg = await parsePackage(await fixture((p) => { p.unresolved[0].primary = ['not_a_muscle']; }));
    await expect(applyImport(db, pkg, 'f.json')).rejects.toThrow(/Unknown muscle group/);
    expect(await db.programs.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.migrations.count()).toBe(0);
    expect(await db.exercises.get('unresolved_x')).toBeUndefined();
  });

  it('missing library exercise blocks the import', async () => {
    const pkg = await parsePackage(await fixture((p) => { p.program.templates[0].exercises[0].exerciseId = 'does_not_exist'; }));
    const pv = await previewImport(db, pkg, 'f.json');
    expect(pv.missingExercises).toEqual(['does_not_exist']);
    await expect(applyImport(db, pkg, 'f.json')).rejects.toThrow(/missing/);
  });

  it('imports, verifies counts, and MIG-04 AC1: second run creates 0 records', async () => {
    const pkg = await parsePackage(await fixture());
    const r = await applyImport(db, pkg, 'f.json');
    expect(r.status).toBe('imported');
    expect(await countImported(db, pkg)).toEqual({ templates: 1, templateRows: 2, sessions: 1, sessionExercises: 2, sets: 2 });
    const totals = async () => Promise.all(db.tables.map((t) => t.count()));
    const before = await totals();
    const r2 = await applyImport(db, pkg, 'f.json');
    expect(r2).toEqual({ status: 'already_imported', created: 0 });
    expect(await totals()).toEqual(before);
    expect((await previewImport(db, pkg, 'f.json')).alreadyImported).toBe(true);
  });

  it('a different version of the same plan is blocked (would overwrite edits)', async () => {
    await applyImport(db, await parsePackage(await fixture()), 'a.json');
    const v2 = await parsePackage(await fixture((p) => { p.goals[0].target = 70; }));
    const pv = await previewImport(db, v2, 'b.json');
    expect(pv.conflict).toMatch(/already in the app/);
    await expect(applyImport(db, v2, 'b.json')).rejects.toThrow(ImportError);
  });

  it('MIG-02: resolve re-points template rows and sets; "later" keeps it loggable but out of records', async () => {
    await applyImport(db, await parsePackage(await fixture()), 'f.json');
    const prov = (await db.exercises.get('unresolved_x'))!;
    expect(prov.status).toBe('unresolved');
    expect(countsForRecords(prov)).toBe(false);
    const later = await resolveExercise(db, 'unresolved_x', null);
    expect(later.mappedTo).toBeNull();
    expect((await db.exercises.get('unresolved_x'))!.status).toBe('unresolved');
    const d = await resolveExercise(db, 'unresolved_x', 'chest_supported_row_db');
    expect(d).toMatchObject({ mappedTo: 'chest_supported_row_db', affectedRows: 1, affectedSets: 1 });
    expect(await db.templateExercises.where('exerciseId').equals('unresolved_x').count()).toBe(0);
    expect(await db.sessionExercises.where('exerciseId').equals('chest_supported_row_db').count()).toBe(1);
    const target = (await db.exercises.get('chest_supported_row_db'))!;
    expect(target.aliases).toContain('Row (machine or db)');
    expect((await db.exercises.get('unresolved_x'))!.mergedInto).toBe('chest_supported_row_db');
    const rec = (await db.migrations.toArray())[0];
    expect(rec.decisions.at(-1)).toMatchObject({ provisionalId: 'unresolved_x', mappedTo: 'chest_supported_row_db' });
    await expect(resolveExercise(db, 'unresolved_x', 'chest_supported_row_machine')).rejects.toThrow(/not waiting/);
  });
});

