/** Phase 3.1 – progression findings B-01…B-05 (written first against baseline 5af66bf to confirm them). */
import { describe, it, expect } from 'vitest';
import { suggest, isStalled, barbellLoads, plateLoads, type RecentPerf, type SuggestArgs } from '../../src/domain/progression';

const perf = (date: string, reps: number[], kg: number | number[] = 20, extra: Partial<RecentPerf> = {}): RecentPerf => ({
  localDate: date, sets: reps.map((r, i) => ({ weightKg: Array.isArray(kg) ? kg[i] : kg, reps: r })), painScore: null, ...extra,
});
const base = (recent: RecentPerf[], o: Partial<SuggestArgs> = {}): SuggestArgs => ({
  exercise: { status: 'active', loadMode: 'total' }, recent, targetReps: '8-12', today: '2026-12-01', weights: { incrementKg: 2.5 }, ...o,
});
const assist = { status: 'active', loadMode: 'assist' as const };

describe('B-01 assisted exercises: less assistance = harder', () => {
  it('a long break adds assistance (easier), never removes it', () => {
    const s = suggest(base([perf('2026-10-27', [10, 10, 10], 30)], { exercise: assist, weights: { incrementKg: 5 } }))!;
    expect(s.topKg!).toBeGreaterThan(30);
    expect(s.message).toMatch(/more assistance/i);
  });
  it('a deload adds assistance', () => {
    const s = suggest(base([perf('2026-11-28', [10, 10, 10], 30)], { exercise: assist, weights: { incrementKg: 5 }, deload: { active: true, reason: 'after_block' } }))!;
    expect(s.kind).toBe('deload');
    expect(s.topKg!).toBeGreaterThan(30);
  });
  it('progression starts from the hardest set (least assistance) and reduces it', () => {
    const s = suggest(base([perf('2026-11-28', [12, 12, 12], [35, 30, 30])], { exercise: assist, weights: { incrementKg: 5 } }))!;
    expect(s).toMatchObject({ kind: 'increase', topKg: 25 });
  });
  it('stall detection: falling assistance with the same reps is progress, not a stall', () => {
    const r = [perf('2026-11-28', [8, 8], 20), perf('2026-11-25', [8, 8], 25), perf('2026-11-21', [8, 8], 30), perf('2026-11-18', [8, 8], 35)];
    expect(isStalled(r, 'assist')).toBe(false);
    expect(isStalled(r, 'total')).toBe(true); // the same numbers as a loaded lift are going backwards
  });
  it('no assistance left → no impossible reduction', () => {
    const s = suggest(base([perf('2026-11-28', [12, 12, 12], 0)], { exercise: assist, weights: { incrementKg: 5 } }))!;
    expect(s.kind).not.toBe('increase');
    expect(s.message).toMatch(/no assistance/i);
  });
});

describe('B-02 partial workouts never trigger an increase', () => {
  it('1 of 3 planned sets at the top of the range → no increase, and it says why', () => {
    const s = suggest(base([perf('2026-11-28', [12], 20, { planned: 3 })]))!;
    expect(s.kind).not.toBe('increase');
    expect(s.message).toMatch(/1 of 3/);
  });
  it('all planned sets done (also after an intentional change to 2 sets) → increase', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12, 12], 20, { planned: 3 })]))!.kind).toBe('increase');
    expect(suggest(base([perf('2026-11-28', [12, 12], 20, { planned: 2 })]))!.kind).toBe('increase');
  });
  it('a failed attempt (0 reps) counts against the planned sets', () => {
    expect(suggest(base([perf('2026-11-28', [12, 12], 20, { planned: 3, failed: 1 })]))!.kind).not.toBe('increase');
  });
});

describe('B-03 equipment limits', () => {
  it('already on the heaviest dumbbell → no increase; reps instead; message matches the values', () => {
    const s = suggest(base([perf('2026-11-28', [12, 12, 12], 50)], { weights: { incrementKg: 2.5, available: [40, 45, 47.5, 50] } }))!;
    expect(s.kind).toBe('more_reps');
    expect(s.topKg).toBe(50);
    expect(s.deltaKg).toBe(0);
    expect(s.message).toMatch(/heaviest/i);
    expect(s.message).not.toMatch(/52\.5|Add load/);
  });
  it('a reduction below the lightest load is not suggested', () => {
    const s = suggest(base([perf('2026-11-28', [6, 6], 10), perf('2026-11-24', [6, 6], 10)], { weights: { incrementKg: 2.5, available: [10, 12.5, 15] } }))!;
    expect(s.kind).not.toBe('reduce');
  });
});

describe('B-04 achievable barbell loads', () => {
  it('plates that are not multiples of the smallest one: 20 + 2×20 = 60 is achievable', () => {
    expect(plateLoads(20, [{ kg: 20 }, { kg: 15 }], 100)).toEqual([20, 50, 60, 80, 90, 100]); // 70 would need 25 per side – impossible
    expect(barbellLoads(20, [20, 15], 100)).toContain(60); // the baseline step algorithm returned [20, 50, 80]
  });
  it('limited pairs: only one pair of 1.25 kg → 22.5 yes, 25 needs another pair', () => {
    const l = plateLoads(20, [{ kg: 1.25, pairs: 1 }, { kg: 5, pairs: 2 }], 60);
    expect(l).toEqual([20, 22.5, 30, 32.5, 40, 42.5]);
  });
});

describe('B-05 explanations', () => {
  it('lists the facts behind the suggestion', () => {
    const s = suggest(base([{ localDate: '2026-11-28', painScore: 2, planned: 3, sets: [12, 12, 12].map((r) => ({ weightKg: 20, reps: r, rpe: 8 })) }], { targetRpe: '8', weights: { incrementKg: 2.5, available: [20, 22.5] } }))!;
    expect(s.factors.join(' | ')).toMatch(/3 of 3 planned sets/);
    expect(s.factors.join(' | ')).toMatch(/12\/12\/12 @ 20 kg/);
    expect(s.factors.join(' | ')).toMatch(/target 8–12/i);
    expect(s.factors.join(' | ')).toMatch(/RPE 8/);
    expect(s.factors.join(' | ')).toMatch(/pain 2\/10/i);
    expect(s.factors.join(' | ')).toMatch(/3 days ago/);
    expect(s.factors.join(' | ')).toMatch(/double progression/i);
  });
});

describe('B-04 plate field', () => {
  it('parses weights with optional pair counts and rejects nonsense', async () => {
    const { parsePlates, formatPlates } = await import('../../src/domain/progression');
    expect(parsePlates('25, 20x2, 1.25 x 1, 5kg')).toEqual({ plates: [25, 20, 5, 1.25], pairs: { '20': 2, '1.25': 1 } });
    expect(parsePlates('20, abc')).toEqual({ error: 'abc' });
    expect(parsePlates('20x0')).toEqual({ error: '20x0' });
    expect(formatPlates([25, 20, 5], { '20': 2 })).toBe('25, 20x2, 5');
  });
});
