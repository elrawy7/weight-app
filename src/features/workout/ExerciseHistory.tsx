/** WO-12 / BR-PP-08: every past performance of an exercise, newest first (used in the workout sheet and the library page). */
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Card, Drawer, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { exerciseHistory } from './workoutOps';
import { setLabel } from './format';

export function ExerciseHistoryList({ exerciseId, excludeSessionId, limit = 50 }: { exerciseId: string; excludeSessionId?: string; limit?: number }) {
  const db = useDb();
  const settings = useSettings();
  const list = useLiveQuery(() => exerciseHistory(db, exerciseId, limit + 1), [db, exerciseId, limit]);
  if (!list) return null;
  const shown = list.filter((h) => h.sessionId !== excludeSessionId).slice(0, limit);
  if (!shown.length) return <Text c="dimmed" fz="sm" data-testid="history-empty">{t('wo.historyEmpty')}</Text>;
  return (
    <Stack gap="xs" data-testid="exercise-history">
      {shown.map((h) => (
        <Card key={h.sessionId} withBorder padding="xs" radius="md" data-testid="exercise-history-item">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} fz="sm">{formatDate(h.localDate, { weekday: 'short', day: 'numeric', month: 'short' })}{h.templateName ? ` · ${h.templateName}` : ''}{h.week ? ` · ${t('common.weekShort', { n: h.week })}` : ''}</Text>
            {h.painScore != null && <Badge size="sm" variant="light" color={h.painScore >= 4 ? 'orange' : 'gray'}>{t('wo.painShort', { n: h.painScore })}</Badge>}
          </Group>
          <Text fz="sm" data-testid="history-sets">{h.sets.map((x) => setLabel(x, settings.weightUnit)).join(' · ') || t('wo.cardioDone')}</Text>
          {h.best && <Text fz="xs" c="dimmed">{t('wo.bestSet', { set: setLabel(h.best, settings.weightUnit) })}</Text>}
          {h.notes && <Text fz="xs" c="dimmed">{h.notes}</Text>}
        </Card>
      ))}
    </Stack>
  );
}

export function ExerciseHistorySheet({ opened, onClose, exerciseId, name, excludeSessionId }: { opened: boolean; onClose: () => void; exerciseId: string | null; name: string; excludeSessionId?: string }) {
  return (
    <Drawer opened={opened} onClose={onClose} size="85%" title={<Text fw={700}>{t('wo.historyTitle', { name })}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <ScrollArea.Autosize mah="72vh">{exerciseId && <ExerciseHistoryList exerciseId={exerciseId} excludeSessionId={excludeSessionId} />}</ScrollArea.Autosize>
    </Drawer>
  );
}
