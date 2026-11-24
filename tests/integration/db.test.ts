import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { WeightDB, SCHEMA_V1, SCHEMA_VERSIONS, type SchemaVersion } from '../../src/db/schema';
import { openDatabase, latestSnapshot, restoreLatestSnapshot, onDiskVersion, exportRaw } from '../../src/db/open';
import { ensureSeed } from '../../src/db/seed';
import * as R from '../../src/db/repos';
import { seedExercises } from '../../src/seed/exercises';

let n = 0;
const fresh = () => `t-db-${++n}-${Math.random().toString(36).slice(2)}`;

describe('FND-03 schema v1', () => {
  it('AC1: fresh install creates every store from doc 08', async () => {
    const name = fresh();
    const r = await openDatabase(name, SCHEMA_VERSIONS, name + '-snap');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.tables.map((t) => t.name).sort()).toEqual(Object.keys(SCHEMA_V1).sort());
    expect(r.db.verno).toBe(1);
    expect(r.upgradedFrom).toBeNull();
    r.db.close();
  });

  it('AC2: failing v1→v2 upgrade keeps v1, snapshot exists, raw export and snapshot restore work', async () => {
    const name = fresh(), snap = name + '-snap';
    const r1 = await openDatabase(name, SCHEMA_VERSIONS, snap);
    if (!r1.ok) throw r1.error;
    await ensureSeed(r1.db);
    await r1.db.kv.put({ key: 'marker', value: 'keep-me' });
    const before = await r1.db.exercises.count();
    r1.db.close();

    const broken: SchemaVersion[] = [...SCHEMA_VERSIONS, { version: 2, stores: { ...SCHEMA_V1, notes: 'id' }, upgrade: async (tx) => { await tx.table('kv').put({ key: 'half', value: 1 }); throw new Error('boom'); } }];
    const r2 = await openDatabase(name, broken, snap);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.onDiskVersion).toBe(1);
    expect(r2.snapshotId).toBeTruthy();
    expect(await onDiskVersion(name)).toBe(1); // DB stays at v1
    const raw = await exportRaw(name);
    expect((raw.data.kv as { key: string }[]).find((k) => k.key === 'half')).toBeUndefined(); // partial upgrade rolled back
    expect((raw.data.kv as { key: string; value: string }[]).find((k) => k.key === 'marker')?.value).toBe('keep-me');
    const s = await latestSnapshot(snap);
    expect(s?.fromVersion).toBe(1);
    expect(s?.data.exercises.length).toBe(before);

    // simulate corruption, then restore the snapshot
    await Dexie.delete(name);
    const restored = await restoreLatestSnapshot(name, snap);
    expect(restored).toBeGreaterThan(before);
    const r3 = await openDatabase(name, SCHEMA_VERSIONS, snap);
    if (!r3.ok) throw r3.error;
    expect(await r3.db.exercises.count()).toBe(before);
    expect((await r3.db.kv.get('marker'))?.value).toBe('keep-me');
    r3.db.close();
  });

  it('successful upgrade v1→v2 takes a snapshot first and keeps all records', async () => {
    const name = fresh(), snap = name + '-snap';
    const r1 = await openDatabase(name, SCHEMA_VERSIONS, snap);
    if (!r1.ok) throw r1.error;
    await ensureSeed(r1.db);
    const before = await r1.db.exercises.count();
    r1.db.close();
    const v2: SchemaVersion[] = [...SCHEMA_VERSIONS, { version: 2, stores: { ...SCHEMA_V1, notes: 'id' }, upgrade: async (tx) => { await tx.table('kv').put({ key: 'migrated', value: 2 }); } }];
    const r2 = await openDatabase(name, v2, snap);
    if (!r2.ok) throw r2.error;
    expect(r2.upgradedFrom).toBe(1);
    expect(r2.snapshotId).toBeTruthy();
    expect(await r2.db.exercises.count()).toBe(before);
    expect((await r2.db.kv.get('migrated'))?.value).toBe(2);
    r2.db.close();
  });
});

