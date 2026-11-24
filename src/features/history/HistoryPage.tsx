import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Card, Collapse, Group, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconHistory } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { EmptyState, PageHeader } from '../../components/ui';
import * as R from '../../db/repos';

export function HistoryPage() {
  const db = useDb();
  const settings = useSettings();
  const sessions = useLiveQuery(async () => {
    const list = await R.completedSessions(db);
    return Promise.all(list.map(async (s) => {
      const tpl = s.templateId ? await db.templates.get(s.templateId) : undefined;
      const ses = await R.exercisesOfSession(db, s.id);
      const exs = await db.exercises.bulkGet(ses.map((x) => x.exerciseId));
      const sets = await Promise.all(ses.map((x) => R.setsOf(db, x.id)));
      return { s, tpl, items: ses.map((x, i) => ({ se: x, ex: exs[i], sets: sets[i] })), nSets: sets.reduce((n, a) => n + a.length, 0) };
    }));
  }, [db]);
  const [open, setOpen] = useState<string | null>(null);
  if (!sessions) return null;
  return (
    <>
      <PageHeader title={t('history.title')} subtitle={t('history.phaseNote')} />
      {sessions.length === 0 ? <EmptyState icon={<IconHistory />} title={t('history.empty')} body={t('history.emptyBody')} /> : (
        <Stack gap="sm">
          {sessions.map(({ s, tpl, items, nSets }) => (
            <Card key={s.id} withBorder radius="md" padding="sm" data-testid="history-session">
              <UnstyledButton onClick={() => setOpen(open === s.id ? null : s.id)} w="100%" mih={44} aria-expanded={open === s.id}>
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={700}>{tpl?.name ?? '—'}</Text>
                    <Text fz="sm" c="dimmed">{formatDate(s.localDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {t('history.sets', { n: nSets })}</Text>
                  </div>
                  <Group gap={6} wrap="nowrap">{s.source === 'notion_import' && <Badge variant="light" size="sm">{t('history.fromNotion')}</Badge>}{open === s.id ? <IconChevronDown /> : <IconChevronRight />}</Group>
                </Group>
              </UnstyledButton>
              <Collapse in={open === s.id}>
                <Stack gap="xs" mt="sm">
                  {items.map(({ se, ex, sets }) => (
                    <div key={se.id}>
                      <Group gap={6}><Text fw={600} fz="sm">{ex?.name ?? se.exerciseId}</Text>{se.supersetGroup && <Badge size="xs" variant="outline">{t('today.superset', { g: se.supersetGroup })}</Badge>}</Group>
                      {se.cardio ? <Text fz="sm" c="dimmed">{t('history.cardio', { min: se.cardio.durationMin ?? '–' })}</Text>
                        : sets.length === 0 ? <Text fz="sm" c="dimmed">{t('history.notRecorded')}</Text> : (
                          <Table withRowBorders={false} verticalSpacing={2} fz="sm">
                            <Table.Tbody>
                              {sets.map((x) => (
                                <Table.Tr key={x.id}><Table.Td w={40} c="dimmed">{x.orderIndex}</Table.Td><Table.Td>{formatWeight(x.weightKg, settings.weightUnit)} × {x.reps ?? '–'}</Table.Td>
                                  <Table.Td c="dimmed" ta="right">{x.setTypeConfidence === 'assumed' ? t('history.assumed') : x.setType}</Table.Td></Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        )}
                    </div>
                  ))}
                </Stack>
              </Collapse>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
