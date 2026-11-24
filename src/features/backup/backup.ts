/**
 * Backup & restore (BAK-01, BAK-02, BR-BAK-01…05).
 * ZIP layout: manifest.json · data.json · photos/<id>.<ext> · csv/{sessions,sets,body}.csv
 */
import type JSZipT from 'jszip';
import { z } from 'zod';
import type { WeightDB } from '../../db/schema';
import { CURRENT_SCHEMA_VERSION, DATA_STORES } from '../../db/schema';
import { takeSnapshot } from '../../db/open';
import { sha256Hex, canonicalJson } from '../../domain/hash';
import { nowIso } from '../../domain/dates';
import { uuidv7 } from '../../domain/uuid';

/** JSZip is loaded on demand so it is not part of the initial bundle (NFR-PERF-05). */
const loadZip = async () => (await import('jszip')).default;

export const BACKUP_FORMAT = 'weight-backup';
export const BACKUP_FORMAT_VERSION = 1;
export class BackupError extends Error {}

const ManifestZ = z.object({
  format: z.literal(BACKUP_FORMAT), formatVersion: z.number().int(), schemaVersion: z.number().int(), appVersion: z.string(), createdAt: z.string(),
  counts: z.record(z.string(), z.number()), files: z.record(z.string(), z.string().length(64)), dataSha256: z.string().length(64),
});
export type Manifest = z.infer<typeof ManifestZ>;

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (header: string[], rows: unknown[][]) => [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';

async function collect(db: WeightDB) {
  const data: Record<string, unknown[]> = {};
  const photos: { path: string; blob: Blob }[] = [];
  for (const name of DATA_STORES) {
    const rows = await db.table(name).toArray();
    if (name === 'progressPhotos') {
      data[name] = rows.map((r: Record<string, unknown>) => {
        const { blob, thumbBlob, ...rest } = r as { blob?: Blob; thumbBlob?: Blob } & Record<string, unknown>;
        const ext = blob?.type === 'image/png' ? 'png' : 'jpg';
        if (blob) photos.push({ path: `photos/${rest.id}.${ext}`, blob });
        if (thumbBlob) photos.push({ path: `photos/${rest.id}.thumb.jpg`, blob: thumbBlob });
        return { ...rest, blobPath: blob ? `photos/${rest.id}.${ext}` : null, thumbPath: thumbBlob ? `photos/${rest.id}.thumb.jpg` : null, blobType: blob?.type ?? null };
      });
    } else if (name === 'backups') {
      data[name] = rows; // history of backups is kept
    } else data[name] = rows;
  }
  return { data, photos };
}

export interface BackupResult { blob: Blob; fileName: string; manifest: Manifest }

export async function createBackup(db: WeightDB, appVersion: string, now = new Date()): Promise<BackupResult> {
  const { data, photos } = await collect(db);
  const JSZip = await loadZip();
  const zip = new JSZip();
  const dataJson = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: CURRENT_SCHEMA_VERSION, stores: data });
  const files: Record<string, string> = { 'data.json': await sha256Hex(dataJson) };
  zip.file('data.json', dataJson);
  for (const p of photos) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    files[p.path] = await sha256Hex(bytes);
    zip.file(p.path, bytes);
  }
  // convenience CSVs (not used for restore)
  const ex = new Map((data.exercises as { id: string; name: string }[]).map((e) => [e.id, e.name]));
  const sessions = data.sessions as { id: string; localDate: string; templateId?: string; status: string; durationMin?: number | null; source: string }[];
  const ses = data.sessionExercises as { id: string; sessionId: string; exerciseId: string }[];
  const seMap = new Map(ses.map((s) => [s.id, s]));
  const sesDate = new Map(sessions.map((s) => [s.id, s.localDate]));
  const csvFiles: Record<string, string> = {
    'csv/sessions.csv': csv(['id', 'date', 'template', 'status', 'duration_min', 'source'], sessions.map((s) => [s.id, s.localDate, s.templateId ?? '', s.status, s.durationMin ?? '', s.source])),
    'csv/sets.csv': csv(['date', 'exercise', 'set', 'type', 'weight_kg', 'reps', 'rpe', 'completed'], (data.sets as { sessionExerciseId: string; orderIndex: number; setType: string; weightKg: number | null; reps: number | null; rpe: number | null; completed: number }[])
      .map((x) => { const se = seMap.get(x.sessionExerciseId); return [se ? sesDate.get(se.sessionId) ?? '' : '', se ? ex.get(se.exerciseId) ?? se.exerciseId : '', x.orderIndex, x.setType, x.weightKg ?? '', x.reps ?? '', x.rpe ?? '', x.completed ? 1 : 0]; })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    'csv/body.csv': csv(['date', 'weight_kg', 'waist_cm', 'source'], (data.bodyMeasurements as { date: string; weightKg?: number | null; waistCm?: number | null; source: string }[]).map((b) => [b.date, b.weightKg ?? '', b.waistCm ?? '', b.source])),
  };
  for (const [p, c] of Object.entries(csvFiles)) { zip.file(p, c); files[p] = await sha256Hex(c); }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  const manifest: Manifest = {
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION, appVersion, createdAt: now.toISOString(), counts, files,
    dataSha256: await sha256Hex(canonicalJson(stripVolatile(data))),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 1));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const fileName = `weight-backup-${stamp}.zip`;
  return { blob, fileName, manifest };
}

