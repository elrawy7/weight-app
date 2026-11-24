import { formatDate, isValidIsoDate } from '../../domain/dates';
import { t } from '../../i18n';

/** Human text for schedule notes written by a plan shift (stored in English data form). */
export function restNote(note: string | undefined | null): string | undefined {
  if (!note) return undefined;
  const moved = note.match(/^Moved to (\d{4}-\d{2}-\d{2})$/);
  if (moved && isValidIsoDate(moved[1])) return t('plan.movedTo', { date: formatDate(moved[1]) });
  if (note === 'Free after plan shift') return t('plan.freed');
  return note;
}
