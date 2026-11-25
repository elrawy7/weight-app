/** PR-01: current records per exercise and the PR timeline. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Group, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { IconTrophy } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { EmptyState, PageHeader } from '../../components/ui';
import type { PRType } from '../../domain/records';
import { recordsOverview } from './progressOps';
import { prText, PR_LABEL_KEYS } from './prText';

export function RecordsPage() {
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const [view, setView] = useState<'current' | 'timeline'>('current');
  const d = useLiveQuery(() => recordsOverview(db), [db]);
  if (!d) return null;
  const label = (type: string) => t(PR_LABEL_KEYS[type as PRType] ?? 'pr.type.max_weight');
  return (
    <>
      <PageHeader back="/progress" title={t('an.records')} subtitle={t('an.recordsNote')} />
      {d.current.length === 0 ? <EmptyState icon={<IconTrophy />} title={t('an.noRecords')} body={t('an.noRecordsBody')} /> : (
        <Stack gap="sm" data-testid="records-page">
          <SegmentedControl fullWidth value={view} onChange={(v) => setView(v as 'current' | 'timeline')} data={[{ value: 'current', label: t('an.current') }, { value: 'timeline', label: t('an.timeline') }]} />
          {view === 'current' && d.current.map((c) => (
            <Card key={c.exerciseId} withBorder radius="md" padding={0} data-testid="record-card" data-exercise={c.exerciseId}>
              <UnstyledButton onClick={() => nav(`/progress/exercise/${c.exerciseId}`)} p="sm" w="100%">
                <Text fw={700}>{c.name}</Text>
                <Stack gap={2} mt={4}>
                  {c.bests.map((r) => (
                    <Group key={r.type} justify="space-between" wrap="nowrap">
                      <Text fz="sm" c="dimmed">{label(r.type)}</Text>
                      <Text fz="sm" fw={700} data-testid={`record-${r.type}`}>{prText({ type: r.type, value: r.value, weightKg: r.weightKg }, settings.weightUnit, true)} <Text span fz="xs" c="dimmed" fw={400}>· {formatDate(r.date)}</Text></Text>
                    </Group>
                  ))}
                </Stack>
              </UnstyledButton>
            </Card>
          ))}
          {view === 'timeline' && d.recent.slice(0, 100).map((r) => (
            <Card key={r.id} withBorder radius="md" padding={0}>
              <UnstyledButton onClick={() => nav(`/history/${r.sessionId}`)} p="sm" w="100%" mih={52} data-testid="record-event">
                <Group justify="space-between" wrap="nowrap">
                  <div><Text fw={600} fz="sm">{r.name || t('pr.type.session_volume')}</Text><Text fz="xs" c="dimmed">{label(r.type)} · {t('an.was', { v: prText({ type: r.type, value: r.previous ?? 0, weightKg: r.weightKg }, settings.weightUnit) })}</Text></div>
                  <Group gap={6} wrap="nowrap"><Text fw={700} fz="sm">{prText({ type: r.type, value: r.value, weightKg: r.weightKg }, settings.weightUnit)}</Text><Badge size="sm" color="amber" variant="light">{formatDate(r.achievedAt)}</Badge></Group>
                </Group>
              </UnstyledButton>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
