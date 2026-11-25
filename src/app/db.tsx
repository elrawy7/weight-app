import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { WeightDB } from '../db/schema';
import type { AppSettings } from '../db/types';
import { defaultSettings } from '../db/defaults';
import { nowIso } from '../domain/dates';

const Ctx = createContext<WeightDB | null>(null);
export const DbProvider = ({ db, children }: { db: WeightDB; children: ReactNode }) => <Ctx.Provider value={db}>{children}</Ctx.Provider>;
export function useDb(): WeightDB {
  const db = useContext(Ctx);
  if (!db) throw new Error('DbProvider missing');
  return db;
}
export function useSettings(): AppSettings {
  const db = useDb();
  // Merge with defaults so settings added in later versions always have a value.
  const stored = useLiveQuery(() => db.settings.get('app'), [db]);
  return useMemo(() => (stored ? { ...defaultSettings(), ...stored } : defaultSettings()), [stored]);
}
export async function saveSettings(db: WeightDB, patch: Partial<AppSettings>) {
  await db.settings.update('app', { ...patch, updatedAt: nowIso() });
}
