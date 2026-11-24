import { useLiveQuery } from 'dexie-react-hooks';
import { SimpleGrid, Stack } from '@mantine/core';
import { IconChartLine } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatWeight } from '../../domain/units';
import { formatDate } from '../../domain/dates';
import { EmptyState, PageHeader, StatCard } from '../../components/ui';

export function ProgressPage() {
  const db = useDb();
  const s = useSettings();
  const d = useLiveQuery(async () => ({
    first: await db.bodyMeasurements.orderBy('date').first(),
    goal: await db.goals.get('notion_goal_target_body_weight'),
    sessions: await db.sessions.where('status').equals('completed').count(),
  }), [db]);
  if (!d) return null;
  const toGo = d.first?.weightKg != null && d.goal?.target != null ? d.first.weightKg - d.goal.target : null;
  return (
    <>
      <PageHeader title={t('progress.title')} />
      <Stack>
        {(d.first || d.goal) && (
          <SimpleGrid cols={2} spacing="sm">
            {d.first?.weightKg != null && <StatCard label={t('progress.start')} value={formatWeight(d.first.weightKg, s.weightUnit)} hint={`${formatDate(d.first.date)}${d.first.dateConfidence === 'inferred' ? ` · ${t('progress.inferred')}` : ''}`} />}
            {d.goal?.target != null && <StatCard label={t('progress.goal')} value={formatWeight(d.goal.target, s.weightUnit)} hint={toGo != null ? `${t('progress.toGo')} ${formatWeight(toGo, s.weightUnit)}` : undefined} color="mint" />}
            <StatCard label={t('progress.sessions')} value={d.sessions} />
          </SimpleGrid>
        )}
        <EmptyState icon={<IconChartLine />} title={t('progress.soon')} body={t('progress.soonBody')} />
      </Stack>
    </>
  );
}
