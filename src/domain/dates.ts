import type { ISODate, Weekday } from '../db/types';
import { WEEKDAYS } from '../db/types';

export const nowIso = (): string => new Date().toISOString();

/** Calendar date (YYYY-MM-DD) of an instant in a given IANA time zone (BR-SES-03). */
export function localDateOf(instant: Date | string, timeZone: string): ISODate {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Session date = the local date of its START, so a workout crossing midnight stays on the start day. */
export const sessionLocalDate = (startedAt: string, timeZone: string): ISODate => localDateOf(startedAt, timeZone);

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const toUTC = (d: ISODate) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
export const fromUTC = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: ISODate, n: number): ISODate => fromUTC(toUTC(d) + n * 86400000);
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toUTC(a) - toUTC(b)) / 86400000);
export const weekdayOf = (d: ISODate): Weekday => WEEKDAYS[new Date(toUTC(d)).getUTCDay()];
export const isValidIsoDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && fromUTC(toUTC(d)) === d;

/** First day of the week containing `d`, for a week starting on `start`. */
export function weekStart(d: ISODate, start: Weekday): ISODate {
  const idx = WEEKDAYS.indexOf(weekdayOf(d));
  const s = WEEKDAYS.indexOf(start);
  return addDays(d, -((idx - s + 7) % 7));
}

export function formatDate(d: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(toUTC(d)));
}
