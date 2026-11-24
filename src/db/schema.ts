import Dexie, { type Table } from 'dexie';
import type * as T from './types';

export const DB_NAME = 'weight';
export const SNAPSHOT_DB_NAME = 'weight-snapshots';

/** Store definitions per schema version. Append a new entry for every schema change (never edit an old one). */
export interface SchemaVersion {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: import('dexie').Transaction) => Promise<void> | void;
}

export const SCHEMA_V1: Record<string, string> = {
  profile: 'id',
  muscleGroups: 'id, region',
  equipment: 'id',
  exercises: 'id, &slug, name, category, mechanic, isArchived, status, *aliasesLower',
  exerciseMuscles: '[exerciseId+muscleGroupId], exerciseId, muscleGroupId',
  exerciseVideos: 'id, exerciseId, status',
  exerciseAlternatives: '[exerciseId+alternativeId], exerciseId',
  programs: 'id, status',
  templates: 'id, programId, [programId+orderIndex]',
  templateExercises: 'id, templateId, exerciseId, [templateId+orderIndex]',
  schedules: 'id, programId',
  sessions: 'id, status, localDate, startedAt, programId, templateId',
  sessionExercises: 'id, sessionId, exerciseId, [exerciseId+status], [sessionId+orderIndex]',
  sets: 'id, sessionExerciseId, [sessionExerciseId+orderIndex], completed',
  personalRecords: 'id, exerciseId, type, [exerciseId+type], achievedAt, sessionId',
  legacyPerformance: 'id, exerciseId',
  bodyMeasurements: 'id, date',
  progressPhotos: 'id, date, pose',
  recoveryLogs: 'id, &date',
  goals: 'id, type, status',
  settings: 'id',
  backups: 'id, createdAt',
  migrations: 'id, source',
  kv: 'key',
};

export const SCHEMA_VERSIONS: SchemaVersion[] = [{ version: 1, stores: SCHEMA_V1 }];
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1].version;

/** Stores that hold user data (everything is backed up; this order is used for export/restore). */
export const DATA_STORES = Object.keys(SCHEMA_V1);

export class WeightDB extends Dexie {
  profile!: Table<T.UserProfile, string>;
  muscleGroups!: Table<T.MuscleGroup, string>;
  equipment!: Table<T.Equipment, string>;
  exercises!: Table<T.Exercise, string>;
  exerciseMuscles!: Table<T.ExerciseMuscle, [string, string]>;
  exerciseVideos!: Table<T.ExerciseVideo, string>;
  exerciseAlternatives!: Table<T.ExerciseAlternative, [string, string]>;
  programs!: Table<T.WorkoutProgram, string>;
  templates!: Table<T.WorkoutTemplate, string>;
  templateExercises!: Table<T.WorkoutTemplateExercise, string>;
  schedules!: Table<T.WorkoutSchedule, string>;
  sessions!: Table<T.WorkoutSession, string>;
  sessionExercises!: Table<T.WorkoutSessionExercise, string>;
  sets!: Table<T.WorkoutSet, string>;
  personalRecords!: Table<T.PersonalRecord, string>;
  legacyPerformance!: Table<T.LegacyPerformance, string>;
  bodyMeasurements!: Table<T.BodyMeasurement, string>;
  progressPhotos!: Table<T.ProgressPhoto, string>;
  recoveryLogs!: Table<T.RecoveryLog, string>;
  goals!: Table<T.FitnessGoal, string>;
  settings!: Table<T.AppSettings, string>;
  backups!: Table<T.BackupMetadata, string>;
  migrations!: Table<T.MigrationRecord, string>;
  kv!: Table<T.KV, string>;

  constructor(name = DB_NAME, versions: SchemaVersion[] = SCHEMA_VERSIONS) {
    super(name);
    for (const v of versions) {
      const ver = this.version(v.version).stores(v.stores);
      if (v.upgrade) ver.upgrade(v.upgrade);
    }
  }
}

/** Snapshot store: a separate database so a failed upgrade of the main DB can never take the snapshot with it. */
export class SnapshotDB extends Dexie {
  snapshots!: Table<{ id: string; createdAt: string; fromVersion: number; toVersion: number; reason: string; data: Record<string, unknown[]> }, string>;
  constructor(name = SNAPSHOT_DB_NAME) {
    super(name);
    this.version(1).stores({ snapshots: 'id, createdAt' });
  }
}
