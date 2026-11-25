/** Progress overview: body weight/goal cards, links to Records and Muscles, every exercise with history (AN-01 entry). */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Card, Group, SimpleGrid, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconChartLine, IconChevronRight, IconSearch, IconTrophy, IconBodyScan } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatWeight } from '../../domain/units';
import { formatDate } from '../../domain/dates';
import { EmptyState, PageHeader, StatCard } from '../../components/ui';
import { progressList } from './progressOps';

export function ProgressPage() {
  const db = useDb();
  const s = useSettings();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const d = useLiveQuery(async () => ({
    first: await db.bodyMeasurements.orderBy('date').first(),
    goal: await db.goals.get('notion_goal_target_body_weight'),
    sessions: await db.sessions.where('status').equals('completed').count(),
    records: await db.personalRecords.count(),
    list: await progressList(db),
  }), [db]);
  if (!d) return null;
  const toGo = d.first?.weightKg != null && d.goal?.target != null ? d.first.weightKg - d.goal.target : null;
  const list = d.list.filter((r) => !q || r.ex.name.toLowerCase().includes(q.toLowerCase()) || r.ex.nameAr.includes(q));
  const link = (icon: React.ReactNode, title: string, sub: string, to: string, testId: string) => (
    <Card withBorder radius="md" padding={0}>
      <UnstyledButton onClick={() => nav(to)} p="sm" w="100%" mih={64} data-testid={testId}>
        <Group justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap">{icon}<div><Text fw={700}>{title}</Text><Text fz="xs" c="dimmed">{sub}</Text></div></Group><IconChevronRight size={18} aria-hidden /></Group>
      </UnstyledButton>
    </Card>
  );
  return (
    <>
      <PageHeader title={t('progress.title')} />
      <Stack>
        <SimpleGrid cols={2} spacing="sm">
          {d.first?.weightKg != null && <StatCard label={t('progress.start')} value={formatWeight(d.first.weightKg, s.weightUnit)} hint={`${formatDate(d.first.date)}${d.first.dateConfidence === 'inferred' ? ` · ${t('progress.inferred')}` : ''}`} />}
          {d.goal?.target != null && <StatCard label={t('progress.goal')} value={formatWeight(d.goal.target, s.weightUnit)} hint={toGo != null ? `${t('progress.toGo')} ${formatWeight(toGo, s.weightUnit)}` : undefined} color="mint" />}
          <StatCard label={t('progress.sessions')} value={d.sessions} />
          <StatCard label={t('an.records')} value={d.records} />
        </SimpleGrid>
        {link(<IconTrophy color="var(--w-pr)" />, t('an.records'), t('an.recordsSub'), '/progress/records', 'open-records')}
        {link(<IconBodyScan />, t('an.muscles'), t('an.musclesSub'), '/progress/muscles', 'open-muscles')}
        <Text fz="xs" tt="uppercase" fw={700} c="dimmed" mt="xs">{t('an.exercises')}</Text>
        {d.list.length === 0 ? <EmptyState icon={<IconChartLine />} title={t('an.noData')} body={t('an.noDataBody')} /> : (
          <>
            {d.list.length > 6 && <TextInput leftSection={<IconSearch size={16} />} placeholder={t('an.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label={t('an.search')} />}
            <Stack gap={6}>
              {list.map((r) => (
                <Card key={r.ex.id} withBorder radius="md" padding={0}>
                  <UnstyledButton onClick={() => nav(`/progress/exercise/${r.ex.id}`)} p="sm" w="100%" mih={56} data-testid="progress-exercise" data-id={r.ex.id}>
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}><Text fw={600} lineClamp={1}>{r.ex.name}</Text><Text fz="xs" c="dimmed">{t('an.lastDone', { date: formatDate(r.last), n: r.sessions })}</Text></div>
                      <Group gap={6} wrap="nowrap">
                        {r.improvementPct != null && <Text fz="sm" fw={700} c={r.improvementPct > 0 ? 'mint' : r.improvementPct < 0 ? 'orange' : 'dimmed'}>{r.improvementPct > 0 ? '▲' : r.improvementPct < 0 ? '▼' : ''} {Math.abs(r.improvementPct)}%</Text>}
                        <IconChevronRight size={18} aria-hidden />
                      </Group>
                    </Group>
                  </UnstyledButton>
                </Card>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </>
  );
}
