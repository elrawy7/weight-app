/**
 * Notion import (MIG-01, MIG-02, MIG-04). The package is produced by scripts/build_import_package.py and
 * delivered to the device as a file; it is never bundled with the public app.
 */
import { z } from 'zod';
import type { WeightDB } from '../../db/schema';
import type * as T from '../../db/types';
import { canonicalJson, sha256Hex } from '../../domain/hash';
import { nowIso } from '../../domain/dates';
import { muscleGroups } from '../../seed/exercises';
import { recomputeRecords } from '../progress/recordsOps';

const num = z.number().nullable();
const SetZ = z.object({ order: z.number(), setType: z.enum(['warmup', 'working', 'drop', 'failure']), setTypeConfidence: z.enum(['recorded', 'assumed']), weightKg: num, reps: num, completed: z.boolean(), rpe: num, rawCell: z.string() });
const SessionExZ = z.object({ order: z.number(), exerciseId: z.string(), supersetGroup: z.string().nullable(), status: z.string(), sets: z.array(SetZ), cardio: z.object({ durationMin: z.number().optional(), durationSource: z.string().optional() }).optional(), note: z.string().optional() });
const WeekZ = z.object({ week: z.number(), startDate: z.string(), endDate: z.string(), phase: z.string(), rpe: z.string(), note: z.string().nullable().optional() });
const WarmupZ = z.object({ order: z.number(), exerciseId: z.string().nullable(), altExerciseIds: z.array(z.string()), label: z.string().nullable(), prescription: z.string() });
const RowZ = z.object({ order: z.number(), exerciseId: z.string(), targetSetsByWeek: z.array(z.number()), targetReps: z.string(), restSec: z.number(), notes: z.string(), supersetGroup: z.string().nullable(), role: z.string() });
const TemplateZ = z.object({ id: z.string(), key: z.string(), name: z.string(), focus: z.string(), order: z.number(), weekday: z.string(), warmup: z.array(WarmupZ), exercises: z.array(RowZ) });
const WD = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const PayloadZ = z.object({
  profile: z.object({ name: z.string(), age: z.number().optional(), heightCm: z.number().optional(), sex: z.enum(['male', 'female']).optional(), units: z.string().optional(), timezone: z.string(), weekStartsOn: WD, injuries: z.array(z.object({ area: z.string(), severity: z.string(), rules: z.string() })), source: z.string().optional() }),
  bodyMeasurements: z.array(z.object({ date: z.string(), dateSource: z.string(), weightKg: num, waistCm: num, source: z.string() })),
  goals: z.array(z.object({ type: z.string(), unit: z.string().default(''), source: z.string() }).passthrough()),
  program: z.object({
    id: z.string(), name: z.string(), status: z.literal('active'), split: z.string(), startDate: z.string(), endDate: z.string(), weeksCount: z.number(),
    progressionRule: z.string(), notionPageId: z.string(), weeks: z.array(WeekZ), templates: z.array(TemplateZ),
    schedule: z.object({
      pattern: z.record(WD, z.string().nullable()),
      exceptions: z.array(z.object({ date: z.string(), templateId: z.string().nullable(), note: z.string() })),
      planned: z.array(z.object({ date: z.string(), templateId: z.string(), week: z.number(), targetRpe: z.string(), notionPageId: z.string(), doneInNotion: z.boolean() })),
    }),
  }),
  sessions: z.array(z.object({ id: z.string(), localDate: z.string(), dateSource: z.string(), programId: z.string(), templateId: z.string(), week: z.number(), startedAt: z.string().nullable(), endedAt: z.string().nullable(), durationMin: num, kneePain: num, energy: num, notes: z.string().nullable(), notionPageId: z.string(), lastEditedInNotion: z.string(), exercises: z.array(SessionExZ) })),
  unresolved: z.array(z.object({ provisionalId: z.string(), notionName: z.string(), name: z.string(), issue: z.string(), candidates: z.array(z.string()).min(1), loadMode: z.enum(['total', 'per_hand', 'stack', 'bodyweight', 'assist', 'band', 'none']), category: z.string(), primary: z.array(z.string()), secondary: z.array(z.string()), usedInTemplates: z.array(z.string()), logged: z.array(z.object({ date: z.string(), sets: z.array(z.string()) })) })),
  issues: z.array(z.object({ id: z.string(), type: z.string(), description: z.string() }).passthrough()),
  excluded: z.array(z.object({ item: z.string(), reason: z.string(), notionPageId: z.string().optional() })),
});
export const PackageZ = z.object({
  format: z.literal('weight-notion-import'), formatVersion: z.literal(1), packageId: z.string().min(8), payloadSha256: z.string().length(64),
  createdAt: z.string(), source: z.object({ rootPageId: z.string(), rootPageTitle: z.string() }).passthrough(), payload: PayloadZ,
});
export type ImportPackage = z.infer<typeof PackageZ>;

