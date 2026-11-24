import type { Table } from 'dexie';
import type { WeightDB } from './schema';
import { nowIso } from '../domain/dates';
import { uuidv7 } from '../domain/uuid';
import type { Exercise, WorkoutTemplate, WorkoutTemplateExercise, WorkoutSession, ExerciseMuscle } from './types';

type Stamped = { id: string; createdAt: string; updatedAt: string };

/** Generic repository: timestamps + UUID v7 ids for new records. */
export function repo<T extends Stamped>(table: Table<T, string>) {
  return {
    async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<T> {
      const t = nowIso();
      const row = { ...data, id: data.id ?? uuidv7(), createdAt: t, updatedAt: t } as T;
      await table.add(row);
      return row;
    },
    get: (id: string) => table.get(id),
    async update(id: string, patch: Partial<T>): Promise<void> {
      const n = await table.update(id, { ...patch, updatedAt: nowIso() } as never);
      if (!n) throw new Error(`Not found: ${table.name}/${id}`);
    },
    remove: (id: string) => table.delete(id),
    list: () => table.toArray(),
  };
}

export const exercisesRepo = (db: WeightDB) => repo<Exercise>(db.exercises);
export const templatesRepo = (db: WeightDB) => repo<WorkoutTemplate>(db.templates);
export const templateRowsRepo = (db: WeightDB) => repo<WorkoutTemplateExercise>(db.templateExercises);
export const sessionsRepo = (db: WeightDB) => repo<WorkoutSession>(db.sessions);

/* ── domain queries (use the indexes declared in schema v1) ── */
export const activeExercises = (db: WeightDB) => db.exercises.where('isArchived').equals(0).toArray();
export const exercisesByCategory = (db: WeightDB, c: string) => db.exercises.where('category').equals(c).toArray();
export const exerciseByAlias = (db: WeightDB, alias: string) => db.exercises.where('aliasesLower').equals(alias.toLowerCase()).first();
export const musclesOfExercise = (db: WeightDB, id: string): Promise<ExerciseMuscle[]> => db.exerciseMuscles.where('exerciseId').equals(id).toArray();
export const templatesOfProgram = (db: WeightDB, programId: string) => db.templates.where('[programId+orderIndex]').between([programId, -Infinity], [programId, Infinity]).toArray();
export const rowsOfTemplate = (db: WeightDB, templateId: string) => db.templateExercises.where('[templateId+orderIndex]').between([templateId, -Infinity], [templateId, Infinity]).toArray();
export const sessionsOnDate = (db: WeightDB, d: string) => db.sessions.where('localDate').equals(d).toArray();
export const completedSessions = (db: WeightDB) => db.sessions.where('status').equals('completed').reverse().sortBy('localDate');
export const exercisesOfSession = (db: WeightDB, sessionId: string) => db.sessionExercises.where('[sessionId+orderIndex]').between([sessionId, -Infinity], [sessionId, Infinity]).toArray();
export const setsOf = (db: WeightDB, seId: string) => db.sets.where('[sessionExerciseId+orderIndex]').between([seId, -Infinity], [seId, Infinity]).toArray();
export const activeProgram = (db: WeightDB) => db.programs.where('status').equals('active').first();
export const usageOfExercise = async (db: WeightDB, id: string) => ({
  templateRows: await db.templateExercises.where('exerciseId').equals(id).count(),
  sessionExercises: await db.sessionExercises.where('exerciseId').equals(id).count(),
});
