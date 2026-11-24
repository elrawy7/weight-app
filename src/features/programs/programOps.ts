import type { WeightDB } from '../../db/schema';
import type { WorkoutProgram, WorkoutTemplate, WorkoutTemplateExercise, WorkoutSchedule, Weekday, ScheduleException } from '../../db/types';
import { nowIso, isValidIsoDate } from '../../domain/dates';
import { uuidv7 } from '../../domain/uuid';

export class ProgramError extends Error {}

/** PROG-01 AC1: deep copy (templates + rows + schedule) as a draft. */
export async function duplicateProgram(db: WeightDB, id: string, name?: string): Promise<WorkoutProgram> {
  return db.transaction('rw', [db.programs, db.templates, db.templateExercises, db.schedules], async () => {
    const p = await db.programs.get(id);
    if (!p) throw new ProgramError('Program not found.');
    const t = nowIso();
    const np: WorkoutProgram = { ...p, id: uuidv7(), name: name ?? `${p.name} (copy)`, status: 'draft', source: 'app', notionPageId: undefined, createdAt: t, updatedAt: t };
    await db.programs.add(np);
    const map = new Map<string, string>();
    for (const tp of await db.templates.where('programId').equals(id).toArray()) {
      const nid = uuidv7();
      map.set(tp.id, nid);
      await db.templates.add({ ...tp, id: nid, programId: np.id, warmup: tp.warmup.map((w) => ({ ...w, id: uuidv7() })), createdAt: t, updatedAt: t });
      const rows = await db.templateExercises.where('templateId').equals(tp.id).toArray();
      await db.templateExercises.bulkAdd(rows.map((r) => ({ ...r, id: uuidv7(), templateId: nid, createdAt: t, updatedAt: t })));
    }
    const s = await db.schedules.where('programId').equals(id).first();
    if (s) {
      const remap = (x: string | null) => (x ? map.get(x) ?? null : null);
      await db.schedules.add({
        ...s, id: uuidv7(), programId: np.id, pattern: Object.fromEntries(Object.entries(s.pattern).map(([k, v]) => [k, remap(v)])) as WorkoutSchedule['pattern'],
        exceptions: [], planned: [], createdAt: t, updatedAt: t,
      });
    }
    return np;
  });
}

/** PROG-01 AC2: exactly one active program. */
export async function setProgramStatus(db: WeightDB, id: string, status: WorkoutProgram['status']): Promise<void> {
  await db.transaction('rw', db.programs, async () => {
    const t = nowIso();
    if (status === 'active') await db.programs.where('status').equals('active').modify({ status: 'archived', updatedAt: t });
    await db.programs.update(id, { status, updatedAt: t });
  });
}

export async function createProgram(db: WeightDB, name: string): Promise<WorkoutProgram> {
  if (!name.trim()) throw new ProgramError('Name is required.');
  const t = nowIso();
  const p: WorkoutProgram = { id: uuidv7(), name: name.trim(), split: 'custom', status: 'draft', weeks: [], source: 'app', createdAt: t, updatedAt: t };
  await db.transaction('rw', [db.programs, db.schedules], async () => {
    await db.programs.add(p);
    await db.schedules.add({ id: uuidv7(), programId: p.id, pattern: { SUN: null, MON: null, TUE: null, WED: null, THU: null, FRI: null, SAT: null }, exceptions: [], planned: [], createdAt: t, updatedAt: t });
  });
  return p;
}

export async function addTemplate(db: WeightDB, programId: string, name: string): Promise<WorkoutTemplate> {
  if (!name.trim()) throw new ProgramError('Name is required.');
  const n = await db.templates.where('programId').equals(programId).count();
  const t = nowIso();
  const tp: WorkoutTemplate = { id: uuidv7(), programId, name: name.trim(), focus: '', orderIndex: n + 1, warmup: [], createdAt: t, updatedAt: t };
  await db.templates.add(tp);
  return tp;
}

export async function deleteTemplate(db: WeightDB, id: string): Promise<void> {
  await db.transaction('rw', [db.templates, db.templateExercises, db.schedules], async () => {
    const tp = await db.templates.get(id);
    if (!tp) return;
    await db.templateExercises.where('templateId').equals(id).delete();
    await db.templates.delete(id);
    await db.schedules.where('programId').equals(tp.programId).modify((s) => {
      for (const k of Object.keys(s.pattern) as Weekday[]) if (s.pattern[k] === id) s.pattern[k] = null;
      s.exceptions = s.exceptions.map((e) => (e.templateId === id ? { ...e, templateId: null } : e));
      s.planned = s.planned.filter((p) => p.templateId !== id);
    });
  });
}

