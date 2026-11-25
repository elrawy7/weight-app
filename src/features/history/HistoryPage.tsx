/** HIST-01: history list and month calendar, filterable by program, muscle and exercise. */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Badge, Button, Card, Group, SegmentedControl, Select, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconHistory, IconTrophy } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { addDays, formatDate } from '../../domain/dates';
import { useToday } from '../../app/useToday';
import { formatWeight } from '../../domain/units';
import { WEEKDAYS } from '../../db/types';
import { EmptyState, PageHeader } from '../../components/ui';
import { discardedSessions, restoreSession, restorableUntil } from '../workout/workoutOps';
import { filterHistory, historyItems, type HistoryItem } from './historyOps';
import { parentList } from '../progress/muscleNames';

export function SessionRow({ item, onClick }: { item: HistoryItem; onClick: () => void }) {
  const settings = useSettings();
  const s = item.session;
  return (
    <Card withBorder radius="md" padding={0} data-testid="history-session">
      <UnstyledButton onClick={onClick} w="100%" p="sm" mih={56}>
        <Group justify="space-between" wrap="nowrap">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} lineClamp={1}>{item.templateName ?? t('wo.emptyName')}</Text>
            <Text fz="sm" c="dimmed">
              {formatDate(s.localDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              {s.logType === 'quick' ? ` · ${t('hist.quick')}` : ` · ${(item.setsDone === 1 ? t('history.set1') : t('history.sets', { n: item.setsDone }))}`}
              {item.volumeKg > 0 ? ` · ${formatWeight(item.volumeKg, settings.weightUnit)}` : ''}
              {s.durationMin != null ? ` · ${s.durationMin} ${t('common.min')}` : ''}
            </Text>
          </div>
          <Group gap={4} wrap="nowrap">
            {item.prCount > 0 && <Badge color="amber" variant="light" size="sm" leftSection={<IconTrophy size={12} />} data-testid="history-pr-count">{item.prCount}</Badge>}
            {s.source === 'notion_import' && <Badge variant="light" size="sm">{t('history.fromNotion')}</Badge>}
            {s.editedAt && <Badge variant="outline" color="gray" size="sm">{t('hist.edited')}</Badge>}
            <IconChevronRight size={18} aria-hidden />
          </Group>
        </Group>
      </UnstyledButton>
    </Card>
  );
}

function monthGrid(month: string, weekStartsOn: (typeof WEEKDAYS)[number]): string[] {
  const first = `${month}-01`;
  const startIdx = WEEKDAYS.indexOf(weekStartsOn);
  const firstIdx = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -((firstIdx - startIdx + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

export function HistoryPage() {
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const filter = { programId: params.get('program'), muscle: params.get('muscle'), exerciseId: params.get('exercise') };
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const data = useLiveQuery(async () => ({
    items: await historyItems(db),
    programs: await db.programs.toArray(),
    groups: parentList(await db.muscleGroups.toArray()),
    exercises: await db.exercises.toArray(),
  }), [db]);
  const discarded = useLiveQuery(async () => Promise.all((await discardedSessions(db)).map(async (s) => ({ s, tpl: s.templateId ? await db.templates.get(s.templateId) : undefined }))), [db]) ?? [];
  const today = useToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const items = useMemo(() => (data ? filterHistory(data.items, filter) : []), [data, filter.programId, filter.muscle, filter.exerciseId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const usedEx = new Set(data.items.flatMap((i) => i.exerciseIds));
  const byDate = new Map<string, HistoryItem[]>();
  for (const i of items) byDate.set(i.session.localDate, [...(byDate.get(i.session.localDate) ?? []), i]);
  const filtered = !!(filter.programId || filter.muscle || filter.exerciseId);
  const startIdx = WEEKDAYS.indexOf(settings.weekStartsOn);
  const dayNames = WEEKDAYS.map((_, i) => WEEKDAYS[(i + startIdx) % 7]);

  return (
    <>
      <PageHeader title={t('history.title')} right={<Button variant="subtle" size="sm" onClick={() => nav('/history/compare')} data-testid="history-compare">{t('hist.compare')}</Button>} />
      <Stack gap="sm">
        <SegmentedControl fullWidth value={view} onChange={(v) => setParam('view', v === 'calendar' ? 'calendar' : null)} data={[{ value: 'list', label: t('hist.list') }, { value: 'calendar', label: t('hist.calendar') }]} data-testid="history-view" />
        <SimpleGrid cols={3} spacing={6}>
          <Select aria-label={t('hist.program')} placeholder={t('hist.program')} clearable clearButtonProps={{ 'aria-label': t('hist.clearFilter') }} size="sm" value={filter.programId} onChange={(v) => setParam('program', v)} data={data.programs.map((p) => ({ value: p.id, label: p.name }))} data-testid="filter-program" comboboxProps={{ withinPortal: true }} />
          <Select aria-label={t('hist.muscle')} placeholder={t('hist.muscle')} clearable clearButtonProps={{ 'aria-label': t('hist.clearFilter') }} size="sm" value={filter.muscle} onChange={(v) => setParam('muscle', v)} data={data.groups.map((g) => ({ value: g.id, label: g.name }))} data-testid="filter-muscle" comboboxProps={{ withinPortal: true }} />
          <Select aria-label={t('hist.exercise')} placeholder={t('hist.exercise')} clearable searchable clearButtonProps={{ 'aria-label': t('hist.clearFilter') }} size="sm" value={filter.exerciseId} onChange={(v) => setParam('exercise', v)}
            data={data.exercises.filter((e) => usedEx.has(e.id)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ value: e.id, label: e.name }))} data-testid="filter-exercise" comboboxProps={{ withinPortal: true }} />
        </SimpleGrid>
        {filtered && <Text fz="xs" c="dimmed" data-testid="filter-count">{t('hist.showing', { n: items.length, total: data.items.length })}</Text>}

        {view === 'calendar' && (
          <Card withBorder radius="md" padding="xs" data-testid="history-calendar">
            <Group justify="space-between" mb={4}>
              <ActionIcon variant="subtle" aria-label={t('hist.prevMonth')} onClick={() => setMonth(shiftMonth(month, -1))}><IconChevronLeft /></ActionIcon>
              <Text fw={700} data-testid="calendar-month">{new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Text>
              <ActionIcon variant="subtle" aria-label={t('hist.nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}><IconChevronRight /></ActionIcon>
            </Group>
            <SimpleGrid cols={7} spacing={2}>
              {dayNames.map((d) => <Text key={d} ta="center" fz="xs" c="dimmed" fw={600}>{t(`wd.${d}`)}</Text>)}
              {monthGrid(month, settings.weekStartsOn).map((d) => {
                const n = byDate.get(d)?.length ?? 0;
                const inMonth = d.startsWith(month);
                return (
                  <UnstyledButton key={d} onClick={() => setDay(d)} aria-label={`${formatDate(d)}${n ? ` · ${t('hist.nWorkouts', { n })}` : ''}`} data-testid={`cal-${d}`} data-count={n}
                    style={{ minHeight: 44, borderRadius: 8, display: 'grid', placeItems: 'center', opacity: inMonth ? 1 : 0.35,
                      background: day === d ? 'var(--mantine-color-default-hover)' : undefined, outline: d === today ? '1px solid var(--mantine-color-mint-5)' : undefined }}>
                    <Stack gap={2} align="center">
                      <Text fz="sm" fw={n ? 700 : 400}>{Number(d.slice(8))}</Text>
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: n ? 'var(--mantine-color-mint-5)' : 'transparent' }} />
                    </Stack>
                  </UnstyledButton>
                );
              })}
            </SimpleGrid>
          </Card>
        )}

        {(view === 'list' ? items : day ? byDate.get(day) ?? [] : []).map((i) => <SessionRow key={i.session.id} item={i} onClick={() => nav(`/history/${i.session.id}`)} />)}
        {view === 'calendar' && day && !(byDate.get(day)?.length) && <Text c="dimmed" fz="sm" ta="center">{t('hist.noneThatDay', { date: formatDate(day) })}</Text>}
        {view === 'calendar' && !day && <Text c="dimmed" fz="sm" ta="center">{t('hist.tapDay')}</Text>}
        {view === 'list' && items.length === 0 && (data.items.length === 0
          ? <EmptyState icon={<IconHistory />} title={t('history.empty')} body={t('history.emptyBody')} />
          : <EmptyState icon={<IconHistory />} title={t('hist.noMatch')} action={<Button variant="light" onClick={() => setParams(new URLSearchParams(), { replace: true })}>{t('hist.clearFilters')}</Button>} />)}
      </Stack>

      {discarded.length > 0 && (
        <Stack gap="xs" mt="lg" data-testid="discarded-list">
          <Text fz="xs" tt="uppercase" fw={700} c="dimmed">{t('wo.recentlyDiscarded')}</Text>
          {discarded.map(({ s, tpl }) => (
            <Card key={s.id} withBorder radius="md" padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div><Text fw={600}>{tpl?.name ?? t('wo.emptyName')}</Text><Text fz="xs" c="dimmed">{formatDate(s.localDate)} · {t('wo.restorableUntil', { date: restorableUntil(s.discardedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) })}</Text></div>
                <Button variant="light" onClick={() => void restoreSession(db, s.id)} data-testid="restore-session">{t('wo.restore')}</Button>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
