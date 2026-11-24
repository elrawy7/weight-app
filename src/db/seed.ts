import type { WeightDB } from './schema';
import type { Exercise, ExerciseMuscle, MuscleGroup, SeedExercise } from './types';
import { seedExercises, muscleGroups, SEED_VERSION } from '../seed/exercises';
import { defaultSettings, equipmentRows } from './defaults';
import { nowIso } from '../domain/dates';

const REGION: Record<string, MuscleGroup['region']> = {
  chest: 'upper', back: 'upper', shoulders: 'upper', biceps: 'upper', triceps: 'upper', forearms: 'upper',
  quadriceps: 'lower', hamstrings: 'lower', glutes: 'lower', adductors: 'lower', calves: 'lower', hip_flexors: 'lower',
  abdominals: 'core', cardio: 'other', tibialis: 'lower',
};

export function toExercise(s: SeedExercise, t = nowIso()): Exercise {
  return {
    id: s.id, slug: s.id, name: s.name, nameAr: s.nameAr, aliases: [...s.aliases],
    aliasesLower: [...new Set([s.name, ...s.aliases].map((a) => a.toLowerCase()))],
    category: s.category, mechanic: s.mechanic, tracking: s.tracking, loadMode: s.loadMode, equipmentId: s.equipment,
    difficulty: s.difficulty, instructions: [...s.instructions], commonMistakes: [...s.mistakes], safetyNotes: [...s.safety],
    tags: [...(s.tags ?? [])], defaultRestSec: s.defaultRestSec, incrementKg: s.incrementKg, isCustom: false, isArchived: 0,
    status: 'active', personalNotes: '', createdAt: t, updatedAt: t,
  };
}

export const musclesOf = (s: { id: string; primary: string[]; secondary: string[] }): ExerciseMuscle[] => [
  ...s.primary.map((m) => ({ exerciseId: s.id, muscleGroupId: m, role: 'primary' as const, weight: 1 })),
  ...s.secondary.filter((m) => !s.primary.includes(m)).map((m) => ({ exerciseId: s.id, muscleGroupId: m, role: 'secondary' as const, weight: 0.5 })),
];

/**
 * Idempotent library seed. New seed exercises are added; existing ones keep the user's name, notes and archive state –
 * only instructional content is refreshed. Custom exercises are never touched (LIB-07).
 */
export async function ensureSeed(db: WeightDB): Promise<{ added: number; refreshed: number }> {
  const current = (await db.kv.get('seedVersion'))?.value as number | undefined;
  const settingsExists = await db.settings.get('app');
  let added = 0, refreshed = 0;
  if (current === SEED_VERSION && settingsExists) return { added, refreshed };
  const t = nowIso();
  await db.transaction('rw', [db.exercises, db.exerciseMuscles, db.exerciseAlternatives, db.exerciseVideos, db.muscleGroups, db.equipment, db.settings, db.kv], async () => {
    if (!settingsExists) await db.settings.put(defaultSettings());
    await db.muscleGroups.bulkPut(Object.entries(muscleGroups).map(([id, [name, nameAr, parentId]]) => ({ id, name, nameAr, parentId, region: REGION[parentId] ?? 'other' })));
    for (const e of equipmentRows()) if (!(await db.equipment.get(e.id))) await db.equipment.put(e);
    for (const s of seedExercises) {
      const existing = await db.exercises.get(s.id);
      if (!existing) {
        await db.exercises.add(toExercise(s, t));
        await db.exerciseMuscles.bulkPut(musclesOf(s));
        await db.exerciseVideos.put(s.video
          ? { id: `vid_${s.id}`, exerciseId: s.id, url: s.video.url, title: s.video.title, channel: s.video.channel, status: 'verified', verifiedAt: s.video.verifiedAt, isPrimary: true, createdAt: t, updatedAt: t }
          : { id: `vid_${s.id}`, exerciseId: s.id, url: null, status: 'missing', isPrimary: true, createdAt: t, updatedAt: t });
        added++;
      } else if (!existing.isCustom) {
        await db.exercises.update(s.id, { instructions: [...s.instructions], commonMistakes: [...s.mistakes], safetyNotes: [...s.safety], nameAr: s.nameAr, tags: [...(s.tags ?? [])], updatedAt: t });
        // New or changed verified video: replace a missing/older verified link, never the user's own link (LIB-05).
        if (s.video) {
          const cur = (await db.exerciseVideos.where('exerciseId').equals(s.id).toArray()).find((v) => v.isPrimary);
          if (!cur || cur.status === 'missing' || (cur.status === 'verified' && cur.url !== s.video.url)) {
            await db.exerciseVideos.put({ id: cur?.id ?? `vid_${s.id}`, exerciseId: s.id, url: s.video.url, title: s.video.title, channel: s.video.channel, status: 'verified', verifiedAt: s.video.verifiedAt, isPrimary: true, createdAt: cur?.createdAt ?? t, updatedAt: t });
          }
        }
        refreshed++;
      }
    }
    const ids = new Set(seedExercises.map((s) => s.id));
    for (const s of seedExercises) {
      for (const a of s.alternatives) {
        if (!ids.has(a)) continue;
        const reason = (seedExercises.find((x) => x.id === a)?.tags ?? []).includes('knee_friendly') ? 'knee_friendly' : 'similar';
        await db.exerciseAlternatives.put({ exerciseId: s.id, alternativeId: a, reason });
      }
    }
    await db.kv.put({ key: 'seedVersion', value: SEED_VERSION });
  });
  return { added, refreshed };
}
