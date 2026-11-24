import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronRight } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { addDays, diffDays, formatDate } from '../../domain/dates';
import { planForDate } from '../../domain/schedule';
import { EmptyState, PageHeader, Section } from '../../components/ui';
import { dayStatus, type DayStatus } from './quickLog';
import { useDay } from './TodayPage';
import * as R from '../../db/repos';
import { restNote } from './notes';
import { PLAN_UNDO_KEY, undoShift, type PlanUndo } from '../workout/planShift';

const COLOR: Record<DayStatus, string> = { done: 'mint', today: 'blue', missed: 'orange', upcoming: 'gray', rest: 'gray', none: 'gray' };

/** PROG-06: every day of the program with its workout and status; tap a day to open it. */
export function PlanPage() {
  const db = useDb();
  const nav = useNavigate();
  const { realToday } = useDay();
  const d = useLiveQuery(async () => {
    const program = await R.activeProgram(db);
    if (!program) return { program: null } as const;
    const schedule = await db.schedules.where('programId').equals(program.id).first();
    const tpl = new Map((await R.templatesOfProgram(db, program.id)).map((x) => [x.id, x.name]));
    const completed = (await db.sessions.where('status').equals('completed').toArray()).map((s) => ({ localDate: s.localDate, templateId: s.templateId }));
    const undo = (await db.kv.get(PLAN_UNDO_KEY))?.value as PlanUndo | undefined;
    const ranges = program.weeks.length
      ? program.weeks.map((w) => ({ week: w.week, title: `${t('common.week', { n: w.week })} · ${w.phase} · ${t('common.rpe', { v: w.rpe })}`, start: w.startDate, end: w.endDate }))
      : [{ week: 0, title: t('plan.noWeeks'), start: realToday, end: addDays(realToday, 27) }];
    const weeks = ranges.map((r) => ({
      title: r.title, week: r.week,
      days: Array.from({ length: diffDays(r.end, r.start) + 1 }, (_, i) => addDays(r.start, i)).map((date) => {
        const plan = planForDate(schedule, date, program.weeks);
        return { date, plan, name: plan.kind === 'planned' ? tpl.get(plan.templateId) : undefined, status: dayStatus(date, realToday, plan, completed) };
      }),
    }));
    const all = weeks.flatMap((w) => w.days).filter((x) => x.plan.kind === 'planned');
    return { program, weeks, done: all.filter((x) => x.status === 'done').length, total: all.length, undo } as const;
  }, [db, realToday]);
  if (!d) return null;
  if (!d.program) return <><PageHeader title={t('plan.title')} back /><EmptyState title={t('plan.noProgram')} /></>;
  return (
    <>
      <PageHeader title={t('plan.title')} back subtitle={d.program.name} />
      <Card withBorder padding="sm" radius="md">
        <Text fw={600} data-testid="plan-progress">{t('plan.progress', { done: d.done, total: d.total })}</Text>
        <Progress mt={6} value={d.total ? (100 * d.done) / d.total : 0} size="lg" radius="xl" />
      </Card>
      {d.undo && (
        <Card withBorder padding="sm" radius="md" mt="sm" data-testid="plan-undo-card">
          <Group justify="space-between" wrap="nowrap">
            <Text fz="sm">{t('shift.lastChange', { name: d.undo.summary })}</Text>
            <Button variant="light" onClick={() => void undoShift(db).then(() => notifications.show({ message: t('shift.undone') }))} data-testid="plan-undo">{t('shift.undoPlan')}</Button>
          </Group>
        </Card>
      )}
      {d.weeks.map((w) => (
        <Section key={w.title} title={w.title}>
          <Card withBorder padding={4} radius="md">
            <Stack gap={0}>
              {w.days.map((x) => (
                <UnstyledButton key={x.date} onClick={() => nav(x.date === realToday ? '/' : `/?date=${x.date}`)} mih={48} px={8} py={6} data-testid="plan-day"
                  aria-label={`${formatDate(x.date)} ${x.name ?? t(`plan.status.${x.status}` as MsgKey)}`}
                  style={x.date === realToday ? { background: 'var(--mantine-color-blue-light)', borderRadius: 8 } : undefined}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text fz="sm" w={104} fw={x.date === realToday ? 700 : 400}>{formatDate(x.date)}</Text>
                    <Text fz="sm" fw={x.plan.kind === 'planned' ? 600 : 400} c={x.plan.kind === 'planned' ? undefined : 'dimmed'} style={{ flex: 1 }} lineClamp={1}>
                      {x.plan.kind === 'planned' ? `${x.name ?? ''}${x.plan.week && w.week && x.plan.week !== w.week ? ` · ${t('common.weekShort', { n: x.plan.week })}` : ''}` : x.plan.kind === 'rest' ? (restNote(x.plan.note) ?? t('prog.restDay')) : '–'}
                    </Text>
                    {x.plan.kind === 'planned' && <Badge size="sm" variant="light" color={COLOR[x.status]} data-testid={`status-${x.date}`}>{t(`plan.status.${x.status}` as MsgKey)}</Badge>}
                    <IconChevronRight size={16} color="var(--mantine-color-dimmed)" aria-hidden />
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          </Card>
        </Section>
      ))}
    </>
  );
}
