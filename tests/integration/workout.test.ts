import { describe, it, expect, beforeEach } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import * as W from '../../src/features/workout/workoutOps';
import type { WorkoutSession } from '../../src/db/types';

let db: WeightDB;
const T = '2026-01-01T00:00:00.000Z';
const BENCH = 'barbell_bench_press';

async function setupProgram() {
  await db.programs.add({ id: 'p', name: 'Plan', split: 'x', status: 'active', weeks: [], source: 'app', createdAt: T, updatedAt: T });
  await db.programs.add({ id: 'p2', name: 'Other', split: 'x', status: 'draft', weeks: [], source: 'app', createdAt: T, updatedAt: T });
  await db.templates.bulkAdd([
    { id: 'ua', programId: 'p', name: 'Upper A', focus: '', orderIndex: 1, warmup: [], createdAt: T, updatedAt: T },
    { id: 'other', programId: 'p2', name: 'Push Day', focus: '', orderIndex: 1, warmup: [], createdAt: T, updatedAt: T },
  ]);
  const row = (id: string, templateId: string, exerciseId: string, orderIndex: number, extra = {}) => ({
    id, templateId, exerciseId, orderIndex, targetSetsByWeek: [3, 3, 4, 2], targetReps: '8-10', restSec: 90, supersetGroup: null, notes: '', alternativeIds: [], role: 'working', createdAt: T, updatedAt: T, ...extra,
  });
  await db.templateExercises.bulkAdd([
    row('r1', 'ua', BENCH, 1),
    row('r2', 'ua', 'lat_pulldown_wide', 2, { supersetGroup: 'A' }),
    row('r3', 'ua', 'leg_press', 3, { supersetGroup: 'A', restSec: 60 }),
    row('r4', 'ua', 'treadmill_incline_walk', 4, { role: 'cardio', targetReps: '20 min' }),
    row('o1', 'other', BENCH, 1, { targetSetsByWeek: [4] }),
  ]);
}

/** Imported-style history: completed session with given bench sets. */
async function history(id: string, localDate: string, sets: [number, number, (0 | 1)?, string?][], startedAt: string | null = null, status: WorkoutSession['status'] = 'completed') {
  await db.sessions.add({ id, programId: 'p', templateId: 'ua', status, startedAt, endedAt: null, pausedMs: 0, localDate, notes: '', source: 'notion_import', createdAt: T, updatedAt: T });
  await db.sessionExercises.add({ id: `${id}_se`, sessionId: id, exerciseId: BENCH, orderIndex: 1, status: 'completed', supersetGroup: null, notes: '', createdAt: T, updatedAt: T });
  await db.sets.bulkAdd(sets.map(([w, r, c = 1, type = 'working'], i) => ({
    id: `${id}_s${i}`, sessionExerciseId: `${id}_se`, orderIndex: i + 1, setType: type as 'working', weightKg: w, inputUnit: 'kg' as const, reps: r, rpe: null, completed: c,
    side: 'both' as const, setTypeConfidence: 'recorded' as const, createdAt: T, updatedAt: T,
  })));
}

const exOf = async (sessionId: string, exerciseId: string) => (await db.sessionExercises.where('sessionId').equals(sessionId).toArray()).find((x) => x.exerciseId === exerciseId)!;
const setsOf = async (seId: string) => db.sets.where('sessionExerciseId').equals(seId).sortBy('orderIndex');

beforeEach(async () => { db = new WeightDB(`t-wo-${Math.random()}`); await db.open(); await ensureSeed(db); await setupProgram(); });

