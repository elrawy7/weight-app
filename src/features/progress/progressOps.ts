/** Loaders for the Progress screens (AN-01, PR-01, MG-01) and the Today dashboard (DASH-01…04). */
import type { WeightDB } from '../../db/schema';
import type { Exercise, ID, ISODate, MuscleGroup, PersonalRecord, WorkoutProgram, WorkoutSchedule } from '../../db/types';
import { exerciseStats, muscleSets, completion, streak, weekBounds, type ExerciseStats, type MuscleCount } from '../../domain/analytics';
import { currentBests, perfOrder, working, type Best, type Performance } from '../../domain/records';
import { addDays } from '../../domain/dates';
import { getSettings } from '../../db/defaults';
import * as R from '../../db/repos';
import { suggest, isStalled } from '../../domain/progression';
import { resolveIncrement } from '../../domain/rounding';
import { latestBodyweight, recentPerfs, weightContext, deloadState } from '../workout/suggestionCtx';
import { parentList, parentName } from './muscleNames';
import { performancesOf, SESSION_KEY } from './recordsOps';

export interface ProgressRow { ex: Exercise; sessions: number; last: ISODate; improvementPct: number | null }

export async function progressList(db: WeightDB): Promise<ProgressRow[]> {
  const settings = await getSettings(db);
  const perfs = await performancesOf(db, null);
  const byEx = new Map<ID, Performance[]>();
  for (const p of perfs) if (working(p).length || p.cardio) byEx.set(p.exerciseId, [...(byEx.get(p.exerciseId) ?? []), p]);
  const exs = new Map((await db.exercises.bulkGet([...byEx.keys()])).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
  const rows: ProgressRow[] = [];
  for (const [id, ps] of byEx) {
    const ex = exs.get(id);
    if (!ex) continue;
    const st = exerciseStats(ps, ex.loadMode, ex.tracking, settings.e1rmFormula);
    rows.push({ ex, sessions: st.sessions, last: st.last?.date ?? '', improvementPct: st.improvementPct });
  }
  return rows.sort((a, b) => b.last.localeCompare(a.last) || a.ex.name.localeCompare(b.ex.name));
}

export interface ExerciseProgress { ex: Exercise; perfs: Performance[]; stats: ExerciseStats; records: PersonalRecord[] }

export async function exerciseProgress(db: WeightDB, id: ID): Promise<ExerciseProgress | null> {
  const ex = await db.exercises.get(id);
  if (!ex) return null;
  const settings = await getSettings(db);
  const perfs = (await performancesOf(db, [id])).sort(perfOrder);
  const records = (await db.personalRecords.where('exerciseId').equals(id).toArray()).sort((a, b) => b.achievedAt.localeCompare(a.achievedAt));
  return { ex, perfs, stats: exerciseStats(perfs, ex.loadMode, ex.tracking, settings.e1rmFormula), records };
}

export interface CurrentRecords { exerciseId: ID; name: string; bests: Best[] }

/** PR-01 Records screen: standing bests per exercise (from all history) and the PR timeline (celebrated PRs only). */
export async function recordsOverview(db: WeightDB): Promise<{ current: CurrentRecords[]; recent: (PersonalRecord & { name: string })[] }> {
  const settings = await getSettings(db);
  const perfs = await performancesOf(db, null);
  const byEx = new Map<ID, Performance[]>();
  for (const p of perfs) byEx.set(p.exerciseId, [...(byEx.get(p.exerciseId) ?? []), p]);
  const exs = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
  const current: CurrentRecords[] = [];
  for (const [id, ps] of byEx) {
    const ex = exs.get(id);
    if (!ex || ex.status === 'unresolved') continue;
    const bests = currentBests(ps, ex, settings.e1rmFormula);
    if (bests.length) current.push({ exerciseId: id, name: ex.name, bests });
  }
  const all = await db.personalRecords.toArray();
  const recent = all.map((r) => ({ ...r, name: r.exerciseId === SESSION_KEY ? '' : exs.get(r.exerciseId)?.name ?? r.exerciseId }))
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt) || b.value - a.value);
  return { current: current.sort((a, b) => a.name.localeCompare(b.name)), recent };
}

export interface MuscleSummary { rows: (MuscleCount & { name: string; prev: number })[]; groups: MuscleGroup[]; from: ISODate; to: ISODate; days: number }

