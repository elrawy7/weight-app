/** Analytics (AN-01/02, MG-01, DASH-01/02, BR-CALC-01…05). Pure functions over performances and schedules. */
import type { ExerciseMuscle, ID, ISODate, LoadMode, MuscleGroup, Tracking, Weekday, WeekPhase, WorkoutSchedule } from '../db/types';
import { WEEKDAYS } from '../db/types';
import { e1rm, type E1rmFormula } from './e1rm';
import { addDays, diffDays, weekdayOf } from './dates';
import { planForDate } from './schedule';
import { LOADED, perfOrder, perfVolume, working, type Performance } from './records';

/* ───────────── exercise stats (AN-01) ───────────── */

export type Metric = 'top_weight' | 'e1rm' | 'volume' | 'max_reps' | 'total_reps' | 'duration' | 'distance';
export interface Point { date: ISODate; sessionId: ID; value: number }

export function metricsFor(loadMode: LoadMode, tracking: Tracking): Metric[] {
  if (tracking === 'duration_distance') return ['duration', 'distance'];
  if (tracking === 'duration' || tracking === 'rounds') return ['duration'];
  if (LOADED.includes(loadMode)) return ['top_weight', 'e1rm', 'volume'];
  return ['max_reps', 'total_reps'];
}

export function metricValue(p: Performance, m: Metric, loadMode: LoadMode, formula: E1rmFormula = 'epley'): number | null {
  const ws = working(p);
  switch (m) {
    case 'top_weight': return ws.length ? Math.max(...ws.map((s) => s.weightKg ?? 0)) : null;
    case 'e1rm': { const v = ws.map((s) => e1rm(s.weightKg, s.reps, loadMode, formula) ?? 0); const b = Math.max(0, ...v); return b > 0 ? b : null; }
    case 'volume': return ws.length ? Math.round(perfVolume(p, loadMode)) : null;
    case 'max_reps': return ws.length ? Math.max(...ws.map((s) => s.reps ?? 0)) : null;
    case 'total_reps': return ws.length ? ws.reduce((a, s) => a + (s.reps ?? 0), 0) : null;
    case 'duration': { const d = Math.max(0, ...ws.map((s) => s.durationSec ?? 0), (p.cardio?.durationMin ?? 0) * 60); return d > 0 ? Math.round(d / 6) / 10 : null; } // minutes
    case 'distance': return p.cardio?.distanceM ? Math.round(p.cardio.distanceM) / 1000 : null; // km
  }
}

export function series(perfs: Performance[], m: Metric, loadMode: LoadMode, formula: E1rmFormula = 'epley'): Point[] {
  return [...perfs].sort(perfOrder).map((p) => ({ date: p.localDate, sessionId: p.sessionId, value: metricValue(p, m, loadMode, formula) })).filter((x): x is Point => x.value != null);
}

export type Range = '7d' | '30d' | '90d' | '6m' | '1y' | 'all' | 'custom';
export const RANGES: Range[] = ['7d', '30d', '90d', '6m', '1y', 'all', 'custom'];
export function rangeStart(r: Range, today: ISODate): ISODate | null {
  const days: Partial<Record<Range, number>> = { '7d': 6, '30d': 29, '90d': 89, '6m': 182, '1y': 364 };
  return days[r] != null ? addDays(today, -days[r]!) : null;
}
export function inRange<T extends { date: ISODate }>(xs: T[], from: ISODate | null, to: ISODate | null): T[] {
  return xs.filter((x) => (!from || x.date >= from) && (!to || x.date <= to));
}

export interface ExerciseStats {
  sessions: number; totalSets: number; totalVolume: number;
  first: { date: ISODate; text: string } | null; last: { date: ISODate; text: string } | null;
  maxWeight: { value: number; date: ISODate; sessionId: ID } | null;
  maxReps: { value: number; date: ISODate; weightKg: number | null } | null;
  bestSet: { weightKg: number | null; reps: number | null; date: ISODate; sessionId: ID } | null;
  bestE1rm: { value: number; date: ISODate } | null;
  avgWorkingWeight: number | null;
  perWeek: number | null;
  improvementPct: number | null; improvementBasis: Metric | null;
}

