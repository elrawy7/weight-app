import type { WeightDB } from '../../db/schema';
import type { Exercise, ExerciseMuscle, ExerciseVideo, SeedExercise } from '../../db/types';
import { nowIso } from '../../domain/dates';
import { uuidv7 } from '../../domain/uuid';
import { parseYoutubeUrl } from '../../domain/youtube';
import { matches } from '../../domain/search';
import { recomputeRecords } from '../progress/recordsOps';

export class LibraryError extends Error {}

export interface ExerciseFilter { q?: string; category?: string | null; equipment?: string | null; muscle?: string | null; includeArchived?: boolean; kneeFriendly?: boolean }

/** LIB-02: search by name, aliases, Arabic name, equipment and muscles; filters combine with AND. */
export async function searchExercises(db: WeightDB, f: ExerciseFilter): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  const muscles = await db.exerciseMuscles.toArray();
  const mg = new Map((await db.muscleGroups.toArray()).map((m) => [m.id, m]));
  const byEx = new Map<string, ExerciseMuscle[]>();
  for (const m of muscles) byEx.set(m.exerciseId, [...(byEx.get(m.exerciseId) ?? []), m]);
  return all
    .filter((e) => (f.includeArchived ? true : e.isArchived === 0))
    .filter((e) => !f.category || e.category === f.category)
    .filter((e) => !f.equipment || e.equipmentId === f.equipment)
    .filter((e) => !f.kneeFriendly || e.tags.includes('knee_friendly'))
    .filter((e) => !f.muscle || (byEx.get(e.id) ?? []).some((m) => m.muscleGroupId === f.muscle || mg.get(m.muscleGroupId)?.parentId === f.muscle))
    .filter((e) => !f.q || matches(f.q, [e.name, e.nameAr, ...e.aliases, e.equipmentId.replace(/_/g, ' '), e.category,
      ...(byEx.get(e.id) ?? []).flatMap((m) => [mg.get(m.muscleGroupId)?.name ?? '', mg.get(m.muscleGroupId)?.nameAr ?? ''])]))
    .sort((a, b) => (a.status === 'unresolved' ? -1 : 0) - (b.status === 'unresolved' ? -1 : 0) || a.name.localeCompare(b.name));
}

export interface CustomExerciseInput {
  name: string; nameAr?: string; category: Exercise['category']; mechanic: Exercise['mechanic']; tracking: Exercise['tracking'];
  loadMode: Exercise['loadMode']; equipmentId: string; primary: string[]; secondary: string[]; defaultRestSec: number; incrementKg: number;
  instructions?: string[]; notes?: string;
}

/** LIB-07: custom exercise with a UUID v7 id. Duplicate names are allowed only with different equipment (BR-EX-02). */
export async function createCustomExercise(db: WeightDB, inp: CustomExerciseInput): Promise<Exercise> {
  const name = inp.name.trim();
  if (!name) throw new LibraryError('Name is required.');
  if (!inp.primary.length) throw new LibraryError('Choose at least one primary muscle.');
  const clash = (await db.exercises.toArray()).find((e) => e.name.toLowerCase() === name.toLowerCase() && e.equipmentId === inp.equipmentId && !e.isArchived);
  if (clash) throw new LibraryError(`"${clash.name}" with this equipment already exists.`);
  const t = nowIso();
  const id = uuidv7();
  const ex: Exercise = {
    id, slug: `custom-${id}`, name, nameAr: inp.nameAr?.trim() ?? '', aliases: [], aliasesLower: [name.toLowerCase()], category: inp.category, mechanic: inp.mechanic,
    tracking: inp.tracking, loadMode: inp.loadMode, equipmentId: inp.equipmentId, difficulty: 'beginner', instructions: inp.instructions ?? [], commonMistakes: [],
    safetyNotes: [], tags: [], defaultRestSec: inp.defaultRestSec, incrementKg: inp.incrementKg, isCustom: true, isArchived: 0, status: 'active',
    personalNotes: inp.notes ?? '', createdAt: t, updatedAt: t,
  };
  await db.transaction('rw', [db.exercises, db.exerciseMuscles, db.exerciseVideos], async () => {
    await db.exercises.add(ex);
    await db.exerciseMuscles.bulkAdd([
      ...inp.primary.map((m) => ({ exerciseId: id, muscleGroupId: m, role: 'primary' as const, weight: 1 })),
      ...inp.secondary.filter((m) => !inp.primary.includes(m)).map((m) => ({ exerciseId: id, muscleGroupId: m, role: 'secondary' as const, weight: 0.5 })),
    ]);
    await db.exerciseVideos.add({ id: `vid_${id}`, exerciseId: id, url: null, status: 'missing', isPrimary: true, createdAt: t, updatedAt: t });
  });
  return ex;
}

/** LIB-07 AC1: renaming changes only the display name – history follows the id. The old name stays searchable. */
export async function renameExercise(db: WeightDB, id: string, newName: string): Promise<void> {
  const name = newName.trim();
  if (!name) throw new LibraryError('Name is required.');
  const ex = await db.exercises.get(id);
  if (!ex) throw new LibraryError('Exercise not found.');
  if (ex.name === name) return;
  await db.exercises.update(id, {
    name, aliases: [...new Set([...ex.aliases, ex.name])], aliasesLower: [...new Set([...ex.aliasesLower, name.toLowerCase(), ex.name.toLowerCase()])], updatedAt: nowIso(),
  });
}

