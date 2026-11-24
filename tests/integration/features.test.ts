import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { WeightDB } from '../../src/db/schema';
import { ensureSeed } from '../../src/db/seed';
import * as L from '../../src/features/library/libraryOps';
import * as P from '../../src/features/programs/programOps';
import * as B from '../../src/features/backup/backup';
import { latestSnapshot } from '../../src/db/open';
import { SNAPSHOT_DB_NAME } from '../../src/db/schema';
import * as R from '../../src/db/repos';

let n = 0;
const fresh = async () => { const db = new WeightDB(`t-f-${++n}-${Math.random()}`); await db.open(); await ensureSeed(db); return db; };
const t = '2026-11-24T00:00:00Z';

async function addSessionWith(db: WeightDB, exerciseId: string, id = 's1') {
  await db.sessions.add({ id, status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-21', notes: '', source: 'app', createdAt: t, updatedAt: t });
  await db.sessionExercises.add({ id: `${id}e`, sessionId: id, exerciseId, orderIndex: 1, status: 'completed', supersetGroup: null, notes: '', createdAt: t, updatedAt: t });
  await db.sets.add({ id: `${id}x`, sessionExerciseId: `${id}e`, orderIndex: 1, setType: 'working', weightKg: 20, inputUnit: 'kg', reps: 10, rpe: null, completed: 1, side: 'both', setTypeConfidence: 'recorded', createdAt: t, updatedAt: t });
}

describe('LIB-02 search & filter', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); });
  it('AC1: "pushdown" finds Cable Rope Triceps Pushdown – also by alias and Arabic', async () => {
    const ids = async (q: string) => (await L.searchExercises(db, { q })).map((e) => e.id);
    expect(await ids('pushdown')).toContain('cable_rope_pushdown');
    expect(await ids('rope pressdown')).toContain('cable_rope_pushdown');
    expect(await ids('الترايسبس')).toContain('cable_rope_pushdown');
    expect(await ids('triceps')).toContain('cable_rope_pushdown'); // by muscle
  });
  it('AC2: category = back AND equipment = cable', async () => {
    const r = await L.searchExercises(db, { category: 'back', equipment: 'cable' });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.category === 'back' && e.equipmentId === 'cable')).toBe(true);
  });
  it('muscle filter rolls sub-groups up to their parent', async () => {
    const r = await L.searchExercises(db, { muscle: 'chest' });
    expect(r.map((e) => e.id)).toContain('incline_db_press'); // primary = upper_chest
  });
});

describe('LIB-07 custom, rename, merge, archive', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); });
  it('custom exercise gets a UUID v7 id and duplicate name+equipment is refused', async () => {
    const e = await L.createCustomExercise(db, { name: 'Viking Press', category: 'shoulders', mechanic: 'compound', tracking: 'weight_reps', loadMode: 'total', equipmentId: 'barbell', primary: ['front_delts'], secondary: ['triceps'], defaultRestSec: 90, incrementKg: 2.5 });
    expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(e.isCustom).toBe(true);
    await expect(L.createCustomExercise(db, { name: 'viking press', category: 'shoulders', mechanic: 'compound', tracking: 'weight_reps', loadMode: 'total', equipmentId: 'barbell', primary: ['front_delts'], secondary: [], defaultRestSec: 90, incrementKg: 2.5 })).rejects.toThrow(/already exists/);
    // same name, different equipment is allowed (BR-EX-02)
    await expect(L.createCustomExercise(db, { name: 'Viking Press', category: 'shoulders', mechanic: 'compound', tracking: 'weight_reps', loadMode: 'stack', equipmentId: 'machine', primary: ['front_delts'], secondary: [], defaultRestSec: 90, incrementKg: 5 })).resolves.toBeTruthy();
  });
  it('AC1: rename keeps history under the same id; old name still searchable', async () => {
    await addSessionWith(db, 'cable_crunch');
    await L.renameExercise(db, 'cable_crunch', 'Kneeling Rope Crunch');
    expect((await db.exercises.get('cable_crunch'))!.name).toBe('Kneeling Rope Crunch');
    expect(await db.sessionExercises.where('exerciseId').equals('cable_crunch').count()).toBe(1);
    expect((await L.searchExercises(db, { q: 'cable crunch' })).map((e) => e.id)).toContain('cable_crunch');
  });
  it('AC2: merge moves all history + rows in one transaction and keeps the alias', async () => {
    const dup = await L.createCustomExercise(db, { name: 'Rope Pushdown (my gym)', category: 'triceps', mechanic: 'isolation', tracking: 'weight_reps', loadMode: 'stack', equipmentId: 'cable', primary: ['triceps'], secondary: [], defaultRestSec: 60, incrementKg: 2.5 });
    await addSessionWith(db, dup.id);
    const r = await L.mergeExercises(db, dup.id, 'cable_rope_pushdown');
    expect(r.movedSessionExercises).toBe(1);
    expect(await db.sessionExercises.where('exerciseId').equals(dup.id).count()).toBe(0);
    expect((await db.exercises.get('cable_rope_pushdown'))!.aliases).toContain('Rope Pushdown (my gym)');
    expect((await db.exercises.get(dup.id))!.isArchived).toBe(1);
    await expect(L.mergeExercises(db, 'db_hammer_curl', 'ez_bar_curl')).rejects.toThrow(/load modes/);
  });
  it('AC3: load-mode change with history requires a new exercise', async () => {
    await addSessionWith(db, 'db_lateral_raise');
    expect(await L.changeEquipment(db, 'db_lateral_raise', 'cable', 'stack')).toBe('requires_new');
    expect(await L.changeEquipment(db, 'cable_lateral_raise', 'cable', 'stack')).toBe('updated');
  });
  it('archive hides from default search', async () => {
    await L.setArchived(db, 'plank', true);
    expect((await L.searchExercises(db, { q: 'plank' })).map((e) => e.id)).not.toContain('plank');
    expect((await L.searchExercises(db, { q: 'plank', includeArchived: true })).map((e) => e.id)).toContain('plank');
  });
});

