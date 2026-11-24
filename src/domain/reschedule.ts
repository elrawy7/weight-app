/**
 * PROG-07 (new): "Do another day's workout today" – shift the plan onward by training day.
 *
 * Rule (decided by the user on 24 Nov 2026 – "next training day"): the plan is a queue of workouts sitting on training
 * days. When you train a different planned workout today, it takes today's place and every not-yet-done workout keeps
 * its order and moves to the next training day. Rest days stay rest days. Each workout keeps its own week / RPE.
 *  - Picked from a later day: the workouts in between move one training day later; nothing after the picked day changes.
 *  - Catch-up of a missed earlier day: everything from today moves one training day later; one training day is added
 *    at the end (next pattern weekday after the last one). The missed day becomes "moved".
 *  - Today is a rest day: today becomes a training day; for a later pick, the plan finishes one training day earlier.
 * Pure function: returns the new schedule; never touches sessions (history is never changed).
 */
import type { ID, ISODate, PlannedSession, ScheduleException, WeekPhase, WorkoutSchedule } from '../db/types';
import { WEEKDAYS } from '../db/types';
import { addDays, weekdayOf } from './dates';
import { planForDate } from './schedule';

export interface Slot { date: ISODate; templateId: ID; week: number | null; targetRpe?: string; notionPageId?: string }
export interface ShiftChange { date: ISODate; before: ID | null; after: ID | null; beforeWeek: number | null; afterWeek: number | null }
export interface ShiftPlan { schedule: WorkoutSchedule; changes: ShiftChange[]; oldEnd: ISODate | null; newEnd: ISODate | null; picked: Slot; replaced: Slot | null }

export class ShiftError extends Error {}

/** Last date the schedule can produce a workout on (explicit entries, schedule end, program end). */
export function scheduleEnd(s: WorkoutSchedule, programEnd?: ISODate): ISODate | null {
  const dates = [...s.planned.map((p) => p.date), ...s.exceptions.filter((e) => e.templateId).map((e) => e.date)];
  if (s.endDate) dates.push(s.endDate);
  if (programEnd) dates.push(programEnd);
  return dates.length ? dates.sort().at(-1)! : null;
}

/** Planned workouts from `from` to `to` (inclusive), resolved with the normal priority (exception → planned → pattern). */
export function slotsBetween(s: WorkoutSchedule, from: ISODate, to: ISODate, weeks: WeekPhase[]): Slot[] {
  const out: Slot[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const p = planForDate(s, d, weeks);
    if (p.kind !== 'planned') continue;
    const explicit = s.planned.find((x) => x.date === d && x.templateId === p.templateId);
    out.push({ date: d, templateId: p.templateId, week: p.week, targetRpe: p.targetRpe, notionPageId: explicit?.notionPageId });
  }
  return out;
}

function nextTrainingDay(s: WorkoutSchedule, after: ISODate): ISODate {
  const hasPattern = WEEKDAYS.some((w) => s.pattern[w]);
  let d = addDays(after, 1);
  if (!hasPattern) return d;
  while (!s.pattern[weekdayOf(d)]) d = addDays(d, 1);
  return d;
}

export function planShift(args: {
  schedule: WorkoutSchedule; weeks: WeekPhase[]; programEnd?: ISODate; today: ISODate; source: ISODate;
  isDone: (date: ISODate, templateId: ID) => boolean;
}): ShiftPlan {
  const { schedule: s, weeks, today, source, isDone } = args;
  if (source === today) throw new ShiftError('That is already today’s workout.');
  const oldEnd = scheduleEnd(s, args.programEnd);
  if (!oldEnd) throw new ShiftError('This plan has no end date, so it cannot be shifted.');
  const srcPlan = planForDate(s, source, weeks);
  if (srcPlan.kind !== 'planned') throw new ShiftError('There is no workout planned on that day.');
  if (isDone(source, srcPlan.templateId)) throw new ShiftError('That workout is already done.');
  const todayPlan = planForDate(s, today, weeks);
  if (todayPlan.kind === 'planned' && isDone(today, todayPlan.templateId)) throw new ShiftError('Today’s workout is already done – log this one as an extra workout instead.');

  const end = source > oldEnd ? source : oldEnd;
  const upcoming = slotsBetween(s, today, end, weeks).filter((x) => !isDone(x.date, x.templateId));
  const picked = source > today ? upcoming.find((x) => x.date === source)! : slotsBetween(s, source, source, weeks)[0];
  const replaced = upcoming[0]?.date === today ? upcoming[0] : null;

  const queue = [picked, ...upcoming.filter((x) => x.date !== picked.date)];
  const dates = upcoming.map((x) => x.date);
  if (!replaced) dates.unshift(today); // rest day becomes a training day
  while (queue.length > dates.length) dates.push(nextTrainingDay(s, dates.at(-1) ?? today));
  const after = new Map<ISODate, Slot>();
  dates.forEach((d, i) => { if (queue[i]) after.set(d, { ...queue[i], date: d }); });
  const lastAfter = [...after.keys()].sort().at(-1) ?? today;
  const newEnd = lastAfter > oldEnd ? lastAfter : oldEnd;

  // Rebuild entries from today onward explicitly; the past is kept as it was.
  const planned: PlannedSession[] = [
    ...s.planned.filter((p) => p.date < today),
    ...[...after.values()].map((x) => ({ date: x.date, templateId: x.templateId, week: x.week ?? 0, targetRpe: x.targetRpe ?? '', ...(x.notionPageId ? { notionPageId: x.notionPageId } : {}) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const exceptions: ScheduleException[] = [
    ...s.exceptions.filter((e) => e.date < today && e.date !== source),
    ...s.exceptions.filter((e) => e.date >= today && !e.templateId && !after.has(e.date)),
  ];
  if (source < today) exceptions.push({ date: source, templateId: null, note: `Moved to ${today}` });
  const next: WorkoutSchedule = { ...s, planned, exceptions, ...(s.endDate && newEnd > s.endDate ? { endDate: newEnd } : {}) };
  // Days that would still fall back to the weekly pattern but are free now become rest days.
  for (let d = today; d <= newEnd; d = addDays(d, 1)) {
    const p = planForDate(next, d, weeks);
    if (p.kind === 'planned' && !after.has(d)) next.exceptions.push({ date: d, templateId: null, note: 'Free after plan shift' });
  }
  next.exceptions.sort((a, b) => a.date.localeCompare(b.date));

  const changes: ShiftChange[] = [];
  const beforeAll = new Map(slotsBetween(s, source < today ? source : today, newEnd, weeks).map((x) => [x.date, x]));
  const afterAll = new Map(slotsBetween(next, source < today ? source : today, newEnd, weeks).map((x) => [x.date, x]));
  for (const d of [...new Set([...beforeAll.keys(), ...afterAll.keys()])].sort()) {
    const b = beforeAll.get(d), a = afterAll.get(d);
    if (b?.templateId !== a?.templateId || b?.week !== a?.week) changes.push({ date: d, before: b?.templateId ?? null, after: a?.templateId ?? null, beforeWeek: b?.week ?? null, afterWeek: a?.week ?? null });
  }
  return { schedule: next, changes, oldEnd, newEnd, picked, replaced };
}
