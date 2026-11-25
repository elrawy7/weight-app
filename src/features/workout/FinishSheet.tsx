/** WO-10 AC2: summary before saving (duration, sets, volume, PRs, incomplete exercises, pain) + knee / energy / note. */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { Alert, Badge, Button, Drawer, Group, NumberInput, ScrollArea, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatWeight } from '../../domain/units';
import type { WorkoutSession } from '../../db/types';
import { Scale } from '../today/QuickLogSheet';
import { StatCard } from '../../components/ui';
import * as W from './workoutOps';
import { prText } from '../progress/prText';

export function FinishSheet({ opened, onClose, session, live, stale, onSaved }: { opened: boolean; onClose: () => void; session: WorkoutSession; live: boolean; stale: boolean; onSaved: () => void }) {
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const running = session.status === 'active' || session.status === 'paused';
  const info = useLiveQuery(async () => (opened ? { sum: await W.summarize(db, session.id), prs: await W.sessionPRs(db, session.id) } : null), [db, session.id, opened]);
  const [knee, setKnee] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    setKnee(session.kneePain ?? null); setEnergy(session.energy ?? null); setNotes(session.notes ?? ''); setError(null);
    // Live: elapsed clock (BR-SES-08). Stale: up to the last activity. Back-logged / editing: what you enter.
    const m = !running ? session.durationMin : live ? Math.round(W.elapsedMs(stale && session.lastActivityAt ? { ...session, endedAt: session.lastActivityAt } : session) / 60000) : session.durationMin;
    setMinutes(m ?? '');
  }, [opened, session, running, live, stale]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const extra = { kneePain: knee, energy, notes, durationMin: minutes === '' ? null : Number(minutes) };
      if (running) await W.finishSession(db, session.id, { ...extra, endedAt: stale && session.lastActivityAt ? session.lastActivityAt : undefined });
      else await W.updateSummary(db, session.id, extra);
      onSaved();
      // BAK-03 AC1: a PR session just saved → backup reminder banner
      if (running && info?.prs.length) {
        notifications.show({ id: 'pr-backup', color: 'amber', autoClose: 8000, message: (
          <Group justify="space-between" wrap="nowrap"><Text fz="sm" style={{ flex: 1 }}>{t('wo.prBackup')}</Text>
            <Button size="xs" variant="light" color="amber" style={{ flexShrink: 0 }} onClick={() => { notifications.hide('pr-backup'); nav('/backup'); }} data-testid="pr-backup">{t('wo.backupNow')}</Button></Group>) });
      }
    } catch (e) { setError(e instanceof Error ? e.message : t('common.error')); } finally { setBusy(false); }
  };
  const sum = info?.sum;
  return (
    <Drawer opened={opened} onClose={onClose} size="92%" title={<Text fw={700}>{running ? t('wo.finishTitle') : t('wo.editSummary')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <ScrollArea.Autosize mah="80vh">
        <Stack gap="sm" pb="md" data-testid="finish-sheet">
          {sum && (
            <>
              <SimpleGrid cols={3} spacing="xs">
                <StatCard label={t('wo.sumSets')} value={<span data-testid="sum-sets">{t('wo.ofN', { a: sum.setsDone, b: sum.setsPlanned })}</span>} />
                <StatCard label={t('wo.sumVolume')} value={<span data-testid="sum-volume">{formatWeight(sum.volumeKg, settings.weightUnit)}</span>} />
                <StatCard label={t('wo.sumExercises')} value={sum.exercisesDone} />
              </SimpleGrid>
              {info.prs.length > 0 && (
                <Alert color="amber" variant="light" title={t('wo.newBests')} data-testid="sum-prs">
                  <Stack gap={2}>{info.prs.map((p) => <Group key={p.setId} gap={6}><Badge color="amber" size="sm">{t('wo.pr')}</Badge><Text fz="sm">{p.exerciseName} · {prText(p, settings.weightUnit)}</Text></Group>)}</Stack>
                </Alert>
              )}
              {sum.incomplete.length > 0 && running && <Alert color="gray" variant="light" title={t('wo.incomplete')} data-testid="sum-incomplete"><Text fz="sm">{sum.incomplete.join(', ')}</Text><Text fz="xs" c="dimmed" mt={4}>{t('wo.incompleteNote')}</Text></Alert>}
              {sum.painFlags.length > 0 && <Alert color="orange" variant="light" title={t('wo.painFlags')}><Text fz="sm">{sum.painFlags.join(', ')}</Text></Alert>}
            </>
          )}
          <NumberInput label={t('ql.minutes')} min={0} max={600} decimalScale={0} value={minutes} onChange={(v) => setMinutes(typeof v === 'number' ? v : v === '' ? '' : Number(v))}
            description={live && running ? t('wo.minutesLive') : t('wo.minutesManual')} data-testid="finish-minutes" />
          <div><Text fz="sm" fw={500} mb={4}>{t('ql.knee')}</Text><Scale values={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} cols={6} value={knee} onChange={setKnee} label={t('ql.knee')} testId="finish-knee" /></div>
          <div><Text fz="sm" fw={500} mb={4}>{t('ql.energy')}</Text><Scale values={[1, 2, 3, 4, 5]} cols={5} value={energy} onChange={setEnergy} label={t('ql.energy')} testId="finish-energy" /></div>
          <Textarea label={t('ql.notes')} autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} data-testid="finish-notes" />
          {error && <Alert color="red">{error}</Alert>}
          <Button size="lg" onClick={() => void save()} loading={busy} data-testid="finish-save">{running ? t('wo.saveWorkout') : t('ql.update')}</Button>
          {running && <Button variant="default" onClick={onClose}>{t('wo.keepGoing')}</Button>}
        </Stack>
      </ScrollArea.Autosize>
    </Drawer>
  );
}
