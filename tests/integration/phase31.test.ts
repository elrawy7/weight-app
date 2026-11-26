/**
 * Phase 3.1 regression tests – each block reproduces one external finding (A-01…A-07).
 * Written first against baseline 5af66bf to confirm the finding, then kept as the regression test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import * as W from '../../src/features/workout/workoutOps';
import { maintenance } from '../../src/features/progress/recordsOps';
import { performancesOf } from '../../src/features/progress/recordsOps';

let db: WeightDB;
let name: string;
const T = '2026-01-01T00:00:00.000Z';
const BENCH = 'barbell_bench_press';

async function setup(d: WeightDB) {
  await d.programs.add({ id: 'p', name: 'Plan', split: 'x', status: 'active', weeks: [], source: 'app', createdAt: T, updatedAt: T });
  await d.templates.add({ id: 'ua', programId: 'p', name: 'Upper A', focus: '', orderIndex: 1, warmup: [], createdAt: T, updatedAt: T });
  const row = (id: string, exerciseId: string, orderIndex: number, extra = {}) => ({
    id, templateId: 'ua', exerciseId, orderIndex, targetSetsByWeek: [3], targetReps: '8-12', restSec: 90, supersetGroup: null, notes: '', alternativeIds: [], role: 'working', createdAt: T, updatedAt: T, ...extra,
  });
  await d.templateExercises.bulkAdd([row('r1', BENCH, 1), row('r2', 'lat_pulldown_wide', 2, { supersetGroup: 'A' }), row('r3', 'leg_press', 3, { supersetGroup: 'A' })]);
}
const start = (d: WeightDB = db, date = '2026-11-24') => W.startWorkout(d, { programId: 'p', templateId: 'ua', week: 1, date, today: date });
const exOf = async (sessionId: string, exerciseId: string) => (await db.sessionExercises.where('sessionId').equals(sessionId).toArray()).find((x) => x.exerciseId === exerciseId)!;
const setsOf = (seId: string) => db.sets.where('sessionExerciseId').equals(seId).sortBy('orderIndex');

beforeEach(async () => { name = `t-31-${Math.random()}`; db = new WeightDB(name); await db.open(); await ensureSeed(db); await setup(db); });
afterEach(() => { vi.restoreAllMocks(); });

describe('A-01 atomic workout creation', () => {
  it('an unknown exercise in the template leaves no partial workout', async () => {
    await db.templateExercises.add({ id: 'bad', templateId: 'ua', exerciseId: 'does_not_exist', orderIndex: 4, targetSetsByWeek: [3], targetReps: '10', restSec: 60, supersetGroup: null, notes: '', alternativeIds: [], role: 'working', createdAt: T, updatedAt: T });
    await expect(start()).rejects.toThrow();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.sessionExercises.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
  });
  it('a failure while creating sets leaves no partial workout', async () => {
    let n = 0;
    const orig = db.sets.bulkAdd.bind(db.sets);
    vi.spyOn(db.sets, 'bulkAdd').mockImplementation(((...a: Parameters<typeof orig>) => { if (++n === 2) throw new Error('disk full'); return orig(...a); }) as typeof orig);
    await expect(start()).rejects.toThrow('disk full');
    expect(await db.sessions.count()).toBe(0);
    expect(await db.sessionExercises.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
  });
  it('a double tap creates exactly one active workout', async () => {
    const r = await Promise.allSettled([start(), start()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await db.sessions.where('status').anyOf('active', 'paused').count()).toBe(1);
  });
  it('two tabs starting at once still give one active workout', async () => {
    const other = new WeightDB(name);
    await other.open();
    const r = await Promise.allSettled([start(db), start(other)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await db.sessions.where('status').anyOf('active', 'paused').count()).toBe(1);
    other.close();
  });
});

describe('A-02 atomic quick-log conversion', () => {
  const quick = async () => db.sessions.add({ id: 'q', programId: 'p', templateId: 'ua', programWeek: 1, status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-24', notes: '', source: 'app', logType: 'quick', createdAt: T, updatedAt: T });
  it('an interrupted conversion leaves the quick log intact; retry gives no duplicates', async () => {
    await quick();
    let n = 0;
    const orig = db.sets.bulkAdd.bind(db.sets);
    const spy = vi.spyOn(db.sets, 'bulkAdd').mockImplementation(((...a: Parameters<typeof orig>) => { if (++n === 2) throw new Error('interrupted'); return orig(...a); }) as typeof orig);
    await expect(W.quickToFull(db, 'q')).rejects.toThrow('interrupted');
    expect((await db.sessions.get('q'))!.logType).toBe('quick');
    expect(await db.sessionExercises.where('sessionId').equals('q').count()).toBe(0);
    spy.mockRestore();
    await W.quickToFull(db, 'q');
    expect(await db.sessionExercises.where('sessionId').equals('q').count()).toBe(3);
  });
  it('concurrent conversions do not duplicate exercises', async () => {
    await quick();
    await Promise.allSettled([W.quickToFull(db, 'q'), W.quickToFull(db, 'q')]);
    expect(await db.sessionExercises.where('sessionId').equals('q').count()).toBe(3);
    expect((await db.sessions.get('q'))!.logType).toBe('full');
    await W.quickToFull(db, 'q'); // a later retry is a no-op
    expect(await db.sessionExercises.where('sessionId').equals('q').count()).toBe(3);
  });
});

describe('A-03 completion consistency and startup repair', () => {
  it('rest timer is cleared with the completion; a failed PR recompute is repaired at start-up', async () => {
    await (async () => { const s = await start(db, '2026-11-20'); const [a] = await setsOf((await exOf(s.id, BENCH)).id); await W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 10 }); await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' }); })();
    const s = await start();
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await W.toggleSetComplete(db, a.id, { weightKg: 50, reps: 10 });
    await W.startRest(db, { sessionId: s.id, exerciseName: 'Bench', durationSec: 90 });
    vi.spyOn(db.personalRecords, 'bulkPut').mockImplementation(() => { throw new Error('crash'); });
    await expect(W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' })).rejects.toThrow('crash');
    expect((await db.sessions.get(s.id))!.status).toBe('completed');
    expect(await db.kv.get(W.REST_KEY)).toBeUndefined();
    vi.restoreAllMocks();
    expect(await db.personalRecords.where('sessionId').equals(s.id).count()).toBe(0); // stale
    await maintenance(db);
    expect(await db.personalRecords.where('sessionId').equals(s.id).count()).toBeGreaterThan(0); // repaired
  });
  it('a rest timer left over from a finished or deleted workout is removed at start-up', async () => {
    await db.kv.put({ key: W.REST_KEY, value: { sessionId: 'gone', exerciseName: 'x', startedAt: Date.now(), durationSec: 90, pausedAt: null, pausedTotalMs: 0 } });
    await maintenance(db);
    expect(await db.kv.get(W.REST_KEY)).toBeUndefined();
  });
});

describe('A-05 set validation', () => {
  it('a weighted exercise cannot silently record an unspecified weight as 0', async () => {
    const s = await start();
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await expect(W.toggleSetComplete(db, a.id, { weightKg: null, reps: 10 })).rejects.toThrow(/weight/i);
    await W.updateSet(db, a.id, { weightKg: 0 });
    await W.toggleSetComplete(db, a.id, { weightKg: null, reps: 10 }); // explicit 0 is allowed
    expect((await db.sets.get(a.id))!.weightKg).toBe(0);
  });
  it('bodyweight allows no external load; assisted needs the assistance; duration needs seconds', async () => {
    const s = await W.startWorkout(db, { week: null, date: '2026-11-24', today: '2026-11-24' });
    const pu = await W.addExercise(db, s.id, 'push_up');
    const [p] = await setsOf(pu.id);
    await W.toggleSetComplete(db, p.id, { weightKg: null, reps: 15 });
    expect((await db.sets.get(p.id))!.weightKg).toBe(0);
    const ap = await W.addExercise(db, s.id, (await db.exercises.filter((e) => e.loadMode === 'assist').first())!.id);
    const [x] = await setsOf(ap.id);
    await expect(W.toggleSetComplete(db, x.id, { weightKg: null, reps: 8 })).rejects.toThrow(/assist/i);
    const pl = await W.addExercise(db, s.id, 'plank');
    const [y] = await setsOf(pl.id);
    await expect(W.toggleSetComplete(db, y.id, { weightKg: null, reps: null, durationSec: 0 }, 'duration')).rejects.toThrow();
    await expect(W.updateSet(db, y.id, { durationSec: 40.5 })).rejects.toThrow();
  });
  it('NaN, Infinity and out-of-range values are rejected', async () => {
    const s = await start();
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await expect(W.updateSet(db, a.id, { weightKg: NaN })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { weightKg: Infinity })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { weightKg: 1001 })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { reps: NaN })).rejects.toThrow();
    await expect(W.updateSet(db, a.id, { rpe: NaN })).rejects.toThrow();
    await expect(W.setCardio(db, (await exOf(s.id, BENCH)).id, { durationMin: NaN })).rejects.toThrow();
  });
  it('a 0-rep attempt is a failed attempt, not a completed working set', async () => {
    await (async () => { const s = await start(db, '2026-11-20'); const [a, b] = await setsOf((await exOf(s.id, BENCH)).id); await W.toggleSetComplete(db, a.id, { weightKg: 60, reps: 8 }); await W.toggleSetComplete(db, b.id, { weightKg: 70, reps: 0 }); await W.finishSession(db, s.id, { kneePain: null, energy: null, notes: '' }); })();
    const s2 = await start();
    const prev = (await exOf(s2.id, BENCH)).snapshot!.previous!;
    expect(prev.sets.map((x) => `${x.weightKg}x${x.reps}`)).toEqual(['60x8']); // the failed attempt is not a previous working set
    expect(prev.failed).toEqual([{ weightKg: 70, reps: 0, setType: 'working', durationSec: null }]);
    expect((await db.personalRecords.where('type').equals('max_weight').toArray()).some((r) => r.value === 70)).toBe(false);
  });
  it('a quick edit followed immediately by ✓ keeps the edited value', async () => {
    const s = await start();
    const [a] = await setsOf((await exOf(s.id, BENCH)).id);
    await W.updateSet(db, a.id, { weightKg: 40 });
    const p1 = W.updateSet(db, a.id, { reps: 5 });
    const p2 = W.toggleSetComplete(db, a.id, { weightKg: 40, reps: 8 });
    await Promise.all([p1, p2]);
    expect(await db.sets.get(a.id)).toMatchObject({ reps: 5, completed: 1 });
  });
});

describe('A-06 skipped and replaced exercises keep completed performance', () => {
  it('skipping the remaining sets keeps the 2 completed sets in history, previous values and records', async () => {
    const s1 = await start(db, '2026-11-20');
    const se = await exOf(s1.id, BENCH);
    const [a, b] = await setsOf(se.id);
    await W.toggleSetComplete(db, a.id, { weightKg: 50, reps: 10 });
    await W.toggleSetComplete(db, b.id, { weightKg: 50, reps: 9 });
    await W.skipExercise(db, se.id);
    await W.finishSession(db, s1.id, { kneePain: null, energy: null, notes: '' });
    expect((await db.sessionExercises.get(se.id))!.status).toBe('completed');
    expect((await performancesOf(db, [BENCH]))[0].sets).toHaveLength(2);
    const s2 = await start();
    expect((await exOf(s2.id, BENCH)).snapshot!.previous!.sets).toHaveLength(2);
    expect((await W.exerciseHistory(db, BENCH))).toHaveLength(1);
  });
  it('replacing after 1 completed set keeps that set for the original exercise; the replacement has its own history', async () => {
    const s1 = await start(db, '2026-11-20');
    const se = await exOf(s1.id, BENCH);
    const [a] = await setsOf(se.id);
    await W.toggleSetComplete(db, a.id, { weightKg: 50, reps: 10 });
    const rep = await W.replaceExercise(db, se.id, 'incline_db_press');
    const [r1] = await setsOf(rep.id);
    await W.toggleSetComplete(db, r1.id, { weightKg: 20, reps: 10 });
    await W.finishSession(db, s1.id, { kneePain: null, energy: null, notes: '' });
    expect((await performancesOf(db, [BENCH]))[0].sets.map((x) => x.weightKg)).toEqual([50]);
    expect((await performancesOf(db, ['incline_db_press']))[0].sets.map((x) => x.weightKg)).toEqual([20]);
    const s2 = await start();
    expect((await exOf(s2.id, BENCH)).snapshot!.previous!.sets.map((x) => x.weightKg)).toEqual([50]);
    expect((await W.summarize(db, s1.id)).setsDone).toBe(2);
  });
  it('an exercise skipped with nothing done stays skipped and contributes nothing', async () => {
    const s1 = await start(db, '2026-11-20');
    const se = await exOf(s1.id, BENCH);
    await W.skipExercise(db, se.id);
    await W.finishSession(db, s1.id, { kneePain: null, energy: null, notes: '' });
    expect((await db.sessionExercises.get(se.id))!.status).toBe('skipped');
    expect(await performancesOf(db, [BENCH])).toHaveLength(0);
  });
});

describe('A-07 superset rest timer', () => {
  it('out-of-order completion: the round completes when its last open set is done', async () => {
    const s = await start();
    const [a1] = await setsOf((await exOf(s.id, 'lat_pulldown_wide')).id);
    const [a2] = await setsOf((await exOf(s.id, 'leg_press')).id);
    expect((await W.toggleSetComplete(db, a2.id, { weightKg: 80, reps: 10 })).startRest).toBe(false);
    expect((await W.toggleSetComplete(db, a1.id, { weightKg: 40, reps: 10 })).startRest).toBe(true);
  });
  it('unequal set counts and skipped partners', async () => {
    const s = await start();
    const lat = await exOf(s.id, 'lat_pulldown_wide');
    await W.addSet(db, lat.id); // lat has 4 sets, leg press 3
    const L = await setsOf(lat.id);
    expect((await W.toggleSetComplete(db, L[3].id, { weightKg: 40, reps: 10 })).startRest).toBe(true); // round 4 has only the pulldown
    await W.skipExercise(db, (await exOf(s.id, 'leg_press')).id);
    expect((await W.toggleSetComplete(db, L[0].id, { weightKg: 40, reps: 10 })).startRest).toBe(true);
  });
  it('undoing the set that started the rest timer stops the timer', async () => {
    const s = await start();
    const [b] = await setsOf((await exOf(s.id, BENCH)).id);
    const r = await W.toggleSetComplete(db, b.id, { weightKg: 40, reps: 10 });
    await W.startRest(db, { sessionId: s.id, exerciseName: 'Bench', durationSec: r.restSec, setId: b.id });
    await W.toggleSetComplete(db, b.id, { weightKg: 40, reps: 10 });
    expect(await db.kv.get(W.REST_KEY)).toBeUndefined();
  });
});
