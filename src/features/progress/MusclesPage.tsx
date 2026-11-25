/** MG-01: fractional working sets per muscle, comparison with the previous period, "limited" flag, method explained. */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert, Card, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconInfoCircle, IconBodyScan } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { useToday } from '../../app/useToday';
import { t } from '../../i18n';
import { addDays, formatDate } from '../../domain/dates';
import { weekBounds } from '../../domain/analytics';
import { EmptyState, PageHeader } from '../../components/ui';
import { BarList } from '../../components/charts/LineChart';
import { muscleSummary } from './progressOps';

type Period = 'week' | 'last_week' | '4w';

export function MusclesPage() {
  const db = useDb();
  const settings = useSettings();
  const today = useToday();
  const [period, setPeriod] = useState<Period>('week');
  const [open, setOpen] = useState<string | null>(null);
  const wk = weekBounds(today, settings.weekStartsOn);
  const [from, to] = period === 'week' ? [wk.start, wk.end] : period === 'last_week' ? [addDays(wk.start, -7), addDays(wk.start, -1)] : [addDays(wk.end, -27), wk.end];
  const d = useLiveQuery(() => muscleSummary(db, from, to), [db, from, to, settings.secondaryMuscleWeight]);
  if (!d) return null;
  const weeks = d.days / 7;
  const min = settings.minWeeklySets * weeks;
  const names = new Map(d.groups.map((g) => [g.id, g.name]));
  const fmt = (v: number) => (Math.round(v * 10) / 10 === 1 ? t('an.set1') : t('an.setsN', { n: Math.round(v * 10) / 10 }));
  return (
    <>
      <PageHeader back="/progress" title={t('an.muscles')} subtitle={`${formatDate(from)} – ${formatDate(to)}`} />
      <Stack gap="sm" data-testid="muscles-page">
        <SegmentedControl fullWidth value={period} onChange={(v) => setPeriod(v as Period)} data={[{ value: 'week', label: t('an.thisWeek') }, { value: 'last_week', label: t('an.lastWeek') }, { value: '4w', label: t('an.fourWeeks') }]} data-testid="muscle-period" />
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="xs" data-testid="muscle-method">
          <Text fz="xs">{t('an.method', { sec: settings.secondaryMuscleWeight, min: settings.minWeeklySets })}</Text>
        </Alert>
        {d.rows.length === 0 ? <EmptyState icon={<IconBodyScan />} title={t('an.noMuscles')} body={t('an.noDataBody')} /> : (
          <Card withBorder radius="md" padding="sm">
            <BarList threshold={min} format={fmt} testId="muscle-bars"
              rows={d.rows.map((r) => {
                const delta = Math.round((r.sets - r.prev) * 10) / 10;
                const subs = Object.entries(r.sub).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${names.get(k) ?? k} ${v}`).join(' · ');
                return {
                  key: r.parentId, label: r.name, value: r.sets, flag: r.sets < min ? t('an.limited') : undefined, onClick: () => setOpen(open === r.parentId ? null : r.parentId),
                  sub: [delta !== 0 ? t('an.vsPrev', { d: `${delta > 0 ? '+' : ''}${delta}` }) : t('an.samePrev'), r.lastTrained ? t('an.lastTrained', { date: formatDate(r.lastTrained) }) : null, open === r.parentId && subs ? subs : null].filter(Boolean).join(' · '),
                };
              })} />
            <Group gap={6} mt="sm"><span aria-hidden style={{ width: 1, height: 12, background: 'var(--mantine-color-text)' }} /><Text fz="xs" c="dimmed">{t('an.minLine', { n: Math.round(min * 10) / 10 })}</Text></Group>
          </Card>
        )}
      </Stack>
    </>
  );
}