describe('WO-01 / PROG-06 start a workout', () => {
  it('snapshots template targets for the week and creates set rows', async () => {
    const s = await W.startWorkout(db, { programId: 'p', templateId: 'ua', week: 3, date: '2026-12-08', today: '2026-12-08' });
    expect(s).toMatchObject({ status: 'active', logType: 'full', localDate: '2026-12-08', programWeek: 3 });
    const bench = await exOf(s.id, BENCH);
    expect(bench.snapshot).toMatchObject({ targetSets: 4, targetReps: '8-10', restSec: 90, templateExerciseId: 'r1' });
    expect(await setsOf(bench.id)).toHaveLength(4);
    const walk = await exOf(s.id, 'treadmill_incline_walk');
    expect(walk.cardio).toEqual({});
    expect(await setsOf(walk.id)).toHaveLength(0);
    // PROG-06 AC1: editing the template later does not change the session
    await db.templateExercises.update('r1', { restSec: 30, targetSetsByWeek: [1, 1, 1, 1] });
    expect((await exOf(s.id, BENCH)).snapshot).toMatchObject({ targetSets: 4, restSec: 90 });
  });
  it('refuses future dates and a second running workout (BR-SES-05); allows a past day', async () => {
    await expect(W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-25', today: '2026-11-24' })).rejects.toThrow(/today or a past day/);
    const past = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-21', today: '2026-11-24' });
    expect(past.localDate).toBe('2026-11-21');
    await expect(W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' })).rejects.toThrow(/still in progress/);
  });
  it('AC2: empty workout on any day', async () => {
    const s = await W.startWorkout(db, { week: null, date: '2026-11-24', today: '2026-11-24' });
    expect(await db.sessionExercises.where('sessionId').equals(s.id).count()).toBe(0);
    await W.addExercise(db, s.id, BENCH);
    expect(await db.sessionExercises.where('sessionId').equals(s.id).count()).toBe(1);
  });
});

describe('WO-03 previous performance (BR-PP)', () => {
  it('AC1: Week 2 shows the Week 1 sets of the same exercise, across programs', async () => {
    await history('w1', '2026-11-21', [[30, 8], [35, 8], [40, 8]]);
    const s = await W.startWorkout(db, { templateId: 'other', week: 1, date: '2026-11-29', today: '2026-11-29' });
    const prev = (await exOf(s.id, BENCH)).snapshot!.previous!;
    expect(prev).toMatchObject({ localDate: '2026-11-21', templateName: 'Upper A' });
    expect(prev.sets.map((x) => `${x.weightKg}x${x.reps}`)).toEqual(['30x8', '35x8', '40x8']);
  });
  it('AC2: uncompleted, skipped and warm-up sets are not previous values; discarded/active sessions ignored', async () => {
    await history('w1', '2026-11-21', [[20, 10, 1, 'warmup'], [30, 8], [35, 6, 0]]);
    await history('disc', '2026-11-25', [[99, 1]], null, 'discarded');
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-28', today: '2026-11-28' });
    const prev = (await exOf(s.id, BENCH)).snapshot!.previous!;
    expect(prev.sets).toEqual([{ weightKg: 30, reps: 8, setType: 'working', durationSec: null }]);
    expect(prev.warmups).toHaveLength(1);
  });
  it('skips a later session whose bench had no completed working set (BR-PP-02)', async () => {
    await history('w1', '2026-11-21', [[30, 8]]);
    await history('w2', '2026-11-25', [[40, 8, 0]]);
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-28', today: '2026-11-28' });
    expect((await exOf(s.id, BENCH)).snapshot!.previous!.sessionId).toBe('w1');
  });
  it('AC3: alignment by set; an extra set shows "—" and prefills from the last previous set', () => {
    const prev = { sessionId: 'x', localDate: '2026-11-21', sets: [{ weightKg: 30, reps: 8, setType: 'working' as const }, { weightKg: 35, reps: 8, setType: 'working' as const }, { weightKg: 40, reps: 8, setType: 'working' as const }], warmups: [], painScore: null };
    expect(W.alignedPrevious(prev, 0).shown?.weightKg).toBe(30);
    expect(W.alignedPrevious(prev, 3)).toEqual({ shown: null, prefill: prev.sets[2] });
    expect(W.alignedPrevious(null, 0)).toEqual({ shown: null, prefill: null });
  });
  it('AC4: two sessions on the same date → the later startedAt wins', async () => {
    await history('am', '2026-11-21', [[30, 8]], '2026-11-21T06:00:00.000Z');
    await history('pm', '2026-11-21', [[32.5, 8]], '2026-11-21T15:00:00.000Z');
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    expect((await exOf(s.id, BENCH)).snapshot!.previous!.sessionId).toBe('pm');
  });
  it('AC5: first time → null; back-logging a past day only looks at earlier sessions', async () => {
    let s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    expect((await exOf(s.id, BENCH)).snapshot!.previous).toBeNull();
    await W.discardSession(db, s.id);
    await history('later', '2026-11-23', [[50, 5]]);
    s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-21', today: '2026-11-24' });
    expect((await exOf(s.id, BENCH)).snapshot!.previous).toBeNull();
  });
  it('AC6: frozen — editing the referenced session during the workout does not change the shown reference', async () => {
    await history('w1', '2026-11-21', [[30, 8], [35, 8]]);
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-28', today: '2026-11-28' });
    await db.sets.update('w1_s0', { weightKg: 100 });
    expect((await exOf(s.id, BENCH)).snapshot!.previous!.sets[0].weightKg).toBe(30);
  });
});

describe('WO-04/05/06 logging sets', () => {
  it('ticking ✓ records ghost values; edits never change history (WO-04 AC2)', async () => {
    await history('w1', '2026-11-21', [[30, 8], [35, 8], [40, 8]]);
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-28', today: '2026-11-28' });
    const se = await exOf(s.id, BENCH);
    const [a, b] = await setsOf(se.id);
    const r1 = await W.toggleSetComplete(db, a.id, { weightKg: 30, reps: 8 });
    expect(r1).toEqual({ completed: true, startRest: true, restSec: 90 });
    await W.updateSet(db, b.id, { weightKg: 37.5 });
    await W.toggleSetComplete(db, b.id, { weightKg: 35, reps: 8 });
    const after = await setsOf(se.id);
    expect(after.slice(0, 2).map((x) => [x.weightKg, x.reps, x.completed])).toEqual([[30, 8, 1], [37.5, 8, 1]]);
    expect((await db.sets.get('w1_s1'))!.weightKg).toBe(35);
    expect((await db.sessionExercises.get(se.id))!.status).toBe('in_progress');
    // un-tick
    expect((await W.toggleSetComplete(db, a.id, { weightKg: 30, reps: 8 })).completed).toBe(false);
  });
  it('validation; reps required; RPE 6–10 in 0.5', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await expect(W.toggleSetComplete(db, a.id, { weightKg: 20, reps: null })).rejects.toThrow(/reps/);
    await expect(W.updateSet(db, a.id, { reps: 2.5 })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { weightKg: -1 })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { rpe: 7.3 })).rejects.toThrow();
    await W.updateSet(db, a.id, { rpe: 8.5, setType: 'failure' });
    expect(await db.sets.get(a.id)).toMatchObject({ rpe: 8.5, setType: 'failure' });
  });
  it('add set copies the last set; remove + undo', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const se = await exOf(s.id, BENCH);
    const sets = await setsOf(se.id);
    await W.updateSet(db, sets[2].id, { weightKg: 42.5, reps: 9 });
    const added = await W.addSet(db, se.id);
    expect(added).toMatchObject({ orderIndex: 4, weightKg: 42.5, reps: 9, completed: 0 });
    const removed = await W.removeSet(db, added.id);
    expect(await setsOf(se.id)).toHaveLength(3);
    await W.restoreSet(db, removed);
    expect(await setsOf(se.id)).toHaveLength(4);
  });
  it('warm-ups do not start the rest timer and are excluded from volume (WO-06 AC3)', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const se = await exOf(s.id, BENCH);
    const w = await W.addSet(db, se.id, 'warmup');
    await W.updateSet(db, w.id, { weightKg: 20, reps: 10 });
    expect((await W.toggleSetComplete(db, w.id, { weightKg: null, reps: null })).startRest).toBe(false);
    const [a] = await setsOf(se.id);
    await W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 8 });
    expect((await W.summarize(db, s.id)).volumeKg).toBe(320);
  });
  it('duration sets (plank) need seconds', async () => {
    const s = await W.startWorkout(db, { week: null, date: '2026-11-24', today: '2026-11-24' });
    const se = await W.addExercise(db, s.id, 'plank');
    const [a] = await setsOf(se.id);
    await expect(W.toggleSetComplete(db, a.id, { weightKg: null, reps: null }, 'duration')).rejects.toThrow(/seconds/);
    await W.toggleSetComplete(db, a.id, { weightKg: null, reps: null, durationSec: 40 }, 'duration');
    expect(await db.sets.get(a.id)).toMatchObject({ durationSec: 40, completed: 1 });
  });
});

