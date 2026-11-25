import { describe, it, expect } from 'vitest';
import { suggest, snapWeight, barbellLoads, isStalled, parseRepRange, type RecentPerf, type SuggestArgs } from '../../src/domain/progression';
import { detectPRs, sessionVolumePRs, currentBests, type Performance } from '../../src/domain/records';
import { exerciseStats, muscleSets, series, streak, completion, weekBounds, metricsFor, rangeStart, inRange } from '../../src/domain/analytics';
import { e1rm } from '../../src/domain/e1rm';
import type { WorkoutSchedule } from '../../src/db/types';

const perf = (date: string, reps: number[], kg = 20, extra: Partial<RecentPerf> = {}): RecentPerf => ({ localDate: date, sets: reps.map((r) => ({ weightKg: kg, reps: r })), painScore: null, ...extra });
const base = (recent: RecentPerf[], o: Partial<SuggestArgs> = {}): SuggestArgs => ({
  exercise: { status: 'active', loadMode: 'total' }, recent, targetReps: '8-12', today: '2026-12-01', weights: { incrementKg: 2.5 }, ...o,
});

describe('PO-01 rule engine (every rule, with boundaries)', () => {
  it('AC1 all sets at top of range (RPE ≤ target) → 22.5 kg, explanation "all sets at the top"', () => {
    const s = suggest(base([perf('2026-11-28', [12, 12, 12])], { targetRpe: '8' }))!;
    expect(s).toMatchObject({ kind: 'increase', rule: 'BR-PO-04', topKg: 22.5, deltaKg: 2.5, repsTarget: 8 });
    expect(s.message).toContain('all sets at the top');
  });
  it('BR-PO-04 RPE boundary: target 8 → RPE 8.5 still increases, RPE 9 holds', () => {
    const at = (rpe: number) => suggest(base([{ localDate: '2026-11-28', painScore: null, sets: [12, 12, 12].map((r) => ({ weightKg: 20, reps: r, rpe })) }], { targetRpe: '8' }))!.kind;
    expect(at(8.5)).toBe('increase');
    expect(at(9)).toBe('hold');
  });
  it('AC2 12/10/9 → keep 20 kg, aim 12/11/10', () => {
    const s = suggest(base([perf('2026-11-28', [12, 10, 9])]))!;
    expect(s).toMatchObject({ kind: 'more_reps', rule: 'BR-PO-05', deltaKg: 0 });
    expect(s.message).toContain('keep 20 kg, aim for 12/11/10');
  });
  it('AC3 below minimum twice → −1 increment; once → repeat (BR-PO-07)', () => {
    expect(suggest(base([perf('2026-11-28', [8, 7, 6]), perf('2026-11-24', [8, 7, 7])]))).toMatchObject({ kind: 'reduce', rule: 'BR-PO-06', topKg: 17.5 });
    expect(suggest(base([perf('2026-11-28', [8, 7, 6]), perf('2026-11-24', [9, 8, 8])]))).toMatchObject({ kind: 'hold', rule: 'BR-PO-07' });
  });
  it('AC4 35 days → −20%; boundaries: exactly 28 → −10%, 29 → −20%, 14 → −10%, 13 → normal', () => {
    const at = (date: string) => suggest(base([perf(date, [12, 12, 12], 50)]));
    expect(at('2026-10-27')).toMatchObject({ rule: 'BR-PO-02', topKg: 40 }); // 35 days
    expect(at('2026-11-03')).toMatchObject({ rule: 'BR-PO-03', topKg: 45 }); // 28 days
    expect(at('2026-11-02')).toMatchObject({ rule: 'BR-PO-02' }); // 29 days
    expect(at('2026-11-17')).toMatchObject({ rule: 'BR-PO-03' }); // 14 days
    expect(at('2026-11-18')).toMatchObject({ rule: 'BR-PO-04' }); // 13 days
  });
  it('AC5 pain 5/10 → no increase and the alternative is shown; boundary pain 3 vs 4', () => {
    const s = suggest(base([perf('2026-11-28', [12, 12, 12], 20, { painScore: 5 })], { alternativeName: 'Leg Press' }))!;
    expect(s).toMatchObject({ kind: 'hold', rule: 'BR-PO-01', alternative: 'Leg Press' });
    expect(s.message).toContain('Leg Press');
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 20, { painScore: 4 })]))!.rule).toBe('BR-PO-01');
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 20, { painScore: 3 })]))!.rule).toBe('BR-PO-04');
  });
  it('BR-PO-12 / first time / unloaded modes → no suggestion', () => {
    expect(suggest(base([perf('2026-11-28', [12])], { exercise: { status: 'unresolved', loadMode: 'total' } }))).toBeNull();
    expect(suggest(base([]))).toBeNull();
    expect(suggest(base([perf('2026-11-28', [12])], { exercise: { status: 'active', loadMode: 'band' } }))).toBeNull();
    expect(suggest(base([perf('2026-11-28', [12])], { targetReps: '20 min' }))).toBeNull();
  });
  it('assisted machines move the assistance the other way', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 30)], { exercise: { status: 'active', loadMode: 'assist' } }))).toMatchObject({ kind: 'increase', topKg: 27.5 });
  });
  it('configurable increments per step (1–2)', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12])], { incrementSteps: 2 }))!.topKg).toBe(25);
    expect(suggest(base([perf('2026-11-28', [12, 12, 12])], { incrementSteps: 5 }))!.topKg).toBe(25);
  });
  it('parseRepRange', () => { expect(parseRepRange('8–12')).toEqual({ min: 8, max: 12 }); expect(parseRepRange('5')).toEqual({ min: 5, max: 5 }); expect(parseRepRange('AMRAP')).toBeNull(); });
});

