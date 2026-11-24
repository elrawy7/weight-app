import type { LoadMode } from '../db/types';

/** Round a load to the nearest available increment (BR-CALC-04 / BR-PO-10). */
export function roundToIncrement(value: number, increment: number, mode: 'nearest' | 'down' | 'up' = 'nearest'): number {
  if (!increment || increment <= 0) return value;
  const q = value / increment;
  const r = mode === 'down' ? Math.floor(q + 1e-9) : mode === 'up' ? Math.ceil(q - 1e-9) : Math.round(q);
  return Math.round(r * increment * 1000) / 1000;
}

/** Stepper +/−: moves by exactly one increment from the current value, never below 0. */
export function step(value: number, increment: number, dir: 1 | -1): number {
  const next = Math.round((value + dir * increment) * 1000) / 1000;
  return Math.max(0, next);
}

/** Increment resolution order: per-exercise override → per-equipment override → exercise default. */
export function resolveIncrement(ex: { id: string; equipmentId: string; incrementKg: number }, overrides: Record<string, number>): number {
  return overrides[`ex:${ex.id}`] ?? overrides[`eq:${ex.equipmentId}`] ?? ex.incrementKg;
}

/** Loads with different load modes are never compared (BR-CALC). */
export const comparable = (a: LoadMode, b: LoadMode): boolean => a === b;