const setTxt = (w: number | null, r: number | null) => `${w ? Math.round(w * 100) / 100 : 'BW'}×${r ?? '–'}`;

export function exerciseStats(perfs: Performance[], loadMode: LoadMode, tracking: Tracking, formula: E1rmFormula = 'epley'): ExerciseStats {
  const ps = [...perfs].sort(perfOrder).filter((p) => working(p).length || p.cardio);
  const loaded = LOADED.includes(loadMode);
  const all = ps.flatMap((p) => working(p).map((s) => ({ s, p })));
  const bestOf = (p: Performance) => { const ws = working(p); if (!ws.length) return ''; const b = ws.reduce((x, y) => ((y.weightKg ?? 0) > (x.weightKg ?? 0) || ((y.weightKg ?? 0) === (x.weightKg ?? 0) && (y.reps ?? 0) > (x.reps ?? 0)) ? y : x)); return setTxt(b.weightKg, b.reps); };
  const maxW = loaded ? all.reduce<{ s: (typeof all)[0]['s']; p: Performance } | null>((b, x) => (!b || (x.s.weightKg ?? 0) > (b.s.weightKg ?? 0) ? x : b), null) : null;
  const maxR = all.reduce<(typeof all)[0] | null>((b, x) => (!b || (x.s.reps ?? 0) > (b.s.reps ?? 0) ? x : b), null);
  const withE = all.map((x) => ({ ...x, e: e1rm(x.s.weightKg, x.s.reps, loadMode, formula) ?? 0 }));
  const bestE = withE.reduce<(typeof withE)[0] | null>((b, x) => (!b || x.e > b.e ? x : b), null);
  const bestSet = loaded ? (bestE && bestE.e > 0 ? bestE : maxW) : maxR;
  const weights = loaded ? all.map((x) => x.s.weightKg ?? 0).filter((w) => w > 0) : [];
  const spanDays = ps.length > 1 ? diffDays(ps[ps.length - 1].localDate, ps[0].localDate) + 1 : 0;
  const basis: Metric | null = ps.length < 2 ? null : tracking === 'duration_distance' || tracking === 'duration' || tracking === 'rounds' ? 'duration' : loaded ? (bestE && bestE.e > 0 ? 'e1rm' : 'top_weight') : 'max_reps';
  let improvementPct: number | null = null;
  if (basis) {
    const a = metricValue(ps[0], basis, loadMode, formula), b = metricValue(ps[ps.length - 1], basis, loadMode, formula);
    if (a && b != null) improvementPct = Math.round(((b - a) / a) * 1000) / 10;
  }
  return {
    sessions: ps.length, totalSets: all.length, totalVolume: Math.round(ps.reduce((v, p) => v + perfVolume(p, loadMode), 0)),
    first: ps[0] ? { date: ps[0].localDate, text: bestOf(ps[0]) } : null,
    last: ps.length ? { date: ps[ps.length - 1].localDate, text: bestOf(ps[ps.length - 1]) } : null,
    maxWeight: maxW && (maxW.s.weightKg ?? 0) > 0 ? { value: maxW.s.weightKg ?? 0, date: maxW.p.localDate, sessionId: maxW.p.sessionId } : null,
    maxReps: maxR && maxR.s.reps ? { value: maxR.s.reps, date: maxR.p.localDate, weightKg: maxR.s.weightKg } : null,
    bestSet: bestSet ? { weightKg: bestSet.s.weightKg, reps: bestSet.s.reps, date: bestSet.p.localDate, sessionId: bestSet.p.sessionId } : null,
    bestE1rm: bestE && bestE.e > 0 ? { value: bestE.e, date: bestE.p.localDate } : null,
    avgWorkingWeight: weights.length ? Math.round((weights.reduce((a, b) => a + b, 0) / weights.length) * 10) / 10 : null,
    perWeek: spanDays >= 7 ? Math.round((ps.length / (spanDays / 7)) * 10) / 10 : null,
    improvementPct, improvementBasis: basis,
  };
}

/* ───────────── muscle groups (MG-01, BR-CALC-03) ───────────── */

