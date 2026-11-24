import type { WeightDB } from '../../db/schema';
import { nowIso } from '../../domain/dates';

export interface StorageStatus { persisted: boolean | null; usage: number | null; quota: number | null; supported: boolean }

/** PWA-04: request persistent storage once and remember the result. */
export async function requestPersistence(db: WeightDB, force = false): Promise<boolean | null> {
  const st = navigator.storage;
  if (!st?.persist) return null;
  const s = await db.settings.get('app');
  if (!force && s?.persistGranted === true) return true;
  let granted: boolean;
  try { granted = (await st.persisted?.()) || (await st.persist()); } catch { granted = false; }
  await db.settings.update('app', { persistGranted: granted, persistCheckedAt: nowIso() });
  return granted;
}

export async function storageStatus(): Promise<StorageStatus> {
  const st = navigator.storage;
  if (!st) return { persisted: null, usage: null, quota: null, supported: false };
  const persisted = st.persisted ? await st.persisted().catch(() => null) : null;
  const est = st.estimate ? await st.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null, supported: true };
}

export function formatBytes(n: number | null): string {
  if (n === null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
