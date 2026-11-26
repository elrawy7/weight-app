/**
 * Progressive-overload engine (PO-01…05, BR-PO-01…14; Phase 3.1 B-01…B-05). Pure and deterministic.
 * Suggestions are hints only (BR-PO-09) – nothing here writes data, and every suggestion carries the facts it used.
 *
 * Direction (B-01): for normal loads "harder" = more kg. For assisted machines the number is the assistance, so
 * "harder" = less assistance and "easier" = more assistance; every rule below goes through `stepLoad()` / `easierBy()`.
 */
import type { LoadMode } from '../db/types';
import { roundToIncrement } from './rounding';
import { diffDays } from './dates';

export type Strategy = 'double_progression' | 'linear' | 'rpe_target' | 'manual';
export const STRATEGIES: Strategy[] = ['double_progression', 'linear', 'rpe_target', 'manual'];
const STRATEGY_NAME: Record<Strategy, string> = { double_progression: 'double progression', linear: 'linear', rpe_target: 'RPE target', manual: 'manual' };

export interface RecentSet { weightKg: number | null; reps: number | null; rpe?: number | null }
/**
 * One past performance (successful completed working sets only), newest first in `recent`.
 * `planned` = working sets planned in that workout (after any intentional change); `failed` = 0-rep attempts.
 */
export interface RecentPerf { localDate: string; sets: RecentSet[]; painScore: number | null; planned?: number; failed?: number }

export type SuggestionKind = 'increase' | 'more_reps' | 'hold' | 'reduce' | 'deload_break' | 'deload';
export interface Suggestion {
  kind: SuggestionKind; rule: string;
  /** Load change for each set before snapping (kg); 0 = keep. */
  deltaKg: number;
  /** Multiply loads instead of adding (breaks and deloads); applied before snapping. */
  factor?: number;
  snap: 'up' | 'down' | 'nearest';
  /** New reference load after snapping (kg) – the value the message names. */
  topKg?: number;
  repsTarget?: number;
  setsDelta?: number;
  message: string;
  /** B-05: the facts behind the suggestion, in plain language. */
  factors: string[];
  alternative?: string;
}

export interface WeightContext {
  incrementKg: number;
  /** Achievable loads (kg) – dumbbells per hand, barbell totals, stack positions. Empty = the increment grid. */
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
  incrementSteps?: number;
  deload?: { active: boolean; reason: 'planned' | 'after_block' } | null;
  deloadPct?: number;
  deloadSets?: number;
  alternativeName?: string;
  noDeload?: boolean;
  /** For assisted exercises: body weight turns "% easier" into the right assistance. */
  bodyweightKg?: number | null;
}

export function parseRepRange(target: string | undefined): { min: number; max: number } | null {
  if (!target) return null;
  const m = target.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const one = target.match(/^\s*(\d+)\s*(reps?)?\s*$/i);
  return one ? { min: Number(one[1]), max: Number(one[1]) } : null;
}

const rpeCap = (target?: string) => { const n = (target?.match(/\d+(\.\d+)?/g) ?? []).map(Number); return n.length ? Math.max(...n) : NaN; };
const kgTxt = (v: number) => `${Math.round(v * 100) / 100} kg`;

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

export interface PlateStock { kg: number; pairs?: number }

/**
 * B-04: every total achievable with the bar plus plate pairs (one plate of each pair per side). `pairs` undefined =
 * unlimited (documented assumption: a commercial gym has enough of each plate). Exact – computed in grams, so plates
 * that are not multiples of the smallest one (e.g. 20 + 15) are handled, and limited stock never yields impossible loads.
 */
export function plateLoads(barKg: number, plates: PlateStock[], max = 300): number[] {
  const g = (kg: number) => Math.round(kg * 1000);
  const maxSide = Math.max(0, Math.floor((g(max) - g(barKg)) / 2));
  let reach = new Set<number>([0]);
  for (const p of plates.filter((x) => x.kg > 0)) {
    const w = g(p.kg);
    const limit = p.pairs == null ? Math.floor(maxSide / w) : Math.max(0, Math.floor(p.pairs));
    const next = new Set<number>(reach);
    for (const r of reach) for (let k = 1; k <= limit && r + k * w <= maxSide; k++) next.add(r + k * w);
    reach = next;
  }
  return [...reach].map((side) => (g(barKg) + 2 * side) / 1000).sort((a, b) => a - b);
}

