/** HIST-02 session detail; HIST-03 edit; HIST-04 delete; HIST-05 repeat; HIST-06 compare entry. */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Drawer, Group, SimpleGrid, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconEdit, IconGitCompare, IconTrash, IconTrophy, IconAlertCircle } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { useToday } from '../../app/useToday';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { ConfirmSheet, EmptyState, PageHeader, StatCard } from '../../components/ui';
import { discardSession, quickToFull } from '../workout/workoutOps';
import { setLabel } from '../workout/format';
import { prText, PR_LABEL_KEYS } from '../progress/prText';
import type { PRType } from '../../domain/records';
import { historyItems, repeatSession, sessionDetail } from './historyOps';

export function SessionDetailPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const today = useToday();
  const [del, setDel] = useState(false);
  const [pick, setPick] = useState(false);
  const d = useLiveQuery(() => sessionDetail(db, id), [db, id]);
  const others = useLiveQuery(async () => (pick ? (await historyItems(db)).filter((i) => i.session.id !== id) : []), [db, id, pick]) ?? [];
  if (d === undefined) return null;
  if (!d || d.session.status === 'discarded') return <><PageHeader title={t('history.title')} back="/history" /><EmptyState icon={<IconAlertCircle />} title={t('wo.notFound')} /></>;
  const s = d.session;
  const unit = settings.weightUnit;
  const exName = new Map(d.exercises.map((x) => [x.se.exerciseId, x.ex?.name ?? x.se.exerciseId]));
  const running = s.status === 'active' || s.status === 'paused';
  const repeat = async () => {
    try { const n = await repeatSession(db, s.id, today); nav(`/workout/${n.id}`); } catch (e) { notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') }); }
  };

  return (
    <>
      <PageHeader back="/history" title={d.templateName ?? t('wo.emptyName')} subtitle={formatDate(s.localDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
      <Stack gap="sm" pb="xl" data-testid="session-detail">
        <Group gap={6}>
          {d.programName && <Badge variant="light" color="gray">{d.programName}{s.programWeek ? ` · ${t('common.weekShort', { n: s.programWeek })}` : ''}</Badge>}
          {s.source === 'notion_import' && <Badge variant="light" data-testid="chip-notion">{t('history.fromNotion')}</Badge>}
          {s.logType === 'quick' && <Badge variant="light" color="gray">{t('hist.quick')}</Badge>}
          {s.editedAt && <Badge variant="outline" color="gray" data-testid="chip-edited">{t('hist.editedOn', { date: formatDate(s.editedAt.slice(0, 10)) })}</Badge>}
          {running && <Badge color="mint">{t('wo.inProgress', { name: '' }).trim()}</Badge>}
        </Group>
        <SimpleGrid cols={3} spacing="xs">
          <StatCard label={t('hist.duration')} value={s.durationMin != null ? `${s.durationMin} ${t('common.min')}` : '—'} />
          <StatCard label={t('wo.sumSets')} value={<span data-testid="detail-sets">{d.summary.setsDone}</span>} />
          <StatCard label={t('wo.sumVolume')} value={<span data-testid="detail-volume">{d.summary.volumeKg ? formatWeight(d.summary.volumeKg, unit) : '—'}</span>} />
        </SimpleGrid>
        {(s.kneePain != null || s.energy != null) && <Text fz="sm" c="dimmed">{t('hist.kneeEnergy', { knee: s.kneePain ?? t('ql.dash'), energy: s.energy ?? t('ql.dash') })}</Text>}

        {d.records.length > 0 && (
          <Alert color="amber" variant="light" icon={<IconTrophy />} title={t('hist.prsHere', { n: d.records.length })} data-testid="detail-prs">
            <Stack gap={2}>
              {d.records.map((r) => <Text key={r.id} fz="sm">{r.exerciseId === '__session' ? t(PR_LABEL_KEYS.session_volume) : exName.get(r.exerciseId) ?? r.exerciseId} · {t(PR_LABEL_KEYS[r.type as PRType] ?? 'pr.type.max_weight')}: <b>{prText({ type: r.type, value: r.value, weightKg: r.weightKg }, unit, true)}</b></Text>)}
            </Stack>
          </Alert>
        )}

        {s.logType === 'quick' && (
          <Card withBorder padding="sm" data-testid="quick-summary">
            <Text fz="sm">{t('ql.summary', { min: s.durationMin ?? t('ql.dash'), knee: s.kneePain ?? t('ql.dash'), energy: s.energy ?? t('ql.dash') })}</Text>
            <Text fz="xs" c="dimmed">{t('ql.noSets')}</Text>
          </Card>
        )}

        {d.exercises.map(({ se, ex, sets, volumeKg }) => (
          <Card key={se.id} withBorder radius="md" padding="sm" data-testid="detail-exercise">
            <Group justify="space-between" wrap="nowrap">
              <UnstyledButton onClick={() => ex && nav(`/progress/exercise/${ex.id}`)} mih={32}><Text fw={700}>{ex?.name ?? se.exerciseId}</Text></UnstyledButton>
              <Group gap={4}>{se.supersetGroup && <Badge size="xs" variant="outline">{t('today.superset', { g: se.supersetGroup })}</Badge>}{volumeKg > 0 && <Text fz="xs" c="dimmed">{formatWeight(volumeKg, unit)}</Text>}</Group>
            </Group>
            {se.status === 'skipped' ? <Text fz="sm" c="dimmed">{t('wo.skipped')}</Text>
              : se.cardio ? <Text fz="sm">{t('history.cardio', { min: se.cardio.durationMin ?? '–' })}{se.cardio.distanceM ? ` · ${se.cardio.distanceM / 1000} km` : ''}{se.cardio.inclinePct ? ` · ${se.cardio.inclinePct}%` : ''}{se.cardio.speedKmh ? ` · ${se.cardio.speedKmh} km/h` : ''}{se.cardio.rounds ? ` · ${t('wo.roundsN', { n: se.cardio.rounds })}` : ''}</Text>
              : sets.length === 0 ? <Text fz="sm" c="dimmed">{t('history.notRecorded')}</Text> : (
                <Table withRowBorders={false} verticalSpacing={2} fz="sm">
                  <Table.Tbody>
                    {sets.map((x) => (
                      <Table.Tr key={x.id} style={x.completed ? undefined : { opacity: 0.5 }} data-testid="detail-set">
                        <Table.Td w={36} c="dimmed">{x.setType === 'warmup' ? t('wo.typeW') : x.orderIndex}</Table.Td>
                        <Table.Td>{x.durationSec && !x.reps ? setLabel(x, unit, false) : `${formatWeight(x.weightKg, unit)} × ${x.reps ?? '–'}`}{x.rpe != null ? ` @ ${x.rpe}` : ''}</Table.Td>
                        <Table.Td c="dimmed" ta="right">{x.setTypeConfidence === 'assumed' ? t('history.assumed') : !x.completed ? t('wo.notDone') : t(`wo.type_${x.setType}`)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            {se.painScore != null && <Text fz="xs" c={se.painScore >= 4 ? 'orange' : 'dimmed'}>{t('wo.painShort', { n: se.painScore })}</Text>}
            {se.notes && <Text fz="xs" c="dimmed">{se.notes}</Text>}
          </Card>
        ))}
        {s.notes && <Card withBorder padding="sm"><Text fz="sm">{s.notes}</Text></Card>}

        <Button leftSection={<IconEdit size={18} />} onClick={() => void (s.logType === 'quick' ? quickToFull(db, s.id) : Promise.resolve()).then(() => nav(`/workout/${s.id}`))} data-testid="history-open">
          {s.logType === 'quick' ? t('wo.addSetsToLog') : running ? t('wo.continue') : t('hist.edit')}
        </Button>
        {!running && (
          <Group grow gap="xs">
            <Button variant="light" leftSection={<IconCopy size={18} />} onClick={() => void repeat()} data-testid="history-repeat">{t('hist.repeat')}</Button>
            <Button variant="light" leftSection={<IconGitCompare size={18} />} onClick={() => setPick(true)} data-testid="history-compare-with">{t('hist.compareWith')}</Button>
          </Group>
        )}
        <Button variant="subtle" color="red" leftSection={<IconTrash size={18} />} onClick={() => setDel(true)} data-testid="history-delete">{t('wo.delete')}</Button>
      </Stack>

      <Drawer opened={pick} onClose={() => setPick(false)} size="auto" title={<Text fw={700}>{t('hist.compareWith')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
        <Stack gap={2}>
          {others.map((i) => (
            <UnstyledButton key={i.session.id} onClick={() => nav(`/history/compare?a=${i.session.id}&b=${s.id}`)} py={10} px={6} mih={48} data-testid="compare-pick">
              <Text fw={600}>{i.templateName ?? t('wo.emptyName')}</Text>
              <Text fz="xs" c="dimmed">{formatDate(i.session.localDate)}</Text>
            </UnstyledButton>
          ))}
          {!others.length && <Text c="dimmed" fz="sm">{t('hist.nothingToCompare')}</Text>}
        </Stack>
      </Drawer>
      <ConfirmSheet opened={del} danger title={t('wo.deleteTitle')} body={t('wo.discardBody')} confirmLabel={t('wo.delete')} onClose={() => setDel(false)}
        onConfirm={() => void discardSession(db, s.id).then(() => { setDel(false); nav('/history'); notifications.show({ message: t('wo.discarded') }); })} />
    </>
  );
}

