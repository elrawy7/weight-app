/** Entity types for Dexie schema v1 (docs/08-data-model.md). Canonical units: kg, m, s. Dates: ISO strings. */

export type ID = string;
export type ISODate = string; // YYYY-MM-DD (local)
export type ISOTime = string; // full ISO-8601 UTC

export type LoadMode = 'total' | 'per_hand' | 'stack' | 'bodyweight' | 'assist' | 'band' | 'none';
export type Tracking = 'weight_reps' | 'reps' | 'reps_per_side' | 'duration' | 'duration_distance' | 'rounds';
export type Mechanic = 'compound' | 'isolation' | 'cardio' | 'mobility';
export type Category =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'quadriceps' | 'hamstrings' | 'glutes'
  | 'calves' | 'abdominals' | 'cardio' | 'mobility' | 'full_body';
export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';
export const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface Stamped { createdAt: ISOTime; updatedAt: ISOTime }

/** Shape of the bundled library seed (src/seed/exercises.ts). */
export interface SeedExercise {
  id: string; name: string; nameAr: string; aliases: string[]; category: Category; mechanic: Mechanic;
  tracking: Tracking; loadMode: LoadMode; equipment: string; difficulty: 'beginner' | 'intermediate' | 'advanced';
  primary: string[]; secondary: string[]; tags?: readonly string[]; defaultRestSec: number; incrementKg: number;
  alternatives: string[]; instructions: string[]; mistakes: string[]; safety: string[];
  video?: { url: string; title: string; channel: string; verifiedAt: ISODate };
}

export interface UserProfile extends Stamped {
  id: 'me'; name: string; age?: number; ageRecordedOn?: ISODate; heightCm?: number; sex?: 'male' | 'female';
  timezone: string; weekStartsOn: Weekday; injuries: { area: string; severity: string; rules: string }[];
}
export interface MuscleGroup { id: string; name: string; nameAr: string; parentId: string; region: 'upper' | 'lower' | 'core' | 'other' }
export interface Equipment { id: string; name: string; loadMode: LoadMode; incrementKg: number; barWeightKg?: number; notes?: string }

export type ExerciseStatus = 'active' | 'unresolved' | 'archived';
export interface Exercise extends Stamped {
  id: ID; slug: string; name: string; nameAr: string; aliases: string[]; aliasesLower: string[];
  category: Category; mechanic: Mechanic; tracking: Tracking; loadMode: LoadMode; equipmentId: string;
  difficulty: SeedExercise['difficulty']; instructions: string[]; commonMistakes: string[]; safetyNotes: string[];
  tags: string[]; defaultRestSec: number; incrementKg: number; isCustom: boolean; isArchived: 0 | 1;
  status: ExerciseStatus; personalNotes: string; mergedInto?: ID;
  /** For provisional (unresolved) exercises created by the Notion import. */
  resolution?: { candidates: ID[]; notionName: string; issue: string };
}
export interface ExerciseMuscle { exerciseId: ID; muscleGroupId: string; role: 'primary' | 'secondary'; weight: number }
export type VideoStatus = 'verified' | 'unverified' | 'missing' | 'user';
export interface ExerciseVideo extends Stamped {
  id: ID; exerciseId: ID; url: string | null; title?: string; channel?: string; status: VideoStatus; verifiedAt?: ISODate; isPrimary: boolean;
}
export interface ExerciseAlternative { exerciseId: ID; alternativeId: ID; reason: string }

