/**
 * Active workout logic (Phase 2 core): WO-01…17, BR-PP, BR-SES, BR-PO, PROG-06.
 * All writes go straight to IndexedDB (BR-SES-02 – no save button).
 */
import type { WeightDB } from '../../db/schema';
import type {
  Exercise, ID, ISODate, PreviousPerformance, PreviousSet, SetType, WorkoutSession, WorkoutSessionExercise, WorkoutSet,
} from '../../db/types';
import { nowIso } from '../../domain/dates';
import { uuidv7 } from '../../domain/uuid';
import { setsForWeek } from '../../domain/schedule';
import { epley, setVolume } from '../../domain/e1rm';
import { snapWeight, type Suggestion, type WeightContext } from '../../domain/progression';
import type { PRType } from '../../domain/records';
import { exercisesOfSession, prEventsFor, recomputeRecords } from '../progress/recordsOps';

export class WorkoutError extends Error {}

/** `dateSource` values: live sessions run a clock/timer; back-logged ones (a past day) don't. */
export const DATE_SOURCE_LIVE = 'start time';
export const DATE_SOURCE_BACKLOG = 'logged afterwards for this date';

const sortKey = (s: Pick<WorkoutSession, 'localDate' | 'startedAt'>) => `${s.localDate}|${s.startedAt ?? ''}`;

/* ───────────── previous performance (BR-PP) ───────────── */

/**
 * BR-PP-01/02/07: latest completed (not discarded) session BEFORE `before` that has at least one completed working set
 * of the exercise. Program/template ignored (cross-program).
 */
export async function previousPerformance(db: WeightDB, exerciseId: ID, before: Pick<WorkoutSession, 'id' | 'localDate' | 'startedAt'>): Promise<PreviousPerformance | null> {
  const ses = await db.sessionExercises.where('exerciseId').equals(exerciseId).toArray();
  const sessions = await db.sessions.bulkGet([...new Set(ses.map((x) => x.sessionId))]);
  const byId = new Map(sessions.filter((s): s is WorkoutSession => !!s).map((s) => [s.id, s]));
  const limit = sortKey(before);
  const candidates = ses
    .filter((x) => x.status !== 'skipped' && x.status !== 'replaced')
    .map((x) => ({ se: x, s: byId.get(x.sessionId) }))
    .filter((c): c is { se: WorkoutSessionExercise; s: WorkoutSession } => !!c.s && c.s.id !== before.id && c.s.status === 'completed' && sortKey(c.s) < limit)
    .sort((a, b) => sortKey(b.s).localeCompare(sortKey(a.s)) || b.se.orderIndex - a.se.orderIndex);
  const found: { se: WorkoutSessionExercise; s: WorkoutSession; working: WorkoutSet[]; warm: WorkoutSet[] }[] = [];
  for (const c of candidates) {
    const sets = (await db.sets.where('sessionExerciseId').equals(c.se.id).sortBy('orderIndex')).filter((x) => x.completed === 1);
    const working = sets.filter((x) => x.setType !== 'warmup');
    if (working.length) found.push({ ...c, working, warm: sets.filter((x) => x.setType === 'warmup') });
    if (found.length === 2) break;
  }
  if (!found.length) return null;
  const [p, older] = found;
  const tpl = p.s.templateId ? await db.templates.get(p.s.templateId) : undefined;
  const map = (x: WorkoutSet): PreviousSet => ({ weightKg: x.weightKg, reps: x.reps, setType: x.setType, durationSec: x.durationSec ?? null, ...(x.rpe != null ? { rpe: x.rpe } : {}) });
  return {
    sessionId: p.s.id, localDate: p.s.localDate, sets: p.working.map(map), warmups: p.warm.map(map), painScore: p.se.painScore ?? null, templateName: tpl?.name,
    olderSets: older?.working.map(map),
  };
}

/** BR-PP-03: align today's working set n with previous working set n; extra rows prefill from the previous last set. */
export function alignedPrevious(prev: PreviousPerformance | null | undefined, workingIndex: number): { shown: PreviousSet | null; prefill: PreviousSet | null } {
  if (!prev || !prev.sets.length) return { shown: null, prefill: null };
  const s = prev.sets[workingIndex];
  return s ? { shown: s, prefill: s } : { shown: null, prefill: prev.sets[prev.sets.length - 1] };
}

/* Progression suggestions live in src/domain/progression.ts (Phase 3 engine). */

/* ───────────── start / continue ───────────── */

export async function activeSession(db: WeightDB): Promise<WorkoutSession | undefined> {
  return (await db.sessions.where('status').anyOf('active', 'paused').toArray()).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0];
}

