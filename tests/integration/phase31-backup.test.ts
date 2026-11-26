/**
 * Phase 3.1 E – backup / restore validation: malformed content, invalid relationships, unsupported schema versions,
 * corrupted archives, excessive sizes, interrupted restores. Every refused backup leaves the database unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import * as B from '../../src/features/backup/backup';
import { sha256Hex } from '../../src/domain/hash';

let n = 0;
const fresh = async () => { const db = new WeightDB(`t-b31-${++n}-${Math.random()}`); await db.open(); await ensureSeed(db); return db; };
const t = '2026-11-24T00:00:00Z';

async function addSessionWith(db: WeightDB, exerciseId: string, id = 's1') {
  await db.sessions.add({ id, status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-21', notes: '', source: 'app', createdAt: t, updatedAt: t });
  await db.sessionExercises.add({ id: `${id}e`, sessionId: id, exerciseId, orderIndex: 1, status: 'completed', supersetGroup: null, notes: '', createdAt: t, updatedAt: t });
  await db.sets.add({ id: `${id}x`, sessionExerciseId: `${id}e`, orderIndex: 1, setType: 'working', weightKg: 20, inputUnit: 'kg', reps: 10, rpe: null, completed: 1, side: 'both', setTypeConfidence: 'recorded', createdAt: t, updatedAt: t });
}

/** Re-pack a backup after changing data.json / the manifest, with VALID checksums (so only the content check can refuse it). */
async function tamper(blob: Blob, edit: (data: { format: string; schemaVersion: number; stores: Record<string, Record<string, unknown>[]> }, manifest: Record<string, unknown>) => void, raw?: string) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const data = JSON.parse(await zip.file('data.json')!.async('string'));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  edit(data, manifest);
  const text = raw ?? JSON.stringify(data);
  zip.file('data.json', text);
  manifest.files['data.json'] = await sha256Hex(text);
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob' });
}

