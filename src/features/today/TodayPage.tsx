import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBarbell, IconMoon, IconAlertCircle, IconFileImport, IconPlus, IconChevronLeft, IconChevronRight, IconCircleCheckFilled, IconCalendarMonth, IconCheck } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { addDays, deviceTimeZone, formatDate, isValidIsoDate, localDateOf } from '../../domain/dates';
import { phaseOf, planForDate, setsForWeek, type DayPlan } from '../../domain/schedule';
import { ConfirmSheet, EmptyState, ExerciseCard, KneeBadge, Section } from '../../components/ui';
import { QuickLogSheet } from './QuickLogSheet';
import { markDone, undoQuickLog, updateQuickLog } from './quickLog';
import { BackupIndicator, InstallBanner } from '../../components/banners';
import type { Exercise, WorkoutTemplate } from '../../db/types';
import * as R from '../../db/repos';

/** The real local date (profile time zone) and the day being viewed (`?date=` lets you browse other days). */
export function useDay(): { day: string; realToday: string; isToday: boolean } {
  const [sp] = useSearchParams();
  const db = useDb();
  const tz = useLiveQuery(async () => (await db.profile.get('me'))?.timezone, [db]) ?? deviceTimeZone();
  const realToday = localDateOf(new Date(), tz);
  const override = sp.get('date');
  const day = override && isValidIsoDate(override) ? override : realToday;
  return { day, realToday, isToday: day === realToday };
}