/** Content fingerprint that ignores bookkeeping stores, so "same data" is detected across backups (BAK-02 AC3). */
function stripVolatile(data: Record<string, unknown[]>) {
  const { backups: _b, kv, settings, ...rest } = data;
  const kvStable = (kv as { key: string }[] | undefined)?.filter((k) => !['lastRestoreHash'].includes(k.key)) ?? [];
  const settingsStable = (settings as Record<string, unknown>[] | undefined)?.map(({ lastBackupAt: _l, persistCheckedAt: _p, persistGranted: _g, updatedAt: _u, ...s }) => s) ?? [];
  return { ...rest, kv: kvStable, settings: settingsStable };
}

/** Record a finished backup (after the user shared/saved it). */
export async function recordBackup(db: WeightDB, r: BackupResult): Promise<void> {
  const t = nowIso();
  await db.transaction('rw', [db.backups, db.settings], async () => {
    await db.backups.add({ id: uuidv7(), createdAt: t, appVersion: r.manifest.appVersion, schemaVersion: r.manifest.schemaVersion, counts: r.manifest.counts, sha256: r.manifest.dataSha256, includesPhotos: Object.keys(r.manifest.files).some((f) => f.startsWith('photos/')), kind: 'manual', fileName: r.fileName });
    await db.settings.update('app', { lastBackupAt: t, updatedAt: t });
  });
}

export interface RestorePreview {
  manifest: Manifest; counts: Record<string, number>; identicalToCurrent: boolean; data: Record<string, unknown[]>; photos: Map<string, Blob>;
}