export interface StartArgs { programId?: ID; templateId?: ID; week: number | null; date: ISODate; today: ISODate }

/** WO-01 + PROG-06/BR-SES-01: snapshot targets from the template and freeze previous performance per exercise. */
export async function startWorkout(db: WeightDB, a: StartArgs): Promise<WorkoutSession> {
  if (a.date > a.today) throw new WorkoutError('You can only log today or a past day.');
  const running = await activeSession(db);
  if (running) throw new WorkoutError('Another workout is still in progress. Continue or finish it first.'); // BR-SES-05
  const t = nowIso();
  const s: WorkoutSession = {
    id: uuidv7(), programId: a.programId, templateId: a.templateId, programWeek: a.week ?? undefined, status: 'active', startedAt: t, endedAt: null, pausedMs: 0,
    localDate: a.date, notes: '', source: 'app', logType: 'full', lastActivityAt: t, pausedAt: null, createdAt: t, updatedAt: t,
    dateSource: a.date === a.today ? DATE_SOURCE_LIVE : DATE_SOURCE_BACKLOG,
  };
  const rows = a.templateId ? await db.templateExercises.where('[templateId+orderIndex]').between([a.templateId, -Infinity], [a.templateId, Infinity]).toArray() : [];
  await db.sessions.add(s);
  for (const [i, r] of rows.entries()) await addExerciseToSession(db, s, r.exerciseId, i + 1, { targetSets: setsForWeek(r.targetSetsByWeek, a.week), targetReps: r.targetReps, restSec: r.restSec, templateExerciseId: r.id, role: r.role, templateNotes: r.notes }, r.supersetGroup);
  return s;
}

/** Adds an exercise with frozen previous performance and empty set rows (values come from ghost prefill on tick). */
export async function addExerciseToSession(db: WeightDB, s: WorkoutSession, exerciseId: ID, orderIndex: number,
  snap: { targetSets?: number; targetReps?: string; restSec?: number; templateExerciseId?: ID; role?: string; templateNotes?: string } = {}, supersetGroup: string | null = null): Promise<WorkoutSessionExercise> {
  const ex = await db.exercises.get(exerciseId);
  if (!ex) throw new WorkoutError('Unknown exercise.');
  const t = nowIso();
  const isCardio = ex.mechanic === 'cardio' || snap.role === 'cardio';
  const previous = await previousPerformance(db, exerciseId, s);
  const se: WorkoutSessionExercise = {
    id: uuidv7(), sessionId: s.id, exerciseId, orderIndex, status: 'pending', supersetGroup,
    snapshot: { ...snap, restSec: snap.restSec ?? ex.defaultRestSec, previous }, notes: '', painScore: null, createdAt: t, updatedAt: t,
    ...(isCardio ? { cardio: {} } : {}),
  };
  await db.sessionExercises.add(se);
  if (!isCardio) {
    const n = Math.max(1, snap.targetSets ?? previous?.sets.length ?? 3);
    await db.sets.bulkAdd(Array.from({ length: n }, (_, i) => newSet(se.id, i + 1, 'working', t)));
  }
  return se;
}

const newSet = (seId: ID, order: number, setType: SetType, t: string): WorkoutSet => ({
  id: uuidv7(), sessionExerciseId: seId, orderIndex: order, setType, weightKg: null, inputUnit: 'kg', reps: null, rpe: null, completed: 0, completedAt: null,
  side: 'both', setTypeConfidence: 'recorded', createdAt: t, updatedAt: t,
});

/** Every change: activity timestamp; on a completed session also the "edited" marker and a PR recompute (HIST-03, BR-PR-05). */
async function touch(db: WeightDB, sessionId: ID, exerciseId?: ID) {
  const t = nowIso();
  const s = await db.sessions.get(sessionId);
  if (s?.status === 'completed') {
    await db.sessions.update(sessionId, { editedAt: t, updatedAt: t });
    await recomputeRecords(db, exerciseId ? [exerciseId] : await exercisesOfSession(db, sessionId));
  } else await db.sessions.update(sessionId, { lastActivityAt: t, updatedAt: t });
}

/* ───────────── set editing (WO-04/05/06) ───────────── */

