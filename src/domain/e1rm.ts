import type { LoadMode } from '../db/types';

export const E1RM_MAX_REPS = 12;
const NO_E1RM: LoadMode[] = ['bodyweight', 'assist', 'band', 'none'];

/** Epley estimate (BR-CALC-02). Returns null where the estimate is not meaningful. */
export function epley(weightKg: number | null, reps: number | null, loadMode: LoadMode = 'total'): number | null {
  if (weightKg == null || reps == null || weightKg <= 0 || reps <= 0) return null;
  if (reps > E1RM_MAX_REPS || NO_E1RM.includes(loadMode)) return null;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/** Volume (BR-CALC): weight × reps; per-hand loads count both hands. */
export function setVolume(weightKg: number | null, reps: number | null, loadMode: LoadMode): number {
  if (weightKg == null || reps == null) return 0;
  if (NO_E1RM.includes(loadMode)) return 0;
  return weightKg * reps * (loadMode === 'per_hand' ? 2 : 1);
}

/** Muscle set counting (BR-CALC): primary 1.0, secondary 0.5. */
export const MUSCLE_WEIGHT = { primary: 1, secondary: 0.5 } as const;
