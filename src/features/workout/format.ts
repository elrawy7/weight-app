import type { PreviousSet, WorkoutSet } from '../../db/types';
import { toDisplay, type WeightUnit } from '../../domain/units';
import { t } from '../../i18n';

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ''));

/** "50×5", "BW×12", "40 s", "W 20×10" – compact set text for previous values and history. */
export function setLabel(s: Pick<WorkoutSet, 'weightKg' | 'reps' | 'setType'> & { durationSec?: number | null }, unit: WeightUnit, withType = true): string {
  const prefix = withType && s.setType === 'warmup' ? `${t('wo.typeW')} ` : withType && s.setType === 'drop' ? `${t('wo.typeD')} ` : withType && s.setType === 'failure' ? `${t('wo.typeF')} ` : '';
  if (s.durationSec && !s.reps) return `${prefix}${t('wo.secShort', { n: s.durationSec })}${s.weightKg ? ` @${num(toDisplay(s.weightKg, unit))}` : ''}`;
  const w = s.weightKg ? num(toDisplay(s.weightKg, unit)) : t('wo.bw');
  return `${prefix}${w}×${s.reps ?? '–'}`;
}

export const prevList = (sets: PreviousSet[], unit: WeightUnit) => sets.map((s) => setLabel(s, unit, false)).join(' · ');
