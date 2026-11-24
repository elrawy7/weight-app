/** PROG-07: start any planned day's workout today, shifting the plan onward (rule in src/domain/reschedule.ts). */
import type { WeightDB } from '../../db/schema';
import type { ID, ISODate, WorkoutProgram, WorkoutSchedule, WorkoutSession } from '../../db/types';
import { planShift, slotsBetween, scheduleEnd, ShiftError, type ShiftPlan, type Slot } from '../../domain/reschedule';
import { addDays, nowIso } from '../../domain/dates';
import * as R from '../../db/repos';
import { activeSession, startWorkout, WorkoutError } from './workoutOps';

export const PLAN_UNDO_KEY = 'planUndo';
export interface PlanUndo { scheduleBefore: WorkoutSchedule; programBefore: Pick<WorkoutProgram, 'id' | 'endDate' | 'weeks'>; appliedAt: string; summary: string }

async function context(db: WeightDB) {
  const program = await R.activeProgram(db);
  if (!program) throw new ShiftError('No active program.');
  const schedule = await db.schedules.where('programId').equals(program.id).first();
  if (!schedule) throw new ShiftError('This program has no schedule.');
  const done = new Set((await db.sessions.where('status').equals('completed').toArray()).map((s) => `${s.localDate}|${s.templateId}`));
  const isDone = (d: ISODate, t: ID) => done.has(`${d}|${t}`);
  return { program, schedule, isDone };
}

export async function previewShift(db: WeightDB, today: ISODate, source: ISODate): Promise<ShiftPlan> {
  const { program, schedule, isDone } = await context(db);
  return planShift({ schedule, weeks: program.weeks, programEnd: program.endDate, today, source, isDone });
}

/** Planned days you can pull into today: missed earlier days (not done, not moved) and the next upcoming ones. */
export async function shiftSources(db: WeightDB, today: ISODate, upcomingLimit = 10): Promise<{ missed: Slot[]; upcoming: Slot[]; todayDone: boolean }> {
  const { program, schedule, isDone } = await context(db);
  const start = program.startDate ?? schedule.startDate ?? addDays(today, -28);
  const end = scheduleEnd(schedule, program.endDate) ?? today;
  const missed = start < today ? slotsBetween(schedule, start, addDays(today, -1), program.weeks).filter((x) => !isDone(x.date, x.templateId)) : [];
  const upcoming = end > today ? slotsBetween(schedule, addDays(today, 1), end, program.weeks).filter((x) => !isDone(x.date, x.templateId)).slice(0, upcomingLimit) : [];
  const todaySlot = slotsBetween(schedule, today, today, program.weeks)[0];
  return { missed, upcoming, todayDone: !!todaySlot && isDone(today, todaySlot.templateId) };
}

export async function applyShift(db: WeightDB, plan: ShiftPlan, summary: string): Promise<void> {
  const { program, schedule } = await context(db);
  const undo: PlanUndo = { scheduleBefore: schedule, programBefore: { id: program.id, endDate: program.endDate, weeks: program.weeks }, appliedAt: nowIso(), summary };
  await db.transaction('rw', [db.schedules, db.programs, db.kv], async () => {
    await db.schedules.put({ ...plan.schedule, updatedAt: nowIso() });
    if (plan.newEnd && program.endDate && plan.newEnd > program.endDate) {
      // The plan grew past its last week: stretch the last week (and the program) so the extra day is shown in it.
      const weeks = program.weeks.map((w, i) => (i === program.weeks.length - 1 && plan.newEnd! > w.endDate ? { ...w, endDate: plan.newEnd! } : w));
      await db.programs.update(program.id, { endDate: plan.newEnd, weeks, updatedAt: nowIso() });
    }
    await db.kv.put({ key: PLAN_UNDO_KEY, value: undo });
  });
}

export async function undoShift(db: WeightDB): Promise<boolean> {
  const u = (await db.kv.get(PLAN_UNDO_KEY))?.value as PlanUndo | undefined;
  if (!u) return false;
  await db.transaction('rw', [db.schedules, db.programs, db.kv], async () => {
    await db.schedules.put({ ...u.scheduleBefore, updatedAt: nowIso() });
    await db.programs.update(u.programBefore.id, { endDate: u.programBefore.endDate, weeks: u.programBefore.weeks, updatedAt: nowIso() });
    await db.kv.delete(PLAN_UNDO_KEY);
  });
  return true;
}

/**
 * Start the workout of planned day `source` today. `shift` = move the plan onward (PROG-07); otherwise it is an extra
 * workout and the plan is not changed. The plan is only changed once nothing else is running; if starting fails it is undone.
 */
export async function startFromDay(db: WeightDB, a: { today: ISODate; source: ISODate; shift: boolean; summary?: string }): Promise<WorkoutSession> {
  if (await activeSession(db)) throw new WorkoutError('Another workout is still in progress. Continue or finish it first.');
  const { program, schedule } = await context(db);
  const slot = slotsBetween(schedule, a.source, a.source, program.weeks)[0];
  if (!slot) throw new ShiftError('There is no workout planned on that day.');
  if (!a.shift) return startWorkout(db, { programId: program.id, templateId: slot.templateId, week: slot.week, date: a.today, today: a.today });
  const plan = await previewShift(db, a.today, a.source);
  await applyShift(db, plan, a.summary ?? '');
  try {
    return await startWorkout(db, { programId: program.id, templateId: plan.picked.templateId, week: plan.picked.week, date: a.today, today: a.today });
  } catch (e) {
    await undoShift(db);
    throw e;
  }
}