describe('PO-02 increments and achievable weights', () => {
  it('AC1 dumbbells snap to an available weight', () => {
    const dbs = [15, 17.5, 20, 22.5, 25];
    expect(snapWeight(21, { incrementKg: 2.5, available: dbs }, 'up')).toBe(22.5);
    expect(snapWeight(21, { incrementKg: 2.5, available: dbs }, 'down')).toBe(20);
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 20)], { weights: { incrementKg: 1, available: dbs } }))!.topKg).toBe(22.5);
  });
  it('AC2 a 6.5 kg stack step suggests +6.5', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 45.5)], { exercise: { status: 'active', loadMode: 'stack' }, weights: { incrementKg: 6.5 } }))).toMatchObject({ deltaKg: 6.5, topKg: 52 });
  });
  it('barbell loads: bar + plate pairs', () => {
    const l = barbellLoads(20, [20, 10, 5, 2.5, 1.25], 30);
    expect(l).toEqual([20, 22.5, 25, 27.5, 30]);
  });
});

describe('PO-04 strategies', () => {
  const rp = (reps: number[], rpe: number) => ({ localDate: '2026-11-28', painScore: null, sets: reps.map((r) => ({ weightKg: 20, reps: r, rpe })) });
  it('manual → never a suggestion (SET-03 AC2)', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12])], { exercise: { status: 'active', loadMode: 'total', strategy: 'manual' } }))).toBeNull();
    expect(suggest(base([perf('2026-11-28', [12, 12, 12])], { defaultStrategy: 'manual' }))).toBeNull();
  });
  it('linear: +increment whenever every set reached the prescribed reps', () => {
    expect(suggest(base([perf('2026-11-28', [8, 9, 8])], { exercise: { status: 'active', loadMode: 'total', strategy: 'linear' } }))).toMatchObject({ kind: 'increase', topKg: 22.5 });
  });
  it('rpe_target: easy → increase; on target → +1 rep; too hard → hold; no RPE → double progression', () => {
    const ex = { status: 'active', loadMode: 'total' as const, strategy: 'rpe_target' as const };
    expect(suggest(base([rp([10, 10], 6.5)], { exercise: ex, targetRpe: '8' }))).toMatchObject({ kind: 'increase' });
    expect(suggest(base([rp([10, 10], 8)], { exercise: ex, targetRpe: '8' }))).toMatchObject({ kind: 'more_reps' });
    expect(suggest(base([rp([10, 10], 9)], { exercise: ex, targetRpe: '8' }))).toMatchObject({ kind: 'hold' });
    expect(suggest(base([perf('2026-11-28', [12, 12])], { exercise: ex, targetRpe: '8' }))).toMatchObject({ rule: 'BR-PO-04' });
  });
});

describe('PO-05 deload', () => {
  it('after the block → −10% and −1 set; 3 stalls on a main lift → deload', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 50)], { deload: { active: true, reason: 'after_block' } }))).toMatchObject({ kind: 'deload', topKg: 45, setsDelta: -1 });
    const flat = [perf('2026-11-28', [8, 8]), perf('2026-11-25', [8, 8]), perf('2026-11-21', [8, 8]), perf('2026-11-18', [8, 8])];
    expect(isStalled(flat)).toBe(true);
    expect(isStalled(flat.slice(0, 3))).toBe(false);
    expect(suggest(base(flat, { exercise: { status: 'active', loadMode: 'total', isMain: true } }))).toMatchObject({ kind: 'deload' });
    expect(suggest(base(flat, { exercise: { status: 'active', loadMode: 'total', isMain: false } }))!.kind).not.toBe('deload');
    expect(isStalled([perf('2026-11-28', [9, 8]), ...flat.slice(1)])).toBe(false);
  });
});