describe('WO-07/09/13/14 exercise actions', () => {
  it('WO-09 superset: rest only after the last exercise of the round', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const [a1] = await setsOf((await exOf(s.id, 'lat_pulldown_wide')).id);
    const [a2] = await setsOf((await exOf(s.id, 'leg_press')).id);
    expect((await W.toggleSetComplete(db, a1.id, { weightKg: 40, reps: 10 })).startRest).toBe(false);
    expect(await W.toggleSetComplete(db, a2.id, { weightKg: 80, reps: 10 })).toMatchObject({ startRest: true, restSec: 60 });
  });
  it('WO-07 replace gets its own previous; skipped is excluded from lookups', async () => {
    await history('w1', '2026-11-21', [[30, 8]]);
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const bench = await exOf(s.id, BENCH);
    const rep = await W.replaceExercise(db, bench.id, 'leg_press');
    expect((await db.sessionExercises.get(bench.id))!.status).toBe('replaced');
    expect(rep.snapshot).toMatchObject({ targetSets: 3, targetReps: '8-10', previous: null });
    const order = (await db.sessionExercises.where('sessionId').equals(s.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex).map((x) => x.orderIndex);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' });
    const s2 = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-25', today: '2026-11-25' });
    expect((await exOf(s2.id, BENCH)).snapshot!.previous!.sessionId).toBe('w1');
  });
  it('reorder saves immediately', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const bench = await exOf(s.id, BENCH);
    await W.moveExercise(db, s.id, bench.id, 1);
    expect((await db.sessionExercises.get(bench.id))!.orderIndex).toBe(2);
  });
  it('WO-13 cardio and WO-14 pain', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    const walk = await exOf(s.id, 'treadmill_incline_walk');
    await W.setCardio(db, walk.id, { durationMin: 20, inclinePct: 8, speedKmh: 5, distanceM: 1700 }, true);
    expect(await db.sessionExercises.get(walk.id)).toMatchObject({ status: 'completed', cardio: { durationMin: 20, inclinePct: 8 } });
    const bench = await exOf(s.id, BENCH);
    await expect(W.setPain(db, bench.id, 11)).rejects.toThrow();
    await W.setPain(db, bench.id, 5);
    const [a] = await setsOf(bench.id);
    await W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 8 });
    expect((await W.summarize(db, s.id)).painFlags[0]).toMatch(/5\/10/);
  });
});

