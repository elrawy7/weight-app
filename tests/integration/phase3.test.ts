import { describe, it, expect, beforeEach } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import * as W from '../../src/features/workout/workoutOps';
import { recomputeRecords, purgeDiscarded, maintenance } from '../../src/features/progress/recordsOps';
import { historyItems, filterHistory, repeatSession, sessionDetail, compareSessions } from '../../src/features/history/historyOps';
import { dashboard, recommendations, exerciseProgress, muscleSummary, recordsOverview } from '../../src/features/progress/progressOps';
import { recentPerfs, weightContext, alternativeNames } from '../../src/features/workout/suggestionCtx';
import { suggest } from '../../src/domain/progression';
import { getSettings } from '../../src/db/defaults';

let db: WeightDB;
const T = '2026-01-01T00:00:00.000Z';
const BENCH = 'barbell_bench_press';

async function setup() {
  await db.programs.add({ id: 'p', name: 'Plan', split: 'x', status: 'active', startDate: '2026-11-21', endDate: '2026-12-19', weeks: [{ week: 1, startDate: '2026-11-21', endDate: '2026-12-19', phase: 'A', rpe: '7' }], source: 'app', createdAt: T, updatedAt: T });
  await db.templates.add({ id: 'ua', programId: 'p', name: 'Upper A', focus: '', orderIndex: 1, warmup: [], createdAt: T, updatedAt: T });
  await db.templateExercises.bulkAdd([
    { id: 'r1', templateId: 'ua', exerciseId: BENCH, orderIndex: 1, targetSetsByWeek: [3], targetReps: '8-12', restSec: 90, supersetGroup: null, notes: '', alternativeIds: [], role: 'working', createdAt: T, updatedAt: T },
    { id: 'r2', templateId: 'ua', exerciseId: 'leg_extension', orderIndex: 2, targetSetsByWeek: [2], targetReps: '10-12', restSec: 60, supersetGroup: null, notes: '', alternativeIds: [], role: 'working', createdAt: T, updatedAt: T },
  ]);
  await db.schedules.add({ id: 'sch', programId: 'p', pattern: { SUN: 'ua', MON: null, TUE: 'ua', WED: null, THU: 'ua', FRI: null, SAT: null }, startDate: '2026-11-21', endDate: '2026-12-19', exceptions: [], planned: [], createdAt: T, updatedAt: T });
}

/** Log a full workout on `date` with bench sets [kg, reps][] (and optional leg extension), then finish. */
async function log(date: string, bench: [number, number][], legExt?: { sets: [number, number][]; pain?: number }) {
  const s = await W.startWorkout(db, { programId: 'p', templateId: 'ua', week: 1, date, today: date });
  const ses = await db.sessionExercises.where('sessionId').equals(s.id).toArray();
  const fill = async (exId: string, sets: [number, number][]) => {
    const se = ses.find((x) => x.exerciseId === exId)!;
    let rows = await db.sets.where('sessionExerciseId').equals(se.id).sortBy('orderIndex');
    while (rows.length < sets.length) { await W.addSet(db, se.id); rows = await db.sets.where('sessionExerciseId').equals(se.id).sortBy('orderIndex'); }
    for (const [i, [w, r]] of sets.entries()) { await W.updateSet(db, rows[i].id, { weightKg: w, reps: r }); await W.toggleSetComplete(db, rows[i].id, { weightKg: null, reps: null }); }
    return se;
  };
  await fill(BENCH, bench);
  if (legExt) { const se = await fill('leg_extension', legExt.sets); if (legExt.pain != null) await W.setPain(db, se.id, legExt.pain); }
  await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' });
  return s;
}

beforeEach(async () => { db = new WeightDB(`t-p3-${Math.random()}`); await db.open(); await ensureSeed(db); await setup(); });