export interface ImportPreview {
  packageId: string; fileName: string; alreadyImported: boolean; conflict: string | null; missingExercises: string[];
  counts: { programs: number; templates: number; templateRows: number; warmupRows: number; weeks: number; plannedSessions: number; sessions: number; sessionExercises: number; sets: number; bodyMeasurements: number; goals: number; unresolved: number; legacy: number };
  unresolved: ImportPackage['payload']['unresolved']; excluded: ImportPackage['payload']['excluded']; issues: number;
}

export class ImportError extends Error {}

/** Parse, validate schema and verify the payload checksum. Throws ImportError with a readable message. */
export async function parsePackage(text: string): Promise<ImportPackage> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ImportError('This file is not valid JSON.'); }
  const r = PackageZ.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ImportError(`Not a Weight import file (${first.path.join('.') || 'root'}: ${first.message}).`);
  }
  const digest = await sha256Hex(canonicalJson((raw as { payload: unknown }).payload));
  if (digest !== r.data.payloadSha256) throw new ImportError('Checksum mismatch – the file is damaged or was edited. Nothing was imported.');
  return r.data;
}

const exerciseIdsOf = (p: ImportPackage['payload']) => new Set([
  ...p.program.templates.flatMap((t) => [...t.exercises.map((e) => e.exerciseId), ...t.warmup.flatMap((w) => [w.exerciseId, ...w.altExerciseIds]).filter((x): x is string => !!x)]),
  ...p.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)),
  ...p.unresolved.flatMap((u) => u.candidates),
]);

export async function previewImport(db: WeightDB, pkg: ImportPackage, fileName: string): Promise<ImportPreview> {
  const p = pkg.payload;
  const provisional = new Set(p.unresolved.map((u) => u.provisionalId));
  const ids = [...exerciseIdsOf(p)].filter((x) => !provisional.has(x));
  const found = await db.exercises.bulkGet(ids);
  const missingExercises = ids.filter((_, i) => !found[i]);
  const already = await db.migrations.get(pkg.packageId);
  const sameSource = (await db.migrations.where('source').equals(`notion:${p.program.id}`).toArray()).filter((m) => m.id !== pkg.packageId);
  const existingProgram = await db.programs.get(p.program.id);
  const conflict = !already && (sameSource.length || existingProgram)
    ? 'A different version of this Notion plan is already in the app. Importing it again would overwrite your edits, so it is blocked.'
    : null;
  return {
    packageId: pkg.packageId, fileName, alreadyImported: !!already, conflict, missingExercises,
    counts: {
      programs: 1, templates: p.program.templates.length, templateRows: p.program.templates.reduce((n, t) => n + t.exercises.length, 0),
      warmupRows: p.program.templates.reduce((n, t) => n + t.warmup.length, 0), weeks: p.program.weeks.length, plannedSessions: p.program.schedule.planned.length,
      sessions: p.sessions.length, sessionExercises: p.sessions.reduce((n, s) => n + s.exercises.length, 0),
      sets: p.sessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.length, 0), 0),
      bodyMeasurements: p.bodyMeasurements.length, goals: p.goals.length, unresolved: p.unresolved.length, legacy: 0,
    },
    unresolved: p.unresolved, excluded: p.excluded, issues: p.issues.length,
  };
}

export type ImportResult = { status: 'imported'; counts: ImportPreview['counts'] } | { status: 'already_imported'; created: 0 };

