/**
 * QL-01 Quick completion log (Phase 1 add-on, 24 Nov 2026): mark a planned day as done with a summary
 * (minutes, knee pain, energy, note) without set-by-set logging. Full logging replaces it in Phase 2.
 */
import type { WeightDB } from '../../db/schema';
import type { ISODate, WorkoutSession } from '../../db/types';
import { nowIso } from '../../domain/dates';
import { uuidv7 } from '../../domain/uuid';
import type { DayPlan } from '../../domain/schedule';

export class QuickLogError extends Error {}

export interface QuickLogInput {
  date: ISODate; today: ISODate; programId: string; templateId: string; week: number | null;
  durationMin: number | null; kneePain: number | null; energy: number | null; notes: string;
}

function validate(i: Pick<QuickLogInput, 'durationMin' | 'kneePain' | 'energy'>) {
  if (i.durationMin !== null && (!Number.isFinite(i.durationMin) || i.durationMin < 0 || i.durationMin > 600)) throw new QuickLogError('Minutes must be between 0 and 600.');
  if (i.kneePain !== null && (!Number.isInteger(i.kneePain) || i.kneePain < 0 || i.kneePain > 10)) throw new QuickLogError('Knee pain must be a whole number from 0 to 10.');
  if (i.energy !== null && (!Number.isInteger(i.energy) || i.energy < 1 || i.energy > 5)) throw new QuickLogError('Energy must be a whole number from 1 to 5.');
}

/** BR-QL-01 only today or past days; BR-QL-02 one completed session per date + workout. */
export async function markDone(db: WeightDB, i: QuickLogInput): Promise<WorkoutSession> {
  if (i.date > i.today) throw new QuickLogError('A future day cannot be marked as done.');
  validate(i);
  return db.transaction('rw', db.sessions, async () => {
    const existing = (await db.sessions.where('localDate').equals(i.date).toArray()).find((s) => s.templateId === i.templateId && s.status === 'completed');
    if (existing) throw new QuickLogError('This workout is already marked as done for that day.');
    const t = nowIso();
    const s: WorkoutSession = {
      id: uuidv7(), programId: i.programId, templateId: i.templateId, programWeek: i.week ?? undefined, status: 'completed', startedAt: null, endedAt: t, pausedMs: 0,
      localDate: i.date, durationMin: i.durationMin, notes: i.notes.trim(), kneePain: i.kneePain, energy: i.energy, source: 'app', logType: 'quick', createdAt: t, updatedAt: t,
    };
    await db.sessions.add(s);
    return s;
  });
}

export async function updateQuickLog(db: WeightDB, id: string, patch: Pick<QuickLogInput, 'durationMin' | 'kneePain' | 'energy' | 'notes'>): Promise<void> {
  validate(patch);
  const s = await db.sessions.get(id);
  if (!s || s.logType !== 'quick') throw new QuickLogError('Only quick logs can be edited here.');
  await db.sessions.update(id, { ...patch, notes: patch.notes.trim(), updatedAt: nowIso() });
}

/** Undo only removes quick logs that have no exercises or sets (imported or full logs are never deleted here). */
export async function undoQuickLog(db: WeightDB, id: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.sessionExercises], async () => {
    const s = await db.sessions.get(id);
    if (!s || s.logType !== 'quick') throw new QuickLogError('Only quick logs can be undone.');
    if (await db.sessionExercises.where('sessionId').equals(id).count()) throw new QuickLogError('This session has logged exercises and cannot be undone here.');
    await db.sessions.delete(id);
  });
}

export type DayStatus = 'done' | 'today' | 'missed' | 'upcoming' | 'rest' | 'none';

/** Status of a calendar day for the plan view. */
export function dayStatus(date: ISODate, today: ISODate, plan: DayPlan, completed: Pick<WorkoutSession, 'localDate' | 'templateId'>[]): DayStatus {
  if (plan.kind === 'planned' && completed.some((s) => s.localDate === date && s.templateId === plan.templateId)) return 'done';
  if (plan.kind === 'rest') return 'rest';
  if (plan.kind === 'none') return completed.some((s) => s.localDate === date) ? 'done' : 'none';
  if (date === today) return 'today';
  return date < today ? 'missed' : 'upcoming';
}