const P = (sessionId: string, localDate: string, sets: [number, number, string?][], extra: Partial<Performance> = {}): Performance => ({
  sessionId, localDate, startedAt: null, exerciseId: 'bench',
  sets: sets.map(([w, r, type = 'working'], i) => ({ setId: `${sessionId}-${i}`, weightKg: w, reps: r, setType: type as 'working' })), ...extra,
});
const ex = { id: 'bench', loadMode: 'total' as const, tracking: 'weight_reps' as const };

describe('PR-01 detection (BR-PR-01…06)', () => {
  it('first performance is a baseline; heavier later → max_weight PR; tie → none', () => {
    const prs = detectPRs([P('a', '2026-11-21', [[40, 12], [45, 10], [50, 8]]), P('b', '2026-11-24', [[42.5, 12], [45, 10], [50, 8]]), P('c', '2026-11-27', [[52.5, 5]])], ex);
    expect(prs.filter((p) => p.type === 'max_weight').map((p) => [p.sessionId, p.value, p.previous])).toEqual([['c', 52.5, 50]]);
    expect(prs.filter((p) => p.sessionId === 'a')).toEqual([]); // baseline
    expect(prs.find((p) => p.type === 'reps_at_weight')).toBeUndefined(); // 42.5 is a new weight → baseline, not a PR
  });
  it('e1RM, reps at the same weight, exercise volume', () => {
    const prs = detectPRs([P('a', '2026-11-21', [[50, 8]]), P('b', '2026-11-24', [[50, 10]])], ex);
    expect(prs.map((p) => p.type).sort()).toEqual(['e1rm', 'exercise_volume', 'reps_at_weight']);
    expect(prs.find((p) => p.type === 'reps_at_weight')).toMatchObject({ value: 10, previous: 8, weightKg: 50 });
    expect(prs.find((p) => p.type === 'e1rm')!.value).toBe(e1rm(50, 10));
  });
  it('warm-ups never count; Brzycki option', () => {
    expect(detectPRs([P('a', '2026-11-21', [[50, 8]]), P('b', '2026-11-24', [[80, 5, 'warmup'], [50, 8]])], ex)).toEqual([]);
    expect(e1rm(100, 5, 'total', 'brzycki')).toBe(112.5);
  });
  it('bodyweight → max reps; cardio → duration/distance/speed', () => {
    const bw = detectPRs([P('a', '2026-11-21', [[0, 10]]), P('b', '2026-11-24', [[0, 12]])], { id: 'bench', loadMode: 'bodyweight', tracking: 'reps' });
    expect(bw).toMatchObject([{ type: 'max_reps', value: 12, previous: 10 }]);
    const run = detectPRs([P('a', '2026-11-21', [], { cardio: { durationMin: 20, distanceM: 2000 } }), P('b', '2026-11-24', [], { cardio: { durationMin: 25, distanceM: 3000 } })], { id: 'bench', loadMode: 'none', tracking: 'duration_distance' });
    expect(run.map((p) => p.type).sort()).toEqual(['distance', 'duration', 'speed']);
  });
  it('TC-CRIT-12: the standing max weight is 50 kg from session 1 even though session 1 is a baseline', () => {
    const perfs = [P('a', '2026-11-21', [[40, 12], [45, 10], [50, 8]]), P('b', '2026-11-24', [[42.5, 12], [45, 10], [50, 8]])];
    expect(detectPRs(perfs, ex).filter((p) => p.type === 'max_weight')).toEqual([]);
    expect(currentBests(perfs, ex).find((b) => b.type === 'max_weight')).toMatchObject({ value: 50, sessionId: 'a', date: '2026-11-21' });
  });
  it('session total volume', () => {
    expect(sessionVolumePRs([{ sessionId: 'a', localDate: '2026-11-21', startedAt: null, volume: 1000 }, { sessionId: 'b', localDate: '2026-11-24', startedAt: null, volume: 1000 }, { sessionId: 'c', localDate: '2026-11-25', startedAt: null, volume: 1200 }]))
      .toMatchObject([{ sessionId: 'c', value: 1200, previous: 1000 }]);
  });
});