describe('PR-01 stored records + BR-PR-05 recompute', () => {
  it('finishing stores PRs; first workout is a baseline; TC-CRIT-12 max-weight PR = 50 kg from session 1', async () => {
    await log('2026-11-21', [[40, 12], [45, 10], [50, 8]]);
    expect(await db.personalRecords.where('exerciseId').equals(BENCH).count()).toBe(0); // baseline
    await log('2026-11-24', [[42.5, 12], [45, 10], [50, 8]]);
    const recs = await db.personalRecords.where('exerciseId').equals(BENCH).toArray();
    expect(recs.find((r) => r.type === 'max_weight')).toBeUndefined(); // 50 tie → no PR
    const p = await exerciseProgress(db, BENCH);
    expect(p!.stats.maxWeight).toMatchObject({ value: 50, date: '2026-11-21' });
  });
  it('HIST-03: editing 58.5×10 → 58.5×11 recalculates PRs and marks the session edited', async () => {
    await log('2026-11-21', [[58.5, 10]]);
    const s2 = await log('2026-11-24', [[58.5, 10]]);
    expect(await db.personalRecords.where('sessionId').equals(s2.id).count()).toBe(0);
    const se = (await db.sessionExercises.where('sessionId').equals(s2.id).toArray()).find((x) => x.exerciseId === BENCH)!;
    const [set] = await db.sets.where('sessionExerciseId').equals(se.id).sortBy('orderIndex');
    await W.updateSet(db, set.id, { reps: 11 });
    const recs = await db.personalRecords.where('sessionId').equals(s2.id).toArray();
    expect(recs.map((r) => r.type).sort()).toEqual(['e1rm', 'exercise_volume', 'reps_at_weight', 'session_volume']);
    expect((await db.sessions.get(s2.id))!.editedAt).toBeTruthy();
    // and the next suggestion follows the corrected history
    const recent = await recentPerfs(db, [BENCH], { id: 'x', localDate: '2026-11-30', startedAt: null });
    expect(recent.get(BENCH)![0].sets[0].reps).toBe(11);
  });
  it('HIST-04: deleting a session removes its PRs; restoring brings them back; purged after 30 days', async () => {
    await log('2026-11-21', [[40, 10]]);
    const s2 = await log('2026-11-24', [[50, 10]]);
    expect(await db.personalRecords.where('sessionId').equals(s2.id).count()).toBeGreaterThan(0);
    await W.discardSession(db, s2.id);
    expect(await db.personalRecords.where('sessionId').equals(s2.id).count()).toBe(0);
    await W.restoreSession(db, s2.id);
    expect(await db.personalRecords.where('sessionId').equals(s2.id).count()).toBeGreaterThan(0);
    await W.discardSession(db, s2.id);
    expect(await purgeDiscarded(db, Date.now() + 29 * 864e5)).toBe(0);
    expect(await purgeDiscarded(db, Date.now() + 31 * 864e5)).toBe(1);
    expect(await db.sessions.get(s2.id)).toBeUndefined();
    expect(await db.sessionExercises.where('sessionId').equals(s2.id).count()).toBe(0);
  });
  it('maintenance builds records once for existing data', async () => {
    await log('2026-11-21', [[40, 10]]);
    await log('2026-11-24', [[50, 10]]);
    await db.personalRecords.clear();
    await db.kv.delete('recordsVersion');
    await maintenance(db);
    expect((await recordsOverview(db)).current.length).toBeGreaterThan(0);
  });
  it('e1RM formula setting changes the stored e1RM', async () => {
    await log('2026-11-21', [[40, 5]]);
    await log('2026-11-24', [[50, 5]]);
    const ep = (await db.personalRecords.where('type').equals('e1rm').first())!.value;
    await db.settings.update('app', { e1rmFormula: 'brzycki' });
    await recomputeRecords(db);
    expect((await db.personalRecords.where('type').equals('e1rm').first())!.value).not.toBe(ep);
  });
});