export async function updateSet(db: WeightDB, setId: ID, patch: Partial<Pick<WorkoutSet, 'weightKg' | 'reps' | 'rpe' | 'setType' | 'durationSec' | 'distanceM'>>) {
  if (patch.reps !== undefined && patch.reps !== null && (!Number.isInteger(patch.reps) || patch.reps < 0 || patch.reps > 200)) throw new WorkoutError('Reps must be a whole number 0–200.');
  if (patch.weightKg !== undefined && patch.weightKg !== null && (patch.weightKg < 0 || patch.weightKg > 1000)) throw new WorkoutError('Weight must be between 0 and 1000 kg.');
  if (patch.rpe !== undefined && patch.rpe !== null && (patch.rpe < 6 || patch.rpe > 10 || (patch.rpe * 2) % 1 !== 0)) throw new WorkoutError('RPE must be 6–10 in 0.5 steps.');
  const set = await db.sets.get(setId);
  if (!set) throw new WorkoutError('Set not found.');
  await db.sets.update(setId, { ...patch, updatedAt: nowIso() });
  const se = await db.sessionExercises.get(set.sessionExerciseId);
  if (se) await touch(db, se.sessionId, se.exerciseId);
}

/**
 * WO-04 AC1 / WO-05 AC1: ticking ✓ records the shown values; empty fields take the ghost (prefill) values.
 * Returns whether a rest timer should start (BR-TIMER-01: not inside a superset round, not for warm-ups).
 */
export async function toggleSetComplete(db: WeightDB, setId: ID, ghost: { weightKg: number | null; reps: number | null; durationSec?: number | null }, measure: 'reps' | 'duration' = 'reps'): Promise<{ completed: boolean; startRest: boolean; restSec: number }> {
  const set = await db.sets.get(setId);
  if (!set) throw new WorkoutError('Set not found.');
  const se = (await db.sessionExercises.get(set.sessionExerciseId))!;
  const t = nowIso();
  if (set.completed) {
    await db.sets.update(setId, { completed: 0, completedAt: null, updatedAt: t });
    await refreshExerciseStatus(db, se.id);
    await touch(db, se.sessionId, se.exerciseId);
    return { completed: false, startRest: false, restSec: 0 };
  }
  const weightKg = set.weightKg ?? ghost.weightKg;
  if (measure === 'duration') {
    const durationSec = set.durationSec ?? ghost.durationSec ?? null;
    if (!durationSec) throw new WorkoutError('Enter the seconds first.');
    await db.sets.update(setId, { weightKg: weightKg ?? 0, durationSec, completed: 1, completedAt: t, updatedAt: t });
  } else {
    const reps = set.reps ?? ghost.reps;
    if (reps === null || reps === undefined) throw new WorkoutError('Enter the reps first.');
    await db.sets.update(setId, { weightKg: weightKg ?? 0, reps, completed: 1, completedAt: t, updatedAt: t });
  }
  await refreshExerciseStatus(db, se.id);
  await touch(db, se.sessionId, se.exerciseId);
  const restSec = se.snapshot?.restSec ?? 90;
  if (set.setType === 'warmup') return { completed: true, startRest: false, restSec };
  return { completed: true, startRest: await isEndOfSupersetRound(db, se), restSec };
}

/** BR-TIMER-01: inside a superset, rest only after the last exercise of the round. */
export async function isEndOfSupersetRound(db: WeightDB, se: WorkoutSessionExercise): Promise<boolean> {
  if (!se.supersetGroup) return true;
  const group = (await db.sessionExercises.where('sessionId').equals(se.sessionId).toArray())
    .filter((x) => x.supersetGroup === se.supersetGroup && x.status !== 'skipped' && x.status !== 'replaced')
    .sort((a, b) => a.orderIndex - b.orderIndex);
  return group[group.length - 1]?.id === se.id;
}

async function refreshExerciseStatus(db: WeightDB, seId: ID) {
  const se = await db.sessionExercises.get(seId);
  if (!se || se.status === 'skipped' || se.status === 'replaced') return;
  const sets = await db.sets.where('sessionExerciseId').equals(seId).toArray();
  const done = sets.filter((s) => s.completed).length;
  const status = done === 0 ? 'pending' : done === sets.length ? 'completed' : 'in_progress';
  if (status !== se.status) await db.sessionExercises.update(seId, { status, updatedAt: nowIso() });
}

export async function addSet(db: WeightDB, seId: ID, setType: SetType = 'working'): Promise<WorkoutSet> {
  const sets = await db.sets.where('sessionExerciseId').equals(seId).sortBy('orderIndex');
  const last = sets[sets.length - 1];
  const s = { ...newSet(seId, (last?.orderIndex ?? 0) + 1, setType, nowIso()), weightKg: last?.weightKg ?? null, reps: last?.reps ?? null, durationSec: last?.durationSec ?? null };
  await db.sets.add(s);
  await refreshExerciseStatus(db, seId);
  const se = await db.sessionExercises.get(seId);
  if (se) await touch(db, se.sessionId, se.exerciseId);
  return s;
}

