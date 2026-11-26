/**
 * Data access for Phase 3 analytics: performances from completed sessions, PR store recompute (BR-PR-05),
 * history purge (HIST-04). Everything derives from sessions/sets – records can always be rebuilt.
 */
import type { WeightDB } from '../../db/schema';
import type { Exercise, ID, PersonalRecord, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from '../../db/types';
import { detectPRs, perfVolume, sessionVolumePRs, type Performance, type PREvent } from '../../domain/records';
import { getSettings } from '../../db/defaults';
import { freezeTemplateNames } from '../workout/sessionNames';

export const RECORDS_VERSION = 1;
export const SESSION_KEY = '__session';

export interface PerfOptions { includeSessionId?: ID }

/** Completed (not replaced/skipped) performances, completed sets only. `includeSessionId` adds a running session. */
/** E-06: with years of history, one full read of a table is much faster than an index lookup with thousands of keys. */
const BULK = 400;
async function setsOf(db: WeightDB, seIds: ID[]): Promise<WorkoutSet[]> {
  if (!seIds.length) return [];
  // index lookup when the keys are a small part of all exercise entries (less memory → no long garbage-collection pause
  // on the next tap); one full read when they are most of them
  if (seIds.length <= BULK || seIds.length * 4 < (await db.sessionExercises.count())) {
    // one keyed read per entry, all queued at once in one transaction (much faster than a cursor walking many keys)
    return db.transaction('r', db.sets, async () => (await Promise.all(seIds.map((k) => db.sets.where('sessionExerciseId').equals(k).toArray()))).flat());
  }
  const want = new Set(seIds);
  return (await db.sets.toArray()).filter((x) => want.has(x.sessionExerciseId));
}
async function sessionsOf(db: WeightDB, ids: ID[]): Promise<Map<ID, WorkoutSession>> {
  const list = ids.length <= BULK ? (await db.sessions.bulkGet(ids)).filter((s): s is WorkoutSession => !!s) : await db.sessions.toArray();
  const want = new Set(ids);
  return new Map(list.filter((s) => want.has(s.id)).map((s) => [s.id, s]));
}

export interface PerfOptionsRange extends PerfOptions { from?: string; to?: string }

export async function performancesOf(db: WeightDB, exerciseIds: ID[] | null, o: PerfOptionsRange = {}): Promise<Performance[]> {
  let ses: WorkoutSessionExercise[];
  let sessions: Map<ID, WorkoutSession>;
  if (o.from || o.to) {
    // E-06: a date range (e.g. this week) reads only those sessions
    const inRange = await db.sessions.where('localDate').between(o.from ?? '0000-00-00', o.to ?? '9999-99-99', true, true).toArray();
    sessions = new Map(inRange.map((s) => [s.id, s]));
    ses = inRange.length ? await db.sessionExercises.where('sessionId').anyOf(inRange.map((s) => s.id)).toArray() : [];
    if (exerciseIds) { const want = new Set(exerciseIds); ses = ses.filter((x) => want.has(x.exerciseId)); }
  } else {
    ses = exerciseIds ? await db.sessionExercises.where('exerciseId').anyOf(exerciseIds).toArray() : await db.sessionExercises.toArray();
    sessions = await sessionsOf(db, [...new Set(ses.map((x) => x.sessionId))]);
  }
  // A-06 / BR-SES-11: completed sets are facts – they count whatever happened to the exercise afterwards
  const keep = ses.filter((se) => { const s = sessions.get(se.sessionId); return s && (s.status === 'completed' || s.id === o.includeSessionId); });
  const sets = await setsOf(db, keep.map((x) => x.id));
  const bySe = new Map<ID, WorkoutSet[]>();
  const rows = new Map<ID, number>();
  for (const x of sets) {
    if (x.setType !== 'warmup') rows.set(x.sessionExerciseId, (rows.get(x.sessionExerciseId) ?? 0) + 1);
    if (x.completed === 1) { const l = bySe.get(x.sessionExerciseId); if (l) l.push(x); else bySe.set(x.sessionExerciseId, [x]); }
  }
  return keep.map((se) => {
    const s = sessions.get(se.sessionId)!;
    const done = (bySe.get(se.id) ?? []).filter((x) => x.setType !== 'warmup').length;
    return {
      sessionId: s.id, localDate: s.localDate, startedAt: s.startedAt, exerciseId: se.exerciseId, painScore: se.painScore ?? null,
      // B-02: planned = working rows, except where the rest was skipped/replaced – then still all rows (incomplete)
      plannedWorking: se.status === 'replaced' ? done : (rows.get(se.id) ?? done),
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

/** A-03: exercises whose records must be recomputed; written in the same transaction as the change that needs it. */
export const DIRTY_KEY = 'recordsDirty';
export async function markRecordsDirty(db: WeightDB, ids: ID[]): Promise<void> {
  const cur = ((await db.kv.get(DIRTY_KEY))?.value as ID[] | undefined) ?? [];
  await db.kv.put({ key: DIRTY_KEY, value: [...new Set([...cur, ...ids])] });
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
    // clear the dirty marker for what was just rebuilt
    const dirty = ((await db.kv.get(DIRTY_KEY))?.value as ID[] | undefined) ?? [];
    const left = exerciseIds ? dirty.filter((id) => !exerciseIds.includes(id)) : [];
    if (left.length) await db.kv.put({ key: DIRTY_KEY, value: left }); else await db.kv.delete(DIRTY_KEY);
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

/**
 * Startup maintenance & repair (A-03): purge old discarded sessions; drop a rest timer whose workout is no longer
 * running; finish any records recompute that was interrupted; (re)build PRs when missing or after an import/restore.
 * Returns what it repaired (for diagnostics and tests).
 */
export async function maintenance(db: WeightDB, o: { rebuildIfMissing?: boolean } = {}): Promise<{ purged: number; staleTimer: boolean; recomputed: 'none' | 'dirty' | 'all' }> {
  const purged = o.rebuildIfMissing === false ? 0 : await purgeDiscarded(db);
  await freezeTemplateNames(db); // E: one-time backfill for workouts logged before names were frozen
  let staleTimer = false;
  const timer = (await db.kv.get('restTimer'))?.value as { sessionId?: ID } | undefined;
  if (timer) {
    const s = timer.sessionId ? await db.sessions.get(timer.sessionId) : undefined;
    if (!s || (s.status !== 'active' && s.status !== 'paused')) { await db.kv.delete('restTimer'); staleTimer = true; }
  }
  const v = (await db.kv.get('recordsVersion'))?.value;
  const dirty = ((await db.kv.get(DIRTY_KEY))?.value as ID[] | undefined) ?? [];
  let recomputed: 'none' | 'dirty' | 'all' = 'none';
  if (v !== RECORDS_VERSION) { if (o.rebuildIfMissing !== false) { await recomputeRecords(db); recomputed = 'all'; } }
  else if (dirty.length) { await recomputeRecords(db, dirty); recomputed = 'dirty'; }
  return { purged, staleTimer, recomputed };
}