describe('HIST-01/02/05/06', () => {
  it('list newest first; filters by program, muscle and exercise', async () => {
    await log('2026-11-21', [[40, 10]], { sets: [[30, 12]] });
    await log('2026-11-24', [[45, 10]]);
    const items = await historyItems(db);
    expect(items.map((i) => i.session.localDate)).toEqual(['2026-11-24', '2026-11-21']);
    expect(filterHistory(items, { exerciseId: 'leg_extension' })).toHaveLength(1);
    expect(filterHistory(items, { muscle: 'quadriceps' })).toHaveLength(1); // parent of quads
    expect(filterHistory(items, { muscle: 'chest' })).toHaveLength(2);
    expect(filterHistory(items, { programId: 'nope' })).toHaveLength(0);
  });
  it('detail shows sets, volume and PRs; repeat starts a new session with latest previous values', async () => {
    const s1 = await log('2026-11-21', [[40, 10]]);
    const s2 = await log('2026-11-24', [[45, 10]]);
    const d = await sessionDetail(db, s2.id);
    expect(d!.summary.volumeKg).toBe(450);
    expect(d!.records.some((r) => r.type === 'max_weight')).toBe(true);
    const n = await repeatSession(db, s1.id, '2026-11-26');
    const ses = await db.sessionExercises.where('sessionId').equals(n.id).toArray();
    expect(ses.find((x) => x.exerciseId === BENCH)!.snapshot).toMatchObject({ targetReps: '8-12', previous: { localDate: '2026-11-24' } });
    expect(n.status).toBe('active');
  });
  it('compare aligns the same exercise with deltas; others listed separately', async () => {
    const a = await log('2026-11-21', [[40, 10]], { sets: [[30, 12]] });
    const b = await log('2026-11-24', [[45, 10]]);
    const c = compareSessions((await sessionDetail(db, a.id))!, (await sessionDetail(db, b.id))!);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ exerciseId: BENCH, a: { volumeKg: 400 }, b: { volumeKg: 450 } });
    expect(c.onlyA.map((x) => x.se.exerciseId)).toEqual(['leg_extension']);
  });
});

describe('MG-01 / DASH-01…04 / TC-PAIN-01', () => {
  it('muscle summary vs previous period; dashboard completion, streak, totals', async () => {
    await log('2026-11-22', [[40, 10], [40, 10], [40, 10]]); // Sun
    await log('2026-11-24', [[42.5, 10], [42.5, 10], [42.5, 10]]); // Tue
    const m = await muscleSummary(db, '2026-11-22', '2026-11-28');
    expect(m.rows.find((r) => r.parentId === 'chest')).toMatchObject({ sets: 6, prev: 0 });
    expect(m.rows.find((r) => r.parentId === 'shoulders')).toMatchObject({ name: 'Shoulders', sets: 3, sub: { front_delts: 3 } }); // parent without its own row
    const d = await dashboard(db, '2026-11-25');
    expect(d.week).toMatchObject({ done: 2, scheduled: 3, start: '2026-11-22' });
    expect(d.streak).toBe(2);
    expect(d.totalWorkouts).toBe(2);
    expect(d.weekVolumeKg).toBe(1200 + 1275);
    expect(d.recentPrs.length).toBeGreaterThan(0);
  });
  it('recommendations: ready to progress and limited muscles', async () => {
    await log('2026-11-22', [[40, 12], [40, 12], [40, 12]]);
    const r = await recommendations(db, '2026-11-25');
    expect(r).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'progress', exerciseId: BENCH, topKg: 42.5 })]));
    expect(r.some((x) => x.kind === 'limited')).toBe(true);
  });
  it('TC-PAIN-01: pain 5 on leg extension → next suggestion has no increase and shows the alternative', async () => {
    await db.exerciseAlternatives.put({ exerciseId: 'leg_extension', alternativeId: 'leg_press', reason: 'knee-friendly' });
    await log('2026-11-22', [[40, 10]], { sets: [[30, 12], [30, 12]], pain: 5 });
    const recent = await recentPerfs(db, ['leg_extension'], { id: 'x', localDate: '2026-11-24', startedAt: null });
    const ex = (await db.exercises.get('leg_extension'))!;
    const s = suggest({ exercise: ex, recent: recent.get('leg_extension')!, targetReps: '10-12', today: '2026-11-24', weights: weightContext(ex, 5, await getSettings(db)), alternativeName: (await alternativeNames(db, ['leg_extension'])).get('leg_extension') });
    expect(s).toMatchObject({ kind: 'hold', rule: 'BR-PO-01' });
    expect(s!.alternative).toBeTruthy();
    expect(s!.message).toContain(s!.alternative!);
  });
});
