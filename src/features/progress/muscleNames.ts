import type { MuscleGroup } from '../../db/types';
import { has, t } from '../../i18n';

/** Top-level muscle groups (parents) with display names – parents like "back" or "shoulders" have no row of their own. */
export function parentName(id: string, groups: MuscleGroup[]): string {
  const k = `cat.${id}`;
  return has(k) ? t(k) : groups.find((g) => g.id === id)?.name ?? id;
}
export function parentList(groups: MuscleGroup[]): { id: string; name: string }[] {
  return [...new Set(groups.map((g) => g.parentId || g.id))].map((id) => ({ id, name: parentName(id, groups) })).sort((a, b) => a.name.localeCompare(b.name));
}