describe('WO-10/11 pause, finish, discard, stale', () => {
  it('pause time is excluded; finish marks untouched exercises skipped and stores the summary', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    await db.sessions.update(s.id, { startedAt: new Date(Date.now() - 60 * 60000).toISOString() });
    await db.sessions.update(s.id, { status: 'paused', pausedAt: new Date(Date.now() - 20 * 60000).toISOString() });
    await W.pauseSession(db, s.id, false);
    const resumed = (await db.sessions.get(s.id))!;
    expect(resumed.status).toBe('active');
    expect(Math.round(resumed.pausedMs / 60000)).toBe(20);
    expect(Math.round(W.elapsedMs(resumed) / 60000)).toBe(40);
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 8 });
    const sum = await W.summarize(db, s.id);
    expect(sum).toMatchObject({ setsDone: 1, setsPlanned: 9, volumeKg: 320, exercisesDone: 1 });
    expect(sum.incomplete).toHaveLength(3);
    await W.finishSession(db, s.id, { kneePain: 2, energy: 4, notes: ' good ' });
    const fin = (await db.sessions.get(s.id))!;
    expect(fin).toMatchObject({ status: 'completed', kneePain: 2, energy: 4, notes: 'good', durationMin: 40 });
    expect((await exOf(s.id, 'leg_press')).status).toBe('skipped');
    expect(await W.activeSession(db)).toBeUndefined();
  });
  it('discard is a soft delete and can be restored', async () => {
    const s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    await W.discardSession(db, s.id);
    expect((await db.sessions.get(s.id))!.status).toBe('discarded');
    expect(await W.activeSession(db)).toBeUndefined();
    await W.restoreSession(db, s.id);
    expect((await db.sessions.get(s.id))!.status).toBe('paused');
  });
  it('stale after 6 hours of no activity (BR-SES-09)', () => {
    const now = Date.parse('2026-11-24T20:00:00Z');
    expect(W.isStale({ status: 'active', lastActivityAt: '2026-11-24T13:00:00Z', startedAt: null }, now)).toBe(true);
    expect(W.isStale({ status: 'active', lastActivityAt: '2026-11-24T15:00:00Z', startedAt: null }, now)).toBe(false);
    expect(W.isStale({ status: 'completed', lastActivityAt: '2026-11-24T01:00:00Z', startedAt: null }, now)).toBe(false);
  });
  it('quick log converts to a full log', async () => {
    await db.sessions.add({ id: 'q', programId: 'p', templateId: 'ua', programWeek: 1, status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-24', notes: '', source: 'app', logType: 'quick', createdAt: T, updatedAt: T });
    await W.quickToFull(db, 'q');
    expect((await db.sessions.get('q'))!.logType).toBe('full');
    expect(await db.sessionExercises.where('sessionId').equals('q').count()).toBe(4);
  });
});