describe('seed', () => {
  let db: WeightDB;
  beforeEach(async () => { db = new WeightDB(fresh()); await db.open(); });

  it('is idempotent and keeps user renames', async () => {
    const a = await ensureSeed(db);
    expect(a.added).toBe(seedExercises.length);
    await db.exercises.update('cable_crunch', { name: 'My crunch' });
    await db.kv.put({ key: 'seedVersion', value: 0 });
    const b = await ensureSeed(db);
    expect(b.added).toBe(0);
    expect((await db.exercises.get('cable_crunch'))?.name).toBe('My crunch');
    expect(await db.exercises.count()).toBe(seedExercises.length);
    expect(await db.settings.get('app')).toBeTruthy();
  });

  it('LIB-01: every exercise has Arabic name, load mode, primary muscle, instructions and a video record (no URL unless verified)', async () => {
    await ensureSeed(db);
    for (const e of await db.exercises.toArray()) {
      expect(e.nameAr, e.id).toMatch(/[؀-ۿ]/);
      expect(e.loadMode).toBeTruthy();
      expect(e.instructions.length, e.id).toBeGreaterThan(0);
      const m = await R.musclesOfExercise(db, e.id);
      expect(m.some((x) => x.role === 'primary'), e.id).toBe(true);
      const v = await db.exerciseVideos.where('exerciseId').equals(e.id).first();
      expect(v, e.id).toBeTruthy();
      if (v!.url) expect(v!.status).toBe('verified');
      else expect(v!.status).toBe('missing');
    }
    // every muscle id used exists
    const mg = new Set((await db.muscleGroups.toArray()).map((m) => m.id));
    for (const m of await db.exerciseMuscles.toArray()) expect(mg.has(m.muscleGroupId), m.muscleGroupId).toBe(true);
    // every alternative points to an existing exercise
    for (const s of seedExercises) for (const a of s.alternatives) expect(seedExercises.some((x) => x.id === a), `${s.id} → ${a}`).toBe(true);
  });

  it('LIB-01 AC2: same-name exercises with different equipment are distinct ids', async () => {
    await ensureSeed(db);
    const rows = await db.exercises.where('category').equals('back').toArray();
    const csr = rows.filter((r) => r.name.startsWith('Chest-Supported'));
    expect(new Set(csr.map((r) => r.id)).size).toBe(2);
    expect(new Set(csr.map((r) => r.loadMode))).toEqual(new Set(['stack', 'per_hand']));
  });
});

describe('FND-03 AC3 repositories + indexes', () => {
  let db: WeightDB;
  beforeEach(async () => { db = new WeightDB(fresh()); await db.open(); await ensureSeed(db); });

  it('generic CRUD with timestamps and UUID v7', async () => {
    const repo = R.sessionsRepo(db);
    const s = await repo.create({ status: 'completed', startedAt: null, endedAt: null, pausedMs: 0, localDate: '2026-11-21', notes: '', source: 'app' });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await repo.get(s.id))?.localDate).toBe('2026-11-21');
    await repo.update(s.id, { notes: 'x' });
    expect((await repo.get(s.id))?.notes).toBe('x');
    await expect(repo.update('nope', { notes: 'y' })).rejects.toThrow('Not found');
    await repo.remove(s.id);
    expect(await repo.get(s.id)).toBeUndefined();
  });

  it('index queries used by the domain', async () => {
    expect((await R.exerciseByAlias(db, 'rope pressdown'))?.id).toBe('cable_rope_pushdown');
    expect((await R.exercisesByCategory(db, 'triceps')).length).toBeGreaterThanOrEqual(2);
    expect((await R.activeExercises(db)).length).toBe(seedExercises.length);
    const p = await db.programs.add({ id: 'p1', name: 'P', split: 's', status: 'active', weeks: [], source: 'app', createdAt: '', updatedAt: '' });
    await db.templates.bulkAdd([{ id: 't2', programId: p, name: 'B', focus: '', orderIndex: 2, warmup: [], createdAt: '', updatedAt: '' }, { id: 't1', programId: p, name: 'A', focus: '', orderIndex: 1, warmup: [], createdAt: '', updatedAt: '' }]);
    expect((await R.templatesOfProgram(db, 'p1')).map((t) => t.id)).toEqual(['t1', 't2']);
    expect((await R.activeProgram(db))?.id).toBe('p1');
  });
});

describe('LIB-06 / LIB-04 library coverage', () => {
  it('140–160 exercises across all 14 categories; ids unique; equipment and muscles valid', async () => {
    const { categories } = await import('../../src/seed/exercises');
    const { EQUIPMENT } = await import('../../src/db/defaults');
    expect(seedExercises.length).toBeGreaterThanOrEqual(140);
    expect(seedExercises.length).toBeLessThanOrEqual(160);
    expect(new Set(seedExercises.map((e) => e.id)).size).toBe(seedExercises.length);
    for (const c of categories) expect(seedExercises.some((e) => e.category === c), c).toBe(true);
    const eq = new Set(EQUIPMENT.map((e) => e[0]));
    for (const e of seedExercises) expect(eq.has(e.equipment), `${e.id}: ${e.equipment}`).toBe(true);
  });
  it('LIB-04 AC2: every video URL in the seed has a verification record (title, channel, date)', () => {
    const withVideo = seedExercises.filter((e) => e.video);
    expect(withVideo.length).toBeGreaterThan(0);
    for (const e of withVideo) {
      expect(e.video!.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
      expect(e.video!.title.length).toBeGreaterThan(3);
      expect(e.video!.channel.length).toBeGreaterThan(1);
      expect(e.video!.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
