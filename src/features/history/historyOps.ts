/** History (HIST-01…06): list items with filters, session detail, repeat, compare. */
import type { WeightDB } from '../../db/schema';
import type { Exercise, ID, PersonalRecord, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from '../../db/types';
import { nowIso } from '../../domain/dates';
import { setVolume, epley } from '../../domain/e1rm';
import { uuidv7 } from '../../domain/uuid';
import { activeSession, addExerciseToSession, inBuildTransaction, summarize, WorkoutError, DATE_SOURCE_LIVE, type SessionSummary } from '../workout/workoutOps';

export interface HistoryItem {
  session: WorkoutSession; templateName?: string; programName?: string;
  setsDone: number; volumeKg: number; prCount: number; exerciseIds: ID[]; muscles: string[];
}

/** All completed sessions, newest first, with the data needed for filters (HIST-01). */
export async function historyItems(db: WeightDB): Promise<HistoryItem[]> {
  const sessions = (await db.sessions.where('status').equals('completed').toArray()).sort((a, b) => `${b.localDate}|${b.startedAt ?? ''}`.localeCompare(`${a.localDate}|${a.startedAt ?? ''}`));
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  // E-06: whole-table reads + maps (index lookups with thousands of keys and per-session filtering were the slow part)
  const idSet = new Set(ids);
  const ses = (await db.sessionExercises.toArray()).filter((x) => idSet.has(x.sessionId));
  const seSet = new Set(ses.map((x) => x.id));
  const sets = ses.length ? (await db.sets.toArray()).filter((x) => seSet.has(x.sessionExerciseId)) : [];
  const sesBySession = new Map<ID, WorkoutSessionExercise[]>();
  for (const x of ses) { const l = sesBySession.get(x.sessionId); if (l) l.push(x); else sesBySession.set(x.sessionId, [x]); }
  const exs = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
  const links = await db.exerciseMuscles.toArray();
  const parentOf = new Map((await db.muscleGroups.toArray()).map((g) => [g.id, g.parentId || g.id]));
  const musclesOf = new Map<ID, string[]>();
  for (const l of links) if (l.role === 'primary') musclesOf.set(l.exerciseId, [...(musclesOf.get(l.exerciseId) ?? []), parentOf.get(l.muscleGroupId) ?? l.muscleGroupId]);
  const tpls = new Map((await db.templates.toArray()).map((t) => [t.id, t.name]));
  const progs = new Map((await db.programs.toArray()).map((p) => [p.id, p.name]));
  const prCount = new Map<ID, number>();
  for (const p of await db.personalRecords.toArray()) if (idSet.has(p.sessionId)) prCount.set(p.sessionId, (prCount.get(p.sessionId) ?? 0) + 1);
  const setsBySe = new Map<ID, WorkoutSet[]>();
  for (const x of sets) { const l = setsBySe.get(x.sessionExerciseId); if (l) l.push(x); else setsBySe.set(x.sessionExerciseId, [x]); }
  return sessions.map((s) => {
    const mine = sesBySession.get(s.id) ?? [];
    let setsDone = 0, volumeKg = 0;
    const withSets = new Set<ID>();
    for (const se of mine) for (const x of setsBySe.get(se.id) ?? []) {
      if (!x.completed || x.setType === 'warmup' || (x.reps === 0 && !x.durationSec)) continue; // failed attempts aren't working sets
      withSets.add(se.id);
      setsDone++;
      volumeKg += setVolume(x.weightKg, x.reps, exs.get(se.exerciseId)?.loadMode ?? 'none');
    }
    // A-06: an exercise is part of the workout if it was done – including the completed sets of a replaced one
    const exerciseIds = [...new Set(mine.filter((x) => withSets.has(x.id) || (x.status !== 'skipped' && x.status !== 'replaced')).map((x) => x.exerciseId))];
    return {
      session: s, templateName: s.templateName ?? (s.templateId ? tpls.get(s.templateId) : undefined), programName: s.programId ? progs.get(s.programId) : undefined,
      setsDone, volumeKg: Math.round(volumeKg), prCount: prCount.get(s.id) ?? 0,
      exerciseIds, muscles: [...new Set(exerciseIds.flatMap((id) => musclesOf.get(id) ?? []))],
    };
  });
}

export interface HistoryFilter { programId?: string | null; muscle?: string | null; exerciseId?: string | null }
export function filterHistory(items: HistoryItem[], f: HistoryFilter): HistoryItem[] {
  return items.filter((i) => (!f.programId || i.session.programId === f.programId) && (!f.muscle || i.muscles.includes(f.muscle)) && (!f.exerciseId || i.exerciseIds.includes(f.exerciseId)));
}

export interface DetailExercise { se: WorkoutSessionExercise; ex: Exercise | undefined; sets: WorkoutSet[]; volumeKg: number }
export interface SessionDetail { session: WorkoutSession; templateName?: string; programName?: string; exercises: DetailExercise[]; summary: SessionSummary; records: PersonalRecord[] }

/** HIST-02: everything about one session. */
export async function sessionDetail(db: WeightDB, id: ID): Promise<SessionDetail | null> {
  const s = await db.sessions.get(id);
  if (!s) return null;
  const all = (await db.sessionExercises.where('sessionId').equals(id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
  const sets = all.length ? await db.sets.where('sessionExerciseId').anyOf(all.map((x) => x.id)).toArray() : [];
  // A-06: a replaced exercise stays in the record when it has completed sets
  const ses = all.filter((x) => x.status !== 'replaced' || sets.some((y) => y.sessionExerciseId === x.id && y.completed === 1));
  const exs = new Map((await db.exercises.bulkGet(ses.map((x) => x.exerciseId))).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
  const exercises = ses.map((se) => {
    const mine = sets.filter((x) => x.sessionExerciseId === se.id).sort((a, b) => a.orderIndex - b.orderIndex);
    const ex = exs.get(se.exerciseId);
    return { se, ex, sets: se.status === 'replaced' ? mine.filter((x) => x.completed === 1) : mine, volumeKg: Math.round(mine.filter((x) => x.completed && x.setType !== 'warmup').reduce((v, x) => v + setVolume(x.weightKg, x.reps, ex?.loadMode ?? 'none'), 0)) };
  });
  return {
    session: s, templateName: s.templateName ?? (s.templateId ? (await db.templates.get(s.templateId))?.name : undefined), programName: s.programId ? (await db.programs.get(s.programId))?.name : undefined,
    exercises, summary: await summarize(db, id), records: await db.personalRecords.where('sessionId').equals(id).toArray(),
  };
}

/** HIST-05: a new active session today with the same exercises and targets; previous values come from the latest performance. */
/** HIST-04 repeat. Internal finding I-03: created in one transaction, like startWorkout (A-01). */
export function repeatSession(db: WeightDB, sourceId: ID, today: string): Promise<WorkoutSession> {
  return inBuildTransaction(db, () => repeatSessionTx(db, sourceId, today));
}
async function repeatSessionTx(db: WeightDB, sourceId: ID, today: string): Promise<WorkoutSession> {
  if (await activeSession(db)) throw new WorkoutError('Another workout is still in progress. Continue or finish it first.');
  const src = await db.sessions.get(sourceId);
  if (!src) throw new WorkoutError('Session not found.');
  const t = nowIso();
  const s: WorkoutSession = {
    id: uuidv7(), programId: src.programId, templateId: src.templateId, programWeek: src.programWeek, status: 'active', startedAt: t, endedAt: null, pausedMs: 0,
    localDate: today, notes: '', source: 'app', logType: 'full', lastActivityAt: t, pausedAt: null, createdAt: t, updatedAt: t, dateSource: DATE_SOURCE_LIVE,
    ...(src.templateName !== undefined ? { templateName: src.templateName } : {}),
  };
  if (s.templateId && s.templateName === undefined) { const tpl = await db.templates.get(s.templateId); if (tpl) s.templateName = tpl.name; }
  await db.sessions.add(s);
  const ses = (await db.sessionExercises.where('sessionId').equals(sourceId).toArray()).filter((x) => x.status !== 'replaced').sort((a, b) => a.orderIndex - b.orderIndex);
  for (const [i, se] of ses.entries()) {
    const n = await db.sets.where('sessionExerciseId').equals(se.id).filter((x) => x.setType !== 'warmup').count();
    const { previous: _p, ...targets } = se.snapshot ?? {};
    void _p;
    await addExerciseToSession(db, s, se.exerciseId, i + 1, { ...targets, targetSets: targets.targetSets ?? (n || undefined) }, se.supersetGroup);
  }
  return s;
}

/* ───────────── HIST-06 compare ───────────── */

export interface SideStats { sets: number; best: WorkoutSet | null; volumeKg: number; e1rm: number | null; cardioMin?: number }
export interface CompareRow { exerciseId: ID; name: string; loadMode: string; a: SideStats; b: SideStats }

function side(d: DetailExercise): SideStats {
  const w = d.sets.filter((x) => x.completed && x.setType !== 'warmup' && !(x.reps === 0 && !x.durationSec));
  const lm = d.ex?.loadMode ?? 'none';
  // B-01: for an assisted exercise the best set is the one with the LEAST assistance
  const dir = lm === 'assist' ? -1 : 1;
  const best = w.reduce<WorkoutSet | null>((b, x) => (!b || dir * ((x.weightKg ?? 0) - (b.weightKg ?? 0)) > 0 || ((x.weightKg ?? 0) === (b.weightKg ?? 0) && (x.reps ?? 0) > (b.reps ?? 0)) ? x : b), null);
  const e = Math.max(0, ...w.map((x) => epley(x.weightKg, x.reps, lm) ?? 0));
  return { sets: w.length, best, volumeKg: d.volumeKg, e1rm: e > 0 ? e : null, cardioMin: d.se.cardio?.durationMin };
}

/** Matching exercises side by side; others listed separately (never compared – BR-EX-03). */
export function compareSessions(a: SessionDetail, b: SessionDetail): { rows: CompareRow[]; onlyA: DetailExercise[]; onlyB: DetailExercise[] } {
  const done = (d: DetailExercise) => d.sets.some((x) => x.completed === 1 && x.setType !== 'warmup') || (d.se.status !== 'skipped' && d.se.status !== 'replaced');
  const A = a.exercises.filter(done), B = b.exercises.filter(done);
  const rows: CompareRow[] = [];
  for (const x of A) {
    const y = B.find((z) => z.se.exerciseId === x.se.exerciseId);
    if (y) rows.push({ exerciseId: x.se.exerciseId, name: x.ex?.name ?? x.se.exerciseId, loadMode: x.ex?.loadMode ?? 'none', a: side(x), b: side(y) });
  }
  const matched = new Set(rows.map((r) => r.exerciseId));
  return { rows, onlyA: A.filter((x) => !matched.has(x.se.exerciseId)), onlyB: B.filter((x) => !matched.has(x.se.exerciseId)) };
}
