/**
 * Progressive-overload engine (PO-01…05, BR-PO-01…12). Pure and deterministic: same inputs → same suggestion.
 * Suggestions are hints only (BR-PO-09) – nothing here writes data.
 */
import type { LoadMode } from '../db/types';
import { roundToIncrement } from './rounding';
import { diffDays } from './dates';

export type Strategy = 'double_progression' | 'linear' | 'rpe_target' | 'manual';
export const STRATEGIES: Strategy[] = ['double_progression', 'linear', 'rpe_target', 'manual'];

export interface RecentSet { weightKg: number | null; reps: number | null; rpe?: number | null }
/** One past performance of the exercise (completed working sets only), newest first in `recent`. */
export interface RecentPerf { localDate: string; sets: RecentSet[]; painScore: number | null }

export type SuggestionKind = 'increase' | 'more_reps' | 'hold' | 'reduce' | 'deload_break' | 'deload';
export interface Suggestion {
  kind: SuggestionKind; rule: string;
  /** Load change for each set before snapping (kg). */
  deltaKg: number;
  /** Multiply loads instead of adding (breaks and deloads); applied before snapping. */
  factor?: number;
  /** Snap direction for "Use suggestion". */
  snap: 'up' | 'down' | 'nearest';
  /** Snapped new top working weight (kg), for display. */
  topKg?: number;
  repsTarget?: number;
  /** −1 set for a deload. */
  setsDelta?: number;
  message: string;
  alternative?: string;
}

export interface WeightContext {
  incrementKg: number;
  /** Achievable loads (kg) – dumbbells per hand, barbell totals, stack positions. Empty = use the increment grid. */
  available?: number[];
}

export interface SuggestArgs {
  exercise: { status: string; loadMode: LoadMode; strategy?: Strategy | null; isMain?: boolean };
  recent: RecentPerf[];
  targetReps?: string;
  targetRpe?: string;
  today: string;
  weights: WeightContext;
  defaultStrategy?: Strategy;
  /** BR-PO-04 configurable 1–2 increments per step. */
  incrementSteps?: number;
  deload?: { active: boolean; reason: 'planned' | 'after_block' } | null;
  deloadPct?: number;
  deloadSets?: number;
  /** BR-PO-01: knee-friendly swap to show with the pain hold. */
  alternativeName?: string;
  /** PO-05: the deload card was dismissed for this exercise. */
  noDeload?: boolean;
}

export function parseRepRange(target: string | undefined): { min: number; max: number } | null {
  if (!target) return null;
  const m = target.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const one = target.match(/^\s*(\d+)\s*(reps?)?\s*$/i);
  return one ? { min: Number(one[1]), max: Number(one[1]) } : null;
}

const rpeCap = (target?: string) => { const n = (target?.match(/\d+(\.\d+)?/g) ?? []).map(Number); return n.length ? Math.max(...n) : NaN; };

/** Snap a load to an achievable value (PO-02). */
export function snapWeight(kg: number, ctx: WeightContext, mode: 'up' | 'down' | 'nearest'): number {
  const list = (ctx.available ?? []).filter((v) => v >= 0).sort((a, b) => a - b);
  if (list.length) {
    if (mode === 'up') return list.find((v) => v >= kg - 1e-9) ?? list[list.length - 1];
    if (mode === 'down') return [...list].reverse().find((v) => v <= kg + 1e-9) ?? list[0];
    return list.reduce((b, v) => (Math.abs(v - kg) < Math.abs(b - kg) ? v : b), list[0]);
  }
  return Math.max(0, roundToIncrement(kg, ctx.incrementKg || 0.5, mode));
}

/** Achievable barbell totals: bar + pairs of plates (unlimited pairs of each listed plate), up to `max`. */
export function barbellLoads(barKg: number, plates: number[], max = 300): number[] {
  const smallest = Math.min(...plates.filter((p) => p > 0));
  if (!Number.isFinite(smallest)) return [barKg];
  const step = smallest * 2;
  const out: number[] = [];
  for (let v = barKg; v <= max + 1e-9; v = Math.round((v + step) * 1000) / 1000) out.push(v);
  return out;
}

