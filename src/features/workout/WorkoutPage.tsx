/** Active workout / edit a logged workout (WO-01…17, TMR-01…03). Every change is written to IndexedDB immediately. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Collapse, Drawer, Group, Menu, NumberInput, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle, IconArrowDown, IconArrowUp, IconBrandYoutube, IconDots, IconHistory, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconPlus,
  IconReplace, IconPlayerSkipForward, IconNote, IconFlame, IconCheck, IconChevronLeft, IconLayoutList, IconLayoutRows, IconCircleCheckFilled, IconSearch,
} from '@tabler/icons-react';
import { saveSettings, useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate, nowIso } from '../../domain/dates';
import { resolveIncrement } from '../../domain/rounding';
import { formatWeight, fromDisplay, kgToLb, toDisplay } from '../../domain/units';
import { youtubeSearchUrl } from '../../domain/youtube';
import { ConfirmSheet, EmptyState, KneeBadge, PageHeader } from '../../components/ui';
import { ExercisePicker } from '../../components/ExercisePicker';
import { requestWakeLock, wakeLockSupported } from '../../pwa/platform';
import { Scale } from '../today/QuickLogSheet';
import type { Exercise, ExerciseVideo, LegacyPerformance, WorkoutProgram, WorkoutSession, WorkoutSessionExercise, WorkoutSet } from '../../db/types';
import { suggest, type RecentPerf } from '../../domain/progression';
import { epley } from '../../domain/e1rm';
import { alternativeNames, deloadState, historyFor, latestBodyweight, weightContext } from './suggestionCtx';
import { useAutosave } from './autosave';
import * as W from './workoutOps';
import { RestTimerPanel, useHeightVar, useNow, mmss, type NextUp } from './RestTimer';
import { ExerciseHistorySheet } from './ExerciseHistory';
import { SetLine, type Ghost } from './SetLine';
import { prevList, setLabel } from './format';
import { unlockAudio } from './alerts';
import { FinishSheet } from './FinishSheet';

interface Row { se: WorkoutSessionExercise; ex: Exercise | undefined; sets: WorkoutSet[]; video?: ExerciseVideo; muscles: string[]; legacy?: LegacyPerformance; best: W.Best | null; recent: RecentPerf[]; alt?: string; deloadDismissed: boolean; bodyweightKg: number | null; historyReady: boolean }

const err = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') });

/** PR-02: amber toast as soon as a completed working set beats every earlier set of this exercise (not on the first-ever performance). */
function livePrToast(row: Row, set: WorkoutSet, ghost: Ghost, unit: 'kg' | 'lb') {
  const best = row.best;
  const ex = row.ex!;
  if (!best) return; // BR-PR-06 baseline
  const w = set.weightKg ?? ghost.weightKg ?? 0, r = set.reps ?? ghost.reps ?? 0;
  if (r === 0 && ex.tracking !== 'duration') return; // A-05: a failed attempt is never a record
  const others = row.sets.filter((x) => x.id !== set.id && x.completed === 1 && x.setType !== 'warmup' && !W.isFailedAttempt(x));
  const loaded = ex.loadMode === 'total' || ex.loadMode === 'per_hand' || ex.loadMode === 'stack';
  let text: string | null = null;
  if (loaded) {
    const maxW = Math.max(best.maxWeightKg, ...others.map((x) => x.weightKg ?? 0));
    const maxE = Math.max(best.maxE1rm, ...others.map((x) => epley(x.weightKg, x.reps, ex.loadMode) ?? 0));
    const e = epley(w, r, ex.loadMode) ?? 0;
    if (w > maxW && r >= 1) text = t('wo.prWeight', { name: ex.name, v: formatWeight(w, unit) });
    else if (e > maxE + 0.01) text = t('wo.prE1rm', { name: ex.name, v: formatWeight(e, unit) });
  } else if (ex.tracking !== 'duration' && r > Math.max(best.maxReps, ...others.map((x) => x.reps ?? 0))) text = t('wo.prReps', { name: ex.name, n: r });
  if (text) notifications.show({ id: `pr-${set.id}`, color: 'amber', autoClose: 4000, title: t('wo.prTitle'), message: <span data-testid="pr-toast">{text}</span> });
}