describe('LIB-05 / LIB-08', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); });
  it('LIB-05 AC2: user link validated, stored as user, replaceable, removable', async () => {
    await expect(L.setUserVideo(db, 'plank', 'https://example.com/v')).rejects.toThrow(/not a YouTube/);
    const v = await L.setUserVideo(db, 'plank', 'https://youtu.be/AAAAAAAAAAA');
    expect(v).toMatchObject({ status: 'user', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' });
    await L.setUserVideo(db, 'plank', 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
    expect((await db.exerciseVideos.where('exerciseId').equals('plank').toArray()).length).toBe(1);
    const r = await L.setUserVideo(db, 'plank', null);
    expect(r).toMatchObject({ status: 'missing', url: null });
  });
  it('LIB-08 AC1: Goblet Box Squat → Leg Press marked knee-friendly', async () => {
    const alts = await L.alternativesFor(db, 'goblet_box_squat');
    expect(alts.find((a) => a.exercise.id === 'leg_press')).toMatchObject({ reason: 'knee_friendly', defined: true });
  });
  it('LIB-08 AC2: no defined alternatives → same primary muscle + mechanic', async () => {
    const alts = await L.alternativesFor(db, 'hip_adduction_machine');
    expect(alts.length).toBe(0); // only exercise with primary adductors + isolation
    const alts2 = await L.alternativesFor(db, 'side_plank');
    expect(alts2.map((a) => a.exercise.id)).toContain('pallof_press'); // obliques, isolation
    expect(alts2.every((a) => !a.defined)).toBe(true);
  });
});

describe('PROG-01 / PROG-02 / PROG-03 / PROG-05', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); });
  it('create, add rows, edit, reorder, replace, remove; validation', async () => {
    const p = await P.createProgram(db, 'Test');
    const tp = await P.addTemplate(db, p.id, 'Day A');
    const a = await P.addRow(db, tp.id, 'barbell_bench_press');
    const b = await P.addRow(db, tp.id, 'lat_pulldown_wide');
    const c = await P.addRow(db, tp.id, 'plank');
    expect(c.targetReps).toBe('30-45 s');
    await P.updateRow(db, a.id, { targetSetsByWeek: [3, 4, 4, 4], targetReps: '6-8', restSec: 120, supersetGroup: 'A', notes: 'n' });
    await expect(P.updateRow(db, a.id, { supersetGroup: 'AB' })).rejects.toThrow();
    await expect(P.updateRow(db, a.id, { targetSetsByWeek: [3.5] })).rejects.toThrow();
    await P.reorderRows(db, tp.id, [c.id, a.id, b.id]);
    expect((await R.rowsOfTemplate(db, tp.id)).map((r) => r.id)).toEqual([c.id, a.id, b.id]);
    await expect(P.reorderRows(db, tp.id, [a.id])).rejects.toThrow();
    await P.replaceRowExercise(db, a.id, 'machine_chest_press');
    expect((await db.templateExercises.get(a.id))).toMatchObject({ exerciseId: 'machine_chest_press', targetReps: '6-8', restSec: 120 });
    await P.removeRow(db, b.id);
    expect(await db.templateExercises.where('templateId').equals(tp.id).count()).toBe(2);
  });
  it('PROG-01 AC1: duplicate = deep copy as draft; AC2: one active program', async () => {
    const p = await P.createProgram(db, 'Orig');
    const tp = await P.addTemplate(db, p.id, 'A');
    await P.addRow(db, tp.id, 'plank');
    const s = (await db.schedules.where('programId').equals(p.id).first())!;
    await P.setPattern(db, s.id, 'SUN', tp.id);
    const copy = await P.duplicateProgram(db, p.id);
    expect(copy.status).toBe('draft');
    const ct = await db.templates.where('programId').equals(copy.id).toArray();
    expect(ct.length).toBe(1);
    expect(ct[0].id).not.toBe(tp.id);
    expect(await db.templateExercises.where('templateId').equals(ct[0].id).count()).toBe(1);
    expect((await db.schedules.where('programId').equals(copy.id).first())!.pattern.SUN).toBe(ct[0].id);
    await P.setProgramStatus(db, p.id, 'active');
    await P.setProgramStatus(db, copy.id, 'active');
    expect((await db.programs.where('status').equals('active').toArray()).map((x) => x.id)).toEqual([copy.id]);
    expect((await db.programs.get(p.id))!.status).toBe('archived');
  });
  it('schedule exceptions and warm-ups; deleting a template cleans the schedule', async () => {
    const p = await P.createProgram(db, 'S');
    const tp = await P.addTemplate(db, p.id, 'A');
    const s = (await db.schedules.where('programId').equals(p.id).first())!;
    await P.setPattern(db, s.id, 'MON', tp.id);
    await P.upsertException(db, s.id, { date: '2026-11-30', templateId: null, note: 'travel' });
    await expect(P.upsertException(db, s.id, { date: '2026-13-01', templateId: null, note: '' })).rejects.toThrow();
    await P.setWarmup(db, tp.id, [{ id: '', exerciseId: 'stationary_bike', altExerciseIds: [], label: null, prescription: '5 min' }, { id: '', exerciseId: null, altExerciseIds: [], label: 'Ramp sets', prescription: '50%×10' }]);
    expect((await db.templates.get(tp.id))!.warmup.map((w) => w.prescription)).toEqual(['5 min', '50%×10']);
    await P.deleteTemplate(db, tp.id);
    expect((await db.schedules.get(s.id))!.pattern.MON).toBeNull();
  });
});