/** Remove a set; returns it so the UI can offer undo (WO-05 AC3). */
export async function removeSet(db: WeightDB, setId: ID): Promise<WorkoutSet> {
  const set = await db.sets.get(setId);
  if (!set) throw new WorkoutError('Set not found.');
  await db.sets.delete(setId);
  await refreshExerciseStatus(db, set.sessionExerciseId);
  const se = await db.sessionExercises.get(set.sessionExerciseId);
  if (se) await touch(db, se.sessionId, se.exerciseId);
  return set;
}
export async function restoreSet(db: WeightDB, set: WorkoutSet) {
  await db.sets.put(set);
  await refreshExerciseStatus(db, set.sessionExerciseId);
  const se = await db.sessionExercises.get(set.sessionExerciseId);
  if (se) await touch(db, se.sessionId, se.exerciseId);
}

/**
 * "Use suggestion" (BR-PO-09/10): fills the not-yet-completed working sets from the aligned previous set with the
 * suggested change, snapped to achievable loads. A deload also removes one empty set.
 */
export async function applySuggestion(db: WeightDB, seId: ID, sug: Pick<Suggestion, 'deltaKg' | 'factor' | 'snap' | 'repsTarget' | 'setsDelta'>, weights: WeightContext) {
  const se = await db.sessionExercises.get(seId);
  if (!se) return;
  const prev = se.snapshot?.previous;
  let sets = (await db.sets.where('sessionExerciseId').equals(seId).sortBy('orderIndex')).filter((s) => s.setType !== 'warmup');
  if (sug.setsDelta && sug.setsDelta < 0) {
    const drop = sets.filter((s) => !s.completed).slice(sug.setsDelta);
    if (sets.length - drop.length >= 1) { await db.sets.bulkDelete(drop.map((s) => s.id)); sets = sets.filter((s) => !drop.includes(s)); }
  }
  for (const [i, s] of sets.entries()) {
    if (s.completed) continue;
    const { prefill } = alignedPrevious(prev, i);
    if (prefill?.weightKg == null) continue;
    const raw = sug.factor ? prefill.weightKg * sug.factor : prefill.weightKg + sug.deltaKg;
    const w = snapWeight(Math.max(0, raw), weights, sug.snap);
    await db.sets.update(s.id, { weightKg: w, reps: sug.repsTarget ?? s.reps, updatedAt: nowIso() });
  }
  await refreshExerciseStatus(db, seId);
  await touch(db, se.sessionId, se.exerciseId);
}

/* ───────────── exercise-level actions (WO-07/08/13/14) ───────────── */

export async function skipExercise(db: WeightDB, seId: ID, skip = true) {
  await db.sessionExercises.update(seId, { status: skip ? 'skipped' : 'pending', updatedAt: nowIso() });
  if (!skip) await refreshExerciseStatus(db, seId);
}

/** BR-SES-10: replacement gets its own previous performance; original marked replaced. */
export async function replaceExercise(db: WeightDB, seId: ID, newExerciseId: ID): Promise<WorkoutSessionExercise> {
  const se = await db.sessionExercises.get(seId);
  if (!se) throw new WorkoutError('Exercise not found in session.');
  const s = (await db.sessions.get(se.sessionId))!;
  const { previous: _ignored, ...targets } = se.snapshot ?? {};
  void _ignored;
  const rep = await addExerciseToSession(db, s, newExerciseId, se.orderIndex + 0.5, targets, se.supersetGroup);
  await db.sessionExercises.update(seId, { status: 'replaced', replacedById: rep.id, updatedAt: nowIso() });
  await normalizeOrder(db, s.id);
  return rep;
}

export async function addExercise(db: WeightDB, sessionId: ID, exerciseId: ID): Promise<WorkoutSessionExercise> {
  const s = await db.sessions.get(sessionId);
  if (!s) throw new WorkoutError('Session not found.');
  const n = await db.sessionExercises.where('sessionId').equals(sessionId).count();
  const ex = await db.exercises.get(exerciseId);
  return addExerciseToSession(db, s, exerciseId, n + 1, { targetSets: 3, restSec: ex?.defaultRestSec });
}

