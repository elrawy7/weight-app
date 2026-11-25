import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from './db';
import { deviceTimeZone, localDateOf } from '../domain/dates';

/** Today's local date in the profile's time zone (falls back to the device's). */
export function useToday(): string {
  const db = useDb();
  const tz = useLiveQuery(async () => (await db.profile.get('me'))?.timezone, [db]) ?? deviceTimeZone();
  return localDateOf(new Date(), tz);
}