/** Write everything in ONE transaction (MIG-01 AC2). Any error aborts the transaction, so nothing is written. */
export async function applyImport(db: WeightDB, pkg: ImportPackage, fileName: string): Promise<ImportResult> {
  const pv = await previewImport(db, pkg, fileName);
  if (pv.alreadyImported) return { status: 'already_imported', created: 0 };
  if (pv.conflict) throw new ImportError(pv.conflict);
  if (pv.missingExercises.length) throw new ImportError(`The exercise library is missing: ${pv.missingExercises.join(', ')}. Update the app and try again.`);
  const p = pkg.payload;
  const t = nowIso();
  const prog = p.program;

  await db.transaction('rw', db.tables, async () => {
    // profile – only fill fields that are not set yet; never overwrite what the user changed in the app
    const prof = await db.profile.get('me');
    const fromNotion: T.UserProfile = {
      id: 'me', name: p.profile.name, age: p.profile.age, ageRecordedOn: pkg.createdAt.slice(0, 10), heightCm: p.profile.heightCm, sex: p.profile.sex,
      timezone: p.profile.timezone, weekStartsOn: p.profile.weekStartsOn, injuries: p.profile.injuries, createdAt: t, updatedAt: t,
    };
    await db.profile.put(prof ? { ...fromNotion, ...Object.fromEntries(Object.entries(prof).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))), updatedAt: t } as T.UserProfile : fromNotion);

    for (const b of p.bodyMeasurements) {
      await db.bodyMeasurements.add({ id: `notion_body_${b.date}`, date: b.date, weightKg: b.weightKg, waistCm: b.waistCm, notes: b.dateSource, source: `Notion: ${b.source}`, dateConfidence: /inferred|confirm|start date/i.test(b.dateSource) ? 'inferred' : 'exact', createdAt: t, updatedAt: t });
    }
    for (const g of p.goals) {
      const { type, unit, source, ...rest } = g as Record<string, unknown> & { type: string; unit: string; source: string };
      await db.goals.add({
        id: `notion_goal_${type}`, type, unit, source: `Notion: ${source}`, target: typeof rest.target === 'number' ? rest.target : undefined,
        startValue: typeof rest.start === 'number' ? rest.start : undefined, startDate: typeof rest.startDate === 'string' ? rest.startDate : undefined,
        status: type === 'reference_nutrition' ? 'reference' : 'active', details: rest, createdAt: t, updatedAt: t,
      });
    }
    // provisional exercises for ambiguous Notion entries (MIG-02)
    for (const u of p.unresolved) {
      await db.exercises.add({
        id: u.provisionalId, slug: u.provisionalId, name: u.name, nameAr: '', aliases: [u.notionName], aliasesLower: [u.name.toLowerCase(), u.notionName.toLowerCase()],
        category: u.category as T.Category, mechanic: 'compound', tracking: 'weight_reps', loadMode: u.loadMode, equipmentId: 'machine', difficulty: 'beginner',
        instructions: [], commonMistakes: [], safetyNotes: [], tags: ['needs_resolution'], defaultRestSec: 90, incrementKg: 2.5, isCustom: false, isArchived: 0,
        status: 'unresolved', personalNotes: '', resolution: { candidates: u.candidates, notionName: u.notionName, issue: u.issue }, createdAt: t, updatedAt: t,
      });
      for (const m of [...u.primary, ...u.secondary]) if (!(m in muscleGroups)) throw new ImportError(`Unknown muscle group ${m}`);
      await db.exerciseMuscles.bulkAdd([
        ...u.primary.map((m) => ({ exerciseId: u.provisionalId, muscleGroupId: m, role: 'primary' as const, weight: 1 })),
        ...u.secondary.map((m) => ({ exerciseId: u.provisionalId, muscleGroupId: m, role: 'secondary' as const, weight: 0.5 })),
      ]);
    }
    // only one active program (PROG-01 AC2)
    await db.programs.where('status').equals('active').modify({ status: 'archived', updatedAt: t });
    await db.programs.add({ id: prog.id, name: prog.name, split: prog.split, status: 'active', startDate: prog.startDate, endDate: prog.endDate, weeksCount: prog.weeksCount, weeks: prog.weeks, progressionRule: prog.progressionRule, source: 'notion_import', notionPageId: prog.notionPageId, createdAt: t, updatedAt: t });
    for (const tp of prog.templates) {
      await db.templates.add({
        id: tp.id, programId: prog.id, name: tp.name, focus: tp.focus, orderIndex: tp.order, weekday: tp.weekday as T.Weekday,
        warmup: tp.warmup.map((w) => ({ id: `${tp.id}__w${w.order}`, exerciseId: w.exerciseId, altExerciseIds: w.altExerciseIds, label: w.label, prescription: w.prescription })),
        createdAt: t, updatedAt: t,
      });
      await db.templateExercises.bulkAdd(tp.exercises.map((r) => ({
        id: `${tp.id}__r${r.order}`, templateId: tp.id, exerciseId: r.exerciseId, orderIndex: r.order, targetSetsByWeek: r.targetSetsByWeek, targetReps: r.targetReps,
        restSec: r.restSec, supersetGroup: r.supersetGroup, notes: r.notes, alternativeIds: [], role: r.role, createdAt: t, updatedAt: t,
      })));
    }
    await db.schedules.add({
      id: `${prog.id}__schedule`, programId: prog.id, pattern: prog.schedule.pattern as Record<T.Weekday, string | null>, startDate: prog.startDate, endDate: prog.endDate,
      exceptions: prog.schedule.exceptions, planned: prog.schedule.planned.map(({ date, templateId, week, targetRpe, notionPageId }) => ({ date, templateId, week, targetRpe, notionPageId })),
      createdAt: t, updatedAt: t,
    });
    for (const s of p.sessions) {
      await db.sessions.add({
        id: s.id, programId: s.programId, templateId: s.templateId, programWeek: s.week, status: 'completed', startedAt: s.startedAt, endedAt: s.endedAt, pausedMs: 0,
        localDate: s.localDate, durationMin: s.durationMin, notes: s.notes ?? '', kneePain: s.kneePain, energy: s.energy, source: 'notion_import', notionPageId: s.notionPageId,
        dateSource: s.dateSource, createdAt: t, updatedAt: t,
      });
      for (const e of s.exercises) {
        const seId = `${s.id}__e${e.order}`;
        await db.sessionExercises.add({
          id: seId, sessionId: s.id, exerciseId: e.exerciseId, orderIndex: e.order, status: e.status as T.SEStatus, supersetGroup: e.supersetGroup,
          ...(e.cardio ? { cardio: e.cardio } : {}), notes: e.note ?? '', createdAt: t, updatedAt: t,
        });
        await db.sets.bulkAdd(e.sets.map((x) => ({
          id: `${seId}__s${x.order}`, sessionExerciseId: seId, orderIndex: x.order, setType: x.setType, weightKg: x.weightKg, inputUnit: 'kg' as const, reps: x.reps,
          rpe: x.rpe, completed: (x.completed ? 1 : 0) as 0 | 1, completedAt: null, side: 'both' as const, setTypeConfidence: x.setTypeConfidence, rawCell: x.rawCell, createdAt: t, updatedAt: t,
        })));
      }
    }
    await db.migrations.add({
      id: pkg.packageId, source: `notion:${prog.id}`, sourceHash: pkg.payloadSha256, importedAt: t, fileName, counts: pv.counts, decisions: [],
      excluded: p.excluded, issues: p.issues as T.MigrationRecord['issues'],
      notionPageIds: [
        { label: pkg.source.rootPageTitle, id: pkg.source.rootPageId }, { label: 'Training Plan', id: prog.notionPageId },
        ...p.sessions.map((s) => ({ label: `Session ${s.localDate}`, id: s.notionPageId })),
        ...prog.schedule.planned.filter((x) => !p.sessions.some((s) => s.notionPageId === x.notionPageId)).map((x) => ({ label: `Planned ${x.date}`, id: x.notionPageId })),
      ],
      unresolved: p.unresolved.map((u) => ({ provisionalId: u.provisionalId, notionName: u.notionName, candidates: u.candidates, logged: u.logged, usedInTemplates: u.usedInTemplates })),
    });
  });
  // MIG-01 AC3: verify DB totals equal the package totals
  const check = await countImported(db, pkg);
  for (const k of ['templates', 'templateRows', 'sessions', 'sessionExercises', 'sets'] as const) {
    if (check[k] !== pv.counts[k]) throw new ImportError(`Post-import check failed for ${k}: expected ${pv.counts[k]}, found ${check[k]}`);
  }
  await recomputeRecords(db); // BR-PR-05: records derive from the imported history
  return { status: 'imported', counts: pv.counts };
}