describe('BR-PO suggestions (hints only)', () => {
  const ex = { status: 'active' as const, loadMode: 'total' as const };
  const prev = (reps: number[], extra = {}) => ({ sessionId: 'x', localDate: '2026-11-21', sets: reps.map((r) => ({ weightKg: 40, reps: r, setType: 'working' as const })), warmups: [], painScore: null, ...extra });
  const base = { exercise: ex, targetReps: '8-10', incrementKg: 2.5, today: '2026-11-28' };
  it('all at top → +increment; within → +1 rep; below once → hold; below twice → reduce', () => {
    expect(W.suggest({ ...base, prev: prev([10, 10, 10]) })).toMatchObject({ kind: 'increase', deltaKg: 2.5, repsTarget: '8' });
    expect(W.suggest({ ...base, prev: prev([9, 8, 8]) })).toMatchObject({ kind: 'more_reps', deltaKg: 0 });
    // BR-PO-04: top of range but RPE above target + 0.5 → no increase
    const hard = { ...prev([10, 10]), sets: [{ weightKg: 40, reps: 10, setType: 'working' as const, rpe: 9.5 }, { weightKg: 40, reps: 10, setType: 'working' as const, rpe: 9 }] };
    expect(W.suggest({ ...base, targetRpe: '7-8', prev: hard })).toMatchObject({ kind: 'hold' });
    expect(W.suggest({ ...base, targetRpe: '9', prev: hard })).toMatchObject({ kind: 'increase' });
    expect(W.suggest({ ...base, prev: prev([8, 7, 6]) })).toMatchObject({ kind: 'hold' });
    expect(W.suggest({ ...base, prev: prev([8, 7, 6], { olderSets: [{ weightKg: 40, reps: 6, setType: 'working' }] }) })).toMatchObject({ kind: 'reduce', deltaKg: -2.5 });
  });
  it('pain ≥4 blocks increases; breaks reduce load; unresolved/no history → none', () => {
    expect(W.suggest({ ...base, prev: prev([10, 10], { painScore: 4 }) })).toMatchObject({ kind: 'hold' });
    expect(W.suggest({ ...base, today: '2026-12-08', prev: prev([10]) })).toMatchObject({ kind: 'deload_break', deltaKg: -5 });
    expect(W.suggest({ ...base, today: '2027-01-10', prev: prev([10]) })).toMatchObject({ kind: 'deload_break', deltaKg: -10 });
    expect(W.suggest({ ...base, exercise: { status: 'unresolved', loadMode: 'total' }, prev: prev([10]) })).toBeNull();
    expect(W.suggest({ ...base, prev: null })).toBeNull();
  });
  it('parseRepRange', () => {
    expect(W.parseRepRange('8-10')).toEqual({ min: 8, max: 10 });
    expect(W.parseRepRange('12 – 15 reps')).toEqual({ min: 12, max: 15 });
    expect(W.parseRepRange('12')).toEqual({ min: 12, max: 12 });
    expect(W.parseRepRange('20 min')).toBeNull();
  });
});