export interface MuscleCount { parentId: string; sets: number; sub: Record<string, number>; lastTrained: ISODate | null }

/**
 * Fractional working sets per muscle. Each completed working set counts 1.0 for each primary and `secondaryWeight`
 * for each secondary muscle. Sub-groups roll up to the parent without double counting: per exercise, a parent gets the
 * highest share of any of its sub-groups.
 */
export function muscleSets(perfs: Performance[], links: ExerciseMuscle[], groups: MuscleGroup[], secondaryWeight = 0.5): Map<string, MuscleCount> {
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId || g.id]));
  const byEx = new Map<ID, ExerciseMuscle[]>();
  for (const l of links) byEx.set(l.exerciseId, [...(byEx.get(l.exerciseId) ?? []), l]);
  const out = new Map<string, MuscleCount>();
  for (const p of perfs) {
    const n = working(p).length;
    if (!n) continue;
    const share = new Map<string, number>(); // parent → share
    const subShare = new Map<string, number>(); // sub → share
    for (const l of byEx.get(p.exerciseId) ?? []) {
      const w = l.role === 'primary' ? 1 : secondaryWeight;
      if (w <= 0) continue;
      const parent = parentOf.get(l.muscleGroupId) ?? l.muscleGroupId;
      share.set(parent, Math.max(share.get(parent) ?? 0, w));
      subShare.set(l.muscleGroupId, Math.max(subShare.get(l.muscleGroupId) ?? 0, w));
    }
    for (const [parent, w] of share) {
      const c = out.get(parent) ?? { parentId: parent, sets: 0, sub: {}, lastTrained: null };
      c.sets += n * w;
      if (!c.lastTrained || p.localDate > c.lastTrained) c.lastTrained = p.localDate;
      out.set(parent, c);
    }
    for (const [sub, w] of subShare) {
      const parent = parentOf.get(sub) ?? sub;
      const c = out.get(parent)!;
      c.sub[sub] = (c.sub[sub] ?? 0) + n * w;
    }
  }
  for (const c of out.values()) { c.sets = Math.round(c.sets * 10) / 10; for (const k of Object.keys(c.sub)) c.sub[k] = Math.round(c.sub[k] * 10) / 10; }
  return out;
}

/* ───────────── weeks, completion, streak (DASH-01, BR-CALC-04/05) ───────────── */

export function weekBounds(date: ISODate, weekStartsOn: Weekday): { start: ISODate; end: ISODate } {
  const idx = WEEKDAYS.indexOf(weekdayOf(date)), s = WEEKDAYS.indexOf(weekStartsOn);
  const start = addDays(date, -((idx - s + 7) % 7));
  return { start, end: addDays(start, 6) };
}

/** Planned (scheduled) training days in [from, to] and how many have a completed session that day. */
export function completion(schedule: WorkoutSchedule | undefined, weeks: WeekPhase[], from: ISODate, to: ISODate, doneDates: Set<ISODate>): { done: number; scheduled: number } {
  if (!schedule) return { done: 0, scheduled: 0 };
  let done = 0, scheduled = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (planForDate(schedule, d, weeks).kind !== 'planned') continue;
    scheduled++;
    if (doneDates.has(d)) done++;
  }
  return { done, scheduled };
}

/**
 * BR-CALC-05: consecutive scheduled training days completed, counting back from today. Rest days and exceptions don't
 * break it; a missed scheduled day does. Today counts if done; if today is scheduled but not done yet it doesn't break.
 */
export function streak(schedule: WorkoutSchedule | undefined, weeks: WeekPhase[], today: ISODate, doneDates: Set<ISODate>, horizonDays = 400): number {
  if (!schedule) return 0;
  let n = 0;
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(today, -i);
    if (schedule.startDate && d < schedule.startDate) break;
    const p = planForDate(schedule, d, weeks);
    if (p.kind === 'none' && !doneDates.has(d)) { if (schedule.startDate && d < schedule.startDate) break; continue; }
    if (p.kind !== 'planned') continue;
    if (doneDates.has(d)) n++;
    else if (i === 0) continue;
    else break;
  }
  return n;
}