export interface WeekPhase { week: number; startDate: ISODate; endDate: ISODate; phase: string; rpe: string; note?: string | null }
export interface WorkoutProgram extends Stamped {
  id: ID; name: string; split: string; status: 'active' | 'archived' | 'draft'; startDate?: ISODate; endDate?: ISODate;
  weeksCount?: number; weeks: WeekPhase[]; progressionRule?: string; notes?: string; source: 'app' | 'notion_import'; notionPageId?: string;
}
export interface WarmupItem { id: string; exerciseId: ID | null; altExerciseIds: ID[]; label: string | null; prescription: string }
export interface WorkoutTemplate extends Stamped {
  id: ID; programId: ID; name: string; focus: string; orderIndex: number; weekday?: Weekday; warmup: WarmupItem[];
}
export type RowRole = 'working' | 'cardio' | 'core';
export interface WorkoutTemplateExercise extends Stamped {
  id: ID; templateId: ID; exerciseId: ID; orderIndex: number;
  targetSetsByWeek: number[]; targetReps: string; restSec: number; supersetGroup: string | null;
  notes: string; alternativeIds: ID[]; role: RowRole | string;
}
export interface PlannedSession { date: ISODate; templateId: ID; week: number; targetRpe: string; notionPageId?: string }
export interface ScheduleException { date: ISODate; templateId: ID | null; note: string }
export interface WorkoutSchedule extends Stamped {
  id: ID; programId: ID; pattern: Record<Weekday, ID | null>; startDate?: ISODate; endDate?: ISODate;
  exceptions: ScheduleException[]; planned: PlannedSession[];
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'discarded';
export interface WorkoutSession extends Stamped {
  id: ID; programId?: ID; templateId?: ID; programWeek?: number; status: SessionStatus;
  startedAt: ISOTime | null; endedAt: ISOTime | null; pausedMs: number; localDate: ISODate; durationMin?: number | null;
  notes: string; kneePain?: number | null; energy?: number | null; source: 'app' | 'notion_import'; notionPageId?: string;
  dateSource?: string;
  /** 'quick' = completed with summary only (no sets); 'full' = logged set by set (Phase 2). */
  logType?: 'quick' | 'full';
  /** Soft delete (BR-SES-07): set when discarded; restorable for 30 days. */
  discardedAt?: ISOTime | null;
  /** Session status before discard, used by restore. */
  statusBeforeDiscard?: SessionStatus;
  /** Timestamp of the last edit, used by the 6-hour rule (BR-SES-09). */
  lastActivityAt?: ISOTime | null;
  /** When the current pause started (null when running). */
  pausedAt?: ISOTime | null;
}
export type SEStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'replaced' | 'not_recorded';
export interface WorkoutSessionExercise extends Stamped {
  id: ID; sessionId: ID; exerciseId: ID; orderIndex: number; status: SEStatus; supersetGroup: string | null;
  snapshot?: {
    targetSets?: number; targetReps?: string; restSec?: number; templateExerciseId?: ID; role?: string; templateNotes?: string;
    /** BR-PP-05: previous performance frozen when the exercise was added to the session. */
    previous?: PreviousPerformance | null;
  };
  cardio?: { durationMin?: number; durationSource?: string; distanceM?: number; inclinePct?: number; speedKmh?: number; rounds?: number; roundMin?: number };
  notes: string;
  /** WO-14 knee/area pain after the exercise (0–10). */
  painScore?: number | null;
  replacedById?: ID | null;
}
export interface PreviousSet { weightKg: number | null; reps: number | null; setType: SetType; durationSec?: number | null; rpe?: number | null }
export interface PreviousPerformance { sessionId: ID; localDate: ISODate; sets: PreviousSet[]; warmups: PreviousSet[]; painScore: number | null; templateName?: string;
  /** The session before that one (for BR-PO-06 "below range twice"). */
  olderSets?: PreviousSet[] }
export type SetType = 'warmup' | 'working' | 'drop' | 'failure';
export interface WorkoutSet extends Stamped {
  id: ID; sessionExerciseId: ID; orderIndex: number; setType: SetType; weightKg: number | null; inputUnit: 'kg' | 'lb';
  reps: number | null; durationSec?: number | null; distanceM?: number | null; rpe: number | null; completed: 0 | 1;
  completedAt?: ISOTime | null; side: 'both' | 'left' | 'right'; setTypeConfidence: 'recorded' | 'assumed'; rawCell?: string;
}
export interface PersonalRecord { id: ID; exerciseId: ID; type: string; value: number; unit: string; loadMode: LoadMode; setId?: ID; sessionId: ID; achievedAt: ISOTime }
export interface LegacyPerformance { id: ID; exerciseId: ID; sourceTemplate: string; weightsBySet: number[]; targetText: string; dateHint: string }
export interface BodyMeasurement extends Stamped {
  id: ID; date: ISODate; weightKg?: number | null; waistCm?: number | null; notes: string; source: string; dateConfidence?: 'exact' | 'inferred';
}
export interface ProgressPhoto { id: ID; date: ISODate; pose: 'front' | 'side' | 'back'; blob: Blob; thumbBlob?: Blob; width: number; height: number; notes: string }
export interface RecoveryLog { id: ID; date: ISODate; [k: string]: unknown }
export interface FitnessGoal extends Stamped {
  id: ID; type: string; target?: number; unit: string; startValue?: number; startDate?: ISODate; status: 'active' | 'reference' | 'done';
  details?: Record<string, unknown>; source?: string;
}

export type ThemePref = 'system' | 'dark' | 'light';
export interface AppSettings extends Stamped {
  id: 'app'; theme: ThemePref; weightUnit: 'kg' | 'lb'; distanceUnit: 'km' | 'mi'; weekStartsOn: Weekday;
  defaultRestSec: number; sound: boolean; spokenCues: boolean; keepAwake: boolean; showRpe: boolean;
  backupReminderDays: number; lastBackupAt: ISOTime | null; persistGranted: boolean | null; persistCheckedAt: ISOTime | null;
  installGuideSeen: boolean; plateSetKg: number[]; barbellKg: number; smithBarKg: number | null; ezBarKg: number;
  /** Per-equipment or per-exercise increment overrides (kg). Keys: `eq:<equipmentId>` or `ex:<exerciseId>`. */
  incrementOverrides: Record<string, number>;
}
export interface BackupMetadata { id: ID; createdAt: ISOTime; appVersion: string; schemaVersion: number; counts: Record<string, number>; sha256: string; includesPhotos: boolean; kind: 'manual' | 'auto_snapshot' | 'pre_restore'; fileName?: string }
export interface MigrationDecision { provisionalId: ID; mappedTo: ID | null; decidedAt: ISOTime; affectedSets: number; affectedRows: number }
export interface MigrationRecord {
  id: ID; source: string; sourceHash: string; importedAt: ISOTime; fileName: string; counts: Record<string, number>;
  decisions: MigrationDecision[]; excluded: { item: string; reason: string; notionPageId?: string }[];
  issues: { id: string; type: string; description: string; [k: string]: unknown }[];
  notionPageIds: { label: string; id: string }[];
  unresolved: { provisionalId: ID; notionName: string; candidates: ID[]; logged: { date: ISODate; sets: string[] }[]; usedInTemplates: string[] }[];
}
export interface KV { key: string; value: unknown }