describe('TMR-01/02 rest timer state', () => {
  it('timestamps survive; ±15, pause/resume, restart, skip', async () => {
    const t0 = 1_000_000;
    await W.startRest(db, { sessionId: 's', exerciseName: 'Bench', durationSec: 90 }, t0);
    const get = async () => (await db.kv.get(W.REST_KEY))?.value as W.RestTimerState;
    expect(W.restRemaining(await get(), t0 + 30_000)).toBe(60);
    await W.adjustRest(db, 'plus', t0); expect((await get()).durationSec).toBe(105);
    await W.adjustRest(db, 'minus', t0); expect((await get()).durationSec).toBe(90);
    await W.adjustRest(db, 'pause', t0 + 30_000);
    expect(W.restRemaining(await get(), t0 + 90_000)).toBe(60);
    await W.adjustRest(db, 'resume', t0 + 90_000);
    expect(W.restRemaining(await get(), t0 + 120_000)).toBe(30);
    await W.adjustRest(db, 'restart', t0 + 200_000);
    expect(W.restRemaining(await get(), t0 + 200_000)).toBe(90);
    await W.adjustRest(db, 'skip');
    expect(await db.kv.get(W.REST_KEY)).toBeUndefined();
  });
});

describe('PRs (WO-02 / WO-10 summary)', () => {
  it('heavier than ever → weight PR; first time → no PR', async () => {
    let s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-20', today: '2026-11-24' });
    let [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 8 });
    expect(await W.sessionPRs(db, s.id)).toEqual([]);
    await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '', durationMin: 55 });
    expect((await db.sessions.get(s.id))!.durationMin).toBe(55);
    s = await W.startWorkout(db, { templateId: 'ua', week: 1, date: '2026-11-24', today: '2026-11-24' });
    [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await W.toggleSetComplete(db, a.id, { weightKg: 42.5, reps: 6 });
    expect(await W.sessionPRs(db, s.id)).toMatchObject([{ kind: 'weight', value: 42.5 }]);
    expect(await W.bestBefore(db, BENCH, s)).toMatchObject({ maxWeightKg: 40, maxReps: 8 });
  });
});

describe('WO-12 exercise history', () => {
  it('lists completed sessions newest first with the best set', async () => {
    await history('w1', '2026-11-21', [[30, 8], [40, 8]]);
    await history('w2', '2026-11-25', [[42.5, 6], [42.5, 7]]);
    await history('d', '2026-11-26', [[90, 1]], null, 'discarded');
    const h = await W.exerciseHistory(db, BENCH);
    expect(h.map((x) => x.localDate)).toEqual(['2026-11-25', '2026-11-21']);
    expect(h[0].best).toMatchObject({ weightKg: 42.5, reps: 7 });
    expect(h[1].templateName).toBe('Upper A');
  });
});

describe('WO-17 estimated duration', () => {
  it('sets × (40 s + rest) + cardio minutes + warm-up minutes, rounded to 5', () => {
    expect(W.estimateMinutes([{ sets: 3, rest: 120, role: 'working', reps: '6-8' }, { sets: 3, rest: 60, role: 'working', reps: '10' }, { sets: 1, rest: 0, role: 'cardio', reps: '20 min incline walk' }], [{ prescription: '5 min' }, { prescription: '10 each' }]))
      .toBe(40); // 480 + 300 + 1200 + 300 + 60 = 2340 s ≈ 39 → 40
    expect(W.estimateMinutes([])).toBe(5);
  });
});