/** Unlimited-stock wrapper for callers that only know the denominations. */
export function barbellLoads(barKg: number, plates: number[], max = 300): number[] {
  return plateLoads(barKg, plates.map((kg) => ({ kg })), max);
}

/* ───────────── direction-aware helpers (B-01) ───────────── */

const isAssist = (m: LoadMode) => m === 'assist';
/** Reference load of a performance: heaviest set, or for assisted the least assistance (the hardest set). */
export function refLoad(sets: RecentSet[], loadMode: LoadMode): number {
  const w = sets.map((s) => s.weightKg ?? 0);
  return w.length ? (isAssist(loadMode) ? Math.min(...w) : Math.max(...w)) : 0;
}

/** Effective score of a performance for stall detection: higher = better. */
function perfScore(p: RecentPerf, loadMode: LoadMode, bw?: number | null): number {
  if (!p.sets.length) return -Infinity;
  if (isAssist(loadMode)) {
    return Math.max(...p.sets.map((s) => {
      const r = s.reps ?? 0, a = s.weightKg ?? 0;
      return bw ? (bw - a) * (1 + r / 30) : -a * 1000 + r; // without body weight: less assistance first, then reps
    }));
  }
  return Math.max(0, ...p.sets.map((s) => ((s.weightKg ?? 0) > 0 ? (s.weightKg ?? 0) * (1 + (s.reps ?? 0) / 30) : (s.reps ?? 0))));
}

/** PO-05: three consecutive sessions without improvement (needs 4 performances). Direction-aware for assistance. */
export function isStalled(recent: RecentPerf[], loadMode: LoadMode = 'total', bodyweightKg?: number | null): boolean {
  if (recent.length < 4) return false;
  const s = recent.slice(0, 4).map((p) => perfScore(p, loadMode, bodyweightKg));
  return s[0] <= s[1] + 1e-9 && s[1] <= s[2] + 1e-9 && s[2] <= s[3] + 1e-9;
}