/** Score of a performance for stall detection: best e1RM-like value (weight × (1 + reps/30)), or reps when unloaded. */
const perfScore = (p: RecentPerf) => Math.max(0, ...p.sets.map((s) => ((s.weightKg ?? 0) > 0 ? (s.weightKg ?? 0) * (1 + (s.reps ?? 0) / 30) : (s.reps ?? 0))));

/** PO-05: three consecutive sessions without improvement (needs 4 performances). */
export function isStalled(recent: RecentPerf[]): boolean {
  if (recent.length < 4) return false;
  const s = recent.slice(0, 4).map(perfScore);
  return s[0] <= s[1] + 1e-9 && s[1] <= s[2] + 1e-9 && s[2] <= s[3] + 1e-9;
}

export function suggest(a: SuggestArgs): Suggestion | null {
  const strategy = a.exercise.strategy ?? a.defaultStrategy ?? 'double_progression';
  const prev = a.recent[0];
  if (strategy === 'manual') return null; // PO-04 / SET-03 AC2
  if (!prev || !prev.sets.length || a.exercise.status === 'unresolved') return null; // BR-PO-12, first time
  if (a.exercise.loadMode === 'none' || a.exercise.loadMode === 'band') return null;
  const inc = Math.max(0, a.weights.incrementKg) * Math.min(2, Math.max(1, a.incrementSteps ?? 1));
  const assist = a.exercise.loadMode === 'assist';
  const reps = prev.sets.map((s) => s.reps ?? 0);
  const fmt = reps.join('/');
  const top = Math.max(0, ...prev.sets.map((s) => s.weightKg ?? 0));
  const snapTop = (kg: number, mode: 'up' | 'down' | 'nearest') => (top > 0 ? snapWeight(kg, a.weights, mode) : undefined);
  const kgTxt = (v: number) => `${Math.round(v * 100) / 100} kg`;

  // BR-PO-01 pain gate
  if (prev.painScore != null && prev.painScore >= 4) {
    return { kind: 'hold', rule: 'BR-PO-01', deltaKg: 0, snap: 'nearest', topKg: snapTop(top, 'nearest'), alternative: a.alternativeName,
      message: `Pain ${prev.painScore}/10 last time – no increase. Hold the load${a.alternativeName ? ` or use ${a.alternativeName}` : ' or use the knee-friendly swap'}.` };
  }
  // BR-PO-02 / 03 long breaks
  const days = diffDays(a.today, prev.localDate);
  if (days > 28 && top > 0) {
    const t = snapWeight(top * 0.8, a.weights, 'down');
    return { kind: 'deload_break', rule: 'BR-PO-02', deltaKg: t - top, factor: 0.8, snap: 'down', topKg: t, message: `Returning after ${Math.round(days / 7)} weeks – start about 20% lighter (${kgTxt(t)}).` };
  }
  if (days >= 14 && top > 0) {
    const t = snapWeight(top * 0.9, a.weights, 'down');
    return { kind: 'deload_break', rule: 'BR-PO-03', deltaKg: t - top, factor: 0.9, snap: 'down', topKg: t, message: `${days} days since last time – start about 10% lighter (${kgTxt(t)}).` };
  }
  // BR-PO-08 deload (planned week after the block, or 3 stalls on a main lift)
  const pct = a.deloadPct ?? 10;
  const stalled = !a.noDeload && !!a.exercise.isMain && isStalled(a.recent);
  if (((a.deload?.active && !a.noDeload) || stalled) && top > 0) {
    const t = snapWeight(top * (1 - pct / 100), a.weights, 'down');
    const why = stalled ? 'No progress in 3 sessions' : a.deload?.reason === 'after_block' ? 'The 4-week block is finished' : 'Deload week';
    return { kind: 'deload', rule: 'BR-PO-08', deltaKg: t - top, factor: 1 - pct / 100, snap: 'down', topKg: t, setsDelta: -(a.deloadSets ?? 1),
      message: `${why} – deload: about ${pct}% lighter (${kgTxt(t)}) and ${a.deloadSets ?? 1} set fewer.` };
  }

  const range = parseRepRange(a.targetReps);
  if (!range) return null;
  const cap = rpeCap(a.targetRpe);
  const rpes = prev.sets.map((s) => s.rpe).filter((v): v is number => v != null);
  const tooHard = Number.isFinite(cap) && rpes.some((r) => r > cap + 0.5);
  const below = reps.some((r) => r < range.min);
  const olderBelow = !!a.recent[1]?.sets.some((s) => (s.reps ?? 0) < range.min);
  const up = assist ? -inc : inc;
  const increase = (rule: string, why: string, repsTarget?: number): Suggestion => {
    if (a.exercise.loadMode === 'bodyweight' && top === 0) return { kind: 'more_reps', rule, deltaKg: 0, snap: 'nearest', message: `${why} Add load or slow the tempo.` };
    const t = snapWeight(top + up, a.weights, assist ? 'down' : 'up');
    return { kind: 'increase', rule, deltaKg: t - top, snap: assist ? 'down' : 'up', topKg: t, repsTarget,
      message: `${why} ${assist ? 'Reduce assistance' : 'Add load'}: ${kgTxt(t)}${repsTarget ? `, restart at ${repsTarget} reps` : ''}.` };
  };
  // BR-PO-06 below the minimum twice → reduce (all strategies)
  if (below && olderBelow) {
    const t = snapWeight(top - (assist ? -inc : inc), a.weights, assist ? 'up' : 'down');
    return { kind: 'reduce', rule: 'BR-PO-06', deltaKg: t - top, snap: assist ? 'up' : 'down', topKg: t, message: `Below ${range.min} reps twice in a row – go to ${kgTxt(t)}.` };
  }
  if (below) return { kind: 'hold', rule: 'BR-PO-07', deltaKg: 0, snap: 'nearest', topKg: snapTop(top, 'nearest'), message: `${fmt} – missed the range once. Repeat the same weight.` };

  if (strategy === 'linear') {
    // +increment every session in which every set reached the prescribed reps (the bottom of the range).
    if (tooHard) return { kind: 'hold', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `${fmt} – reps done but harder than RPE ${a.targetRpe}. Repeat the weight.` };
    return increase('BR-PO-11', `${fmt} – all reps done (linear).`);
  }
  if (strategy === 'rpe_target' && Number.isFinite(cap) && rpes.length) {
    const hardest = Math.max(...rpes);
    if (hardest > cap + 0.5) return { kind: 'hold', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `Last time reached RPE ${hardest} (target ${a.targetRpe}) – keep the weight.` };
    if (hardest <= cap - 1) return increase('BR-PO-11', `Last time felt easy (RPE ${hardest}, target ${a.targetRpe}).`);
    return { kind: 'more_reps', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `RPE ${hardest} is on target – same weight, aim for +1 rep.` };
  }
  // double progression (default; also RPE strategy without RPE data)
  if (reps.every((r) => r >= range.max)) {
    if (tooHard) return { kind: 'hold', rule: 'BR-PO-04', deltaKg: 0, snap: 'nearest', message: `${fmt} – top of the range but harder than RPE ${a.targetRpe}. Repeat the weight.` };
    return increase('BR-PO-04', `${fmt} – all sets at the top of ${range.min}–${range.max}.`, range.min);
  }
  // AC2: 12/10/9 → keep the load, aim 12/11/10 (+1 rep on every set below the top of the range)
  const aim = reps.map((r) => Math.min(range.max, r + (r < range.max ? 1 : 0))).join('/');
  return { kind: 'more_reps', rule: 'BR-PO-05', deltaKg: 0, snap: 'nearest', topKg: snapTop(top, 'nearest'), message: `${fmt} – keep ${top > 0 ? kgTxt(top) : 'the same load'}, aim for ${aim}.` };
}
