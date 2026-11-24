import type { ISODate, WeekPhase, WorkoutSchedule, ID } from '../db/types';
import { weekdayOf } from './dates';

export type DayPlan =
  | { kind: 'planned'; templateId: ID; week: number | null; targetRpe?: string; source: 'planned' | 'exception' | 'pattern'; note?: string }
  | { kind: 'rest'; source: 'pattern' | 'exception'; note?: string }
  | { kind: 'none' };

/**
 * What is scheduled on `date` (PROG-03). Priority: exception → explicit planned date → weekly pattern
 * (pattern applies inside the program window, or open-ended when the schedule has no end date).
 */
export function planForDate(s: WorkoutSchedule | undefined, date: ISODate, weeks: WeekPhase[] = []): DayPlan {
  if (!s) return { kind: 'none' };
  const week = weekOf(weeks, date);
  const ex = s.exceptions.find((e) => e.date === date);
  if (ex) return ex.templateId ? { kind: 'planned', templateId: ex.templateId, week, source: 'exception', note: ex.note } : { kind: 'rest', source: 'exception', note: ex.note };
  const p = s.planned.find((x) => x.date === date);
  if (p) return { kind: 'planned', templateId: p.templateId, week: p.week, targetRpe: p.targetRpe, source: 'planned' };
  if (s.startDate && date < s.startDate) return { kind: 'none' };
  if (s.endDate && date > s.endDate) return { kind: 'none' };
  const t = s.pattern[weekdayOf(date)];
  return t ? { kind: 'planned', templateId: t, week, source: 'pattern' } : { kind: 'rest', source: 'pattern' };
}

/** Program week for a date from explicit week ranges (PROG-04). */
export function weekOf(weeks: WeekPhase[], date: ISODate): number | null {
  return weeks.find((w) => date >= w.startDate && date <= w.endDate)?.week ?? null;
}
export const phaseOf = (weeks: WeekPhase[], date: ISODate): WeekPhase | null => weeks.find((w) => date >= w.startDate && date <= w.endDate) ?? null;

/** Target sets for a given week (1-based); falls back to the last defined week. */
export function setsForWeek(targetSetsByWeek: number[], week: number | null): number {
  if (!targetSetsByWeek.length) return 0;
  if (!week) return targetSetsByWeek[0];
  return targetSetsByWeek[Math.min(week, targetSetsByWeek.length) - 1];
}
