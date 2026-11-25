/**
 * Data access for Phase 3 analytics: performances from completed sessions, PR store recompute (BR-PR-05),
 * history purge (HIST-04). Everything derives from sessions/sets – records can always be rebuilt.
 */
import type { WeightDB } from '../../db/schema';
import type { Exercise, ID, PersonalRecord, WorkoutSession } from '../../db/types';
import { detectPRs, perfVolume, sessionVolumePRs, type Performance, type PREvent } from '../../domain/records';
import { getSettings } from '../../db/defaults';

export const RECORDS_VERSION = 1;
export const SESSION_KEY = '__session';

export interface PerfOptions { includeSessionId?: ID }

/** Completed (not replaced/skipped) performances, completed sets only. `includeSessionId` adds a running session. */
export async function performancesOf(db: WeightDB, exerciseIds: ID[] | null, o: PerfOptions = {}): Promise<Performance[]> {
  const ses = exerciseIds ? await db.sessionExercises.where('exerciseId').anyOf(exerciseIds).toArray() : await db.sessionExercises.toArray();
  const sessions = new Map((await db.sessions.bulkGet([...new Set(ses.map((x) => x.sessionId))])).filter((s): s is WorkoutSession => !!s).map((s) => [s.id, s]));
  const keep = ses.filter((se) => { const s = sessions.get(se.sessionId); return s && (s.status === 'completed' || s.id === o.includeSessionId) && se.status !== 'replaced' && se.status !== 'skipped'; });
  const sets = keep.length ? await db.sets.where('sessionExerciseId').anyOf(keep.map((x) => x.id)).toArray() : [];
  const bySe = new Map<ID, typeof sets>();
  for (const x of sets) if (x.completed === 1) bySe.set(x.sessionExerciseId, [...(bySe.get(x.sessionExerciseId) ?? []), x]);
  return keep.map((se) => {
    const s = sessions.get(se.sessionId)!;
    return {
      sessionId: s.id, localDate: s.localDate, startedAt: s.startedAt, exerciseId: se.exerciseId, painScore: se.painScore ?? null,
      sets: (bySe.get(se.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex).map((x) => ({ setId: x.id, weightKg: x.weightKg, reps: x.reps, durationSec: x.durationSec ?? null, setType: x.setType, rpe: x.rpe })),
      cardio: se.cardio && se.status === 'completed' ? se.cardio : null,
    };
  }).filter((p) => p.sets.length || p.cardio);
}

const toRecord = (e: PREvent): PersonalRecord => ({
  id: `${e.type}:${e.exerciseId ?? SESSION_KEY}:${e.sessionId}${e.weightKg != null ? `:${e.weightKg}` : ''}`,
  exerciseId: e.exerciseId ?? SESSION_KEY, type: e.type, value: e.value, previous: e.previous, unit: e.unit, loadMode: e.loadMode,
  setId: e.setId, sessionId: e.sessionId, achievedAt: e.date, ...(e.weightKg != null ? { weightKg: e.weightKg } : {}),
});

export async function prEventsFor(db: WeightDB, ex: Exercise, o: PerfOptions = {}): Promise<PREvent[]> {
  const settings = await getSettings(db);
  return detectPRs(await performancesOf(db, [ex.id], o), ex, settings.e1rmFormula);
}

/** Session total volume per session (completed only, or including a running one). */
export async function sessionVolumes(db: WeightDB, o: PerfOptions = {}) {
  const perfs = await performancesOf(db, null, o);
  const exs = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
  const vol = new Map<ID, { sessionId: ID; localDate: string; startedAt: string | null; volume: number }>();
  for (const p of perfs) {
    const v = vol.get(p.sessionId) ?? { sessionId: p.sessionId, localDate: p.localDate, startedAt: p.startedAt, volume: 0 };
    v.volume += perfVolume(p, exs.get(p.exerciseId)?.loadMode ?? 'none');
    vol.set(p.sessionId, v);
  }
  return [...vol.values()];
}

/** BR-PR-05: rebuild the stored PRs of the given exercises (all when null) and the session-volume PRs. */
export async function recomputeRecords(db: WeightDB, exerciseIds: ID[] | null = null): Promise<void> {
  const settings = await getSettings(db);
  const exs = exerciseIds ? (await db.exercises.bulkGet(exerciseIds)).filter((e): e is Exercise => !!e) : await db.exercises.toArray();
  const perfs = await performancesOf(db, exerciseIds);
  const byEx = new Map<ID, Performance[]>();
  for (const p of perfs) byEx.set(p.exerciseId, [...(byEx.get(p.exerciseId) ?? []), p]);
  const rows: PersonalRecord[] = [];
  for (const ex of exs) if (ex.status !== 'unresolved') rows.push(...detectPRs(byEx.get(ex.id) ?? [], ex, settings.e1rmFormula).map(toRecord));
  const sessionRows = sessionVolumePRs(await sessionVolumes(db)).map(toRecord);
  await db.transaction('rw', db.personalRecords, db.kv, async () => {
    if (exerciseIds) await db.personalRecords.where('exerciseId').anyOf(exerciseIds).delete();
    else await db.personalRecords.clear();
    await db.personalRecords.where('exerciseId').equals(SESSION_KEY).delete();
    await db.personalRecords.bulkPut([...rows, ...sessionRows]);
    await db.kv.put({ key: 'recordsVersion', value: RECORDS_VERSION });
  });
}

/** Exercises touched by a session (for targeted recompute). */
export async function exercisesOfSession(db: WeightDB, sessionId: ID): Promise<ID[]> {
  return [...new Set((await db.sessionExercises.where('sessionId').equals(sessionId).toArray()).map((x) => x.exerciseId))];
}

/** HIST-04: discarded sessions are purged 30 days after discarding (with their exercises and sets). */
export async function purgeDiscarded(db: WeightDB, now = Date.now()): Promise<number> {
  const old = (await db.sessions.where('status').equals('discarded').toArray()).filter((s) => s.discardedAt && now - new Date(s.discardedAt).getTime() > 30 * 86400000);
  if (!old.length) return 0;
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.sets], async () => {
    for (const s of old) {
      const ses = await db.sessionExercises.where('sessionId').equals(s.id).toArray();
      if (ses.length) await db.sets.where('sessionExerciseId').anyOf(ses.map((x) => x.id)).delete();
      await db.sessionExercises.where('sessionId').equals(s.id).delete();
      await db.sessions.delete(s.id);
    }
  });
  return old.length;
}

/** Startup maintenance: purge old discarded sessions; (re)build PRs when missing or after an import/restore. */
export async function maintenance(db: WeightDB): Promise<void> {
  await purgeDiscarded(db);
  const v = (await db.kv.get('recordsVersion'))?.value;
  if (v !== RECORDS_VERSION) await recomputeRecords(db);
}
