export const KG_PER_LB = 0.45359237;
export type WeightUnit = 'kg' | 'lb';

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

/** Round for display only (stored values are never changed – SET-01 AC1). */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

export function toDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? round1(kg) : round1(kgToLb(kg));
}
export function fromDisplay(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : lbToKg(value);
}
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return '–';
  const v = toDisplay(kg, unit);
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} ${unit}`;
}
