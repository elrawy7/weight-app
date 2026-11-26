/**
 * Personal records (PR-01, BR-PR-01…06). Pure: given every completed performance of one exercise in chronological
 * order, returns the PR events. The first-ever performance is a baseline (no event); ties are not PRs.
 */
import type { ID, LoadMode, SetType, Tracking } from '../db/types';
import { e1rm, type E1rmFormula } from './e1rm';

export type PRType = 'max_weight' | 'reps_at_weight' | 'max_reps' | 'e1rm' | 'exercise_volume' | 'session_volume' | 'duration' | 'distance' | 'speed';

export interface PerfSet { setId: ID; weightKg: number | null; reps: number | null; durationSec?: number | null; setType: SetType; rpe?: number | null }
/** A-05: a completed 0-rep set is a failed attempt – kept in history, never a working set. */
export const isFailed = (s: Pick<PerfSet, 'reps' | 'durationSec'>) => s.reps === 0 && !s.durationSec;
export interface Performance {
  sessionId: ID; localDate: string; startedAt: string | null; exerciseId: ID;
  /** Completed sets of completed sessions only (warm-ups included, flagged by setType). */
  sets: PerfSet[];
  cardio?: { durationMin?: number; distanceM?: number; speedKmh?: number } | null;
  painScore?: number | null;
  /** Working sets planned in that workout (rows, after intentional changes); B-02. */
  plannedWorking?: number;
}
export interface PREvent { exerciseId: ID | null; type: PRType; value: number; previous: number; unit: string; loadMode: LoadMode; sessionId: ID; setId?: ID; date: string; weightKg?: number }

export const LOADED: LoadMode[] = ['total', 'per_hand', 'stack'];
export const perfOrder = (a: Performance, b: Performance) => a.localDate.localeCompare(b.localDate) || (a.startedAt ?? '').localeCompare(b.startedAt ?? '');
export const working = (p: Performance) => p.sets.filter((s) => s.setType !== 'warmup' && !isFailed(s));
export const failedAttempts = (p: Performance) => p.sets.filter((s) => s.setType !== 'warmup' && isFailed(s));

/** Volume of one performance (both hands for per-hand loads – see known limitation R-23). */
export function perfVolume(p: Performance, loadMode: LoadMode): number {
  if (!LOADED.includes(loadMode)) return 0;
  return working(p).reduce((v, s) => v + (s.weightKg ?? 0) * (s.reps ?? 0) * (loadMode === 'per_hand' ? 2 : 1), 0);
}

const wKey = (w: number | null) => String(Math.round((w ?? 0) * 100) / 100);