/** Validate everything before touching the database (BAK-02 AC1). */
export async function inspectBackup(db: WeightDB, file: Blob): Promise<RestorePreview> {
  let zip: JSZipT;
  const JSZip = await loadZip();
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new BackupError('This is not a ZIP file.'); }
  const mf = zip.file('manifest.json');
  if (!mf) throw new BackupError('manifest.json is missing – not a Weight backup.');
  let manifest: Manifest;
  try { manifest = ManifestZ.parse(JSON.parse(await mf.async('string'))); } catch { throw new BackupError('manifest.json is not valid.'); }
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) throw new BackupError('This backup was made by a newer version of Weight. Update the app first.');
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) throw new BackupError(`Backup schema v${manifest.schemaVersion} is newer than this app (v${CURRENT_SCHEMA_VERSION}).`);
  const photos = new Map<string, Blob>();
  for (const [path, hash] of Object.entries(manifest.files)) {
    const f = zip.file(path);
    if (!f) throw new BackupError(`File listed in the manifest is missing: ${path}`);
    const bytes = await f.async('uint8array');
    const h = path.endsWith('.json') || path.endsWith('.csv') ? await sha256Hex(new TextDecoder().decode(bytes)) : await sha256Hex(bytes);
    if (h !== hash) throw new BackupError(`Checksum mismatch in ${path} – the backup is damaged. Nothing was changed.`);
    if (path.startsWith('photos/')) photos.set(path, new Blob([bytes], { type: path.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
  }
  const parsed = JSON.parse(await zip.file('data.json')!.async('string')) as { format: string; stores: Record<string, unknown[]> };
  if (parsed.format !== BACKUP_FORMAT || typeof parsed.stores !== 'object') throw new BackupError('data.json is not a Weight backup.');
  for (const s of Object.keys(parsed.stores)) if (!DATA_STORES.includes(s)) throw new BackupError(`Unknown store in backup: ${s}`);
  for (const s of DATA_STORES) if (!Array.isArray(parsed.stores[s] ?? [])) throw new BackupError(`Store ${s} is not a list.`);
  checkIntegrity(parsed.stores);
  const current = await collect(db);
  const identical = (await sha256Hex(canonicalJson(stripVolatile(current.data)))) === manifest.dataSha256;
  return { manifest, counts: Object.fromEntries(DATA_STORES.map((s) => [s, (parsed.stores[s] ?? []).length])), identicalToCurrent: identical, data: parsed.stores, photos };
}

/** Referential integrity (BR-BAK-02). */
export function checkIntegrity(st: Record<string, unknown[]>): void {
  const ids = (s: string) => new Set(((st[s] ?? []) as { id: string }[]).map((r) => r.id));
  const ex = ids('exercises'), ses = ids('sessions'), se = ids('sessionExercises'), tp = ids('templates'), pr = ids('programs');
  const bad = (msg: string) => { throw new BackupError(`Backup is inconsistent: ${msg}`); };
  for (const r of (st.sets ?? []) as { id: string; sessionExerciseId: string }[]) if (!se.has(r.sessionExerciseId)) bad(`set ${r.id} has no exercise entry`);
  for (const r of (st.sessionExercises ?? []) as { id: string; sessionId: string; exerciseId: string }[]) { if (!ses.has(r.sessionId)) bad(`entry ${r.id} has no session`); if (!ex.has(r.exerciseId)) bad(`entry ${r.id} references unknown exercise ${r.exerciseId}`); }
  for (const r of (st.templateExercises ?? []) as { id: string; templateId: string; exerciseId: string }[]) { if (!tp.has(r.templateId)) bad(`row ${r.id} has no template`); if (!ex.has(r.exerciseId)) bad(`row ${r.id} references unknown exercise ${r.exerciseId}`); }
  for (const r of (st.templates ?? []) as { id: string; programId: string }[]) if (!pr.has(r.programId)) bad(`template ${r.id} has no program`);
}

/**
 * Atomic restore (BAK-02 AC2): snapshot → clear all stores → write the backup, in ONE transaction.
 * If the content is identical to what is already on the device, nothing is written (AC3).
 */
export async function restoreBackup(db: WeightDB, pv: RestorePreview): Promise<{ status: 'restored' | 'identical'; records: number; snapshotId: string | null }> {
  if (pv.identicalToCurrent) return { status: 'identical', records: 0, snapshotId: null };
  const snapshotId = await takeSnapshot('before restore', CURRENT_SCHEMA_VERSION, db.name);
  let records = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    for (const s of DATA_STORES) {
      let rows = (pv.data[s] ?? []) as Record<string, unknown>[];
      if (s === 'progressPhotos') {
        rows = rows.map(({ blobPath, thumbPath, blobType: _bt, ...r }) => ({ ...r, blob: pv.photos.get(blobPath as string), ...(thumbPath ? { thumbBlob: pv.photos.get(thumbPath as string) } : {}) }));
      }
      if (rows.length) await db.table(s).bulkAdd(rows);
      records += rows.length;
    }
    await db.kv.put({ key: 'lastRestoreHash', value: pv.manifest.dataSha256 });
  });
  return { status: 'restored', records, snapshotId };
}

/** iOS share sheet when available (BAK-01 AC1), download otherwise. */
export async function deliverFile(blob: Blob, fileName: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: fileName }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}
/** DASH-06 / BAK-03: warn when there is data and no backup for ≥ N days (or never). */
export function backupState(lastBackupAt: string | null, reminderDays: number, hasData: boolean, now = new Date()): 'ok' | 'due' | 'never' {
  if (!hasData) return 'ok';
  const d = daysSince(lastBackupAt, now);
  if (d === null) return 'never';
  return d >= reminderDays ? 'due' : 'ok';
}