describe('AN-01 exercise stats and series', () => {
  it('first/last, max weight, best set, e1RM, average, frequency, % improvement', () => {
    const s = exerciseStats([P('a', '2026-11-01', [[40, 12], [45, 10], [50, 8]]), P('b', '2026-11-15', [[42.5, 12], [50, 8], [55, 6]])], 'total', 'weight_reps');
    expect(s).toMatchObject({ sessions: 2, totalSets: 6, first: { date: '2026-11-01', text: '50×8' }, last: { text: '55×6' }, maxWeight: { value: 55 }, maxReps: { value: 12 } });
    expect(s.bestE1rm!.value).toBe(e1rm(55, 6));
    expect(s.avgWorkingWeight).toBe(47.1);
    expect(s.perWeek).toBe(0.9);
    expect(s.improvementBasis).toBe('e1rm');
    expect(s.improvementPct).toBeCloseTo(((e1rm(55, 6)! - e1rm(50, 8)!) / e1rm(50, 8)!) * 100, 0);
  });
  it('metrics follow the tracking type; series sorted by date; range filter', () => {
    expect(metricsFor('per_hand', 'weight_reps')).toEqual(['top_weight', 'e1rm', 'volume']);
    expect(metricsFor('bodyweight', 'reps')).toEqual(['max_reps', 'total_reps']);
    const pts = series([P('b', '2026-11-15', [[55, 6]]), P('a', '2026-11-01', [[50, 8]])], 'top_weight', 'total');
    expect(pts.map((p) => p.value)).toEqual([50, 55]);
    expect(inRange(pts, rangeStart('7d', '2026-11-20'), null)).toHaveLength(1);
    expect(rangeStart('all', '2026-11-20')).toBeNull();
  });
});

describe('MG-01 muscle sets (BR-CALC-03)', () => {
  const groups = [
    { id: 'chest', name: 'Chest', nameAr: '', parentId: 'chest', region: 'upper' as const }, { id: 'upper_chest', name: 'Upper chest', nameAr: '', parentId: 'chest', region: 'upper' as const },
    { id: 'front_delts', name: 'Front delts', nameAr: '', parentId: 'shoulders', region: 'upper' as const }, { id: 'shoulders', name: 'Shoulders', nameAr: '', parentId: 'shoulders', region: 'upper' as const },
    { id: 'triceps', name: 'Triceps', nameAr: '', parentId: 'triceps', region: 'upper' as const },
  ];
  const links = [
    { exerciseId: 'incline', muscleGroupId: 'upper_chest', role: 'primary' as const, weight: 1 }, { exerciseId: 'incline', muscleGroupId: 'front_delts', role: 'secondary' as const, weight: 0.5 },
    { exerciseId: 'incline', muscleGroupId: 'triceps', role: 'secondary' as const, weight: 0.5 }, { exerciseId: 'incline', muscleGroupId: 'chest', role: 'secondary' as const, weight: 0.5 },
  ];
  const p = { ...P('a', '2026-11-21', [[20, 10], [20, 10], [20, 10], [10, 10, 'warmup']]), exerciseId: 'incline' };
  it('AC1 incline DB press 3 sets → chest 3.0 (no double count), front delts 1.5', () => {
    const m = muscleSets([p], links, groups);
    expect(m.get('chest')!.sets).toBe(3);
    expect(m.get('chest')!.sub.upper_chest).toBe(3);
    expect(m.get('shoulders')!.sub.front_delts).toBe(1.5);
    expect(m.get('triceps')!.sets).toBe(1.5);
  });
  it('SET-03 AC1 secondary weight 0 → secondaries drop out', () => {
    const m = muscleSets([p], links, groups, 0);
    expect(m.get('chest')!.sets).toBe(3);
    expect(m.has('triceps')).toBe(false);
  });
});

describe('DASH-01 week, completion, streak (BR-CALC-04/05)', () => {
  const schedule: WorkoutSchedule = { id: 's', programId: 'p', pattern: { SUN: 'a', MON: 'b', TUE: 'c', WED: null, THU: 'd', FRI: null, SAT: null }, startDate: '2026-11-01', endDate: '2026-12-31', exceptions: [{ date: '2026-11-17', templateId: null, note: 'moved' }], planned: [], createdAt: '', updatedAt: '' };
  it('week bounds use weekStartsOn', () => {
    expect(weekBounds('2026-11-25', 'SUN')).toEqual({ start: '2026-11-22', end: '2026-11-28' });
    expect(weekBounds('2026-11-25', 'MON')).toEqual({ start: '2026-11-23', end: '2026-11-29' });
  });
  it('weekly completion 2/4', () => {
    expect(completion(schedule, [], '2026-11-22', '2026-11-28', new Set(['2026-11-22', '2026-11-23']))).toEqual({ done: 2, scheduled: 4 });
  });
  it('streak: rest days and exceptions do not break it; a missed scheduled day does; today not done yet is fine', () => {
    const done = new Set(['2026-11-12', '2026-11-15', '2026-11-16', '2026-11-19', '2026-11-22', '2026-11-23']);
    // 24 (Tue, today, not done) → skip; 23,22 done; 19 done (20/21 rest); 18 rest; 17 exception; 16,15 done; 12 done (13/14 rest); 11 rest; 10 Tue missed → stop
    expect(streak(schedule, [], '2026-11-24', done)).toBe(6);
    expect(streak(schedule, [], '2026-11-23', new Set(['2026-11-22']))).toBe(1);
    expect(streak(schedule, [], '2026-11-24', new Set(['2026-11-22']))).toBe(0); // Mon 23 missed
  });
});