export function detectPRs(perfs: Performance[], ex: { id: ID; loadMode: LoadMode; tracking: Tracking }, formula: E1rmFormula = 'epley'): PREvent[] {
  const out: PREvent[] = [];
  const best = { weight: -1, e1rm: -1, reps: -1, volume: -1, duration: -1, distance: -1, speed: -1 };
  const repsAt = new Map<string, number>();
  let seen = false;
  const loaded = LOADED.includes(ex.loadMode);
  for (const p of [...perfs].sort(perfOrder)) {
    const ws = working(p);
    const cardio = p.cardio && (p.cardio.durationMin || p.cardio.distanceM);
    if (!ws.length && !cardio) continue;
    const ev = (type: PRType, value: number, previous: number, unit: string, setId?: ID, weightKg?: number) => {
      if (seen) out.push({ exerciseId: ex.id, type, value, previous, unit, loadMode: ex.loadMode, sessionId: p.sessionId, setId, date: p.localDate, ...(weightKg != null ? { weightKg } : {}) });
    };
    // max weight (≥ 1 rep)
    if (loaded && ws.length) {
      const heavy = ws.filter((s) => (s.reps ?? 0) >= 1).reduce<PerfSet | null>((b, s) => (!b || (s.weightKg ?? 0) > (b.weightKg ?? 0) ? s : b), null);
      if (heavy && (heavy.weightKg ?? 0) > best.weight) { if (best.weight >= 0) ev('max_weight', heavy.weightKg ?? 0, best.weight, 'kg', heavy.setId); best.weight = heavy.weightKg ?? 0; }
      // e1RM
      const e = ws.map((s) => ({ s, v: e1rm(s.weightKg, s.reps, ex.loadMode, formula) ?? -1 })).sort((x, y) => y.v - x.v)[0];
      if (e && e.v > 0 && e.v > best.e1rm + 1e-9) { if (best.e1rm >= 0) ev('e1rm', e.v, best.e1rm, 'kg', e.s.setId); best.e1rm = e.v; }
      // most reps at a given weight
      const perW = new Map<string, PerfSet>();
      for (const s of ws) { const k = wKey(s.weightKg); const c = perW.get(k); if (!c || (s.reps ?? 0) > (c.reps ?? 0)) perW.set(k, s); }
      for (const [k, s] of perW) {
        const prevR = repsAt.get(k);
        if (prevR !== undefined && (s.reps ?? 0) > prevR && seen) ev('reps_at_weight', s.reps ?? 0, prevR, 'reps', s.setId, s.weightKg ?? 0);
        if (prevR === undefined || (s.reps ?? 0) > prevR) repsAt.set(k, s.reps ?? 0);
      }
      // exercise volume in one session
      const vol = perfVolume(p, ex.loadMode);
      if (vol > best.volume + 1e-9) { if (best.volume >= 0) ev('exercise_volume', Math.round(vol * 10) / 10, best.volume, 'kg'); best.volume = Math.round(vol * 10) / 10; }
    } else if (ws.length && ex.tracking !== 'duration') {
      // unloaded: most reps in a set
      const r = ws.reduce((b, s) => ((s.reps ?? 0) > (b.reps ?? 0) ? s : b));
      if ((r.reps ?? 0) > best.reps) { if (best.reps >= 0) ev('max_reps', r.reps ?? 0, best.reps, 'reps', r.setId); best.reps = r.reps ?? 0; }
    }
    // duration (timed sets or cardio minutes → seconds), distance, speed
    const dur = Math.max(0, ...ws.map((s) => s.durationSec ?? 0), (p.cardio?.durationMin ?? 0) * 60);
    if (dur > 0 && dur > best.duration) { if (best.duration >= 0) ev('duration', dur, best.duration, 's'); best.duration = dur; }
    const dist = p.cardio?.distanceM ?? 0;
    if (dist > 0 && dist > best.distance) { if (best.distance >= 0) ev('distance', dist, best.distance, 'm'); best.distance = dist; }
    const speed = p.cardio?.speedKmh ?? (dist > 0 && p.cardio?.durationMin ? Math.round((dist / 1000 / (p.cardio.durationMin / 60)) * 10) / 10 : 0);
    if (speed > 0 && speed > best.speed) { if (best.speed >= 0) ev('speed', speed, best.speed, 'km/h'); best.speed = speed; }
    seen = true;
  }
  return out;
}

/** Session total volume PRs across all sessions (BR-PR-02 "best session total volume"). */
export function sessionVolumePRs(sessions: { sessionId: ID; localDate: string; startedAt: string | null; volume: number }[]): PREvent[] {
  const out: PREvent[] = [];
  let best = -1;
  for (const s of [...sessions].sort((a, b) => a.localDate.localeCompare(b.localDate) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))) {
    if (s.volume <= 0) continue;
    if (s.volume > best + 1e-9) { if (best >= 0) out.push({ exerciseId: null, type: 'session_volume', value: Math.round(s.volume), previous: Math.round(best), unit: 'kg', loadMode: 'total', sessionId: s.sessionId, date: s.localDate }); best = s.volume; }
  }
  return out;
}

export interface Best { type: PRType; value: number; date: string; sessionId: ID; weightKg?: number }

/**
 * Standing records of one exercise from all its history (TC-CRIT-12: the Records screen shows the current best even when
 * it was set on the first-ever workout – that one is a baseline, so it is never celebrated, but it is still the record).
 */
export function currentBests(perfs: Performance[], ex: { loadMode: LoadMode; tracking: Tracking }, formula: E1rmFormula = 'epley'): Best[] {
  const out = new Map<PRType, Best>();
  const take = (type: PRType, value: number, p: Performance, weightKg?: number) => {
    if (!(value > 0)) return;
    const c = out.get(type);
    if (!c || value > c.value) out.set(type, { type, value, date: p.localDate, sessionId: p.sessionId, ...(weightKg != null ? { weightKg } : {}) });
  };
  const loaded = LOADED.includes(ex.loadMode);
  for (const p of [...perfs].sort(perfOrder)) {
    const ws = working(p);
    for (const s of ws) {
      if (loaded) { if ((s.reps ?? 0) >= 1) take('max_weight', s.weightKg ?? 0, p); take('e1rm', e1rm(s.weightKg, s.reps, ex.loadMode, formula) ?? 0, p); }
      else if (ex.tracking !== 'duration') take('max_reps', s.reps ?? 0, p);
      if (s.durationSec) take('duration', s.durationSec, p);
    }
    if (loaded) take('exercise_volume', Math.round(perfVolume(p, ex.loadMode) * 10) / 10, p);
    if (p.cardio?.durationMin) take('duration', p.cardio.durationMin * 60, p);
    if (p.cardio?.distanceM) take('distance', p.cardio.distanceM, p);
  }
  return [...out.values()];
}
