import { formatWeight, type WeightUnit } from '../../domain/units';
import { t } from '../../i18n';
import type { PRType } from '../../domain/records';

/** One-line text for a PR value, by type (BR-PR-02). */
/** `short`: when a label already names the type (no "est. 1RM" prefix). */
export function prText(p: { kind?: PRType; type?: string; value: number; weightKg?: number }, unit: WeightUnit, short = false): string {
  const kind = (p.kind ?? p.type) as PRType;
  switch (kind) {
    case 'max_weight': return formatWeight(p.value, unit);
    case 'e1rm': return short ? formatWeight(p.value, unit) : t('wo.e1rm', { v: formatWeight(p.value, unit) });
    case 'reps_at_weight': return t('pr.repsAt', { n: p.value, w: formatWeight(p.weightKg ?? 0, unit) });
    case 'max_reps': return t('wo.repsPr', { n: p.value });
    case 'exercise_volume': case 'session_volume': return short ? formatWeight(p.value, unit) : t('pr.volume', { v: formatWeight(p.value, unit) });
    case 'duration': return t('pr.duration', { m: Math.floor(p.value / 60), s: String(Math.round(p.value % 60)).padStart(2, '0') });
    case 'distance': return t('pr.distance', { km: Math.round(p.value / 10) / 100 });
    case 'speed': return t('pr.speed', { v: p.value });
    default: return String(p.value);
  }
}

export const PR_LABEL_KEYS: Record<PRType, 'pr.type.max_weight' | 'pr.type.reps_at_weight' | 'pr.type.max_reps' | 'pr.type.e1rm' | 'pr.type.exercise_volume' | 'pr.type.session_volume' | 'pr.type.duration' | 'pr.type.distance' | 'pr.type.speed'> = {
  max_weight: 'pr.type.max_weight', reps_at_weight: 'pr.type.reps_at_weight', max_reps: 'pr.type.max_reps', e1rm: 'pr.type.e1rm', exercise_volume: 'pr.type.exercise_volume',
  session_volume: 'pr.type.session_volume', duration: 'pr.type.duration', distance: 'pr.type.distance', speed: 'pr.type.speed',
};