describe('PROG-07 start another day today + shift (DB)', () => {
  async function plan() {
    await db.programs.update('p', { startDate: '2026-11-21', endDate: '2026-11-28', weeks: [{ week: 1, startDate: '2026-11-21', endDate: '2026-11-28', phase: 'A', rpe: '7' }] });
    await db.templates.bulkAdd([
      { id: 'co', programId: 'p', name: 'Conditioning', focus: '', orderIndex: 2, warmup: [], createdAt: T, updatedAt: T },
      { id: 'lb', programId: 'p', name: 'Lower B', focus: '', orderIndex: 3, warmup: [], createdAt: T, updatedAt: T },
    ]);
    await db.schedules.add({ id: 'sch', programId: 'p', pattern: { SUN: null, MON: null, TUE: null, WED: null, THU: null, FRI: null, SAT: null }, startDate: '2026-11-21', endDate: '2026-11-28',
      exceptions: [], planned: [
        { date: '2026-11-23', templateId: 'ua', week: 1, targetRpe: '7' }, { date: '2026-11-24', templateId: 'co', week: 1, targetRpe: '7' },
        { date: '2026-11-26', templateId: 'lb', week: 1, targetRpe: '7' },
      ], createdAt: T, updatedAt: T });
  }
  it('lists missed + upcoming days; catch-up shifts and extends; undo restores', async () => {
    const PS = await import('../../src/features/workout/planShift');
    await plan();
    const src = await PS.shiftSources(db, '2026-11-24');
    expect(src.missed.map((x) => x.date)).toEqual(['2026-11-23']);
    expect(src.upcoming.map((x) => x.date)).toEqual(['2026-11-26']);
    const s = await PS.startFromDay(db, { today: '2026-11-24', source: '2026-11-23', shift: true });
    expect(s).toMatchObject({ templateId: 'ua', localDate: '2026-11-24', programWeek: 1 });
    const sch = (await db.schedules.get('sch'))!;
    expect(sch.planned.filter((p) => p.date >= '2026-11-24').map((p) => `${p.date}:${p.templateId}`)).toEqual(['2026-11-24:ua', '2026-11-26:co', '2026-11-27:lb']);
    expect((await db.programs.get('p'))!.endDate).toBe('2026-11-28'); // 27th is inside the plan already
    await W.discardSession(db, s.id);
    expect(await PS.undoShift(db)).toBe(true);
    expect((await db.schedules.get('sch'))!.planned.map((p) => p.templateId)).toEqual(['ua', 'co', 'lb']);
  });
  it('extra workout: plan unchanged; a running workout blocks any change', async () => {
    const PS = await import('../../src/features/workout/planShift');
    await plan();
    const s = await PS.startFromDay(db, { today: '2026-11-24', source: '2026-11-26', shift: false });
    expect(s.templateId).toBe('lb');
    expect((await db.schedules.get('sch'))!.planned.map((p) => p.templateId)).toEqual(['ua', 'co', 'lb']);
    await expect(PS.startFromDay(db, { today: '2026-11-24', source: '2026-11-23', shift: true })).rejects.toThrow(/still in progress/);
    expect((await db.schedules.get('sch'))!.planned.map((p) => p.templateId)).toEqual(['ua', 'co', 'lb']);
  });
  it('plan grows past the program end → program end and last week stretched', async () => {
    const PS = await import('../../src/features/workout/planShift');
    await plan();
    await db.schedules.update('sch', { endDate: '2026-11-26' });
    await db.programs.update('p', { endDate: '2026-11-26', weeks: [{ week: 1, startDate: '2026-11-21', endDate: '2026-11-26', phase: 'A', rpe: '7' }] });
    await PS.startFromDay(db, { today: '2026-11-24', source: '2026-11-23', shift: true });
    const p = (await db.programs.get('p'))!;
    expect(p.endDate).toBe('2026-11-27');
    expect(p.weeks[0].endDate).toBe('2026-11-27');
  });
});