export async function moveExercise(db: WeightDB, sessionId: ID, seId: ID, dir: -1 | 1) {
  const list = (await db.sessionExercises.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
  const i = list.findIndex((x) => x.id === seId), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db.transaction('rw', db.sessionExercises, async () => { for (const [k, x] of list.entries()) await db.sessionExercises.update(x.id, { orderIndex: k + 1 }); });
}

async function normalizeOrder(db: WeightDB, sessionId: ID) {
  const list = (await db.sessionExercises.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
  for (const [k, x] of list.entries()) if (x.orderIndex !== k + 1) await db.sessionExercises.update(x.id, { orderIndex: k + 1 });
}

export async function setExerciseNotes(db: WeightDB, seId: ID, notes: string) { await db.sessionExercises.update(seId, { notes, updatedAt: nowIso() }); }
export async function setPain(db: WeightDB, seId: ID, painScore: number | null) {
  if (painScore !== null && (!Number.isInteger(painScore) || painScore < 0 || painScore > 10)) throw new WorkoutError('Pain must be 0–10.');
  await db.sessionExercises.update(seId, { painScore, updatedAt: nowIso() });
}
/** Merges the patch into the stored cardio values (safe against fast consecutive edits). `done` undefined = keep status. */
export async function setCardio(db: WeightDB, seId: ID, patch: WorkoutSessionExercise['cardio'], done?: boolean) {
  await db.transaction('rw', db.sessionExercises, async () => {
    const se = await db.sessionExercises.get(seId);
    if (!se) return;
    const cardio = { ...(se.cardio ?? {}), ...patch };
    for (const k of Object.keys(cardio) as (keyof typeof cardio)[]) if (cardio[k] === undefined) delete cardio[k];
    await db.sessionExercises.update(seId, { cardio, ...(done === undefined ? {} : { status: done ? 'completed' : 'pending' }), updatedAt: nowIso() });
  });
}

/* ───────────── pause / finish / discard (WO-10, BR-SES-06/07/08/09) ───────────── */

export async function pauseSession(db: WeightDB, id: ID, pause: boolean) {
  const s = await db.sessions.get(id);
  if (!s) return;
  const t = nowIso();
  if (pause && s.status === 'active') await db.sessions.update(id, { status: 'paused', pausedAt: t, updatedAt: t });
  if (!pause && s.status === 'paused') {
    const extra = s.pausedAt ? Date.now() - new Date(s.pausedAt).getTime() : 0;
    await db.sessions.update(id, { status: 'active', pausedMs: s.pausedMs + extra, pausedAt: null, updatedAt: t });
  }
}

/** Elapsed training time in ms (BR-SES-08). */
export function elapsedMs(s: Pick<WorkoutSession, 'startedAt' | 'endedAt' | 'pausedMs' | 'pausedAt'>, now = Date.now()): number {
  if (!s.startedAt) return 0;
  const end = s.endedAt ? new Date(s.endedAt).getTime() : s.pausedAt ? new Date(s.pausedAt).getTime() : now;
  return Math.max(0, end - new Date(s.startedAt).getTime() - (s.pausedMs ?? 0));
}

export interface SessionSummary { durationMin: number; setsDone: number; setsPlanned: number; volumeKg: number; incomplete: string[]; painFlags: string[]; exercisesDone: number }

export async function summarize(db: WeightDB, id: ID): Promise<SessionSummary> {
  const s = (await db.sessions.get(id))!;
  const ses = (await db.sessionExercises.where('sessionId').equals(id).toArray()).filter((x) => x.status !== 'replaced').sort((a, b) => a.orderIndex - b.orderIndex);
  const exs = new Map((await db.exercises.bulkGet(ses.map((x) => x.exerciseId))).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
  let setsDone = 0, setsPlanned = 0, volumeKg = 0, exercisesDone = 0;
  const incomplete: string[] = [], painFlags: string[] = [];
  for (const se of ses) {
    const ex = exs.get(se.exerciseId);
    const sets = await db.sets.where('sessionExerciseId').equals(se.id).toArray();
    const working = sets.filter((x) => x.setType !== 'warmup');
    const done = working.filter((x) => x.completed);
    if (se.status !== 'skipped') setsPlanned += working.length;
    setsDone += done.length;
    for (const x of done) volumeKg += setVolume(x.weightKg, x.reps, ex?.loadMode ?? 'total');
    if (se.cardio ? se.status === 'completed' : done.length > 0) exercisesDone++;
    else if (se.status !== 'skipped') incomplete.push(ex?.name ?? se.exerciseId);
    if ((se.painScore ?? 0) >= 4) painFlags.push(`${ex?.name ?? ''} ${se.painScore}/10`);
  }
  return { durationMin: Math.round(elapsedMs(s) / 60000), setsDone, setsPlanned, volumeKg: Math.round(volumeKg), incomplete, painFlags, exercisesDone };
}

/** BR-SES-06: finish; exercises with no completed set become skipped (unless cardio done). */
export async function finishSession(db: WeightDB, id: ID, extra: { kneePain: number | null; energy: number | null; notes: string; endedAt?: string; durationMin?: number | null }) {
  if (extra.durationMin != null && (!Number.isFinite(extra.durationMin) || extra.durationMin < 0 || extra.durationMin > 600)) throw new WorkoutError('Minutes must be between 0 and 600.');
  if (extra.kneePain != null && (extra.kneePain < 0 || extra.kneePain > 10)) throw new WorkoutError('Knee pain must be 0–10.');
  if (extra.energy != null && (extra.energy < 1 || extra.energy > 5)) throw new WorkoutError('Energy must be 1–5.');
  const s = await db.sessions.get(id);
  if (!s) throw new WorkoutError('Session not found.');
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.sets], async () => {
    for (const se of await db.sessionExercises.where('sessionId').equals(id).toArray()) {
      if (se.status === 'replaced' || se.status === 'skipped') continue;
      if (se.cardio) { if (se.status !== 'completed' && !(se.cardio.durationMin || se.cardio.distanceM)) await db.sessionExercises.update(se.id, { status: 'skipped' }); else await db.sessionExercises.update(se.id, { status: 'completed' }); continue; }
      const done = await db.sets.where('sessionExerciseId').equals(se.id).filter((x) => x.completed === 1).count();
      if (done === 0) await db.sessionExercises.update(se.id, { status: 'skipped' });
    }
    const t = extra.endedAt ?? nowIso();
    const pausedExtra = s.status === 'paused' && s.pausedAt ? new Date(t).getTime() - new Date(s.pausedAt).getTime() : 0;
    const fin = { ...s, endedAt: s.endedAt ?? t, pausedMs: s.pausedMs + Math.max(0, pausedExtra), pausedAt: null };
    await db.sessions.update(id, {
      status: 'completed', endedAt: fin.endedAt, pausedMs: fin.pausedMs, pausedAt: null, durationMin: extra.durationMin !== undefined ? extra.durationMin : s.endedAt ? s.durationMin : Math.round(elapsedMs(fin) / 60000),
      kneePain: extra.kneePain, energy: extra.energy, notes: extra.notes.trim(), logType: 'full', updatedAt: nowIso(),
    });
  });
  await clearRestFor(db, id);
  await recomputeRecords(db, await exercisesOfSession(db, id)); // PR-01: store the new records
}

async function clearRestFor(db: WeightDB, sessionId: ID) {
  const cur = (await db.kv.get(REST_KEY))?.value as RestTimerState | undefined;
  if (cur?.sessionId === sessionId) await db.kv.delete(REST_KEY);
}

/** Edit the summary of a completed session (minutes, knee pain, energy, note). */
export async function updateSummary(db: WeightDB, id: ID, v: { kneePain: number | null; energy: number | null; notes: string; durationMin: number | null }) {
  if (v.durationMin != null && (!Number.isFinite(v.durationMin) || v.durationMin < 0 || v.durationMin > 600)) throw new WorkoutError('Minutes must be between 0 and 600.');
  if (v.kneePain != null && (v.kneePain < 0 || v.kneePain > 10)) throw new WorkoutError('Knee pain must be 0–10.');
  if (v.energy != null && (v.energy < 1 || v.energy > 5)) throw new WorkoutError('Energy must be 1–5.');
  await db.sessions.update(id, { durationMin: v.durationMin, kneePain: v.kneePain, energy: v.energy, notes: v.notes.trim(), updatedAt: nowIso() });
}

/** BR-SES-07 soft delete (restorable for 30 days). */
export async function discardSession(db: WeightDB, id: ID) {
  const s = await db.sessions.get(id);
  if (!s) return;
  await db.sessions.update(id, { status: 'discarded', statusBeforeDiscard: s.status === 'discarded' ? s.statusBeforeDiscard : s.status, discardedAt: nowIso(), updatedAt: nowIso() });
  await clearRestFor(db, id);
  if (s.status === 'completed') await recomputeRecords(db, await exercisesOfSession(db, id)); // BR-PR-05
}

/** Discarded sessions still restorable (30 days), newest first. */
export async function discardedSessions(db: WeightDB, now = Date.now()): Promise<WorkoutSession[]> {
  return (await db.sessions.where('status').equals('discarded').toArray())
    .filter((s) => s.discardedAt && restorableUntil(s.discardedAt).getTime() > now)
    .sort((a, b) => (b.discardedAt ?? '').localeCompare(a.discardedAt ?? ''));
}
export async function restoreSession(db: WeightDB, id: ID) {
  const s = await db.sessions.get(id);
  if (!s || s.status !== 'discarded') return;
  const back = s.statusBeforeDiscard === 'active' || s.statusBeforeDiscard === 'paused' ? ((await activeSession(db)) ? 'completed' : 'paused') : (s.statusBeforeDiscard ?? 'completed');
  await db.sessions.update(id, { status: back, discardedAt: null, updatedAt: nowIso() });
  if (back === 'completed') await recomputeRecords(db, await exercisesOfSession(db, id));
}
export const restorableUntil = (discardedAt: string) => new Date(new Date(discardedAt).getTime() + 30 * 86400000);

/** BR-SES-09: an active session untouched for > 6 h. */
export const isStale = (s: Pick<WorkoutSession, 'status' | 'lastActivityAt' | 'startedAt'>, now = Date.now()) =>
  (s.status === 'active' || s.status === 'paused') && now - new Date(s.lastActivityAt ?? s.startedAt ?? now).getTime() > 6 * 3600000;

/** Convert a quick log (QL-01) into a full, editable log for the same day. */
export async function quickToFull(db: WeightDB, sessionId: ID): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (!s || s.logType !== 'quick') throw new WorkoutError('Only quick logs can be converted.');
  const rows = s.templateId ? await db.templateExercises.where('[templateId+orderIndex]').between([s.templateId, -Infinity], [s.templateId, Infinity]).toArray() : [];
  for (const [i, r] of rows.entries()) await addExerciseToSession(db, s, r.exerciseId, i + 1, { targetSets: setsForWeek(r.targetSetsByWeek, s.programWeek ?? null), targetReps: r.targetReps, restSec: r.restSec, templateExerciseId: r.id, role: r.role, templateNotes: r.notes }, r.supersetGroup);
  await db.sessions.update(sessionId, { logType: 'full', updatedAt: nowIso() });
}