/** MG-01: fractional sets per muscle in [from, to], with the previous period of the same length for comparison. */
export async function muscleSummary(db: WeightDB, from: ISODate, to: ISODate): Promise<MuscleSummary> {
  const settings = await getSettings(db);
  const groups = await db.muscleGroups.toArray();
  const links = await db.exerciseMuscles.toArray();
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const perfs = await performancesOf(db, null);
  const cur = muscleSets(perfs.filter((p) => p.localDate >= from && p.localDate <= to), links, groups, settings.secondaryMuscleWeight);
  const prev = muscleSets(perfs.filter((p) => p.localDate >= addDays(from, -days) && p.localDate < from), links, groups, settings.secondaryMuscleWeight);
  const allTime = muscleSets(perfs, links, groups, settings.secondaryMuscleWeight);
  const parents = parentList(groups);
  const rows = parents.map((g) => ({
    parentId: g.id, name: g.name, sets: cur.get(g.id)?.sets ?? 0, sub: cur.get(g.id)?.sub ?? {}, lastTrained: allTime.get(g.id)?.lastTrained ?? null, prev: prev.get(g.id)?.sets ?? 0,
  })).filter((r) => r.sets > 0 || r.prev > 0 || r.lastTrained).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
  return { rows, groups, from, to, days };
}

/* ───────────── dashboard (DASH-01…04) ───────────── */

export interface Dashboard {
  week: { start: ISODate; end: ISODate; done: number; scheduled: number };
  streak: number; totalWorkouts: number; totalMinutes: number;
  weekVolumeKg: number; weekMuscles: { id: string; name: string; sets: number }[];
  recentPrs: (PersonalRecord & { name: string })[];
  program?: WorkoutProgram; schedule?: WorkoutSchedule;
}

export async function dashboard(db: WeightDB, today: ISODate): Promise<Dashboard> {
  const settings = await getSettings(db);
  const program = await R.activeProgram(db);
  const schedule = program ? await db.schedules.where('programId').equals(program.id).first() : undefined;
  const completed = await db.sessions.where('status').equals('completed').toArray();
  const doneDates = new Set(completed.map((s) => s.localDate));
  const wk = weekBounds(today, settings.weekStartsOn);
  const comp = completion(schedule, program?.weeks ?? [], wk.start, wk.end, doneDates);
  const perfs = await performancesOf(db, null, { from: wk.start, to: wk.end }); // E-06: this week only
  const exs = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
  let vol = 0;
  for (const p of perfs) for (const s of working(p)) {
    const lm = exs.get(p.exerciseId)?.loadMode ?? 'none';
    if (lm === 'total' || lm === 'stack' || lm === 'per_hand') vol += (s.weightKg ?? 0) * (s.reps ?? 0) * (lm === 'per_hand' ? 2 : 1);
  }
  const groups = await db.muscleGroups.toArray();
  const m = muscleSets(perfs, await db.exerciseMuscles.toArray(), groups, settings.secondaryMuscleWeight);
  const gName = new Map(parentList(groups).map((g) => [g.id, g.name]));
  const since = addDays(today, -13);
  const recent = (await db.personalRecords.where('achievedAt').aboveOrEqual(since).toArray())
    .filter((r) => r.exerciseId !== SESSION_KEY && r.type !== 'reps_at_weight')
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt) || (a.type === 'max_weight' ? -1 : 1));
  const seen = new Set<string>();
  const recentPrs = recent.filter((r) => { if (seen.has(r.exerciseId)) return false; seen.add(r.exerciseId); return true; }).slice(0, 3).map((r) => ({ ...r, name: exs.get(r.exerciseId)?.name ?? r.exerciseId }));
  return {
    week: { ...wk, ...comp }, streak: streak(schedule, program?.weeks ?? [], today, doneDates),
    totalWorkouts: completed.length, totalMinutes: completed.reduce((a, s) => a + (s.durationMin ?? 0), 0),
    weekVolumeKg: Math.round(vol), weekMuscles: [...m.values()].map((c) => ({ id: c.parentId, name: gName.get(c.parentId) ?? c.parentId, sets: c.sets })).sort((a, b) => b.sets - a.sets),
    recentPrs, program, schedule,
  };
}

