import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Checkbox, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconBarbell, IconMoon, IconAlertCircle, IconFileImport, IconPlus } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { addDays, deviceTimeZone, formatDate, isValidIsoDate, localDateOf } from '../../domain/dates';
import { phaseOf, planForDate, setsForWeek, type DayPlan } from '../../domain/schedule';
import { EmptyState, ExerciseCard, KneeBadge, Section } from '../../components/ui';
import { BackupIndicator, InstallBanner } from '../../components/banners';
import type { Exercise, WorkoutTemplate } from '../../db/types';
import * as R from '../../db/repos';

export function useToday(): string {
  const [sp] = useSearchParams();
  const db = useDb();
  const tz = useLiveQuery(async () => (await db.profile.get('me'))?.timezone, [db]) ?? deviceTimeZone();
  const override = sp.get('date');
  return override && isValidIsoDate(override) ? override : localDateOf(new Date(), tz);
}

export function TodayPage() {
  const db = useDb();
  const nav = useNavigate();
  const today = useToday();
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
    const unresolved = await db.exercises.where('status').equals('unresolved').count();
    return { program, schedule, plan, template, rows, upcoming, tplMap, warmEx, checked, logged, unresolved } as const;
  }, [db, today]);

  const phase = useMemo(() => (data?.program ? phaseOf(data.program.weeks, today) : null), [data, today]);

  if (!data) return null;
  const header = (
    <Stack gap={2} mb="md">
      <Text c="dimmed" fz="sm" data-testid="today-date">{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
      <Title order={1} fz={30}>{t('today.title')}</Title>
    </Stack>
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
  const { plan, template, rows, upcoming, tplMap, warmEx, checked, logged, unresolved, program } = data;
  const toggleWarm = async (id: string) => {
    const next = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
    await db.kv.put({ key: `warmup:${today}`, value: next });
  };
  const ended = program.endDate && today > program.endDate;

  return (
    <>
      {header}
      <InstallBanner />
      <Stack gap="sm">
        <BackupIndicator compact />
        {unresolved > 0 && (
          <Alert color="amber" variant="light" icon={<IconAlertCircle />} title={t('today.unresolved', { n: unresolved })} data-testid="unresolved-banner">
            <Text fz="sm">{t('today.unresolvedBody')}</Text>
            <Button size="sm" mt="xs" variant="light" color="amber" onClick={() => nav('/migration')}>{t('today.resolve')}</Button>
          </Alert>
        )}
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
              {logged.some((s) => s.status === 'completed') ? <Badge color="mint" mt={4}>{t('today.completedHere')}</Badge> : (
                <Tooltip label={t('today.startSoon')} multiline w={240} events={{ hover: true, focus: true, touch: true }}>
                  <Button size="lg" mt="xs" fullWidth disabled data-disabled aria-describedby="start-note">{t('today.start')}</Button>
                </Tooltip>
              )}
              <Text id="start-note" fz="xs" c="dimmed">{t('today.startSoon')}</Text>
            </Stack>
          )}
          {plan.kind === 'rest' && <Stack gap={4} mt="sm"><Group gap="xs"><IconMoon /><Title order={2}>{t('today.rest')}</Title></Group><Text c="dimmed" fz="sm">{plan.note ?? t('today.restBody')}</Text></Stack>}
          {plan.kind === 'none' && <Stack gap={4} mt="sm"><Title order={3}>{ended ? t('today.programEnded') : t('today.nothing')}</Title><Text c="dimmed" fz="sm">{ended ? t('today.programEndedBody') : t('today.nothingBody')}</Text></Stack>}
        </Card>

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

        <Section title={t('today.upcoming')}>
          <Card withBorder padding="xs" radius="md">
            {upcoming.map(({ date, plan: p }) => <UpcomingRow key={date} date={date} plan={p} name={p.kind === 'planned' ? tplMap.get(p.templateId)?.name : undefined} />)}
          </Card>
        </Section>
      </Stack>
    </>
  );
}

function UpcomingRow({ date, plan, name }: { date: string; plan: DayPlan; name?: string }) {
  return (
    <Group justify="space-between" py={10} px={6} wrap="nowrap" data-testid="upcoming-row">
      <Text fz="sm" w={110}>{formatDate(date)}</Text>
      <Text fz="sm" fw={plan.kind === 'planned' ? 600 : 400} c={plan.kind === 'planned' ? undefined : 'dimmed'} style={{ flex: 1 }} ta="right">
        {plan.kind === 'planned' ? `${name ?? '?'}${plan.week ? ` · ${t('common.weekShort', { n: plan.week })}` : ''}` : plan.kind === 'rest' ? t('prog.restDay') : '–'}
      </Text>
    </Group>
  );
}