/* ───────────── exercise history (WO-12) ───────────── */

export interface HistoryEntry { sessionId: ID; localDate: ISODate; templateName?: string; week?: number; sets: WorkoutSet[]; best: WorkoutSet | null; painScore: number | null; notes: string }

export async function exerciseHistory(db: WeightDB, exerciseId: ID, limit = 50): Promise<HistoryEntry[]> {
  const ses = await db.sessionExercises.where('exerciseId').equals(exerciseId).toArray();
  const sessions = new Map((await db.sessions.bulkGet([...new Set(ses.map((x) => x.sessionId))])).filter((s): s is WorkoutSession => !!s).map((s) => [s.id, s]));
  const out: HistoryEntry[] = [];
  for (const se of ses) {
    const s = sessions.get(se.sessionId);
    if (!s || s.status !== 'completed' || se.status === 'replaced') continue;
    const sets = (await db.sets.where('sessionExerciseId').equals(se.id).sortBy('orderIndex')).filter((x) => x.completed === 1);
    if (!sets.length && !se.cardio) continue;
    const working = sets.filter((x) => x.setType !== 'warmup');
    const best = working.reduce<WorkoutSet | null>((b, x) => (!b || (x.weightKg ?? 0) > (b.weightKg ?? 0) || ((x.weightKg ?? 0) === (b.weightKg ?? 0) && (x.reps ?? 0) > (b.reps ?? 0)) ? x : b), null);
    const tpl = s.templateId ? await db.templates.get(s.templateId) : undefined;
    out.push({ sessionId: s.id, localDate: s.localDate, templateName: tpl?.name, week: s.programWeek, sets, best, painScore: se.painScore ?? null, notes: se.notes });
  }
  return out.sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, limit);
}

