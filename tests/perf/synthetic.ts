/**
 * Phase 3.1 E – deterministic SYNTHETIC data set for performance tests: ~1,000 completed workouts, ~50,000 sets,
 * 200 custom exercises, 5 years of history, weekly body weight. Every value is generated (seeded PRNG) – nothing is
 * personal or copied from the real Notion import. Self-contained (no imports) so it can also run inside a browser page.
 */
export interface SyntheticOptions { seed?: number; workouts?: number; setsTarget?: number; customExercises?: number; endDate?: string; years?: number; libraryExerciseIds: string[] }

export function generateSynthetic(o: SyntheticOptions) {
  const seed0 = o.seed ?? 20261127;
  const workouts = o.workouts ?? 1000, setsTarget = o.setsTarget ?? 50000, nCustom = o.customExercises ?? 200, years = o.years ?? 5;
  const end = new Date(`${o.endDate ?? '2026-11-27'}T12:00:00Z`);
  let st = seed0 >>> 0;
  const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let x = st; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const stamp = '2026-11-27T00:00:00.000Z';
  const id = (p: string, i: number) => `syn-${p}-${String(i).padStart(6, '0')}`;

  const muscles = ['chest', 'lats', 'upper_back', 'front_delts', 'side_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
  const exercises = Array.from({ length: nCustom }, (_, i) => {
    const ex = id('ex', i);
    return {
      id: ex, slug: ex, name: `Synthetic Exercise ${String(i + 1).padStart(3, '0')}`, nameAr: '', aliases: [], aliasesLower: [], category: 'chest', mechanic: i % 3 === 0 ? 'compound' : 'isolation',
      tracking: 'weight_reps', loadMode: i % 10 === 0 ? 'per_hand' : 'total', equipmentId: i % 10 === 0 ? 'dumbbell' : 'machine', difficulty: 'intermediate', instructions: [], commonMistakes: [], safetyNotes: [],
      tags: [], defaultRestSec: 90, incrementKg: 2.5, isCustom: true, isArchived: 0 as const, status: 'active', personalNotes: '', createdAt: stamp, updatedAt: stamp,
    };
  });
  const exerciseMuscles = exercises.map((e, i) => ({ exerciseId: e.id, muscleGroupId: muscles[i % muscles.length], role: 'primary', weight: 1 }));
  const pool = [...o.libraryExerciseIds.slice(0, 40), ...exercises.map((e) => e.id)];

  const program = { id: 'syn-prog', name: 'Synthetic 5-year plan', split: 'upper_lower', status: 'active', weeks: [], source: 'app', createdAt: stamp, updatedAt: stamp };
  const templates = Array.from({ length: 6 }, (_, i) => ({ id: id('tpl', i), programId: program.id, name: `Synthetic Day ${String.fromCharCode(65 + i)}`, focus: '', orderIndex: i + 1, warmup: [], createdAt: stamp, updatedAt: stamp }));
  const perTemplate = templates.map(() => Array.from({ length: 8 }, () => pick(pool)));
  const templateExercises = templates.flatMap((t, ti) => perTemplate[ti].map((ex, j) => ({ id: `${t.id}-r${j}`, templateId: t.id, exerciseId: ex, orderIndex: j + 1, targetSetsByWeek: [3, 4, 4, 4], targetReps: '8-12', restSec: 90, supersetGroup: null, notes: '', alternativeIds: [], role: 'working' })));

  const schedules = [{ id: 'syn-sched', programId: program.id, pattern: { SUN: templates[0].id, MON: templates[1].id, TUE: null, WED: templates[2].id, THU: templates[3].id, FRI: null, SAT: templates[4].id }, exceptions: [], planned: [], createdAt: stamp, updatedAt: stamp }];
  const days = years * 365;
  const step = days / workouts;
  const perWorkout = setsTarget / workouts; // ≈ 50
  const sessions: Record<string, unknown>[] = [], sessionExercises: Record<string, unknown>[] = [], sets: Record<string, unknown>[] = [];
  const base = new Map<string, number>(pool.map((e) => [e, 20 + Math.floor(rnd() * 60)]));
  let si = 0, sei = 0, seti = 0;
  for (let w = 0; w < workouts; w++) {
    const d = new Date(end.getTime() - Math.round((workouts - w) * step) * 86400000);
    const ti = w % templates.length;
    const sid = id('s', si++);
    const startedAt = new Date(`${iso(d)}T17:00:00Z`).toISOString();
    sessions.push({ id: sid, programId: program.id, templateId: templates[ti].id, templateName: templates[ti].name, status: 'completed', startedAt, endedAt: new Date(Date.parse(startedAt) + 75 * 60000).toISOString(), pausedMs: 0, localDate: iso(d), durationMin: 75, notes: '', source: 'app', logType: 'full', createdAt: startedAt, updatedAt: startedAt });
    const exs = perTemplate[ti];
    const nSets = Math.max(exs.length, Math.round(perWorkout + (rnd() - 0.5) * 6));
    const each = Math.floor(nSets / exs.length);
    let extra = nSets - each * exs.length;
    exs.forEach((ex, j) => {
      const seid = id('se', sei++);
      sessionExercises.push({ id: seid, sessionId: sid, exerciseId: ex, orderIndex: j + 1, status: 'completed', supersetGroup: null, notes: '', snapshot: { targetSets: 4, targetReps: '8-12', restSec: 90 }, createdAt: startedAt, updatedAt: startedAt });
      const k = each + (extra-- > 0 ? 1 : 0);
      const trend = (base.get(ex) ?? 40) * (1 + (0.6 * w) / workouts); // slow progression over 5 years
      for (let s = 0; s < k; s++) {
        const kg = Math.round((trend + (rnd() - 0.5) * 5) / 2.5) * 2.5;
        sets.push({ id: id('set', seti++), sessionExerciseId: seid, orderIndex: s + 1, setType: s === 0 && rnd() < 0.2 ? 'warmup' : 'working', weightKg: Math.max(0, kg), inputUnit: 'kg', reps: 6 + Math.floor(rnd() * 7), rpe: null, completed: 1, completedAt: startedAt, side: 'both', setTypeConfidence: 'recorded', createdAt: startedAt, updatedAt: startedAt });
      }
    });
  }
  const bodyMeasurements = Array.from({ length: years * 52 }, (_, i) => {
    const d = new Date(end.getTime() - (years * 52 - i) * 7 * 86400000);
    return { id: id('bm', i), date: iso(d), weightKg: Math.round((110 - (15 * i) / (years * 52) + (rnd() - 0.5) * 2) * 10) / 10, waistCm: null, notes: '', source: 'synthetic', createdAt: stamp, updatedAt: stamp };
  });
  return { exercises, exerciseMuscles, programs: [program], templates, templateExercises, schedules, sessions, sessionExercises, sets, bodyMeasurements };
}
