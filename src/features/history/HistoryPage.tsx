import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Collapse, Group, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconChevronDown, IconChevronRight, IconHistory } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { EmptyState, PageHeader } from '../../components/ui';
import * as R from '../../db/repos';
import { discardedSessions, quickToFull, restoreSession, restorableUntil } from '../workout/workoutOps';
import { setLabel } from '../workout/format';

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
  const nav = useNavigate();
  const discarded = useLiveQuery(async () => Promise.all((await discardedSessions(db)).map(async (s) => ({ s, tpl: s.templateId ? await db.templates.get(s.templateId) : undefined }))), [db]) ?? [];
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
                    <Text fz="sm" c="dimmed">{formatDate(s.localDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {t('history.sets', { n: nSets })}{s.durationMin != null ? ` · ${s.durationMin} ${t('common.min')}` : ''}</Text>
                  </div>
                  <Group gap={6} wrap="nowrap">{s.source === 'notion_import' && <Badge variant="light" size="sm">{t('history.fromNotion')}</Badge>}{open === s.id ? <IconChevronDown /> : <IconChevronRight />}</Group>
                </Group>
              </UnstyledButton>
              <Collapse in={open === s.id}>
                <Stack gap="xs" mt="sm">
                  {s.logType === 'quick' && (
                    <div data-testid="quick-summary">
                      <Text fz="sm">{t('ql.summary', { min: s.durationMin ?? t('ql.dash'), knee: s.kneePain ?? t('ql.dash'), energy: s.energy ?? t('ql.dash') })}</Text>
                      {s.notes && <Text fz="sm" c="dimmed">{s.notes}</Text>}
                      <Text fz="xs" c="dimmed">{t('ql.noSets')}</Text>
                    </div>
                  )}
                  {items.map(({ se, ex, sets }) => (
                    <div key={se.id}>
                      <Group gap={6}><Text fw={600} fz="sm">{ex?.name ?? se.exerciseId}</Text>{se.supersetGroup && <Badge size="xs" variant="outline">{t('today.superset', { g: se.supersetGroup })}</Badge>}</Group>
                      {se.status === 'skipped' ? <Text fz="sm" c="dimmed">{t('wo.skipped')}</Text> : se.cardio ? <Text fz="sm" c="dimmed">{t('history.cardio', { min: se.cardio.durationMin ?? '–' })}{se.cardio.distanceM ? ` · ${se.cardio.distanceM / 1000} km` : ''}{se.cardio.rounds ? ` · ${t('wo.roundsN', { n: se.cardio.rounds })}` : ''}</Text>
                        : sets.length === 0 ? <Text fz="sm" c="dimmed">{t('history.notRecorded')}</Text> : (
                          <Table withRowBorders={false} verticalSpacing={2} fz="sm">
                            <Table.Tbody>
                              {sets.map((x) => (
                                <Table.Tr key={x.id} style={x.completed ? undefined : { opacity: 0.5 }}><Table.Td w={40} c="dimmed">{x.orderIndex}</Table.Td><Table.Td>{x.durationSec && !x.reps ? setLabel(x, settings.weightUnit, false) : `${formatWeight(x.weightKg, settings.weightUnit)} × ${x.reps ?? '–'}`}</Table.Td>
                                  <Table.Td c="dimmed" ta="right">{x.setTypeConfidence === 'assumed' ? t('history.assumed') : !x.completed ? t('wo.notDone') : t(`wo.type_${x.setType}`)}</Table.Td></Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        )}
                    </div>
                  ))}
                  {s.notes && s.logType !== 'quick' && <Text fz="sm" c="dimmed">{s.notes}</Text>}
                  <Button variant="light" onClick={() => void (s.logType === 'quick' ? quickToFull(db, s.id) : Promise.resolve()).then(() => nav(`/workout/${s.id}`))} data-testid="history-open">{s.logType === 'quick' ? t('wo.addSetsToLog') : t('wo.viewSets')}</Button>
                </Stack>
              </Collapse>
            </Card>
          ))}
        </Stack>
      )}
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
