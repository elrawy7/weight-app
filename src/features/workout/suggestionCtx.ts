/** Inputs for the progression engine during a workout (recent history, achievable loads, deload state). */
import type { WeightDB } from '../../db/schema';
import type { AppSettings, Exercise, ID, WorkoutProgram, WorkoutSession } from '../../db/types';
import { addDays } from '../../domain/dates';
import { plateLoads, type RecentPerf, type WeightContext } from '../../domain/progression';
import { failedAttempts, perfOrder, working } from '../../domain/records';
import { performancesOf } from '../progress/recordsOps';

const sortKey = (s: { localDate: string; startedAt: string | null }) => `${s.localDate}|${s.startedAt ?? ''}`;

/** Up to 4 most recent completed performances per exercise, strictly before `before` (newest first). */
export async function recentPerfs(db: WeightDB, exerciseIds: ID[], before: Pick<WorkoutSession, 'id' | 'localDate' | 'startedAt'>): Promise<Map<ID, RecentPerf[]>> {
  const out = new Map<ID, RecentPerf[]>();
  if (!exerciseIds.length) return out;
  const limit = sortKey(before);
  const perfs = (await performancesOf(db, exerciseIds)).filter((p) => p.sessionId !== before.id && sortKey(p) < limit && working(p).length).sort(perfOrder).reverse();
  for (const p of perfs) {
    const list = out.get(p.exerciseId) ?? [];
    if (list.length < 4) list.push({
      localDate: p.localDate, painScore: p.painScore ?? null, sets: working(p).map((s) => ({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe })),
      planned: p.plannedWorking, failed: failedAttempts(p).length, // B-02: partial workouts are recognised
    });
    out.set(p.exerciseId, list);
  }
  return out;
}

/** Latest recorded body weight (kg), for assisted-exercise maths (B-01). */
export async function latestBodyweight(db: WeightDB): Promise<number | null> {
  const m = await db.bodyMeasurements.orderBy('date').reverse().filter((x) => x.weightKg != null).first();
  return m?.weightKg ?? null;
}

/** PO-02 / BR-PO-10: what loads can actually be set on this equipment. */
export function weightContext(ex: Pick<Exercise, 'id' | 'equipmentId'>, incrementKg: number, s: AppSettings): WeightContext {
  if (s.incrementOverrides[`ex:${ex.id}`] != null) return { incrementKg }; // the user set this exercise's own step
  if (ex.equipmentId === 'dumbbell' && s.dumbbellsKg.length) return { incrementKg, available: s.dumbbellsKg };
  // B-04: exact plate maths with the stock you entered (no count = enough of that plate)
  const stock = s.plateSetKg.map((kg) => ({ kg, pairs: s.platePairs?.[String(kg)] }));
  if (ex.equipmentId === 'barbell') return { incrementKg, available: plateLoads(s.barbellKg, stock) };
  if (ex.equipmentId === 'ez_bar') return { incrementKg, available: plateLoads(s.ezBarKg, stock) };
  if (ex.equipmentId === 'smith_machine' && s.smithBarKg != null) return { incrementKg, available: plateLoads(s.smithBarKg, stock) };
  return { incrementKg };
}

/** PO-05: the week after a finished block, or a week whose phase says "deload". */
export function deloadState(program: WorkoutProgram | undefined, date: string): { active: boolean; reason: 'planned' | 'after_block' } | null {
  if (!program) return null;
  const wk = program.weeks.find((w) => date >= w.startDate && date <= w.endDate);
  if (wk && /deload/i.test(wk.phase)) return { active: true, reason: 'planned' };
  if (program.endDate && date > program.endDate && date <= addDays(program.endDate, 7)) return { active: true, reason: 'after_block' };
  return null;
}

/** First defined alternative (knee-friendly swaps come from the plan), for the pain hold message. */
export async function alternativeNames(db: WeightDB, ids: ID[]): Promise<Map<ID, string>> {
  const alts = ids.length ? await db.exerciseAlternatives.where('exerciseId').anyOf(ids).toArray() : [];
  const names = new Map((await db.exercises.bulkGet([...new Set(alts.map((a) => a.alternativeId))])).filter((e): e is Exercise => !!e).map((e) => [e.id, e.name]));
  const out = new Map<ID, string>();
  for (const a of alts) if (!out.has(a.exerciseId) && names.get(a.alternativeId)) out.set(a.exerciseId, names.get(a.alternativeId)!);
  return out;
}