export function WorkoutPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'replace'; seId: string; exclude: string } | null>(null);
  const [historyOf, setHistoryOf] = useState<Row | null>(null);
  const [infoOf, setInfoOf] = useState<Row | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [warmOpen, setWarmOpen] = useState<boolean | null>(null); // null = default for the layout (open in expanded, closed in compact)

  // E-06: two loads. LIVE – this workout only (session, its exercises and sets): cheap, re-runs on every tap.
  const live0 = useLiveQuery(async () => {
    const s = await db.sessions.get(id);
    if (!s) return { s: undefined } as const;
    const ses = (await db.sessionExercises.where('sessionId').equals(id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    const exIds = [...new Set(ses.map((x) => x.exerciseId))];
    const exs = new Map((await db.exercises.bulkGet(exIds)).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
    const sets = ses.length ? await db.sets.where('sessionExerciseId').anyOf(ses.map((x) => x.id)).toArray() : [];
    const tpl = s.templateId ? await db.templates.get(s.templateId) : undefined;
    const program = s.programId ? await db.programs.get(s.programId) : undefined;
    const warmChecked = ((await db.kv.get(`warmup:${s.localDate}`))?.value as string[] | undefined) ?? [];
    const warmEx = tpl ? await db.exercises.bulkGet(tpl.warmup.map((w) => w.exerciseId ?? '__none')) : [];
    const dismissed = ((await db.kv.get('deloadDismissed'))?.value as Record<string, string> | undefined) ?? {};
    return { s, ses, exIds, exs, sets, tpl, program, warmChecked, warmEx, dismissed } as const;
  }, [db, id]);
  // HISTORY – earlier workouts (bests, recent performances, videos, muscles…): loaded once per exercise list. It does
  // not change while logging, so it never makes a ✓ wait for years of history.
  const exKey = live0?.s ? `${live0.s.localDate}|${live0.s.startedAt}|${live0.exIds.join(',')}` : '';
  const [hist, setHist] = useState<{ key: string; bests: Map<string, W.Best>; recents: Map<string, RecentPerf[]>; alts: Map<string, string>; videos: ExerciseVideo[]; mus: { exerciseId: string; muscleGroupId: string; role: string }[]; groups: Map<string, string>; legacy: LegacyPerformance[]; bodyweightKg: number | null; loaded: Set<string> } | null>(null);
  useEffect(() => {
    if (!live0?.s || !exKey) return;
    const s0 = live0.s, exIds = live0.exIds;
    let cancelled = false;
    void (async () => {
      const [{ bests, recents }, alts, videos, mus, groups, legacy, bodyweightKg] = await Promise.all([
        historyFor(db, exIds, s0), alternativeNames(db, exIds),
        exIds.length ? db.exerciseVideos.where('exerciseId').anyOf(exIds).toArray() : Promise.resolve([]),
        exIds.length ? db.exerciseMuscles.where('exerciseId').anyOf(exIds).toArray() : Promise.resolve([]),
        db.muscleGroups.toArray().then((g) => new Map(g.map((m) => [m.id, m.name]))),
        exIds.length ? db.legacyPerformance.where('exerciseId').anyOf(exIds).toArray() : Promise.resolve([]),
        latestBodyweight(db),
      ]);
      if (!cancelled) setHist({ key: exKey, bests, recents, alts, videos, mus, groups, legacy, bodyweightKg, loaded: new Set(exIds) });
    })();
    return () => { cancelled = true; };
  }, [db, exKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!live0) return undefined;
    if (!live0.s) return { s: undefined } as const;
    const { s, ses, exs, sets, tpl, program, warmChecked, warmEx, dismissed } = live0;
    // keep showing what is already loaded while a changed exercise list reloads (no flicker for the others)
    const h = hist && hist.key.split('|').slice(0, 2).join('|') === exKey.split('|').slice(0, 2).join('|') ? hist : null;
    const rows: Row[] = ses.map((se) => {
      const ready = !!h && h.loaded.has(se.exerciseId);
      const recent = ready ? h!.recents.get(se.exerciseId) ?? [] : [];
      return {
        se, ex: exs.get(se.exerciseId), sets: sets.filter((x) => x.sessionExerciseId === se.id).sort((a, b) => a.orderIndex - b.orderIndex),
        video: h ? h.videos.find((v) => v.exerciseId === se.exerciseId && v.isPrimary) ?? h.videos.find((v) => v.exerciseId === se.exerciseId) : undefined,
        muscles: h ? h.mus.filter((m) => m.exerciseId === se.exerciseId && m.role === 'primary').map((m) => h.groups.get(m.muscleGroupId) ?? m.muscleGroupId) : [],
        legacy: h?.legacy.find((l) => l.exerciseId === se.exerciseId), best: se.cardio ? null : h?.bests.get(se.exerciseId) ?? null, recent, alt: h?.alts.get(se.exerciseId),
        deloadDismissed: !!dismissed[se.exerciseId] && dismissed[se.exerciseId] === (recent[0]?.localDate ?? ''), bodyweightKg: h?.bodyweightKg ?? null,
        historyReady: ready,
      };
    });
    return { s, rows, tpl, program, warmChecked, warmEx } as const;
  }, [live0, hist, exKey]);

  const s = data?.s;
  const running = s?.status === 'active' || s?.status === 'paused';
  const live = running && s?.dateSource !== W.DATE_SOURCE_BACKLOG;
  const now = useNow(!!live && s?.status === 'active', 1000);

  // WO-16 keep the screen awake during a live workout; re-acquire when returning to the foreground.
  useEffect(() => {
    if (!live || !settings.keepAwake) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => { if (document.visibilityState === 'visible') { lock = await requestWakeLock(); if (cancelled) void lock?.release(); } };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, [live, settings.keepAwake]);
  const wakeTip = useLiveQuery(async () => (await db.kv.get('wakeTipShown'))?.value === true, [db]);

  const targetRpe = useMemo(() => (data?.program && s?.programWeek ? data.program.weeks.find((w) => w.week === s.programWeek)?.rpe : undefined), [data, s]);
  const compact = settings.workoutDensity !== 'expanded';
  const barRef = useRef<HTMLDivElement>(null);
  useHeightVar(barRef, '--w-wbar-h', !!data?.s);
  useHeightVar(barRef, '--w-toast-offset', !!data?.s); // D-05: toasts appear below the bar, never over Pause/Finish

  if (!data) return null;
  if (!s || s.status === 'discarded') {
    return <><PageHeader title={t('wo.title')} back="/" /><EmptyState icon={<IconAlertCircle />} title={t('wo.notFound')} action={<Button onClick={() => nav('/')}>{t('day.backToToday')}</Button>} /></>;
  }
  const { rows, tpl, warmChecked, warmEx } = data;
  const visible = rows.filter((r) => r.se.status !== 'replaced');
  // A-06: a replaced exercise whose sets were already done stays visible (read-only) – those sets are kept
  const replacedKept = rows.filter((r) => r.se.status === 'replaced' && r.sets.some((x) => x.completed === 1));
  const stale = W.isStale(s);
  const title = tpl?.name ?? t('wo.emptyName');
  const dateText = formatDate(s.localDate, { weekday: 'short', day: 'numeric', month: 'short' });

  const onToggle = async (row: Row, set: WorkoutSet, ghost: Ghost) => {
    unlockAudio();
    try {
      const measure = row.ex?.tracking === 'duration' ? 'duration' : 'reps';
      // PR-02 (≤ 300 ms): judge the PR from the values being saved before the slower status writes
      const before = await db.sets.get(set.id);
      let willComplete = !!before && !before.completed && before.setType !== 'warmup';
      if (willComplete) { try { W.completedValues(row.ex, before!, ghost, measure); } catch { willComplete = false; } } // no toast for a set that will be rejected
      if (willComplete && row.ex) livePrToast(row, before!, ghost, settings.weightUnit);
      const r = await W.toggleSetComplete(db, set.id, ghost, measure);
      if (r.completed && r.startRest && live && s.status === 'active') await W.startRest(db, { sessionId: s.id, exerciseName: row.ex?.name ?? '', durationSec: r.restSec || settings.defaultRestSec, setId: set.id });
      // WO-09: inside a superset round, jump to the next exercise of the group (no rest yet)
      if (r.completed && !r.startRest && row.se.supersetGroup && set.setType !== 'warmup') {
        const next = rows.find((x) => x.se.supersetGroup === row.se.supersetGroup && x.se.orderIndex > row.se.orderIndex && x.se.status !== 'skipped' && x.se.status !== 'replaced' && !x.se.skippedRemaining)
          ?? rows.find((x) => x.se.supersetGroup === row.se.supersetGroup && x.se.id !== row.se.id && x.se.status !== 'skipped' && x.se.status !== 'replaced' && !x.se.skippedRemaining && x.sets.some((y) => !y.completed && y.setType !== 'warmup'));
        if (next) window.setTimeout(() => document.querySelector(`[data-se="${next.se.id}"] [data-done="0"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
      }
    } catch (e) { err(e); }
  };
  const onDelete = async (set: WorkoutSet) => {
    const removed = await W.removeSet(db, set.id);
    const nid = `undo-${set.id}`;
    notifications.show({ id: nid, autoClose: 5000, message: (
      <Group justify="space-between" wrap="nowrap"><Text fz="sm" style={{ flex: 1 }}>{t('wo.setRemoved')}</Text>
        <Button size="xs" variant="light" onClick={() => { void W.restoreSet(db, removed); notifications.hide(nid); }} data-testid="undo-set">{t('ql.undo')}</Button></Group>) });
  };
  const toggleWarm = async (wid: string) => {
    const next = warmChecked.includes(wid) ? warmChecked.filter((x) => x !== wid) : [...warmChecked, wid];
    await db.kv.put({ key: `warmup:${s.localDate}`, value: next });
  };

  // D-03 progress: exercises done / total and working sets done / planned (skipped exercises and skipped remainders excluded)
  const prog = visible.filter((r) => r.se.status !== 'skipped').reduce((a, r) => {
    const w = r.sets.filter((x) => x.setType !== 'warmup');
    const done = w.filter((x) => x.completed).length;
    const planned = r.se.cardio ? 1 : r.se.skippedRemaining ? done : w.length;
    const doneHere = r.se.cardio ? (r.se.status === 'completed' ? 1 : 0) : done;
    return { e: a.e + (r.se.status === 'completed' || (planned > 0 && doneHere >= planned) ? 1 : 0), et: a.et + 1, s: a.s + doneHere, st: a.st + planned };
  }, { e: 0, et: 0, s: 0, st: 0 });
  const isDone = (r: Row) => r.se.status === 'skipped' || r.se.status === 'completed' || (!r.se.cardio && r.sets.some((x) => x.setType !== 'warmup') && r.sets.filter((x) => x.setType !== 'warmup').every((x) => x.completed));
  const current = visible.find((r) => !isDone(r));
  // D-06: what comes after the rest
  const nextUp: NextUp | null = (() => {
    if (!current) return null;
    const w = current.sets.filter((x) => x.setType !== 'warmup');
    const i = w.findIndex((x) => !x.completed);
    if (current.se.cardio || i < 0) return { name: current.ex?.name ?? '', set: 1 };
    const g = W.alignedPrevious(current.se.snapshot?.previous, i).prefill;
    const target = g ? setLabel(g, settings.weightUnit, false) : current.se.snapshot?.targetReps ? t('wo.reps', { r: current.se.snapshot.targetReps }) : undefined;
    return { name: current.ex?.name ?? '', set: i + 1, target };
  })();
  const goTo = (seId: string) => document.querySelector(`[data-se="${seId}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const toggleDensity = () => void saveSettings(db, { workoutDensity: compact ? 'expanded' : 'compact' });

  const header = (
    <div className="w-wbar" ref={barRef} data-testid="wo-bar">
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Group gap={0} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <ActionIcon aria-label={t('common.back')} onClick={() => nav('/')} ml={-10}><IconChevronLeft size={26} /></ActionIcon>
          <div style={{ minWidth: 0 }}>
            <Title order={1} fz={19} lh={1.2} lineClamp={1}>{title}</Title>
            <Text fz="xs" c="dimmed" lineClamp={1} data-testid="wo-subtitle">{dateText}{s.programWeek ? ` · ${t('common.week', { n: s.programWeek })}` : ''}{targetRpe ? ` · ${t('common.rpe', { v: targetRpe })}` : ''}</Text>
            <Text fz="xs" fw={600} lineClamp={1} data-testid="wo-progress" data-ex={`${prog.e}/${prog.et}`} data-sets={`${prog.s}/${prog.st}`}>{t('wo.progressLine', prog)}</Text>
          </div>
        </Group>
        {running ? (
          <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
            {live && <Text ff="monospace" fw={700} fz="sm" data-testid="wo-clock" aria-label={t('wo.elapsed')} role="timer">{mmss(Math.floor(W.elapsedMs(s, now) / 1000))}</Text>}
            {live && (s.status === 'active'
              ? <ActionIcon variant="subtle" aria-label={t('wo.pause')} onClick={() => void W.pauseSession(db, s.id, true)} data-testid="wo-pause"><IconPlayerPause /></ActionIcon>
              : <ActionIcon variant="filled" aria-label={t('wo.resume')} onClick={() => void W.pauseSession(db, s.id, false)} data-testid="wo-resume"><IconPlayerPlay /></ActionIcon>)}
            <Button size="sm" mih={44} px="sm" leftSection={<IconCheck size={16} />} onClick={() => setFinishOpen(true)} data-testid="wo-finish-top">{t('wo.finishShort')}</Button>
          </Group>
        ) : <Badge variant="light" color="mint" data-testid="wo-logged" style={{ flexShrink: 0 }}>{t('wo.logged')}</Badge>}
      </Group>
      {visible.length > 0 && (
        <Group gap={4} wrap="nowrap" align="center">
          {/* D-02: exercise navigator – current exercise highlighted, tap to jump */}
          <nav className="w-nav-strip" aria-label={t('wo.navigator')} style={{ flex: 1, minWidth: 0 }} data-testid="wo-nav">
            {visible.map((r, i) => {
              const w = r.sets.filter((x) => x.setType !== 'warmup');
              const done = r.se.cardio ? (r.se.status === 'completed' ? 1 : 0) : w.filter((x) => x.completed).length;
              const total = r.se.cardio ? 1 : w.length;
              const state = r.se.status === 'skipped' ? 'skipped' : isDone(r) ? 'done' : r === current ? 'current' : 'todo';
              return (
                <button key={r.se.id} type="button" className="w-nav-chip" data-state={state} aria-current={r === current ? 'step' : undefined} onClick={() => goTo(r.se.id)}
                  aria-label={t('wo.navItem', { name: r.ex?.name ?? r.se.exerciseId, done, total })} data-testid="wo-nav-item" data-se={undefined} data-target={r.se.id}>
                  {state === 'done' ? <IconCircleCheckFilled size={16} color="var(--mantine-color-mint-5)" aria-hidden /> : <Text span fz="xs" fw={700} aria-hidden>{i + 1}</Text>}
                  <span className="w-nav-name" aria-hidden>{r.ex?.name ?? r.se.exerciseId}</span>
                  <Text span fz="xs" c="dimmed" aria-hidden>{done}/{total}</Text>
                </button>
              );
            })}
          </nav>
          <ActionIcon variant="subtle" onClick={toggleDensity} aria-label={compact ? t('wo.expandedView') : t('wo.compactView')} data-testid="wo-density" data-density={compact ? 'compact' : 'expanded'} style={{ flexShrink: 0 }}>
            {compact ? <IconLayoutRows /> : <IconLayoutList />}
          </ActionIcon>
        </Group>
      )}
    </div>
  );

  return (
    <>
      {header}
      <Stack gap="sm" pb="xl">
        {!running && <Alert variant="light" color="gray" icon={<IconInfoCircle />} data-testid="wo-edit-note">{t('wo.editNote')}</Alert>}
        {running && !live && <Alert variant="light" color="blue" icon={<IconInfoCircle />} data-testid="wo-backlog-note">{t('wo.backlogNote', { date: dateText })}</Alert>}
        {s.status === 'paused' && live && <Alert variant="light" color="amber" data-testid="wo-paused">{t('wo.pausedNote')}</Alert>}
        {stale && (
          <Alert color="amber" variant="light" icon={<IconAlertCircle />} title={t('wo.staleTitle')} data-testid="wo-stale">
            <Group mt="xs" gap="xs">
              <Button size="sm" onClick={() => setFinishOpen(true)} data-testid="wo-stale-finish">{t('wo.staleFinish')}</Button>
              <Button size="sm" variant="default" onClick={() => void db.sessions.update(s.id, { lastActivityAt: nowIso() })}>{t('wo.staleContinue')}</Button>
            </Group>
          </Alert>
        )}
        {live && settings.keepAwake && !wakeLockSupported() && !wakeTip && (
          <Alert variant="light" withCloseButton closeButtonLabel={t('common.close')} onClose={() => void db.kv.put({ key: 'wakeTipShown', value: true })} data-testid="wake-tip">{t('wo.wakeTip')}</Alert>
        )}

        {running && tpl && tpl.warmup.length > 0 && (!compact || warmChecked.length < tpl.warmup.length) && (
          <Card withBorder padding="xs" radius="md" data-testid="wo-warmup">
            <Group justify="space-between" onClick={() => setWarmOpen((o) => !(o ?? !compact))} style={{ cursor: 'pointer' }} mih={44} px={4} role="button" tabIndex={0} aria-expanded={warmOpen ?? !compact} data-testid="wo-warmup-toggle"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWarmOpen((o) => !(o ?? !compact)); } }}>
              <Group gap={6}><IconFlame size={18} /><Text fw={600}>{t('today.warmup')}</Text></Group>
              <Text fz="xs" c="dimmed">{t('today.warmupDone', { done: tpl.warmup.filter((w) => warmChecked.includes(w.id)).length, total: tpl.warmup.length })}</Text>
            </Group>
            <Collapse in={warmOpen ?? !compact}>
              <Stack gap={0}>
                {tpl.warmup.map((w, i) => (
                  <Checkbox key={w.id} size="md" py={8} px={4} checked={warmChecked.includes(w.id)} onChange={() => void toggleWarm(w.id)} data-testid="warmup-item"
                    label={<Group gap={6}><Text fw={500}>{warmEx[i]?.name ?? w.label}</Text><Text c="dimmed" fz="sm">{w.prescription}</Text></Group>} />
                ))}
                <Text fz="xs" c="dimmed" px={4} pb={4}>{t('wo.warmupNote')}</Text>
              </Stack>
            </Collapse>
          </Card>
        )}

        {visible.length === 0 && <EmptyState icon={<IconPlus />} title={t('wo.noExercises')} body={t('wo.noExercisesBody')} />}
        {visible.map((row, i) => (
          <ExerciseBlock key={row.se.id} row={row} session={s} program={data.program} index={i} count={visible.length} targetRpe={targetRpe} compact={compact}
            onToggle={onToggle} onDelete={onDelete} onHistory={() => setHistoryOf(row)} onInfo={() => setInfoOf(row)}
            onReplace={() => setPicker({ mode: 'replace', seId: row.se.id, exclude: row.se.exerciseId })} />
        ))}

        {replacedKept.map((row) => (
          <Card key={row.se.id} withBorder radius="lg" padding="sm" data-testid="wo-replaced-kept" data-exercise={row.se.exerciseId} style={{ opacity: 0.75 }}>
            <Text fz="sm" fw={600}>{t('wo.replacedKept', { name: row.ex?.name ?? row.se.exerciseId, n: row.sets.filter((x) => x.completed === 1).length })}</Text>
            <Text fz="sm" c="dimmed">{prevList(row.sets.filter((x) => x.completed === 1 && x.setType !== 'warmup').map((x) => ({ weightKg: x.weightKg, reps: x.reps, setType: x.setType, durationSec: x.durationSec ?? null })), settings.weightUnit)}</Text>
          </Card>
        ))}

        <Button variant="default" size="lg" leftSection={<IconPlus />} onClick={() => setPicker({ mode: 'add' })} data-testid="wo-add-exercise">{t('wo.addExercise')}</Button>
        {running ? (
          <>
            <Button size="lg" leftSection={<IconCheck />} onClick={() => setFinishOpen(true)} data-testid="wo-finish">{t('wo.finish')}</Button>
            <Button variant="subtle" color="red" onClick={() => setDiscardOpen(true)} data-testid="wo-discard">{t('wo.discard')}</Button>
          </>
        ) : (
          <>
            <Button size="lg" onClick={() => nav(`/?date=${s.localDate}`)} data-testid="wo-done">{t('common.done')}</Button>
            <Button variant="default" onClick={() => setFinishOpen(true)} data-testid="wo-edit-summary">{t('wo.editSummary')}</Button>
            <Button variant="subtle" color="red" onClick={() => setDiscardOpen(true)} data-testid="wo-delete">{t('wo.delete')}</Button>
          </>
        )}
      </Stack>
      {running && <RestTimerPanel sessionId={s.id} next={nextUp} />}

      <ExercisePicker opened={picker !== null} title={picker?.mode === 'replace' ? t('wo.replaceWith') : t('wo.addExercise')} exclude={picker?.mode === 'replace' ? [picker.exclude] : []}
        onClose={() => setPicker(null)}
        onPick={(e) => { const p = picker; if (!p) return; void (p.mode === 'add' ? W.addExercise(db, s.id, e.id) : W.replaceExercise(db, p.seId, e.id)).catch(err); }} />
      <ExerciseHistorySheet opened={!!historyOf} onClose={() => setHistoryOf(null)} exerciseId={historyOf?.se.exerciseId ?? null} name={historyOf?.ex?.name ?? ''} excludeSessionId={s.id} />
      <InstructionsSheet row={infoOf} onClose={() => setInfoOf(null)} />
      <FinishSheet opened={finishOpen} onClose={() => setFinishOpen(false)} session={s} live={!!live} stale={stale}
        onSaved={() => { setFinishOpen(false); if (running) nav(`/?date=${s.localDate}`); }} />
      <ConfirmSheet opened={discardOpen} danger title={running ? t('wo.discardTitle') : t('wo.deleteTitle')} body={t('wo.discardBody')} confirmLabel={running ? t('wo.discard') : t('wo.delete')}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void W.discardSession(db, s.id).then(() => { setDiscardOpen(false); nav(`/?date=${s.localDate}`); notifications.show({ message: t('wo.discarded') }); })} />
    </>
  );
}

function ExerciseBlock({ row, session, program, index, count, targetRpe, compact, onToggle, onDelete, onHistory, onInfo, onReplace }: {
  row: Row; session: WorkoutSession; program?: WorkoutProgram; index: number; count: number; targetRpe?: string; compact: boolean;
  onToggle: (row: Row, set: WorkoutSet, ghost: Ghost) => Promise<void>; onDelete: (set: WorkoutSet) => Promise<void>; onHistory: () => void; onInfo: () => void; onReplace: () => void;
}) {
  const db = useDb();
  const settings = useSettings();
  const { se, ex, sets } = row;
  const [noteOpen, setNoteOpen] = useState(!!se.notes);
  const [note, setNote] = useState(se.notes);
  const [noteFocused, setNoteFocused] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  // A-04: autosave while typing; an update from the database never overwrites text that is being typed
  useEffect(() => { if (!noteFocused) setNote(se.notes); }, [se.notes, noteFocused]);
  const noteSave = useAutosave(note, se.notes, (v) => W.setExerciseNotes(db, se.id, v));
  const unit = settings.weightUnit;
  const incKg = ex ? resolveIncrement(ex, settings.incrementOverrides) : 2.5;
  const weightInc = unit === 'kg' ? incKg || 1 : Math.max(1, Math.round(kgToLb(incKg || 1)));
  const prev = se.snapshot?.previous;
  const skipped = se.status === 'skipped';
  const restSkipped = !!se.skippedRemaining; // A-06: completed sets kept, remaining sets skipped
  const running = session.status === 'active' || session.status === 'paused';
  const weights = ex ? weightContext(ex, incKg, settings) : { incrementKg: incKg };
  const sug = running && ex && row.historyReady ? suggest({
    exercise: { status: ex.status, loadMode: ex.loadMode, strategy: ex.strategy, isMain: ex.mechanic === 'compound' }, recent: row.recent, targetReps: se.snapshot?.targetReps, targetRpe,
    today: session.localDate, weights, defaultStrategy: settings.defaultStrategy, incrementSteps: settings.incrementSteps, deload: deloadState(program, session.localDate),
    deloadPct: settings.deloadPct, deloadSets: settings.deloadSets, alternativeName: row.alt, noDeload: row.deloadDismissed, bodyweightKg: row.bodyweightKg ?? undefined,
  }) : null;
  const working = sets.filter((x) => x.setType !== 'warmup');
  const warm = sets.filter((x) => x.setType === 'warmup');
  const allDone = working.length > 0 && working.every((x) => x.completed);
  const kneeCaution = !!ex?.tags.includes('knee_caution');
  const measure = ex?.tracking === 'duration' ? 'duration' : 'reps';
  const showWeight = !(ex && (ex.loadMode === 'none' || ex.loadMode === 'band' || (ex.loadMode === 'bodyweight' && ex.tracking !== 'weight_reps')));
  const snap = se.snapshot ?? {};
  const targets = [snap.targetSets ? t('common.sets', { n: snap.targetSets }) : null, snap.targetReps ? (se.cardio ? snap.targetReps : t('wo.reps', { r: snap.targetReps })) : null, snap.restSec && !se.cardio ? t('common.rest', { s: snap.restSec }) : null].filter(Boolean).join(' · ');
  // D-04: a verified / your own video when there is one; otherwise an honest YouTube search (never an invented link)
  const verified = !!row.video?.url && (row.video.status === 'verified' || row.video.status === 'user');
  const videoUrl = verified ? row.video!.url : ex ? youtubeSearchUrl(ex.name) : null;
  const formLabel = verified ? t('wo.watchForm') : t('wo.findForm');
  const formAria = verified ? t('wo.watchFormAria', { name: ex?.name ?? '' }) : t('wo.findFormAria', { name: ex?.name ?? '' });
  const lastLine = prev ? `${t('wo.lastTime', { date: formatDate(prev.localDate, { weekday: 'short', day: 'numeric', month: 'short' }) })}${prev.templateName ? ` · ${prev.templateName}` : ''}: ` : null;

  return (
    <Card withBorder radius="lg" padding={compact ? 'xs' : 'sm'} data-testid="wo-exercise" data-se={se.id} data-exercise={se.exerciseId} data-status={se.status} data-density={compact ? 'compact' : 'expanded'} style={skipped ? { opacity: 0.6 } : undefined}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={4}>
        <Stack gap={compact ? 0 : 2} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap={compact ? 'nowrap' : 'wrap'}>
            {se.supersetGroup && <Badge variant="outline" size="sm" style={{ flexShrink: 0 }}>{t('today.superset', { g: se.supersetGroup })}</Badge>}
            <Title order={4} fz={compact ? 17 : undefined} lineClamp={compact ? 1 : 2} data-testid="wo-ex-name">{ex?.name ?? se.exerciseId}</Title>
          </Group>
          {!compact && ex?.nameAr && <Text fz="sm" c="dimmed" className="w-arabic" dir="rtl" style={{ alignSelf: 'flex-start' }}>{ex.nameAr}</Text>}
          {!compact && row.muscles.length > 0 && <Text fz="xs" c="dimmed">{row.muscles.join(', ')}</Text>}
          <Group gap={6}>{ex?.status === 'unresolved' && <Badge color="amber" size="sm">{t('library.unresolved')}</Badge>}<KneeBadge tags={ex?.tags ?? []} />{skipped && <Badge color="gray" size="sm" data-testid="wo-skipped">{t('wo.skipped')}</Badge>}{restSkipped && <Badge color="gray" size="sm" data-testid="wo-rest-skipped">{t('wo.restSkipped')}</Badge>}</Group>
        </Stack>
        <Group gap={0} wrap="nowrap">
          {videoUrl && compact && <ActionIcon component="a" href={videoUrl} target="_blank" rel="noopener noreferrer" aria-label={formAria} data-testid="wo-video" data-verified={verified ? '1' : '0'}>{verified ? <IconBrandYoutube /> : <IconSearch />}</ActionIcon>}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target><ActionIcon aria-label={t('wo.exerciseMenu', { name: ex?.name ?? '' })} data-testid="wo-ex-menu"><IconDots /></ActionIcon></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={onInfo}>{t('wo.instructions')}</Menu.Item>
              <Menu.Item leftSection={<IconHistory size={16} />} onClick={onHistory} data-testid="wo-ex-history">{t('wo.history')}</Menu.Item>
              <Menu.Item leftSection={<IconNote size={16} />} onClick={() => setNoteOpen(true)}>{t('wo.addNote')}</Menu.Item>
              <Menu.Item leftSection={<IconReplace size={16} />} onClick={onReplace} data-testid="wo-ex-replace">{t('common.replace')}</Menu.Item>
              <Menu.Item leftSection={<IconPlayerSkipForward size={16} />} onClick={() => void W.skipExercise(db, se.id, !(skipped || restSkipped)).catch(err)} data-testid="wo-ex-skip">{skipped || restSkipped ? t('wo.unskip') : working.some((x) => x.completed) ? t('wo.skipRest') : t('wo.skip')}</Menu.Item>
              <Menu.Item leftSection={<IconArrowUp size={16} />} disabled={index === 0} onClick={() => void W.moveExercise(db, session.id, se.id, -1)} data-testid="wo-ex-up">{t('common.moveUp')}</Menu.Item>
              <Menu.Item leftSection={<IconArrowDown size={16} />} disabled={index === count - 1} onClick={() => void W.moveExercise(db, session.id, se.id, 1)} data-testid="wo-ex-down">{t('common.moveDown')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {videoUrl && !compact && (
        <Button component="a" href={videoUrl} target="_blank" rel="noopener noreferrer" variant="light" size="sm" mih={44} mt={6} leftSection={verified ? <IconBrandYoutube size={18} /> : <IconSearch size={18} />}
          aria-label={formAria} data-testid="wo-video" data-verified={verified ? '1' : '0'}>{formLabel}</Button>
      )}
      {targets && <Text fz={compact ? 'xs' : 'sm'} mt={compact ? 0 : 4} c={compact ? 'dimmed' : undefined} data-testid="wo-targets">{targets}</Text>}
      {snap.templateNotes && <Text fz="xs" c="dimmed" lineClamp={compact ? 1 : undefined}>{snap.templateNotes}</Text>}
      {ex?.personalNotes && <Text fz="xs" c="dimmed" lineClamp={compact ? 1 : undefined} data-testid="wo-personal-note">{t('wo.yourNote', { note: ex.personalNotes })}</Text>}

      {!se.cardio && compact && (
        <Text fz="xs" mt={2} lineClamp={2} data-testid="wo-last">
          {prev ? <><Text span fw={600} fz="xs">{lastLine}</Text><span data-testid="wo-last-sets">{prevList(prev.sets, unit)}</span>{prev.painScore != null && prev.painScore >= 4 && <Text span fz="xs" c="orange"> · {t('wo.lastPain', { n: prev.painScore })}</Text>}</>
            : <Text span fz="xs" fw={600} data-testid="wo-first-time">{t('wo.firstTime')}</Text>}
        </Text>
      )}
      {!se.cardio && !compact && (
        <Card withBorder={false} padding={6} radius="sm" mt={6} bg="var(--mantine-color-default-hover)" data-testid="wo-last">
          {prev ? (
            <>
              <Text fz="sm" fw={600}>{t('wo.lastTime', { date: formatDate(prev.localDate, { weekday: 'short', day: 'numeric', month: 'short' }) })}{prev.templateName ? ` · ${prev.templateName}` : ''}</Text>
              <Text fz="sm" data-testid="wo-last-sets">{prevList(prev.sets, unit)}</Text>
              {prev.painScore != null && prev.painScore >= 4 && <Text fz="xs" c="orange">{t('wo.lastPain', { n: prev.painScore })}</Text>}
            </>
          ) : (
            <>
              <Text fz="sm" fw={600} data-testid="wo-first-time">{t('wo.firstTime')}</Text>
              {row.legacy && <Text fz="xs" c="dimmed">{t('wo.legacy', { tpl: row.legacy.sourceTemplate, w: row.legacy.weightsBySet.join(' / ') })}</Text>}
            </>
          )}
        </Card>
      )}

      {sug && !skipped && !restSkipped && working.some((x) => !x.completed) && (
        // PO-03: hint in the info colour with ✦ – inputs keep their prefill until "Use suggestion"
        <Alert variant="light" color="info" icon={compact ? undefined : <Text fw={800} c="var(--w-info)" aria-hidden>✦</Text>} mt={6} p={compact ? 6 : 'xs'} data-testid="wo-suggestion" data-kind={sug.kind}>
          {(() => {
            const msg = <Text fz="sm" lineClamp={compact && !whyOpen ? 2 : undefined} style={{ flex: 1, minWidth: 0 }}>{compact && <Text span fw={800} c="var(--w-info)" aria-hidden>✦ </Text>}{sug.message}</Text>;
            const buttons = (
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {sug.factors.length > 0 && <Button size="xs" mih={44} px={8} variant="subtle" color="info" onClick={() => setWhyOpen((o) => !o)} aria-expanded={whyOpen} aria-controls={`why-${se.id}`} data-testid="wo-why">{whyOpen ? t('wo.whyHide') : t('wo.why')}</Button>}
                {(sug.deltaKg !== 0 || sug.repsTarget || sug.setsDelta) && (
                  <Button size="xs" mih={44} px={8} variant="light" color="info" onClick={() => void W.applySuggestion(db, se.id, sug, weights).catch(err)} data-testid="wo-use-suggestion">{compact ? t('wo.useShort') : t('wo.useSuggestion')}</Button>
                )}
              </Group>
            );
            return compact ? <Group gap={4} wrap="nowrap" align="center">{msg}{buttons}</Group> : <>{msg}<Group mt={4}>{buttons}</Group></>;
          })()}
          {/* B-05: what the suggestion is based on */}
          {whyOpen && <Stack gap={0} mt={4} data-testid="wo-why-list" id={`why-${se.id}`}>{sug.factors.map((f, i) => <Text key={i} fz="xs" c="dimmed">• {f}</Text>)}</Stack>}
          <Group gap={6} mt={sug.kind === 'deload' ? 4 : 0}>
            {sug.kind === 'deload' && (
              <Button size="xs" mih={44} variant="subtle" color="gray" data-testid="wo-dismiss-deload"
                onClick={() => void db.kv.get('deloadDismissed').then((k) => db.kv.put({ key: 'deloadDismissed', value: { ...((k?.value as Record<string, string>) ?? {}), [se.exerciseId]: row.recent[0]?.localDate ?? '' } }))}>{t('wo.dismiss')}</Button>
            )}
          </Group>
        </Alert>
      )}

      {!skipped && se.cardio && <CardioFields se={se} ex={ex} />}
      {!skipped && !se.cardio && (
        <Stack gap={compact ? 4 : 6} mt={compact ? 6 : 'xs'}>
          {compact && sets.length > 0 && (
            <Group wrap="nowrap" gap={4} px={4} aria-hidden data-testid="wo-cols">
              <Text fz={10} c="dimmed" w={44} ta="center">{t('wo.colSet')}</Text>
              {showWeight && <Text fz={10} c="dimmed" w={150} ta="center">{unit === 'kg' ? t('common.kg') : t('common.lb')}</Text>}
              <Text fz={10} c="dimmed" w={showWeight ? 52 : 96} ta="center">{measure === 'duration' ? t('common.sec') : t('wo.colReps')}</Text>
            </Group>
          )}
          {sets.filter((set) => !restSkipped || set.completed === 1).map((set) => {
            const isWarm = set.setType === 'warmup';
            const wi = isWarm ? warm.indexOf(set) : working.indexOf(set);
            const aligned = isWarm ? { shown: prev?.warmups[wi] ?? null, prefill: prev?.warmups[wi] ?? null } : W.alignedPrevious(prev, wi);
            const ghost: Ghost = { weightKg: aligned.prefill?.weightKg ?? null, reps: aligned.prefill?.reps ?? null, durationSec: aligned.prefill?.durationSec ?? null };
            const badge = isWarm ? t('wo.typeW') : set.setType === 'drop' ? t('wo.typeD') : set.setType === 'failure' ? t('wo.typeF') : String(wi + 1);
            const loaded = ex?.loadMode === 'total' || ex?.loadMode === 'per_hand' || ex?.loadMode === 'stack'; // more assistance is never a PR
            const pr = !!row.best && set.completed === 1 && !isWarm && loaded && (set.reps ?? 0) > 0 && (set.weightKg ?? 0) > row.best.maxWeightKg;
            return (
              <SetLine key={set.id} set={set} badge={badge} prevText={aligned.shown ? t('wo.prev', { v: setLabel(aligned.shown, unit, false) }) : t('wo.prevNone')} ghost={ghost} measure={measure}
                showWeight={showWeight} unitLabel={unit === 'kg' ? t('common.kg') : t('common.lb')} weightInc={weightInc}
                toDisplay={(kg) => toDisplay(kg, unit)} fromDisplay={(v) => fromDisplay(v, unit)} showRpe={settings.showRpe} pr={pr} compact={compact}
                onPatch={(p) => void W.updateSet(db, set.id, p).catch(err)} onToggle={() => void onToggle(row, set, ghost)} onDelete={() => void onDelete(set)} />
            );
          })}
          {!restSkipped && <Group gap="xs" grow>
            <Button variant={compact ? 'subtle' : 'light'} mih={44} leftSection={<IconPlus size={18} />} onClick={() => void W.addSet(db, se.id)} data-testid="wo-add-set">{t('wo.addSet')}</Button>
            <Button variant="subtle" mih={44} onClick={() => void W.addSet(db, se.id, 'warmup')} data-testid="wo-add-warmup">{t('wo.addWarmup')}</Button>
          </Group>}
        </Stack>
      )}

      {kneeCaution && allDone && (
        <Stack gap={4} mt="sm" data-testid="wo-pain">
          <Text fz="sm" fw={600}>{t('wo.painPrompt')}</Text>
          <Scale values={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} cols={6} value={se.painScore ?? null} onChange={(n) => void W.setPain(db, se.id, n)} label={t('wo.painPrompt')} testId="wo-pain-scale" />
          {(se.painScore ?? 0) >= 4 && <Text fz="xs" c="orange">{t('wo.painHigh')}</Text>}
        </Stack>
      )}

      <Collapse in={noteOpen}>
        <Textarea mt="xs" label={t('wo.sessionNote')} autosize minRows={1} value={note} maxLength={2000}
          description={noteSave.state === 'saving' ? t('common.saving') : noteSave.state === 'saved' ? t('common.saved') : noteSave.state === 'error' ? t('common.notSaved') : undefined}
          onChange={(e) => setNote(e.currentTarget.value)} onFocus={() => setNoteFocused(true)} onBlur={() => { setNoteFocused(false); void noteSave.flush(); }} data-testid="wo-ex-note" />
      </Collapse>
    </Card>
  );
}

/** NumberInput that owns its text while focused, so live DB updates never clobber what is being typed. */
function LiveNumber({ value, onValue, ...rest }: { value: number | undefined; onValue: (v: number | undefined) => void; label: string; min: number; max: number; decimalScale: number; 'data-testid': string }) {
  const [local, setLocal] = useState<number | string>(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(value ?? ''); }, [value, focused]);
  return <NumberInput {...rest} value={local} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onChange={(v) => { setLocal(v); const n = typeof v === 'number' ? v : v === '' ? undefined : Number(v); if (n === undefined || Number.isFinite(n)) onValue(n); }} />;
}

function CardioFields({ se, ex }: { se: WorkoutSessionExercise; ex: Exercise | undefined }) {
  const db = useDb();
  const c = se.cardio ?? {};
  const done = se.status === 'completed';
  const save = (patch: Partial<NonNullable<WorkoutSessionExercise['cardio']>>, d?: boolean) => void W.setCardio(db, se.id, patch, d);
  const rounds = ex?.tracking === 'rounds';
  return (
    <Stack gap="xs" mt="xs" data-testid="wo-cardio">
      <Group grow gap="xs">
        {rounds ? (
          <>
            <LiveNumber label={t('wo.rounds')} min={0} max={100} decimalScale={0} value={c.rounds} onValue={(v) => save({ rounds: v, durationMin: v !== undefined && c.roundMin ? v * c.roundMin : c.durationMin })} data-testid="cardio-rounds" />
            <LiveNumber label={t('wo.roundMin')} min={0} max={60} decimalScale={1} value={c.roundMin} onValue={(v) => save({ roundMin: v, durationMin: v !== undefined && c.rounds ? v * c.rounds : c.durationMin })} data-testid="cardio-roundmin" />
          </>
        ) : (
          <>
            <LiveNumber label={t('wo.minutes')} min={0} max={600} decimalScale={1} value={c.durationMin} onValue={(v) => save({ durationMin: v })} data-testid="cardio-min" />
            {ex?.tracking === 'duration_distance' && <LiveNumber label={t('wo.distanceKm')} min={0} max={200} decimalScale={2} value={c.distanceM != null ? c.distanceM / 1000 : undefined} onValue={(n) => save({ distanceM: n === undefined ? undefined : Math.round(n * 1000) })} data-testid="cardio-km" />}
          </>
        )}
      </Group>
      {!rounds && ex?.id.startsWith('treadmill') && (
        <Group grow gap="xs">
          <LiveNumber label={t('wo.incline')} min={0} max={30} decimalScale={1} value={c.inclinePct} onValue={(v) => save({ inclinePct: v })} data-testid="cardio-incline" />
          <LiveNumber label={t('wo.speed')} min={0} max={30} decimalScale={1} value={c.speedKmh} onValue={(v) => save({ speedKmh: v })} data-testid="cardio-speed" />
        </Group>
      )}
      <Checkbox size="lg" label={t('wo.cardioDoneCheck')} checked={done} onChange={(e) => save({}, e.currentTarget.checked)} data-testid="cardio-done" />
    </Stack>
  );
}

function InstructionsSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const ex = row?.ex;
  return (
    <Drawer opened={!!row} onClose={onClose} size="85%" title={<Text fw={700}>{ex?.name ?? ''}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      {ex && (
        <Stack gap="sm" data-testid="wo-instructions">
          {ex.instructions.length > 0 && <div><Text fw={700} fz="sm" mb={4}>{t('ex.instructions')}</Text><Stack gap={4}>{ex.instructions.map((x, i) => <Text key={i} fz="sm">{i + 1}. {x}</Text>)}</Stack></div>}
          {ex.commonMistakes.length > 0 && <div><Text fw={700} fz="sm" mb={4}>{t('ex.mistakes')}</Text><Stack gap={4}>{ex.commonMistakes.map((x, i) => <Text key={i} fz="sm">• {x}</Text>)}</Stack></div>}
          {ex.safetyNotes.length > 0 && <div><Text fw={700} fz="sm" mb={4}>{t('ex.safety')}</Text><Stack gap={4}>{ex.safetyNotes.map((x, i) => <Text key={i} fz="sm">• {x}</Text>)}</Stack></div>}
          {row?.video?.url && (row.video.status === 'verified' || row.video.status === 'user') && <Anchor href={row.video.url} target="_blank" rel="noopener noreferrer">{t('wo.watchVideo', { title: row.video.title ?? ex.name })}</Anchor>}
          {!ex.instructions.length && !ex.commonMistakes.length && <Text c="dimmed" fz="sm">{t('wo.noInstructions')}</Text>}
          <Button variant="light" onClick={onClose}>{t('common.close')}</Button>
        </Stack>
      )}
    </Drawer>
  );
}