export function TodayPage() {
  const db = useDb();
  const nav = useNavigate();
  const { day: today, realToday, isToday } = useDay();
  const [qlOpen, setQlOpen] = useState<'new' | 'edit' | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const go = (d: string) => nav(d === realToday ? '/' : `/?date=${d}`);
  const data = useLiveQuery(async () => {
    const program = await R.activeProgram(db);
    if (!program) return { program: null } as const;
    const schedule = await db.schedules.where('programId').equals(program.id).first();
    const plan = planForDate(schedule, today, program.weeks);
    const templates = await R.templatesOfProgram(db, program.id);
    const tplMap = new Map(templates.map((x) => [x.id, x]));
    const upcoming = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).map((d) => ({ date: d, plan: planForDate(schedule, d, program.weeks) }));
    let rows: { id: string; ex: Exercise | undefined; sets: number; reps: string; rest: number; ss: string | null; role: string }[] = [];
    let template: WorkoutTemplate | undefined;
    if (plan.kind === 'planned') {
      template = tplMap.get(plan.templateId);
      const r = await R.rowsOfTemplate(db, plan.templateId);
      const exs = await db.exercises.bulkGet(r.map((x) => x.exerciseId));
      rows = r.map((x, i) => ({ id: x.id, ex: exs[i], sets: setsForWeek(x.targetSetsByWeek, plan.week), reps: x.targetReps, rest: x.restSec, ss: x.supersetGroup, role: x.role }));
    }
    const warmEx = template ? await db.exercises.bulkGet(template.warmup.map((w) => w.exerciseId ?? '__none')) : [];
    const checked = ((await db.kv.get(`warmup:${today}`))?.value as string[] | undefined) ?? [];
    const logged = await R.sessionsOnDate(db, today);
    const doneDates = new Set((await db.sessions.where('localDate').between(today, addDays(today, 8), true, true).toArray()).filter((x) => x.status === 'completed').map((x) => `${x.localDate}|${x.templateId}`));
    const unresolved = await db.exercises.where('status').equals('unresolved').count();
    return { program, schedule, plan, template, rows, upcoming, tplMap, warmEx, checked, logged, unresolved, doneDates } as const;
  }, [db, today]);

  const phase = useMemo(() => (data?.program ? phaseOf(data.program.weeks, today) : null), [data, today]);

  if (!data) return null;
  const header = (
    <Group justify="space-between" align="flex-end" mb="md" wrap="nowrap">
      <Stack gap={2}>
        <Text c="dimmed" fz="sm" data-testid="today-date">{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        <Title order={1} fz={30}>{isToday ? t('today.title') : formatDate(today, { weekday: 'long' })}</Title>
      </Stack>
      <Group gap={0} wrap="nowrap">
        <ActionIcon aria-label={t('day.prev')} onClick={() => go(addDays(today, -1))} data-testid="day-prev"><IconChevronLeft /></ActionIcon>
        <ActionIcon aria-label={t('day.next')} onClick={() => go(addDays(today, 1))} data-testid="day-next"><IconChevronRight /></ActionIcon>
        <ActionIcon aria-label={t('day.fullPlan')} onClick={() => nav('/plan')} data-testid="open-plan"><IconCalendarMonth /></ActionIcon>
      </Group>
    </Group>
  );

  if (!data.program) {
    return (
      <>
        {header}
        <InstallBanner />
        <EmptyState icon={<IconBarbell />} title={t('today.noProgram')} body={t('today.noProgramBody')}
          action={<Group><Button leftSection={<IconFileImport size={18} />} onClick={() => nav('/import')}>{t('today.import')}</Button><Button variant="default" leftSection={<IconPlus size={18} />} onClick={() => nav('/programs')}>{t('today.createProgram')}</Button></Group>} />
      </>
    );
  }
  const { plan, template, rows, upcoming, tplMap, warmEx, checked, logged, unresolved, program, doneDates } = data;
  const done = plan.kind === 'planned' ? logged.find((x) => x.status === 'completed' && x.templateId === plan.templateId) : undefined;
  const saveNew = async (v: { durationMin: number | null; kneePain: number | null; energy: number | null; notes: string }) => {
    if (plan.kind !== 'planned') return;
    await markDone(db, { ...v, date: today, today: realToday, programId: program.id, templateId: plan.templateId, week: plan.week });
    setQlOpen(null);
    notifications.show({ message: t('ql.saved'), icon: <IconCheck size={16} />, autoClose: 1500 });
  };
  const saveEdit = async (v: { durationMin: number | null; kneePain: number | null; energy: number | null; notes: string }) => { if (done) await updateQuickLog(db, done.id, v); setQlOpen(null); };
  const toggleWarm = async (id: string) => {
    const next = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
    await db.kv.put({ key: `warmup:${today}`, value: next });
  };
  const ended = program.endDate && today > program.endDate;

  return (
    <>
      {header}
      <Stack gap="sm">
        {!isToday && <Button variant="subtle" size="sm" onClick={() => go(realToday)} data-testid="back-today" style={{ alignSelf: 'flex-start' }}>{t('day.backToToday')}</Button>}
        <Card withBorder radius="lg" padding="md" data-testid="today-card">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <div>
              <Text fz="xs" tt="uppercase" fw={700} c="dimmed">{program.name}</Text>
              {phase && <Text fz="sm" fw={600} c="mint" data-testid="week-phase">{t('today.weekPhase', { week: phase.week, phase: phase.phase, rpe: plan.kind === 'planned' && plan.targetRpe ? plan.targetRpe : phase.rpe })}</Text>}
            </div>
            {plan.kind === 'planned' && plan.source === 'exception' && <Badge variant="light">{t('today.exception')}</Badge>}
          </Group>
          {plan.kind === 'planned' && template && (
            <Stack gap={4} mt="sm">
              <Title order={2} data-testid="today-template">{template.name}</Title>
              <Text c="dimmed" fz="sm">{template.focus}</Text>
              {done ? (
                <Card withBorder padding="sm" radius="md" mt="xs" bg="var(--mantine-color-mint-light)" data-testid="done-card">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap={6} wrap="nowrap"><IconCircleCheckFilled color="var(--mantine-color-mint-5)" /><Text fw={700}>{done.logType === 'quick' || done.source === 'app' ? t('ql.done') : t('ql.importedDone')}</Text></Group>
                    {done.logType === 'quick' && (
                      <Group gap={4} wrap="nowrap">
                        <Button size="sm" variant="subtle" onClick={() => setQlOpen('edit')} data-testid="ql-edit">{t('ql.edit')}</Button>
                        <Button size="sm" variant="subtle" color="red" onClick={() => setUndoOpen(true)} data-testid="ql-undo">{t('ql.undo')}</Button>
                      </Group>
                    )}
                  </Group>
                  {(done.durationMin != null || done.kneePain != null || done.energy != null) && <Text fz="sm" mt={4} data-testid="done-summary">{t('ql.summary', { min: done.durationMin ?? t('ql.dash'), knee: done.kneePain ?? t('ql.dash'), energy: done.energy ?? t('ql.dash') })}</Text>}
                  {done.notes && <Text fz="sm" c="dimmed">{done.notes}</Text>}
                </Card>
              ) : today <= realToday ? (
                <Button size="lg" mt="xs" fullWidth leftSection={<IconCheck />} onClick={() => setQlOpen('new')} data-testid="mark-done">{t('ql.mark')}</Button>
              ) : (
                <Text fz="sm" c="dimmed" mt="xs" data-testid="future-note">{t('ql.future')}</Text>
              )}
              <Text fz="xs" c="dimmed">{t('today.startSoon')}</Text>
            </Stack>
          )}
          {plan.kind === 'rest' && <Stack gap={4} mt="sm"><Group gap="xs"><IconMoon /><Title order={2}>{t('today.rest')}</Title></Group><Text c="dimmed" fz="sm">{plan.note ?? t('today.restBody')}</Text></Stack>}
          {plan.kind === 'none' && <Stack gap={4} mt="sm"><Title order={3}>{ended ? t('today.programEnded') : t('today.nothing')}</Title><Text c="dimmed" fz="sm">{ended ? t('today.programEndedBody') : t('today.nothingBody')}</Text></Stack>}
        </Card>

        <BackupIndicator compact />
        {unresolved > 0 && (
          <Alert color="amber" variant="light" icon={<IconAlertCircle />} title={t('today.unresolved', { n: unresolved })} data-testid="unresolved-banner">
            <Text fz="sm">{t('today.unresolvedBody')}</Text>
            <Button size="sm" mt="xs" variant="light" color="amber" onClick={() => nav('/migration')}>{t('today.resolve')}</Button>
          </Alert>
        )}
        <InstallBanner />
        {template && template.warmup.length > 0 && (
          <Section title={t('today.warmup')} right={<Text fz="xs" c="dimmed">{t('today.warmupDone', { done: template.warmup.filter((w) => checked.includes(w.id)).length, total: template.warmup.length })}</Text>}>
            <Card withBorder padding="xs" radius="md">
              <Stack gap={0}>
                {template.warmup.map((w, i) => (
                  <Checkbox key={w.id} size="md" py={10} px={4} checked={checked.includes(w.id)} onChange={() => void toggleWarm(w.id)} data-testid="warmup-item"
                    label={<Group gap={6}><Text fw={500}>{warmEx[i]?.name ?? w.label}</Text><Text c="dimmed" fz="sm">{w.prescription}</Text></Group>} />
                ))}
              </Stack>
            </Card>
          </Section>
        )}

        {rows.length > 0 && (
          <Section title={t('today.exercises')}>
            {rows.map((r) => (
              <ExerciseCard key={r.id} testId="today-exercise" title={r.ex?.name ?? '?'} onClick={r.ex ? () => nav(`/library/${r.ex!.id}`) : undefined}
                meta={r.role === 'cardio' ? r.reps : `${t('common.sets', { n: r.sets })} · ${r.reps} · ${t('common.rest', { s: r.rest })}`}
                badges={<>{r.ss && <Badge variant="outline" size="sm">{t('today.superset', { g: r.ss })}</Badge>}{r.ex?.status === 'unresolved' && <Badge color="amber" size="sm">{t('library.unresolved')}</Badge>}<KneeBadge tags={r.ex?.tags ?? []} /></>} />
            ))}
          </Section>
        )}

        <Section title={t('today.upcoming')} right={<Button size="xs" variant="subtle" onClick={() => nav('/plan')} data-testid="full-plan-link">{t('day.fullPlan')}</Button>}>
          <Card withBorder padding="xs" radius="md">
            {upcoming.map(({ date, plan: p }) => <UpcomingRow key={date} date={date} plan={p} name={p.kind === 'planned' ? tplMap.get(p.templateId)?.name : undefined}
              done={p.kind === 'planned' && doneDates.has(`${date}|${p.templateId}`)} onOpen={() => go(date)} />)}
          </Card>
        </Section>
      </Stack>
      <QuickLogSheet opened={qlOpen !== null} title={qlOpen === 'edit' ? t('ql.editTitle', { name: template?.name ?? '' }) : t('ql.title', { name: template?.name ?? '' })}
        submitLabel={qlOpen === 'edit' ? t('ql.update') : t('ql.save')} onClose={() => setQlOpen(null)} onSubmit={qlOpen === 'edit' ? saveEdit : saveNew}
        initial={qlOpen === 'edit' && done ? { durationMin: done.durationMin ?? null, kneePain: done.kneePain ?? null, energy: done.energy ?? null, notes: done.notes } : undefined} />
      <ConfirmSheet opened={undoOpen} danger title={t('ql.undoTitle')} body={t('ql.undoBody')} confirmLabel={t('ql.undo')} onClose={() => setUndoOpen(false)}
        onConfirm={() => { if (done) void undoQuickLog(db, done.id).then(() => setUndoOpen(false)); }} />
    </>
  );
}

function UpcomingRow({ date, plan, name, done, onOpen }: { date: string; plan: DayPlan; name?: string; done: boolean; onOpen: () => void }) {
  return (
    <UnstyledButton onClick={onOpen} w="100%" mih={44} py={8} px={6} data-testid="upcoming-row" aria-label={`${formatDate(date)} ${name ?? ''}`}>
      <Group justify="space-between" wrap="nowrap">
        <Text fz="sm" w={110}>{formatDate(date)}</Text>
        <Group gap={6} wrap="nowrap" style={{ flex: 1 }} justify="flex-end">
          {done && <IconCircleCheckFilled size={18} color="var(--mantine-color-mint-5)" aria-hidden />}
          <Text fz="sm" fw={plan.kind === 'planned' ? 600 : 400} c={plan.kind === 'planned' ? undefined : 'dimmed'} ta="right">
            {plan.kind === 'planned' ? `${name ?? '?'}${plan.week ? ` · ${t('common.weekShort', { n: plan.week })}` : ''}` : plan.kind === 'rest' ? t('prog.restDay') : '–'}
          </Text>
          <IconChevronRight size={16} color="var(--mantine-color-dimmed)" aria-hidden />
        </Group>
      </Group>
    </UnstyledButton>
  );
}
