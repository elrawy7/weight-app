import type { AppSettings, Equipment, LoadMode } from './types';
import type { WeightDB } from './schema';
import { nowIso } from '../domain/dates';
import { expansionEquipment } from '../seed/expansion';

/** Typical commercial gym rack, per hand: 1 kg steps to 10 kg, then 2.5 kg steps to 50 kg. Editable in Settings. */
export const DEFAULT_DUMBBELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50];

export function defaultSettings(): AppSettings {
  const t = nowIso();
  return {
    id: 'app', theme: 'dark', weightUnit: 'kg', distanceUnit: 'km', weekStartsOn: 'SUN', defaultRestSec: 90,
    sound: true, spokenCues: true, keepAwake: true, showRpe: false, backupReminderDays: 7, lastBackupAt: null,
    persistGranted: null, persistCheckedAt: null, installGuideSeen: false,
    plateSetKg: [25, 20, 15, 10, 5, 2.5, 1.25], barbellKg: 20, smithBarKg: null, ezBarKg: 10,
    incrementOverrides: {},
    secondaryMuscleWeight: 0.5, minWeeklySets: 8, defaultStrategy: 'double_progression', incrementSteps: 1, e1rmFormula: 'epley', deloadPct: 10, deloadSets: 1,
    dumbbellsKg: DEFAULT_DUMBBELLS, workoutDensity: 'compact', createdAt: t, updatedAt: t,
  };
}

/** Generic gym defaults – editable in Settings → Equipment (SET-02). */
export const EQUIPMENT: [id: string, name: string, loadMode: LoadMode, incrementKg: number, barWeightKg?: number][] = [
  ['barbell', 'Barbell', 'total', 2.5, 20],
  ['ez_bar', 'EZ bar', 'total', 2.5, 10],
  ['smith_machine', 'Smith machine', 'total', 2.5],
  ['dumbbell', 'Dumbbells', 'per_hand', 2],
  ['machine', 'Selectorised / plate machine', 'stack', 5],
  ['cable_machine', 'Lat pulldown station', 'stack', 5],
  ['cable', 'Cable pulley', 'stack', 2.5],
  ['bench', 'Bench / back-extension', 'bodyweight', 2.5],
  ['band', 'Resistance band', 'band', 0],
  ['bodyweight', 'Bodyweight', 'bodyweight', 0],
  ['kettlebell', 'Kettlebell', 'total', 4],
  ['treadmill', 'Treadmill', 'none', 0],
  ['bike', 'Stationary bike', 'none', 0],
  ['rower', 'Rowing machine', 'none', 0],
  ['elliptical', 'Elliptical', 'none', 0],
  ['pool', 'Pool', 'none', 0],
  ['bag', 'Boxing bag / pads', 'none', 0],
  ['none', 'No equipment', 'none', 0],
  ...expansionEquipment,
];

export const equipmentRows = (): Equipment[] =>
  EQUIPMENT.map(([id, name, loadMode, incrementKg, barWeightKg]) => ({ id, name, loadMode, incrementKg, ...(barWeightKg ? { barWeightKg } : {}) }));

/** Settings with defaults for fields added in later versions (for non-React code). */
export async function getSettings(db: WeightDB): Promise<AppSettings> {
  const s = await db.settings.get('app');
  return { ...defaultSettings(), ...(s ?? {}) };
}
