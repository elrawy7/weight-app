/** AN-01 / AN-02: one exercise's progress – stats, chart with ranges (tap a point → that workout), records, history. */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Card, Chip, Group, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconChartLine, IconInfoCircle, IconTrophy } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { useToday } from '../../app/useToday';
import { t, type MsgKey } from '../../i18n';
import { formatDate, isValidIsoDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { metricsFor, series, rangeStart, inRange, RANGES, type Metric, type Range } from '../../domain/analytics';
import { EmptyState, PageHeader, StatCard } from '../../components/ui';
import { LineChart } from '../../components/charts/LineChart';
import { ExerciseHistoryList } from '../workout/ExerciseHistory';
import { exerciseProgress } from './progressOps';
import { prText, PR_LABEL_KEYS } from './prText';
import type { PRType } from '../../domain/records';

const METRIC_KEY: Record<Metric, MsgKey> = { top_weight: 'an.m.top_weight', e1rm: 'an.m.e1rm', volume: 'an.m.volume', max_reps: 'an.m.max_reps', total_reps: 'an.m.total_reps', duration: 'an.m.duration', distance: 'an.m.distance' };

export function ExerciseProgressPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const today = useToday();
  const d = useLiveQuery(() => exerciseProgress(db, id), [db, id]);
  const [metric, setMetric] = useState<Metric | null>(null);
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const unit = settings.weightUnit;
  const metrics = d ? metricsFor(d.ex.loadMode, d.ex.tracking) : [];
  const m = metric && metrics.includes(metric) ? metric : metrics[0];
  const points = useMemo(() => {
    if (!d || !m) return [];
    const prSessions = new Set(d.records.filter((r) => (m === 'top_weight' ? r.type === 'max_weight' : m === 'e1rm' ? r.type === 'e1rm' : m === 'volume' ? r.type === 'exercise_volume' : m === 'max_reps' ? r.type === 'max_reps' : m === 'duration' ? r.type === 'duration' : r.type === 'distance')).map((r) => r.sessionId));
    const all = series(d.perfs, m, d.ex.loadMode, settings.e1rmFormula).map((p) => ({ x: p.date, value: p.value, id: p.sessionId, pr: prSessions.has(p.sessionId), date: p.date }));
    const [f, tt] = range === 'custom' ? [isValidIsoDate(from) ? from : null, isValidIsoDate(to) ? to : null] : [rangeStart(range, today), null];
    return inRange(all, f, tt);
  }, [d, m, range, from, to, today, settings.e1rmFormula]);
  if (d === undefined) return null;
  if (!d) return <><PageHeader title={t('progress.title')} back="/progress" /><EmptyState icon={<IconChartLine />} title={t('wo.notFound')} /></>;
  const { ex, stats } = d;
  const kg = (v: number) => formatWeight(v, unit);
  const fmt = (v: number) => (m === 'top_weight' || m === 'e1rm' || m === 'volume' ? kg(v) : m === 'duration' ? `${v} ${t('common.min')}` : m === 'distance' ? `${v} km` : `${v} ${t('wo.repsShort')}`);
  const perHand = ex.loadMode === 'per_hand';
  return (
    <>
      <PageHeader back="/progress" title={ex.name} subtitle={ex.nameAr || undefined} />
      <Stack gap="sm" pb="xl" data-testid="exercise-progress">
        {perHand && <Text fz="xs" c="dimmed">{t('an.perHandNote')}</Text>}
        {stats.sessions === 0 ? <EmptyState icon={<IconChartLine />} title={t('an.noData')} body={t('an.noDataBody')} /> : (
          <>
            {metrics.length > 1 && <SegmentedControl fullWidth value={m} onChange={(v) => setMetric(v as Metric)} data={metrics.map((x) => ({ value: x, label: t(METRIC_KEY[x]) }))} data-testid="metric-control" />}
            <Group gap={4} data-testid="range-chips">
              {RANGES.map((r) => <Chip key={r} size="xs" checked={range === r} onChange={() => setRange(r)} data-testid={`range-${r}`}>{t(`an.r.${r}`)}</Chip>)}
            </Group>
            {range === 'custom' && (
              <SimpleGrid cols={2} spacing="xs">
                <TextInput type="date" label={t('an.from')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} data-testid="range-from" />
                <TextInput type="date" label={t('an.to')} value={to} onChange={(e) => setTo(e.currentTarget.value)} data-testid="range-to" />
              </SimpleGrid>
            )}
            <Card withBorder radius="md" padding="sm">
              <Text fw={700} fz="sm" mb={4}>{t(METRIC_KEY[m])}{m === 'top_weight' && perHand ? ` (${t('an.perHand')})` : ''}</Text>
              {points.length >= 2
                ? <LineChart points={points} format={fmt} xLabel={(x) => formatDate(x)} onSelect={(sid) => nav(`/history/${sid}`)} label={`${t(METRIC_KEY[m])} – ${ex.name}`} testId="progress-chart" />
                : <Text c="dimmed" fz="sm" data-testid="chart-empty">{points.length === 1 ? t('an.oneMore', { v: fmt(points[0].value), date: formatDate(points[0].x) }) : t('an.noneInRange')}</Text>}
              <Text fz="xs" c="dimmed" mt={4}>{t('an.tapPoint')}</Text>
            </Card>

            <SimpleGrid cols={2} spacing="xs" data-testid="exercise-stats">
              {stats.maxWeight && <StatCard label={t('an.maxWeight')} value={<span data-testid="stat-max-weight">{kg(stats.maxWeight.value)}</span>} hint={formatDate(stats.maxWeight.date)} />}
              {stats.bestE1rm && <StatCard label={t('an.e1rm')} value={<span data-testid="stat-e1rm">{kg(stats.bestE1rm.value)}</span>} hint={formatDate(stats.bestE1rm.date)} />}
              {stats.bestSet && <StatCard label={t('an.bestSet')} value={`${stats.bestSet.weightKg ? kg(stats.bestSet.weightKg) : t('wo.bw')} × ${stats.bestSet.reps ?? '–'}`} hint={formatDate(stats.bestSet.date)} />}
              {stats.maxReps && <StatCard label={t('an.maxReps')} value={stats.maxReps.value} hint={stats.maxReps.weightKg ? `@ ${kg(stats.maxReps.weightKg)}` : undefined} />}
              {stats.first && <StatCard label={t('an.first')} value={stats.first.text || '—'} hint={formatDate(stats.first.date)} />}
              {stats.last && <StatCard label={t('an.last')} value={stats.last.text || '—'} hint={formatDate(stats.last.date)} />}
              {stats.totalVolume > 0 && <StatCard label={t('an.totalVolume')} value={kg(stats.totalVolume)} />}
              {stats.avgWorkingWeight != null && <StatCard label={t('an.avgWeight')} value={kg(stats.avgWorkingWeight)} />}
              <StatCard label={t('an.totalSets')} value={stats.totalSets} hint={t('an.inSessions', { n: stats.sessions })} />
              <StatCard label={t('an.frequency')} value={stats.perWeek != null ? t('an.perWeek', { n: stats.perWeek }) : '—'} hint={stats.perWeek == null ? t('an.needWeek') : undefined} />
              <StatCard label={t('an.improvement')} value={<span data-testid="stat-improvement">{stats.improvementPct != null ? `${stats.improvementPct > 0 ? '+' : ''}${stats.improvementPct}%` : '—'}</span>}
                hint={stats.improvementBasis ? t('an.basis', { m: t(METRIC_KEY[stats.improvementBasis]) }) : t('an.needTwo')} />
            </SimpleGrid>
            <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="xs"><Text fz="xs">{t('an.how')}</Text></Alert>

            {d.records.length > 0 && (
              <Card withBorder radius="md" padding="sm" data-testid="exercise-records">
                <Group gap={6} mb={4}><IconTrophy size={18} color="var(--w-pr)" /><Text fw={700}>{t('an.records')}</Text></Group>
                <Stack gap={4}>
                  {d.records.slice(0, 12).map((r) => (
                    <Group key={r.id} justify="space-between" wrap="nowrap" onClick={() => nav(`/history/${r.sessionId}`)} style={{ cursor: 'pointer' }} mih={32}>
                      <Text fz="sm">{t(PR_LABEL_KEYS[r.type as PRType] ?? 'pr.type.max_weight')}: <b>{prText({ type: r.type, value: r.value, weightKg: r.weightKg }, unit, true)}</b></Text>
                      <Badge variant="light" color="amber" size="sm">{formatDate(r.achievedAt)}</Badge>
                    </Group>
                  ))}
                </Stack>
              </Card>
            )}
          </>
        )}
        <Text fz="xs" tt="uppercase" fw={700} c="dimmed" mt="xs">{t('wo.yourHistory')}</Text>
        <ExerciseHistoryList exerciseId={ex.id} />
      </Stack>
    </>
  );
}
