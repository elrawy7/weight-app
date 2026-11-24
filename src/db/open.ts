/**
 * Opening the database safely (FND-03, BAK-05, PWA-03 AC3, BR-DATA-05):
 *  1. Read the on-disk version without upgrading.
 *  2. If an upgrade is pending, export every store to the separate snapshot DB first.
 *  3. Open with the current schema. If the upgrade throws, IndexedDB aborts the version-change transaction,
 *     so the DB stays at the old version, and the caller shows the recovery screen.
 */
import Dexie from 'dexie';
import { WeightDB, SnapshotDB, DB_NAME, SNAPSHOT_DB_NAME, SCHEMA_VERSIONS, type SchemaVersion } from './schema';
import { nowIso } from '../domain/dates';

export type OpenResult =
  | { ok: true; db: WeightDB; upgradedFrom: number | null; snapshotId: string | null }
  | { ok: false; error: Error; onDiskVersion: number; snapshotId: string | null };

/** Version currently stored on disk (0 = no database). Dexie reports version ×10 for native versions; it normalises it. */
export async function onDiskVersion(name = DB_NAME): Promise<number> {
  if (!(await Dexie.exists(name))) return 0;
  const probe = new Dexie(name);
  try {
    await probe.open(); // dynamic mode – opens the existing schema without changes
    return probe.verno;
  } finally {
    probe.close();
  }
}

/** Raw export of every store of an existing database, schema-agnostic. */
export async function exportRaw(name = DB_NAME): Promise<{ version: number; data: Record<string, unknown[]> }> {
  const probe = new Dexie(name);
  await probe.open();
  try {
    const data: Record<string, unknown[]> = {};
    for (const t of probe.tables) data[t.name] = await t.toArray();
    return { version: probe.verno, data };
  } finally {
    probe.close();
  }
}

export async function takeSnapshot(reason: string, toVersion: number, name = DB_NAME, snapName = SNAPSHOT_DB_NAME): Promise<string> {
  const raw = await exportRaw(name);
  const snap = new SnapshotDB(snapName);
  const id = `snap_${Date.now()}`;
  try {
    await snap.snapshots.put({ id, createdAt: nowIso(), fromVersion: raw.version, toVersion, reason, data: raw.data });
    // keep the 3 most recent snapshots
    const all = await snap.snapshots.orderBy('createdAt').reverse().primaryKeys();
    if (all.length > 3) await snap.snapshots.bulkDelete(all.slice(3));
  } finally {
    snap.close();
  }
  return id;
}

export async function latestSnapshot(snapName = SNAPSHOT_DB_NAME) {
  if (!(await Dexie.exists(snapName))) return null;
  const snap = new SnapshotDB(snapName);
  try {
    return (await snap.snapshots.orderBy('createdAt').last()) ?? null;
  } finally {
    snap.close();
  }
}

/**
 * Restore the latest snapshot: recreate the main DB at the snapshot's original version and write the data back.
 * The original schema of that version is taken from SCHEMA_VERSIONS (or the test-provided list).
 */
export async function restoreLatestSnapshot(name = DB_NAME, snapName = SNAPSHOT_DB_NAME, versions: SchemaVersion[] = SCHEMA_VERSIONS): Promise<number> {
  const snap = await latestSnapshot(snapName);
  if (!snap) throw new Error('No snapshot available');
  await Dexie.delete(name);
  const keep = versions.filter((v) => v.version <= snap.fromVersion).map((v) => ({ ...v, upgrade: undefined }));
  const db = new WeightDB(name, keep);
  await db.open();
  let n = 0;
  try {
    await db.transaction('rw', db.tables, async () => {
      for (const [store, rows] of Object.entries(snap.data)) {
        const t = db.tables.find((x) => x.name === store);
        if (t && rows.length) {
          await t.bulkPut(rows as never[]);
          n += rows.length;
        }
      }
    });
  } finally {
    db.close();
  }
  return n;
}

export async function openDatabase(name = DB_NAME, versions: SchemaVersion[] = SCHEMA_VERSIONS, snapName = SNAPSHOT_DB_NAME): Promise<OpenResult> {
  const target = versions[versions.length - 1].version;
  const disk = await onDiskVersion(name);
  let snapshotId: string | null = null;
  if (disk > 0 && disk < target) {
    snapshotId = await takeSnapshot(`schema upgrade v${disk} → v${target}`, target, name, snapName);
  }
  const db = new WeightDB(name, versions);
  try {
    await db.open();
    return { ok: true, db, upgradedFrom: disk > 0 && disk < target ? disk : null, snapshotId };
  } catch (e) {
    db.close();
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)), onDiskVersion: disk, snapshotId };
  }
}