describe('E – backup validation (refused backups never change data)', () => {
  let db: WeightDB; let backup: Blob; let before: unknown[];
  beforeEach(async () => {
    db = await fresh(); await addSessionWith(db, 'barbell_bench_press');
    backup = (await B.createBackup(db, '0.1.0')).blob;
    await db.sets.update('s1x', { weightKg: 25 }); // the device has changed since
    before = await db.sets.toArray();
  });
  const refused = async (file: Blob, re: RegExp) => {
    await expect(B.inspectBackup(db, file)).rejects.toThrow(re);
    await expect(B.inspectBackup(db, file)).rejects.toBeInstanceOf(B.BackupError);
    expect(await db.sets.toArray()).toEqual(before);
  };

  it('malformed data.json (not JSON) → clear message, not a crash', async () => {
    await refused(await tamper(backup, () => undefined, '{"format": "weight-backup", "stores": {'), /data\.json is not valid JSON/);
  });
  it('data.json missing from the archive and from the manifest', async () => {
    const zip = await JSZip.loadAsync(await backup.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    delete manifest.files['data.json']; zip.remove('data.json'); zip.file('manifest.json', JSON.stringify(manifest));
    await refused(await zip.generateAsync({ type: 'blob' }), /data\.json is missing/);
  });
  it('invalid values in rows (NaN-like, text, out of range, wrong types)', async () => {
    await refused(await tamper(backup, (d) => { d.stores.sets[0].weightKg = 'heavy'; }), /sets.*weightKg/);
    await refused(await tamper(backup, (d) => { d.stores.sets[0].reps = -3; }), /sets.*reps/);
    await refused(await tamper(backup, (d) => { d.stores.sets[0].weightKg = 5000; }), /sets.*weightKg/);
    await refused(await tamper(backup, (d) => { d.stores.sessions[0].localDate = '21/11/2026'; }), /sessions.*localDate/);
    await refused(await tamper(backup, (d) => { d.stores.sessions[0].status = 'hacked'; }), /sessions.*status/);
    await refused(await tamper(backup, (d) => { (d.stores.sets as unknown[])[0] = null; }), /sets.*not a record/);
    await refused(await tamper(backup, (d) => { delete d.stores.sets[0].id; }), /sets.*id/);
  });
  it('duplicate ids', async () => {
    await refused(await tamper(backup, (d) => { d.stores.sets.push({ ...d.stores.sets[0] }); }), /duplicate id.*sets/i);
  });
  it('invalid relationships (orphans)', async () => {
    await refused(await tamper(backup, (d) => { d.stores.sets[0].sessionExerciseId = 'nope'; }), /inconsistent/);
    await refused(await tamper(backup, (d) => { d.stores.sessionExercises[0].exerciseId = 'no_such_exercise'; }), /unknown exercise/);
    await refused(await tamper(backup, (d) => { d.stores.exerciseMuscles.push({ exerciseId: 'no_such_exercise', muscleGroupId: 'chest', role: 'primary' }); }), /inconsistent/);
  });
  it('unsupported schema / format versions', async () => {
    await refused(await tamper(backup, (_d, m) => { m.schemaVersion = 99; }), /newer than this app/);
    await refused(await tamper(backup, (_d, m) => { m.schemaVersion = 0; }), /not supported/);
    await refused(await tamper(backup, (_d, m) => { m.formatVersion = 7; }), /newer version of Weight/);
    await refused(await tamper(backup, (d) => { d.schemaVersion = 99; }), /does not match the manifest|newer/);
  });
  it('corrupted archive: truncated ZIP, random bytes, empty file, wrong manifest', async () => {
    const bytes = new Uint8Array(await backup.arrayBuffer());
    await refused(new Blob([bytes.slice(0, Math.floor(bytes.length / 2))]), /not a ZIP|damaged/);
    await refused(new Blob([crypto.getRandomValues(new Uint8Array(4096))]), /not a ZIP/);
    await refused(new Blob([]), /empty|not a ZIP/);
    const zip = new JSZip(); zip.file('manifest.json', '{"format":"something-else"}');
    await refused(await zip.generateAsync({ type: 'blob' }), /manifest\.json is not valid/);
  });
  it('excessive sizes are refused before anything is unpacked', async () => {
    const huge = { size: B.LIMITS.fileBytes + 1, arrayBuffer: () => { throw new Error('must not be read'); } } as unknown as Blob;
    await refused(huge, /too large/);
    // an entry that claims to unpack to more than the limit (zip bomb guard)
    const zip = await JSZip.loadAsync(await backup.arrayBuffer());
    zip.file('photos/bomb.jpg', new Uint8Array(1024));
    const bomb = await zip.generateAsync({ type: 'blob' });
    const keep = { ...B.LIMITS };
    try {
      B.LIMITS.entryBytes = 512; // the bomb entry declares 1024 bytes unpacked
      await refused(bomb, /too large/);
      Object.assign(B.LIMITS, keep);
      const many = await tamper(backup, (d) => { d.stores.sets = Array.from({ length: 3 }, (_, i) => ({ ...d.stores.sets[0], id: `x${i}` })); });
      B.LIMITS.rows = 2;
      await refused(many, /too many records/);
    } finally { Object.assign(B.LIMITS, keep); }
  });
});

describe('E – interrupted restore', () => {
  it('a failure in the middle of the restore rolls everything back', async () => {
    const db = await fresh(); await addSessionWith(db, 'barbell_bench_press');
    const backup = (await B.createBackup(db, '0.1.0')).blob;
    await addSessionWith(db, 'plank', 's2');
    const pv = await B.inspectBackup(db, backup);
    const sessionsBefore = await db.sessions.toArray(), setsBefore = await db.sets.toArray(), exBefore = await db.exercises.count();
    const spy = vi.spyOn(db.table('sets'), 'bulkAdd').mockImplementation(() => { throw new Error('power cut'); });
    await expect(B.restoreBackup(db, pv)).rejects.toThrow();
    spy.mockRestore();
    expect(await db.sessions.toArray()).toEqual(sessionsBefore);
    expect(await db.sets.toArray()).toEqual(setsBefore);
    expect(await db.exercises.count()).toBe(exBefore);
    // and a retry succeeds
    expect((await B.restoreBackup(db, pv)).status).toBe('restored');
    expect(await db.sessions.get('s2')).toBeUndefined();
  });
  it('after a restore, start-up repair runs (stale rest timer from the backup is dropped)', async () => {
    const db = await fresh(); await addSessionWith(db, 'barbell_bench_press');
    await db.kv.put({ key: 'restTimer', value: { sessionId: 's1', exerciseName: 'x', startedAt: 1, durationSec: 90, pausedAt: null, pausedTotalMs: 0 } });
    const backup = (await B.createBackup(db, '0.1.0')).blob;
    await db.kv.delete('restTimer'); await addSessionWith(db, 'plank', 's2');
    await B.restoreBackup(db, await B.inspectBackup(db, backup));
    expect(await db.kv.get('restTimer')).toBeUndefined(); // s1 is completed – a timer for it is stale
  });
});
