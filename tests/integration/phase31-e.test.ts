/** Phase 3.1 E – template edits never change logged history; data written before Phase 3.1 keeps working. */
import { describe, it, expect, beforeEach } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import { CURRENT_SCHEMA_VERSION } from '../../src/db/schema';
import * as P from '../../src/features/programs/programOps';
import * as W from '../../src/features/workout/workoutOps';
import * as H from '../../src/features/history/historyOps';
import * as B from '../../src/features/backup/backup';
import { getSettings } from '../../src/db/defaults';
import { maintenance } from '../../src/features/progress/recordsOps';

let n = 0;
const fresh = async () => { const db = new WeightDB(`t-e31-${++n}-${Math.random()}`); await db.open(); await ensureSeed(db); return db; };
const BENCH = 'barbell_bench_press';

async function loggedWorkout(db: WeightDB) {
  const prog = await P.createProgram(db, 'Plan');
  const tp = await P.addTemplate(db, prog.id, 'Push day');
  const row = await P.addRow(db, tp.id, BENCH);
  await P.updateRow(db, row.id, { targetReps: '6-8', targetSetsByWeek: [2] });
  const row2 = await P.addRow(db, tp.id, 'plank');
  const s = await W.startWorkout(db, { programId: prog.id, templateId: tp.id, week: 1, date: '2026-11-20', today: '2026-11-20' });
  const se = (await db.sessionExercises.where('sessionId').equals(s.id).toArray()).find((x) => x.exerciseId === BENCH)!;
  const sets = await db.sets.where('sessionExerciseId').equals(se.id).sortBy('orderIndex');
  await W.updateSet(db, sets[0].id, { weightKg: 60, reps: 8 }); await W.toggleSetComplete(db, sets[0].id, { weightKg: null, reps: null });
  await W.updateSet(db, sets[1].id, { weightKg: 62.5, reps: 7 }); await W.toggleSetComplete(db, sets[1].id, { weightKg: null, reps: null });
  await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' });
  return { prog, tp, row, row2, s };
}

describe('E – template edits do not change history', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); });

  it('changing targets, removing rows, renaming and deleting the template leave the logged workout as it was', async () => {
    const { tp, row, row2, s } = await loggedWorkout(db);
    const detail0 = await H.sessionDetail(db, s.id);
    const items0 = (await H.historyItems(db)).find((x) => x.session.id === s.id)!;
    const hist0 = await W.exerciseHistory(db, BENCH);
    const prs0 = (await db.personalRecords.toArray()).map(({ id: _i, ...r }) => r);
    expect(detail0!.templateName).toBe('Push day');

    await P.updateRow(db, row.id, { targetReps: '12-15', targetSetsByWeek: [5] });
    await P.removeRow(db, row2.id);
    await db.templates.update(tp.id, { name: 'Renamed' });
    const detail1 = await H.sessionDetail(db, s.id);
    expect(detail1!.exercises.map((e) => [e.se.exerciseId, e.se.snapshot?.targetReps, e.se.snapshot?.targetSets, e.sets.map((x) => [x.weightKg, x.reps, x.completed])]))
      .toEqual(detail0!.exercises.map((e) => [e.se.exerciseId, e.se.snapshot?.targetReps, e.se.snapshot?.targetSets, e.sets.map((x) => [x.weightKg, x.reps, x.completed])]));
    expect(detail1!.templateName).toBe('Push day'); // the name it had when it was done
    expect((await H.historyItems(db)).find((x) => x.session.id === s.id)!.templateName).toBe(items0.templateName);

    await P.deleteTemplate(db, tp.id);
    const detail2 = await H.sessionDetail(db, s.id);
    expect(detail2!.exercises.length).toBe(detail0!.exercises.length);
    expect(detail2!.templateName).toBe('Push day');
    expect((await W.exerciseHistory(db, BENCH)).map((h) => [h.localDate, h.templateName, h.sets.map((x) => x.weightKg)])).toEqual(hist0.map((h) => [h.localDate, h.templateName, h.sets.map((x) => x.weightKg)]));
    expect((await db.personalRecords.toArray()).map(({ id: _i, ...r }) => r)).toEqual(prs0);
  });
});

describe('E – data written before Phase 3.1 (no schema change, optional new fields)', () => {
  it('schema version is unchanged – no migration, nothing destructive', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it('old settings, sessions and rest timer work with the new code', async () => {
    const db = await fresh();
    const { s } = await loggedWorkout(db);
    // shape of a pre-3.1 database: no workoutDensity / platePairs, no skippedRemaining, timer without setId, no recordsDirty
    const st = (await db.settings.get('app'))!;
    const { workoutDensity: _d, platePairs: _p, ...old } = st as typeof st & { platePairs?: unknown };
    await db.settings.put(old as typeof st);
    expect((await getSettings(db)).workoutDensity).toBe('compact');
    for (const se of await db.sessionExercises.toArray()) { const { skippedRemaining: _s, ...o } = se; await db.sessionExercises.put(o); }
    await db.kv.put({ key: 'restTimer', value: { sessionId: s.id, exerciseName: 'x', startedAt: 1, durationSec: 90, pausedAt: null, pausedTotalMs: 0 } });
    await db.kv.delete('recordsDirty');
    const r = await maintenance(db);
    expect(r.staleTimer).toBe(true);
    const sum = await W.summarize(db, s.id);
    expect(sum.setsDone).toBe(2);
    // a backup from such a database restores
    const pv = await B.inspectBackup(db, (await B.createBackup(db, '0.1.0')).blob);
    expect(pv.counts.sets).toBeGreaterThan(0);
  });
});

describe('I-03 – repeat workout is atomic like start (A-01)', () => {
  it('a double tap on Repeat creates one running workout', async () => {
    const db = await fresh();
    const { s } = await loggedWorkout(db);
    const r = await Promise.allSettled([H.repeatSession(db, s.id, '2026-11-27'), H.repeatSession(db, s.id, '2026-11-27')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await db.sessions.where('status').anyOf('active', 'paused').count()).toBe(1);
    const fresh1 = (r.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ id: string; templateName?: string }>).value;
    expect(fresh1.templateName).toBe('Push day');
  });
});