describe('BAK-01 / BAK-02 backup & restore', () => {
  let db: WeightDB; beforeEach(async () => { db = await fresh(); await addSessionWith(db, 'barbell_bench_press'); });

  it('BAK-01: ZIP has manifest, data.json and CSVs; every SHA-256 matches', async () => {
    const r = await B.createBackup(db, '0.1.0', new Date('2026-11-24T10:05:00Z'));
    expect(r.fileName).toBe('weight-backup-2026-11-24-1005.zip');
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    for (const f of ['manifest.json', 'data.json', 'csv/sessions.csv', 'csv/sets.csv', 'csv/body.csv']) expect(zip.file(f), f).toBeTruthy();
    const { sha256Hex } = await import('../../src/domain/hash');
    for (const [p, h] of Object.entries(r.manifest.files)) expect(await sha256Hex(await zip.file(p)!.async('uint8array')), p).toBe(h);
    expect(r.manifest.counts.sets).toBe(1);
    expect(await zip.file('csv/sets.csv')!.async('string')).toContain('Flat Barbell Bench Press');
    await B.recordBackup(db, r);
    expect((await db.settings.get('app'))!.lastBackupAt).toBeTruthy();
  });

  it('AC1: corrupted backup is refused and data untouched', async () => {
    const r = await B.createBackup(db, '0.1.0');
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    const data = await zip.file('data.json')!.async('string');
    zip.file('data.json', data.replace('"weightKg":20', '"weightKg":200'));
    const bad = await zip.generateAsync({ type: 'blob' });
    const before = await db.sets.toArray();
    await expect(B.inspectBackup(db, bad)).rejects.toThrow(/Checksum mismatch in data.json/);
    expect(await db.sets.toArray()).toEqual(before);
    await expect(B.inspectBackup(db, new Blob(['not a zip']))).rejects.toThrow(/not a ZIP/);
  });

  it('AC2: valid backup → preview counts → snapshot → atomic replace; AC3: same backup again = no duplicates', async () => {
    const r = await B.createBackup(db, '0.1.0');
    // change data after the backup
    await db.sets.update('s1x', { weightKg: 22.5 });
    await addSessionWith(db, 'plank', 's2');
    const pv = await B.inspectBackup(db, r.blob);
    expect(pv.identicalToCurrent).toBe(false);
    expect(pv.counts.sets).toBe(1);
    const res = await B.restoreBackup(db, pv);
    expect(res.status).toBe('restored');
    expect(await db.sets.count()).toBe(1);
    expect((await db.sets.get('s1x'))!.weightKg).toBe(20);
    expect(await db.sessions.get('s2')).toBeUndefined();
    expect((await latestSnapshot(SNAPSHOT_DB_NAME))?.reason).toBe('before restore');
    const again = await B.restoreBackup(db, await B.inspectBackup(db, r.blob));
    expect(again).toMatchObject({ status: 'identical', records: 0 });
    expect(await db.sets.count()).toBe(1);
  });

  it('referential integrity check', () => {
    expect(() => B.checkIntegrity({ sets: [{ id: 'x', sessionExerciseId: 'missing' }] })).toThrow(/inconsistent/);
  });

  it('DASH-06 / BAK-03: backup state', () => {
    const now = new Date('2026-12-01T12:00:00Z');
    expect(B.backupState(null, 7, false, now)).toBe('ok');
    expect(B.backupState(null, 7, true, now)).toBe('never');
    expect(B.backupState('2026-11-24T11:00:00Z', 7, true, now)).toBe('due');
    expect(B.backupState('2026-11-26T11:00:00Z', 7, true, now)).toBe('ok');
  });
});