/** LIB-07 AC3: an equipment/load-mode change on an exercise with history must create a new exercise instead. */
export async function changeEquipment(db: WeightDB, id: string, equipmentId: string, loadMode: Exercise['loadMode']): Promise<'updated' | 'requires_new'> {
  const ex = await db.exercises.get(id);
  if (!ex) throw new LibraryError('Exercise not found.');
  const history = await db.sessionExercises.where('exerciseId').equals(id).count();
  if (history > 0 && loadMode !== ex.loadMode) return 'requires_new';
  await db.exercises.update(id, { equipmentId, loadMode, updatedAt: nowIso() });
  return 'updated';
}

/** LIB-07 AC2: merge duplicates. All history and template rows move to the survivor; the old name becomes an alias. */
export async function mergeExercises(db: WeightDB, fromId: string, intoId: string): Promise<{ movedRows: number; movedSessionExercises: number }> {
  const r = await mergeInner(db, fromId, intoId);
  await recomputeRecords(db, [fromId, intoId]);
  return r;
}

async function mergeInner(db: WeightDB, fromId: string, intoId: string): Promise<{ movedRows: number; movedSessionExercises: number }> {
  if (fromId === intoId) throw new LibraryError('Choose two different exercises.');
  return db.transaction('rw', [db.exercises, db.templateExercises, db.sessionExercises, db.personalRecords, db.exerciseAlternatives, db.templates], async () => {
    const from = await db.exercises.get(fromId), into = await db.exercises.get(intoId);
    if (!from || !into) throw new LibraryError('Exercise not found.');
    if (from.loadMode !== into.loadMode) throw new LibraryError('These exercises use different load modes, so their weights are not comparable and cannot be merged.');
    const t = nowIso();
    const movedRows = await db.templateExercises.where('exerciseId').equals(fromId).modify({ exerciseId: intoId, updatedAt: t });
    const movedSessionExercises = await db.sessionExercises.where('exerciseId').equals(fromId).modify({ exerciseId: intoId, updatedAt: t });
    await db.personalRecords.where('exerciseId').equals(fromId).delete(); // recomputed from history later (BR-PR)
    await db.templates.toCollection().modify((tp) => { tp.warmup.forEach((w) => { if (w.exerciseId === fromId) w.exerciseId = intoId; w.altExerciseIds = w.altExerciseIds.map((a) => (a === fromId ? intoId : a)); }); });
    await db.exercises.update(intoId, {
      aliases: [...new Set([...into.aliases, from.name, ...from.aliases])], aliasesLower: [...new Set([...into.aliasesLower, ...from.aliasesLower, from.name.toLowerCase()])], updatedAt: t,
    });
    await db.exercises.update(fromId, { isArchived: 1, status: 'archived', mergedInto: intoId, updatedAt: t });
    return { movedRows, movedSessionExercises };
  });
}

export async function setArchived(db: WeightDB, id: string, archived: boolean): Promise<void> {
  const ex = await db.exercises.get(id);
  if (!ex) throw new LibraryError('Exercise not found.');
  if (ex.status === 'unresolved') throw new LibraryError('Resolve this exercise in Data migration first.');
  await db.exercises.update(id, { isArchived: archived ? 1 : 0, status: archived ? 'archived' : 'active', updatedAt: nowIso() });
}

/** LIB-05 AC2: user-supplied YouTube link (validated) with status `user`; replaceable and removable. */
export async function setUserVideo(db: WeightDB, exerciseId: string, url: string | null): Promise<ExerciseVideo> {
  const t = nowIso();
  const cur = (await db.exerciseVideos.where('exerciseId').equals(exerciseId).toArray()).find((v) => v.isPrimary);
  if (url === null) {
    const v: ExerciseVideo = { id: cur?.id ?? `vid_${exerciseId}`, exerciseId, url: null, status: 'missing', isPrimary: true, createdAt: cur?.createdAt ?? t, updatedAt: t };
    await db.exerciseVideos.put(v);
    return v;
  }
  const p = parseYoutubeUrl(url);
  if (!p.ok) throw new LibraryError('That is not a YouTube video link (youtube.com/watch?v=…, youtu.be/…, or /shorts/…).');
  const v: ExerciseVideo = { id: cur?.id ?? `vid_${exerciseId}`, exerciseId, url: p.url, status: 'user', isPrimary: true, createdAt: cur?.createdAt ?? t, updatedAt: t };
  await db.exerciseVideos.put(v);
  return v;
}

/** LIB-08: defined alternatives first; otherwise same primary muscle + mechanic. */
export async function alternativesFor(db: WeightDB, id: string): Promise<{ exercise: Exercise; reason: string; defined: boolean }[]> {
  const defined = await db.exerciseAlternatives.where('exerciseId').equals(id).toArray();
  if (defined.length) {
    const exs = await db.exercises.bulkGet(defined.map((d) => d.alternativeId));
    return exs.map((e, i) => ({ e, r: defined[i].reason })).filter((x): x is { e: Exercise; r: string } => !!x.e && !x.e.isArchived).map((x) => ({ exercise: x.e, reason: x.r, defined: true }));
  }
  const ex = await db.exercises.get(id);
  if (!ex) return [];
  const prim = (await db.exerciseMuscles.where('exerciseId').equals(id).toArray()).filter((m) => m.role === 'primary').map((m) => m.muscleGroupId);
  const cands = await db.exerciseMuscles.where('muscleGroupId').anyOf(prim).toArray();
  const ids = [...new Set(cands.filter((c) => c.role === 'primary' && c.exerciseId !== id).map((c) => c.exerciseId))];
  const exs = (await db.exercises.bulkGet(ids)).filter((e): e is Exercise => !!e && !e.isArchived && e.mechanic === ex.mechanic && e.status === 'active');
  return exs.map((e) => ({ exercise: e, reason: e.tags.includes('knee_friendly') ? 'knee_friendly' : 'same_muscle', defined: false }));
}

export const seedToSearchable = (s: SeedExercise) => [s.name, s.nameAr, ...s.aliases];