/* ───────────── DASH-04 recommendations ───────────── */

export type Recommendation =
  | { kind: 'deload'; reason: 'planned' | 'after_block' | 'stall'; exercise?: string }
  | { kind: 'progress'; exerciseId: ID; name: string; topKg: number; assist?: boolean }
  | { kind: 'limited'; muscleId: string; name: string; sets: number; min: number };

/** Up to `max` actionable cards (backup is added by the caller, which owns the backup state). */
export async function recommendations(db: WeightDB, today: ISODate, max = 3): Promise<Recommendation[]> {
  const settings = await getSettings(db);
  const program = await R.activeProgram(db);
  const out: Recommendation[] = [];
  const dl = deloadState(program, today);
  if (dl?.active) out.push({ kind: 'deload', reason: dl.reason });

  // exercises done in the last 21 days, with the targets they were done against
  const since = addDays(today, -21);
  const sessions = (await db.sessions.where('status').equals('completed').toArray()).filter((s) => s.localDate >= since);
  const ses = sessions.length ? await db.sessionExercises.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray() : [];
  const latestTarget = new Map<ID, { reps?: string; date: string }>();
  const dateOf = new Map(sessions.map((s) => [s.id, s.localDate]));
  for (const se of ses) {
    const d = dateOf.get(se.sessionId)!;
    const c = latestTarget.get(se.exerciseId);
    if (se.snapshot?.targetReps && (!c || d > c.date)) latestTarget.set(se.exerciseId, { reps: se.snapshot.targetReps, date: d });
  }
  const ids = [...latestTarget.keys()];
  const exs = new Map((await db.exercises.bulkGet(ids)).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
  const recent = await recentPerfs(db, ids, { id: '__none__', localDate: addDays(today, 1), startedAt: null });
  const bodyweightKg = (await latestBodyweight(db)) ?? undefined;
  const ready: Recommendation[] = [];
  for (const id of ids) {
    const ex = exs.get(id);
    if (!ex) continue;
    const r = recent.get(id) ?? [];
    if (!dl?.active && ex.mechanic === 'compound' && isStalled(r, ex.loadMode, bodyweightKg) && !out.some((o) => o.kind === 'deload')) out.push({ kind: 'deload', reason: 'stall', exercise: ex.name });
    const inc = resolveIncrement(ex, settings.incrementOverrides);
    const s = suggest({ exercise: { status: ex.status, loadMode: ex.loadMode, strategy: ex.strategy }, recent: r, targetReps: latestTarget.get(id)?.reps, today, weights: weightContext(ex, inc, settings),
      defaultStrategy: settings.defaultStrategy, incrementSteps: settings.incrementSteps, bodyweightKg });
    if (s?.kind === 'increase' && s.topKg != null && (s.topKg > 0 || ex.loadMode === 'assist')) ready.push({ kind: 'progress', exerciseId: id, name: ex.name, topKg: s.topKg, assist: ex.loadMode === 'assist' });
  }
  out.push(...ready.slice(0, 2));

  // limited muscles: only those the active program trains as a main muscle, judged from mid-week on
  const wk = weekBounds(today, settings.weekStartsOn);
  if (program && today >= addDays(wk.start, 3)) {
    const tpls = await R.templatesOfProgram(db, program.id);
    const rows = tpls.length ? await db.templateExercises.where('templateId').anyOf(tpls.map((x) => x.id)).toArray() : [];
    const groups = await db.muscleGroups.toArray();
    const parentOf = new Map(groups.map((g) => [g.id, g.parentId || g.id]));
    const links = await db.exerciseMuscles.toArray();
    const trained = new Set(links.filter((l) => l.role === 'primary' && rows.some((r) => r.exerciseId === l.exerciseId)).map((l) => parentOf.get(l.muscleGroupId) ?? l.muscleGroupId));
    const m = await muscleSummary(db, wk.start, wk.end);
    for (const g of [...trained]) {
      const sets = m.rows.find((r) => r.parentId === g)?.sets ?? 0;
      if (sets < settings.minWeeklySets) out.push({ kind: 'limited', muscleId: g, name: parentName(g, groups), sets, min: settings.minWeeklySets });
    }
  }
  return out.slice(0, max);
}