export async function countImported(db: WeightDB, pkg: ImportPackage) {
  const progId = pkg.payload.program.id;
  const templates = await db.templates.where('programId').equals(progId).toArray();
  const tIds = templates.map((x) => x.id);
  const sessions = await db.sessions.where('programId').equals(progId).filter((s) => s.source === 'notion_import').toArray();
  const ses = await db.sessionExercises.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray();
  return {
    templates: templates.length,
    templateRows: await db.templateExercises.where('templateId').anyOf(tIds).count(),
    sessions: sessions.length,
    sessionExercises: ses.length,
    sets: await db.sets.where('sessionExerciseId').anyOf(ses.map((x) => x.id)).count(),
  };
}

/**
 * MIG-02: map a provisional exercise to a library exercise (or "resolve later" with target = null).
 * Re-points template rows and logged session exercises in one transaction and records the decision.
 */
export async function resolveExercise(db: WeightDB, provisionalId: string, targetId: string | null): Promise<T.MigrationDecision> {
  const d = await resolveExerciseInner(db, provisionalId, targetId);
  if (targetId) await recomputeRecords(db, [provisionalId, targetId]);
  return d;
}

async function resolveExerciseInner(db: WeightDB, provisionalId: string, targetId: string | null): Promise<T.MigrationDecision> {
  const t = nowIso();
  return db.transaction('rw', [db.exercises, db.templateExercises, db.sessionExercises, db.sets, db.migrations, db.templates], async () => {
    const prov = await db.exercises.get(provisionalId);
    if (!prov || prov.status !== 'unresolved') throw new ImportError('This exercise is not waiting for a decision.');
    let affectedRows = 0, affectedSets = 0;
    if (targetId) {
      const target = await db.exercises.get(targetId);
      if (!target) throw new ImportError(`Unknown exercise ${targetId}`);
      if (!prov.resolution?.candidates.includes(targetId) && target.status !== 'active') throw new ImportError('Target exercise is not available.');
      affectedRows = await db.templateExercises.where('exerciseId').equals(provisionalId).modify({ exerciseId: targetId, updatedAt: t });
      const seIds = await db.sessionExercises.where('exerciseId').equals(provisionalId).primaryKeys();
      await db.sessionExercises.where('exerciseId').equals(provisionalId).modify({ exerciseId: targetId, updatedAt: t });
      affectedSets = await db.sets.where('sessionExerciseId').anyOf(seIds).count();
      // warm-ups never reference provisional ids, but keep this safe
      await db.templates.toCollection().modify((tp) => { tp.warmup.forEach((w) => { if (w.exerciseId === provisionalId) w.exerciseId = targetId; }); });
      const alias = prov.resolution?.notionName;
      if (alias && !target.aliases.includes(alias)) {
        await db.exercises.update(targetId, { aliases: [...target.aliases, alias], aliasesLower: [...new Set([...target.aliasesLower, alias.toLowerCase()])], updatedAt: t });
      }
      await db.exercises.update(provisionalId, { status: 'archived', isArchived: 1, mergedInto: targetId, updatedAt: t });
    }
    const decision: T.MigrationDecision = { provisionalId, mappedTo: targetId, decidedAt: t, affectedRows, affectedSets };
    const recs = await db.migrations.toArray();
    const rec = recs.find((r) => r.unresolved.some((u) => u.provisionalId === provisionalId));
    if (rec) await db.migrations.update(rec.id, { decisions: [...rec.decisions.filter((d) => d.provisionalId !== provisionalId || (targetId === null && d.mappedTo !== null)), decision] });
    return decision;
  });
}

/** MIG-02 AC3: unresolved exercises stay loggable but are excluded from PRs and progression. */
export const countsForRecords = (e: Pick<T.Exercise, 'status'>): boolean => e.status === 'active';