export function suggest(a: SuggestArgs): Suggestion | null {
  const strategy = a.exercise.strategy ?? a.defaultStrategy ?? 'double_progression';
  const prev = a.recent[0];
  const lm = a.exercise.loadMode;
  if (strategy === 'manual') return null; // PO-04 / SET-03 AC2
  if (!prev || !prev.sets.length || a.exercise.status === 'unresolved') return null; // BR-PO-12, first time
  if (lm === 'none' || lm === 'band') return null;
  const assist = isAssist(lm);
  const inc = Math.max(0, a.weights.incrementKg) * Math.min(2, Math.max(1, a.incrementSteps ?? 1));
  const reps = prev.sets.map((s) => s.reps ?? 0);
  const fmt = reps.join('/');
  const ref = refLoad(prev.sets, lm);
  const range = parseRepRange(a.targetReps);
  const days = diffDays(a.today, prev.localDate);
  const done = prev.sets.length;
  const failed = prev.failed ?? 0;
  const planned = Math.max(done + failed, prev.planned ?? done + failed);
  const loadWord = assist ? 'assistance' : 'load';

  // B-05: the facts behind every suggestion
  const weights = [...new Set(prev.sets.map((s) => s.weightKg ?? 0))];
  const factors: string[] = [
    `Last time (${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}): ${weights.length === 1 ? `${fmt} @ ${kgTxt(weights[0])}${assist ? ' assistance' : ''}` : prev.sets.map((s) => `${s.weightKg ?? 0}×${s.reps ?? 0}`).join(', ')}`,
    `${done} of ${planned} planned sets completed${failed ? ` (${failed} failed attempt${failed > 1 ? 's' : ''})` : ''}`,
  ];
  if (range) factors.push(`Target ${range.min === range.max ? range.min : `${range.min}–${range.max}`} reps`);
  const rpes = prev.sets.map((s) => s.rpe).filter((v): v is number => v != null);
  if (rpes.length) factors.push(`RPE ${rpes.join(', ')}${a.targetRpe ? ` (target ${a.targetRpe})` : ''}`);
  if (prev.painScore != null) factors.push(`Pain ${prev.painScore}/10 last time`);
  factors.push(`Strategy: ${STRATEGY_NAME[strategy]}`);
  if (assist) factors.push('Assisted: less assistance = harder');

  const changed = (t: number) => Math.abs(t - ref) > 1e-9;
  /** One increment harder (+1) or easier (−1), snapped to what exists. */
  const stepLoad = (steps: 1 | -1) => {
    const towardsMore = assist ? steps < 0 : steps > 0; // more kg on the stack/bar, or more assistance
    const snap: 'up' | 'down' = towardsMore ? 'up' : 'down';
    return { t: snapWeight(Math.max(0, ref + (towardsMore ? inc : -inc)), a.weights, snap), snap };
  };
  /** A fraction easier (break, deload). Assisted: scale the effective load with body weight, else add increments. */
  const easierBy = (frac: number) => {
    if (!assist) return { t: snapWeight(ref * (1 - frac), a.weights, 'down'), snap: 'down' as const, factor: 1 - frac as number | undefined };
    const target = a.bodyweightKg && a.bodyweightKg > ref ? a.bodyweightKg - (a.bodyweightKg - ref) * (1 - frac) : ref + Math.max(1, Math.round(frac * 10)) * (inc || 5);
    return { t: snapWeight(target, a.weights, 'up'), snap: 'up' as const, factor: undefined };
  };
  const mk = (s: Omit<Suggestion, 'factors'>): Suggestion => ({ ...s, factors });

  // BR-PO-01 pain gate
  if (prev.painScore != null && prev.painScore >= 4) {
    return mk({ kind: 'hold', rule: 'BR-PO-01', deltaKg: 0, snap: 'nearest', topKg: ref || undefined, alternative: a.alternativeName,
      message: `Pain ${prev.painScore}/10 last time – no increase. Hold the ${loadWord}${a.alternativeName ? ` or use ${a.alternativeName}` : ' or use the knee-friendly swap'}.` });
  }
  // BR-PO-02 / 03 long breaks → easier
  if (days >= 14 && (ref > 0 || assist)) {
    const frac = days > 28 ? 0.2 : 0.1;
    const e = easierBy(frac);
    factors.push(`${days} days since last time`);
    return mk({ kind: 'deload_break', rule: days > 28 ? 'BR-PO-02' : 'BR-PO-03', deltaKg: e.t - ref, factor: e.factor, snap: e.snap, topKg: e.t,
      message: changed(e.t)
        ? `${days > 28 ? `Returning after ${Math.round(days / 7)} weeks` : `${days} days since last time`} – start about ${Math.round(frac * 100)}% ${assist ? 'easier with more assistance' : 'lighter'} (${kgTxt(e.t)}).`
        : `${days} days since last time – keep ${kgTxt(ref)} (nothing ${assist ? 'with more assistance' : 'lighter'} is available) and take the first set easy.` });
  }
  // BR-PO-08 deload (planned week after the block, or 3 stalls on a main lift)
  const pct = a.deloadPct ?? 10;
  const stalled = !a.noDeload && !!a.exercise.isMain && isStalled(a.recent, lm, a.bodyweightKg);
  if (((a.deload?.active && !a.noDeload) || stalled) && (ref > 0 || assist)) {
    const e = easierBy(pct / 100);
    const why = stalled ? 'No progress in 3 sessions' : a.deload?.reason === 'after_block' ? 'The 4-week block is finished' : 'Deload week';
    factors.push(why);
    return mk({ kind: 'deload', rule: 'BR-PO-08', deltaKg: e.t - ref, factor: e.factor, snap: e.snap, topKg: e.t, setsDelta: -(a.deloadSets ?? 1),
      message: `${why} – deload: about ${pct}% easier (${assist ? 'more assistance, ' : ''}${kgTxt(e.t)}) and ${a.deloadSets ?? 1} set fewer.` });
  }

  if (!range) return null;
  const cap = rpeCap(a.targetRpe);
  const tooHard = Number.isFinite(cap) && rpes.some((r) => r > cap + 0.5);
  const below = reps.some((r) => r < range.min) || failed > 0;
  const olderBelow = !!a.recent[1] && (a.recent[1].sets.some((s) => (s.reps ?? 0) < range.min) || (a.recent[1].failed ?? 0) > 0);
  const incomplete = done < planned;

  const increase = (rule: string, why: string, repsTarget?: number): Suggestion => {
    // B-02: never progress the load off a partial workout
    if (incomplete) return mk({ kind: 'hold', rule: 'BR-PO-13', deltaKg: 0, snap: 'nearest', topKg: ref || undefined,
      message: `Only ${done} of ${planned} planned sets were completed last time – repeat ${kgTxt(ref)}${assist ? ' assistance' : ''} and complete all sets first.` });
    if (lm === 'bodyweight' && ref === 0) return mk({ kind: 'more_reps', rule, deltaKg: 0, snap: 'nearest', message: `${why} Add load or slow the tempo.` });
    // B-03: equipment limits
    if (assist && ref <= 0) return mk({ kind: 'more_reps', rule: 'BR-PO-14', deltaKg: 0, snap: 'nearest', topKg: 0, message: `${why} No assistance left – add reps or move to the unassisted version.` });
    const { t, snap } = stepLoad(1);
    if (!changed(t) || (assist ? t > ref : t < ref)) {
      factors.push(assist ? `No smaller assistance step than ${kgTxt(ref)}` : `Heaviest available load: ${kgTxt(ref)}`);
      return mk({ kind: 'more_reps', rule: 'BR-PO-14', deltaKg: 0, snap: 'nearest', topKg: ref,
        message: assist ? `${why} No smaller assistance step is available – stay at ${kgTxt(ref)} and add reps.` : `${why} You are on the heaviest available load (${kgTxt(ref)}) – add reps or slow the tempo.` });
    }
    factors.push(`Next available ${loadWord}: ${kgTxt(t)}`);
    return mk({ kind: 'increase', rule, deltaKg: t - ref, snap, topKg: t, repsTarget,
      message: `${why} ${assist ? 'Reduce assistance' : 'Add load'}: ${kgTxt(t)}${repsTarget ? `, restart at ${repsTarget} reps` : ''}.` });
  };

  // BR-PO-06 below the minimum twice → one step easier (all strategies)
  if (below && olderBelow) {
    const { t, snap } = stepLoad(-1);
    if (!changed(t) || (assist ? t < ref : t > ref)) return mk({ kind: 'hold', rule: 'BR-PO-06', deltaKg: 0, snap: 'nearest', topKg: ref,
      message: `Below ${range.min} reps twice in a row, but ${assist ? 'no more assistance' : 'no lighter load'} is available – keep ${kgTxt(ref)} and aim for ${range.min} reps.` });
    return mk({ kind: 'reduce', rule: 'BR-PO-06', deltaKg: t - ref, snap, topKg: t, message: `Below ${range.min} reps twice in a row – go to ${kgTxt(t)}${assist ? ' assistance' : ''}.` });
  }
  if (below) return mk({ kind: 'hold', rule: 'BR-PO-07', deltaKg: 0, snap: 'nearest', topKg: ref || undefined, message: `${fmt} – missed the range once. Repeat the same ${assist ? 'assistance' : 'weight'}.` });

  if (strategy === 'linear') {
    if (tooHard) return mk({ kind: 'hold', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `${fmt} – reps done but harder than RPE ${a.targetRpe}. Repeat the weight.` });
    return increase('BR-PO-11', `${fmt} – all reps done (linear).`);
  }
  if (strategy === 'rpe_target' && Number.isFinite(cap) && rpes.length) {
    const hardest = Math.max(...rpes);
    if (hardest > cap + 0.5) return mk({ kind: 'hold', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `Last time reached RPE ${hardest} (target ${a.targetRpe}) – keep the weight.` });
    if (hardest <= cap - 1) return increase('BR-PO-11', `Last time felt easy (RPE ${hardest}, target ${a.targetRpe}).`);
    return mk({ kind: 'more_reps', rule: 'BR-PO-11', deltaKg: 0, snap: 'nearest', message: `RPE ${hardest} is on target – same weight, aim for +1 rep.` });
  }
  // double progression (default; also the RPE strategy without RPE data)
  if (reps.every((r) => r >= range.max)) {
    if (tooHard) return mk({ kind: 'hold', rule: 'BR-PO-04', deltaKg: 0, snap: 'nearest', message: `${fmt} – top of the range but harder than RPE ${a.targetRpe}. Repeat the weight.` });
    return increase('BR-PO-04', `${fmt} – all sets at the top of ${range.min}–${range.max}.`, range.min);
  }
  // AC2: 12/10/9 → keep the load, aim 12/11/10 (+1 rep on every set below the top of the range)
  const aim = reps.map((r) => Math.min(range.max, r + (r < range.max ? 1 : 0))).join('/');
  return mk({ kind: 'more_reps', rule: 'BR-PO-05', deltaKg: 0, snap: 'nearest', topKg: ref || undefined, message: `${fmt} – keep ${ref > 0 ? kgTxt(ref) : 'the same load'}${assist ? ' assistance' : ''}, aim for ${aim}.` });
}