/* ───────────── rest timer state (TMR-02, persisted as timestamps) ───────────── */

export interface RestTimerState { sessionId: ID; exerciseName: string; startedAt: number; durationSec: number; pausedAt: number | null; pausedTotalMs: number }
export const REST_KEY = 'restTimer';
export function restRemaining(t: RestTimerState, now = Date.now()): number {
  const elapsed = (t.pausedAt ?? now) - t.startedAt - t.pausedTotalMs;
  return Math.ceil(t.durationSec - elapsed / 1000);
}
export async function startRest(db: WeightDB, st: Omit<RestTimerState, 'startedAt' | 'pausedAt' | 'pausedTotalMs'>, now = Date.now()) {
  await db.kv.put({ key: REST_KEY, value: { ...st, startedAt: now, pausedAt: null, pausedTotalMs: 0 } satisfies RestTimerState });
}
export async function adjustRest(db: WeightDB, action: 'plus' | 'minus' | 'pause' | 'resume' | 'restart' | 'skip', now = Date.now()) {
  const cur = (await db.kv.get(REST_KEY))?.value as RestTimerState | undefined;
  if (!cur) return;
  if (action === 'skip') { await db.kv.delete(REST_KEY); return; }
  let next: RestTimerState = { ...cur };
  if (action === 'plus') next.durationSec += 15;
  if (action === 'minus') next.durationSec = Math.max(0, next.durationSec - 15);
  if (action === 'pause' && !cur.pausedAt) next.pausedAt = now;
  if (action === 'resume' && cur.pausedAt) next = { ...next, pausedTotalMs: cur.pausedTotalMs + (now - cur.pausedAt), pausedAt: null };
  if (action === 'restart') next = { ...next, startedAt: now, pausedAt: null, pausedTotalMs: 0 };
  await db.kv.put({ key: REST_KEY, value: next });
}