/** PROG-02 AC1: add from library. Defaults come from the exercise (rest) and the program length (sets per week). */
export async function addRow(db: WeightDB, templateId: string, exerciseId: string): Promise<WorkoutTemplateExercise> {
  const tp = await db.templates.get(templateId);
  const ex = await db.exercises.get(exerciseId);
  if (!tp || !ex) throw new ProgramError('Template or exercise not found.');
  const prog = await db.programs.get(tp.programId);
  const rows = await db.templateExercises.where('templateId').equals(templateId).toArray();
  const t = nowIso();
  const weeks = Math.max(1, prog?.weeksCount ?? 1);
  const row: WorkoutTemplateExercise = {
    id: uuidv7(), templateId, exerciseId, orderIndex: Math.max(0, ...rows.map((r) => r.orderIndex)) + 1, targetSetsByWeek: Array(weeks).fill(3),
    targetReps: ex.tracking === 'duration' ? '30-45 s' : ex.mechanic === 'cardio' ? '20 min' : '8-12', restSec: ex.defaultRestSec, supersetGroup: null, notes: '',
    alternativeIds: [], role: ex.mechanic === 'cardio' ? 'cardio' : 'working', createdAt: t, updatedAt: t,
  };
  await db.templateExercises.add(row);
  return row;
}

export async function updateRow(db: WeightDB, id: string, patch: Partial<Pick<WorkoutTemplateExercise, 'targetSetsByWeek' | 'targetReps' | 'restSec' | 'notes' | 'supersetGroup' | 'alternativeIds' | 'role'>>): Promise<void> {
  if (patch.targetSetsByWeek && patch.targetSetsByWeek.some((n) => !Number.isInteger(n) || n < 0 || n > 20)) throw new ProgramError('Sets must be whole numbers between 0 and 20.');
  if (patch.restSec !== undefined && (patch.restSec < 0 || patch.restSec > 900)) throw new ProgramError('Rest must be between 0 and 900 seconds.');
  if (patch.supersetGroup !== undefined && patch.supersetGroup !== null && !/^[A-Z]$/.test(patch.supersetGroup)) throw new ProgramError('Superset group must be a single letter A–Z.');
  await db.templateExercises.update(id, { ...patch, updatedAt: nowIso() });
}

/** Replace keeps the targets (PROG-02 AC1). */
export const replaceRowExercise = (db: WeightDB, id: string, exerciseId: string) => db.templateExercises.update(id, { exerciseId, updatedAt: nowIso() });
export const removeRow = (db: WeightDB, id: string) => db.templateExercises.delete(id);

/** Reorder (drag result): rewrite orderIndex 1..n in the given order, in one transaction. */
export async function reorderRows(db: WeightDB, templateId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.templateExercises, async () => {
    const rows = await db.templateExercises.where('templateId').equals(templateId).toArray();
    if (rows.length !== orderedIds.length || !rows.every((r) => orderedIds.includes(r.id))) throw new ProgramError('Reorder list does not match the template.');
    const t = nowIso();
    for (let i = 0; i < orderedIds.length; i++) await db.templateExercises.update(orderedIds[i], { orderIndex: i + 1, updatedAt: t });
  });
}

/* ── schedule (PROG-03) ── */
export async function setPattern(db: WeightDB, scheduleId: string, day: Weekday, templateId: string | null) {
  await db.schedules.where('id').equals(scheduleId).modify((s) => { s.pattern[day] = templateId; s.updatedAt = nowIso(); });
}
export async function upsertException(db: WeightDB, scheduleId: string, ex: ScheduleException) {
  if (!isValidIsoDate(ex.date)) throw new ProgramError('Invalid date.');
  await db.schedules.where('id').equals(scheduleId).modify((s) => { s.exceptions = [...s.exceptions.filter((e) => e.date !== ex.date), ex].sort((a, b) => a.date.localeCompare(b.date)); s.updatedAt = nowIso(); });
}
export async function removeException(db: WeightDB, scheduleId: string, date: string) {
  await db.schedules.where('id').equals(scheduleId).modify((s) => { s.exceptions = s.exceptions.filter((e) => e.date !== date); s.updatedAt = nowIso(); });
}

/* ── warm-ups (PROG-05) ── */
export async function setWarmup(db: WeightDB, templateId: string, items: WorkoutTemplate['warmup']) {
  await db.templates.update(templateId, { warmup: items.map((w, i) => ({ ...w, id: w.id || uuidv7(), prescription: w.prescription.trim() || '—', label: w.exerciseId ? null : (w.label?.trim() || `Item ${i + 1}`) })), updatedAt: nowIso() });
}
