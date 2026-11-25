/** Active workout / edit a logged workout (WO-01…17, TMR-01…03). Every change is written to IndexedDB immediately. */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Collapse, Drawer, Group, Menu, NumberInput, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle, IconArrowDown, IconArrowUp, IconBrandYoutube, IconDots, IconHistory, IconInfoCircle, IconPlayerPause, IconPlayerPlay, IconPlus,
  IconReplace, IconPlayerSkipForward, IconNote, IconFlame, IconCheck,
} from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
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
import { alternativeNames, deloadState, recentPerfs, weightContext } from './suggestionCtx';
import * as W from './workoutOps';
import { RestTimerPanel, useNow, mmss } from './RestTimer';
import { ExerciseHistorySheet } from './ExerciseHistory';
import { SetLine, type Ghost } from './SetLine';
import { prevList, setLabel } from './format';
import { unlockAudio } from './alerts';
import { FinishSheet } from './FinishSheet';

interface Row { se: WorkoutSessionExercise; ex: Exercise | undefined; sets: WorkoutSet[]; video?: ExerciseVideo; muscles: string[]; legacy?: LegacyPerformance; best: W.Best | null; recent: RecentPerf[]; alt?: string; deloadDismissed: boolean }

const err = (e: unknown) => notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') });

/** PR-02: amber toast as soon as a completed working set beats every earlier set of this exercise (not on the first-ever performance). */
function livePrToast(row: Row, set: WorkoutSet, ghost: Ghost, unit: 'kg' | 'lb') {
  const best = row.best;
  const ex = row.ex!;
  if (!best) return; // BR-PR-06 baseline
  const w = set.weightKg ?? ghost.weightKg ?? 0, r = set.reps ?? ghost.reps ?? 0;
  const others = row.sets.filter((x) => x.id !== set.id && x.completed === 1 && x.setType !== 'warmup');
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
  const [warmOpen, setWarmOpen] = useState(true);

  const data = useLiveQuery(async () => {
    const s = await db.sessions.get(id);
    if (!s) return { s: undefined } as const;
    const ses = (await db.sessionExercises.where('sessionId').equals(id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    const exIds = [...new Set(ses.map((x) => x.exerciseId))];
    const exs = new Map((await db.exercises.bulkGet(exIds)).filter((e): e is Exercise => !!e).map((e) => [e.id, e]));
    const sets = ses.length ? await db.sets.where('sessionExerciseId').anyOf(ses.map((x) => x.id)).toArray() : [];
    const videos = exIds.length ? await db.exerciseVideos.where('exerciseId').anyOf(exIds).toArray() : [];
    const mus = exIds.length ? await db.exerciseMuscles.where('exerciseId').anyOf(exIds).toArray() : [];
    const groups = new Map((await db.muscleGroups.toArray()).map((m) => [m.id, m.name]));
    const legacy = exIds.length ? await db.legacyPerformance.where('exerciseId').anyOf(exIds).toArray() : [];
    const tpl = s.templateId ? await db.templates.get(s.templateId) : undefined;
    const program = s.programId ? await db.programs.get(s.programId) : undefined;
    const warmChecked = ((await db.kv.get(`warmup:${s.localDate}`))?.value as string[] | undefined) ?? [];
    const warmEx = tpl ? await db.exercises.bulkGet(tpl.warmup.map((w) => w.exerciseId ?? '__none')) : [];
    const bests = await Promise.all(ses.map((x) => (x.cardio ? null : W.bestBefore(db, x.exerciseId, s))));
    const recents = await recentPerfs(db, exIds, s);
    const alts = await alternativeNames(db, exIds);
    const dismissed = ((await db.kv.get('deloadDismissed'))?.value as Record<string, string> | undefined) ?? {};
    const rows: Row[] = ses.map((se, i) => ({
      se, ex: exs.get(se.exerciseId), sets: sets.filter((x) => x.sessionExerciseId === se.id).sort((a, b) => a.orderIndex - b.orderIndex),
      video: videos.find((v) => v.exerciseId === se.exerciseId && v.isPrimary) ?? videos.find((v) => v.exerciseId === se.exerciseId),
      muscles: mus.filter((m) => m.exerciseId === se.exerciseId && m.role === 'primary').map((m) => groups.get(m.muscleGroupId) ?? m.muscleGroupId),
      legacy: legacy.find((l) => l.exerciseId === se.exerciseId), best: bests[i], recent: recents.get(se.exerciseId) ?? [], alt: alts.get(se.exerciseId),
      deloadDismissed: !!dismissed[se.exerciseId] && dismissed[se.exerciseId] === (recents.get(se.exerciseId)?.[0]?.localDate ?? ''),
    }));
    return { s, rows, tpl, program, warmChecked, warmEx } as const;
  }, [db, id]);

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

  if (!data) return null;
  if (!s || s.status === 'discarded') {
    return <><PageHeader title={t('wo.title')} back="/" /><EmptyState icon={<IconAlertCircle />} title={t('wo.notFound')} action={<Button onClick={() => nav('/')}>{t('day.backToToday')}</Button>} /></>;
  }
  const { rows, tpl, warmChecked, warmEx } = data;
  const visible = rows.filter((r) => r.se.status !== 'replaced');
  const stale = W.isStale(s);
  const title = tpl?.name ?? t('wo.emptyName');
  const dateText = formatDate(s.localDate, { weekday: 'short', day: 'numeric', month: 'short' });

  const onToggle = async (row: Row, set: WorkoutSet, ghost: Ghost) => {
    unlockAudio();
    try {
      const measure = row.ex?.tracking === 'duration' ? 'duration' : 'reps';
      // PR-02 (≤ 300 ms): judge the PR from the values being saved before the slower status writes
      const before = await db.sets.get(set.id);
      const willComplete = !!before && !before.completed && before.setType !== 'warmup' && (measure === 'duration' ? (before.durationSec ?? ghost.durationSec) : (before.reps ?? ghost.reps)) != null;
      if (willComplete && row.ex) livePrToast(row, before!, ghost, settings.weightUnit);
      const r = await W.toggleSetComplete(db, set.id, ghost, measure);
      if (r.completed && r.startRest && live && s.status === 'active') await W.startRest(db, { sessionId: s.id, exerciseName: row.ex?.name ?? '', durationSec: r.restSec || settings.defaultRestSec });
      // WO-09: inside a superset round, jump to the next exercise of the group (no rest yet)
      if (r.completed && !r.startRest && row.se.supersetGroup && set.setType !== 'warmup') {
        const next = rows.find((x) => x.se.supersetGroup === row.se.supersetGroup && x.se.orderIndex > row.se.orderIndex && x.se.status !== 'skipped' && x.se.status !== 'replaced');
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

  const header = (
    <PageHeader back="/" title={title}
      subtitle={<span data-testid="wo-subtitle">{dateText}{s.programWeek ? ` · ${t('common.week', { n: s.programWeek })}` : ''}{targetRpe ? ` · ${t('common.rpe', { v: targetRpe })}` : ''}</span>}
      right={running ? (
        <Group gap={4} wrap="nowrap">
          {live && <Text ff="monospace" fw={700} data-testid="wo-clock" aria-label={t('wo.elapsed')}>{mmss(Math.floor(W.elapsedMs(s, now) / 1000))}</Text>}
          {live && (s.status === 'active'
            ? <ActionIcon variant="light" aria-label={t('wo.pause')} onClick={() => void W.pauseSession(db, s.id, true)} data-testid="wo-pause"><IconPlayerPause /></ActionIcon>
            : <ActionIcon variant="filled" aria-label={t('wo.resume')} onClick={() => void W.pauseSession(db, s.id, false)} data-testid="wo-resume"><IconPlayerPlay /></ActionIcon>)}
        </Group>
      ) : <Badge variant="light" color="mint" data-testid="wo-logged">{t('wo.logged')}</Badge>} />
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
        <RestTimerPanel sessionId={s.id} />

        {running && tpl && tpl.warmup.length > 0 && (
          <Card withBorder padding="xs" radius="md" data-testid="wo-warmup">
            <Group justify="space-between" onClick={() => setWarmOpen((o) => !o)} style={{ cursor: 'pointer' }} mih={44} px={4}>
              <Group gap={6}><IconFlame size={18} /><Text fw={600}>{t('today.warmup')}</Text></Group>
              <Text fz="xs" c="dimmed">{t('today.warmupDone', { done: tpl.warmup.filter((w) => warmChecked.includes(w.id)).length, total: tpl.warmup.length })}</Text>
            </Group>
            <Collapse in={warmOpen}>
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
          <ExerciseBlock key={row.se.id} row={row} session={s} program={data.program} index={i} count={visible.length} targetRpe={targetRpe}
            onToggle={onToggle} onDelete={onDelete} onHistory={() => setHistoryOf(row)} onInfo={() => setInfoOf(row)}
            onReplace={() => setPicker({ mode: 'replace', seId: row.se.id, exclude: row.se.exerciseId })} />
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

function ExerciseBlock({ row, session, program, index, count, targetRpe, onToggle, onDelete, onHistory, onInfo, onReplace }: {
  row: Row; session: WorkoutSession; program?: WorkoutProgram; index: number; count: number; targetRpe?: string;
  onToggle: (row: Row, set: WorkoutSet, ghost: Ghost) => Promise<void>; onDelete: (set: WorkoutSet) => Promise<void>; onHistory: () => void; onInfo: () => void; onReplace: () => void;
}) {
  const db = useDb();
  const settings = useSettings();
  const { se, ex, sets } = row;
  const [noteOpen, setNoteOpen] = useState(!!se.notes);
  const [note, setNote] = useState(se.notes);
  useEffect(() => setNote(se.notes), [se.notes]);
  const unit = settings.weightUnit;
  const incKg = ex ? resolveIncrement(ex, settings.incrementOverrides) : 2.5;
  const weightInc = unit === 'kg' ? incKg || 1 : Math.max(1, Math.round(kgToLb(incKg || 1)));
  const prev = se.snapshot?.previous;
  const skipped = se.status === 'skipped';
  const running = session.status === 'active' || session.status === 'paused';
  const weights = ex ? weightContext(ex, incKg, settings) : { incrementKg: incKg };
  const sug = running && ex ? suggest({
    exercise: { status: ex.status, loadMode: ex.loadMode, strategy: ex.strategy, isMain: ex.mechanic === 'compound' }, recent: row.recent, targetReps: se.snapshot?.targetReps, targetRpe,
    today: session.localDate, weights, defaultStrategy: settings.defaultStrategy, incrementSteps: settings.incrementSteps, deload: deloadState(program, session.localDate),
    deloadPct: settings.deloadPct, deloadSets: settings.deloadSets, alternativeName: row.alt, noDeload: row.deloadDismissed,
  }) : null;
  const working = sets.filter((x) => x.setType !== 'warmup');
  const warm = sets.filter((x) => x.setType === 'warmup');
  const allDone = working.length > 0 && working.every((x) => x.completed);
  const kneeCaution = !!ex?.tags.includes('knee_caution');
  const measure = ex?.tracking === 'duration' ? 'duration' : 'reps';
  const showWeight = !(ex && (ex.loadMode === 'none' || ex.loadMode === 'band' || (ex.loadMode === 'bodyweight' && ex.tracking !== 'weight_reps')));
  const snap = se.snapshot ?? {};
  const targets = [snap.targetSets ? t('common.sets', { n: snap.targetSets }) : null, snap.targetReps ? (se.cardio ? snap.targetReps : t('wo.reps', { r: snap.targetReps })) : null, snap.restSec && !se.cardio ? t('common.rest', { s: snap.restSec }) : null].filter(Boolean).join(' · ');
  const videoUrl = row.video?.url && (row.video.status === 'verified' || row.video.status === 'user') ? row.video.url : ex ? youtubeSearchUrl(ex.name) : null;

  return (
    <Card withBorder radius="lg" padding="sm" data-testid="wo-exercise" data-se={se.id} data-exercise={se.exerciseId} data-status={se.status} style={skipped ? { opacity: 0.6 } : undefined}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={4}>
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6}>
            {se.supersetGroup && <Badge variant="outline" size="sm">{t('today.superset', { g: se.supersetGroup })}</Badge>}
            <Title order={4} lineClamp={2} data-testid="wo-ex-name">{ex?.name ?? se.exerciseId}</Title>
          </Group>
          {ex?.nameAr && <Text fz="sm" c="dimmed" className="w-arabic" dir="rtl" style={{ alignSelf: 'flex-start' }}>{ex.nameAr}</Text>}
          {row.muscles.length > 0 && <Text fz="xs" c="dimmed">{row.muscles.join(', ')}</Text>}
          <Group gap={6}>{ex?.status === 'unresolved' && <Badge color="amber" size="sm">{t('library.unresolved')}</Badge>}<KneeBadge tags={ex?.tags ?? []} />{skipped && <Badge color="gray" size="sm" data-testid="wo-skipped">{t('wo.skipped')}</Badge>}</Group>
        </Stack>
        <Group gap={0} wrap="nowrap">
          {videoUrl && <ActionIcon component="a" href={videoUrl} target="_blank" rel="noopener noreferrer" aria-label={t('wo.video')} data-testid="wo-video"><IconBrandYoutube /></ActionIcon>}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target><ActionIcon aria-label={t('wo.exerciseMenu', { name: ex?.name ?? '' })} data-testid="wo-ex-menu"><IconDots /></ActionIcon></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconInfoCircle size={16} />} onClick={onInfo}>{t('wo.instructions')}</Menu.Item>
              <Menu.Item leftSection={<IconHistory size={16} />} onClick={onHistory} data-testid="wo-ex-history">{t('wo.history')}</Menu.Item>
              <Menu.Item leftSection={<IconNote size={16} />} onClick={() => setNoteOpen(true)}>{t('wo.addNote')}</Menu.Item>
              <Menu.Item leftSection={<IconReplace size={16} />} onClick={onReplace} data-testid="wo-ex-replace">{t('common.replace')}</Menu.Item>
              <Menu.Item leftSection={<IconPlayerSkipForward size={16} />} onClick={() => void W.skipExercise(db, se.id, !skipped)} data-testid="wo-ex-skip">{skipped ? t('wo.unskip') : t('wo.skip')}</Menu.Item>
              <Menu.Item leftSection={<IconArrowUp size={16} />} disabled={index === 0} onClick={() => void W.moveExercise(db, session.id, se.id, -1)} data-testid="wo-ex-up">{t('common.moveUp')}</Menu.Item>
              <Menu.Item leftSection={<IconArrowDown size={16} />} disabled={index === count - 1} onClick={() => void W.moveExercise(db, session.id, se.id, 1)} data-testid="wo-ex-down">{t('common.moveDown')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {targets && <Text fz="sm" mt={4} data-testid="wo-targets">{targets}</Text>}
      {snap.templateNotes && <Text fz="xs" c="dimmed">{snap.templateNotes}</Text>}
      {ex?.personalNotes && <Text fz="xs" c="dimmed" data-testid="wo-personal-note">{t('wo.yourNote', { note: ex.personalNotes })}</Text>}

      {!se.cardio && (
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

      {sug && !skipped && working.some((x) => !x.completed) && (
        // PO-03: hint in the info colour with ✦ – inputs keep their prefill until "Use suggestion"
        <Alert variant="light" color="info" icon={<Text fw={800} c="var(--w-info)" aria-hidden>✦</Text>} mt={6} p="xs" data-testid="wo-suggestion" data-kind={sug.kind}>
          <Text fz="sm">{sug.message}</Text>
          <Group gap={6} mt={4}>
            {(sug.deltaKg !== 0 || sug.repsTarget || sug.setsDelta) && (
              <Button size="xs" variant="light" color="info" onClick={() => void W.applySuggestion(db, se.id, sug, weights).catch(err)} data-testid="wo-use-suggestion">{t('wo.useSuggestion')}</Button>
            )}
            {sug.kind === 'deload' && (
              <Button size="xs" variant="subtle" color="gray" data-testid="wo-dismiss-deload"
                onClick={() => void db.kv.get('deloadDismissed').then((k) => db.kv.put({ key: 'deloadDismissed', value: { ...((k?.value as Record<string, string>) ?? {}), [se.exerciseId]: row.recent[0]?.localDate ?? '' } }))}>{t('wo.dismiss')}</Button>
            )}
          </Group>
        </Alert>
      )}

      {!skipped && se.cardio && <CardioFields se={se} ex={ex} />}
      {!skipped && !se.cardio && (
        <Stack gap={6} mt="xs">
          {sets.map((set) => {
            const isWarm = set.setType === 'warmup';
            const wi = isWarm ? warm.indexOf(set) : working.indexOf(set);
            const aligned = isWarm ? { shown: prev?.warmups[wi] ?? null, prefill: prev?.warmups[wi] ?? null } : W.alignedPrevious(prev, wi);
            const ghost: Ghost = { weightKg: aligned.prefill?.weightKg ?? null, reps: aligned.prefill?.reps ?? null, durationSec: aligned.prefill?.durationSec ?? null };
            const badge = isWarm ? t('wo.typeW') : set.setType === 'drop' ? t('wo.typeD') : set.setType === 'failure' ? t('wo.typeF') : String(wi + 1);
            const pr = !!row.best && set.completed === 1 && !isWarm && showWeight && (set.weightKg ?? 0) > row.best.maxWeightKg;
            return (
              <SetLine key={set.id} set={set} badge={badge} prevText={aligned.shown ? t('wo.prev', { v: setLabel(aligned.shown, unit, false) }) : t('wo.prevNone')} ghost={ghost} measure={measure}
                showWeight={showWeight} unitLabel={unit === 'kg' ? t('common.kg') : t('common.lb')} weightInc={weightInc}
                toDisplay={(kg) => toDisplay(kg, unit)} fromDisplay={(v) => fromDisplay(v, unit)} showRpe={settings.showRpe} pr={pr}
                onPatch={(p) => void W.updateSet(db, set.id, p).catch(err)} onToggle={() => void onToggle(row, set, ghost)} onDelete={() => void onDelete(set)} />
            );
          })}
          <Group gap="xs" grow>
            <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => void W.addSet(db, se.id)} data-testid="wo-add-set">{t('wo.addSet')}</Button>
            <Button variant="subtle" onClick={() => void W.addSet(db, se.id, 'warmup')} data-testid="wo-add-warmup">{t('wo.addWarmup')}</Button>
          </Group>
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
        <Textarea mt="xs" label={t('wo.sessionNote')} autosize minRows={1} value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => void W.setExerciseNotes(db, se.id, note)} data-testid="wo-ex-note" />
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