/* ───────────── personal bests (WO-02 PR badge, WO-10 summary) ───────────── */

export interface Best { maxWeightKg: number; maxE1rm: number; maxReps: number }

/** Best values of an exercise in completed sessions strictly before `before` (BR-PR: same load mode only, warm-ups excluded). */
export async function bestBefore(db: WeightDB, exerciseId: ID, before: Pick<WorkoutSession, 'id' | 'localDate' | 'startedAt'>): Promise<Best | null> {
  const ex = await db.exercises.get(exerciseId);
  const ses = await db.sessionExercises.where('exerciseId').equals(exerciseId).toArray();
  const sessions = new Map((await db.sessions.bulkGet([...new Set(ses.map((x) => x.sessionId))])).filter((s): s is WorkoutSession => !!s).map((s) => [s.id, s]));
  const limit = sortKey(before);
  let best: Best | null = null;
  for (const se of ses) {
    const s = sessions.get(se.sessionId);
    if (!s || s.id === before.id || s.status !== 'completed' || sortKey(s) >= limit || se.status === 'replaced') continue;
    const sets = (await db.sets.where('sessionExerciseId').equals(se.id).toArray()).filter((x) => x.completed === 1 && x.setType !== 'warmup');
    for (const x of sets) {
      best ??= { maxWeightKg: 0, maxE1rm: 0, maxReps: 0 };
      best.maxWeightKg = Math.max(best.maxWeightKg, x.weightKg ?? 0);
      best.maxReps = Math.max(best.maxReps, x.reps ?? 0);
      best.maxE1rm = Math.max(best.maxE1rm, epley(x.weightKg, x.reps, ex?.loadMode ?? 'total') ?? 0);
    }
  }
  return best;
}

export interface PR { exerciseId: ID; exerciseName: string; kind: PRType; value: number; previous: number; unit: string; setId?: ID; weightKg?: number }

/** PRs achieved in this session (running or completed) versus all earlier history – BR-PR-01…06 via the records engine. */
export async function sessionPRs(db: WeightDB, sessionId: ID): Promise<PR[]> {
  const s = await db.sessions.get(sessionId);
  if (!s) return [];
  const ids = await exercisesOfSession(db, sessionId);
  const out: PR[] = [];
  for (const ex of (await db.exercises.bulkGet(ids)).filter((e): e is Exercise => !!e && e.status !== 'unresolved')) {
    for (const e of await prEventsFor(db, ex, { includeSessionId: sessionId })) {
      if (e.sessionId === sessionId) out.push({ exerciseId: ex.id, exerciseName: ex.name, kind: e.type, value: e.value, previous: e.previous, unit: e.unit, setId: e.setId, weightKg: e.weightKg });
    }
  }
  const order: PRType[] = ['max_weight', 'e1rm', 'reps_at_weight', 'max_reps', 'exercise_volume', 'duration', 'distance', 'speed'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * WO-17 AC1 estimated duration (an estimate, shown with "≈"): 40 s per working set + its rest, cardio minutes from the
 * target text ("20 min"), warm-up minutes from the prescription (else 1 min per item). Rounded to 5 min.
 */
export function estimateMinutes(rows: { sets: number; rest: number; role: string; reps: string }[], warmup: { prescription: string }[] = []): number {
  const minIn = (txt: string) => { const m = txt.match(/(\d+(?:\.\d+)?)\s*(?:[-–]\s*\d+\s*)?min/i); return m ? Number(m[1]) : null; };
  let sec = 0;
  for (const r of rows) {
    if (r.role === 'cardio') sec += (minIn(r.reps) ?? 20) * 60;
    else sec += r.sets * (40 + r.rest);
  }
  for (const w of warmup) sec += (minIn(w.prescription) ?? 1) * 60;
  return Math.max(5, Math.round(sec / 300) * 5);
}
