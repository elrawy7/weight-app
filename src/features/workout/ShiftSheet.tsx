/** PROG-07: preview "do this day's workout today" – what moves where – then start with or without shifting the plan. */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Drawer, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowRight } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { planForDate } from '../../domain/schedule';
import type { ShiftPlan } from '../../domain/reschedule';
import * as R from '../../db/repos';
import { previewShift, startFromDay, undoShift } from './planShift';

const MAX_ROWS = 8;

export function ShiftSheet({ source, today, onClose }: { source: string | null; today: string; onClose: () => void }) {
  const db = useDb();
  const nav = useNavigate();
  const [plan, setPlan] = useState<ShiftPlan | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useLiveQuery(async () => {
    const p = await R.activeProgram(db);
    return new Map(p ? (await R.templatesOfProgram(db, p.id)).map((x) => [x.id, x.name]) : []);
  }, [db]) ?? new Map<string, string>();
  const pickedName = useLiveQuery(async () => {
    if (!source) return '';
    const p = await R.activeProgram(db);
    const s = p ? await db.schedules.where('programId').equals(p.id).first() : undefined;
    const d = planForDate(s, source, p?.weeks ?? []);
    return d.kind === 'planned' ? ((await db.templates.get(d.templateId))?.name ?? '') : '';
  }, [db, source]) ?? '';
  useEffect(() => {
    setPlan(null); setBlocked(null);
    if (!source) return;
    previewShift(db, today, source).then(setPlan).catch((e: unknown) => setBlocked(e instanceof Error ? e.message : t('common.error')));
  }, [db, source, today]);

  const go = async (shift: boolean) => {
    if (!source) return;
    setBusy(true);
    try {
      const s = await startFromDay(db, { today, source, shift, summary: pickedName });
      onClose();
      nav(`/workout/${s.id}`);
      if (shift) {
        notifications.show({ id: 'plan-shifted', autoClose: 8000, message: (
          <Group justify="space-between" wrap="nowrap"><Text fz="sm" style={{ flex: 1 }}>{t('shift.done')}</Text>
            <Button size="xs" variant="light" onClick={() => { notifications.hide('plan-shifted'); void undoShift(db).then(() => notifications.show({ message: t('shift.undone') })); }} data-testid="shift-undo">{t('ql.undo')}</Button></Group>) });
      }
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : t('common.error') });
    } finally { setBusy(false); }
  };

  const nm = (id: string | null) => (id ? names.get(id) ?? '?' : t('prog.restDay'));
  const wk = (w: number | null) => (w ? ` · ${t('common.weekShort', { n: w })}` : '');
  return (
    <Drawer opened={!!source} onClose={onClose} size="auto" title={<Text fw={700}>{t('shift.title', { name: pickedName })}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      
        <Stack gap="sm" pb="md" data-testid="shift-sheet">
          {plan && (
            <>
              <Text fz="sm">{plan.replaced ? t('shift.instead', { name: nm(plan.replaced.templateId) }) : t('shift.restDay')}</Text>
              <Card withBorder padding="xs" radius="md">
                <Stack gap={4} data-testid="shift-changes">
                  {plan.changes.slice(0, MAX_ROWS).map((c) => (
                    <Group key={c.date} gap={8} wrap="nowrap" align="flex-start" data-testid="shift-change">
                      <Text fz="sm" w={84} fw={c.date === today ? 700 : 500} style={{ flexShrink: 0 }}>{formatDate(c.date)}</Text>
                      <Text fz="sm" style={{ flex: 1 }}>
                        <Text span c="dimmed" td="line-through">{nm(c.before)}{c.before ? wk(c.beforeWeek) : ''}</Text>{' '}
                        <IconArrowRight size={13} aria-hidden style={{ verticalAlign: 'middle' }} />{' '}
                        <Text span fw={600}>{c.date < today && !c.after ? t('shift.moved') : `${nm(c.after)}${c.after ? wk(c.afterWeek) : ''}`}</Text>
                      </Text>
                    </Group>
                  ))}
                  {plan.changes.length > MAX_ROWS && <Text fz="xs" c="dimmed">{t('shift.more', { n: plan.changes.length - MAX_ROWS })}</Text>}
                </Stack>
              </Card>
              <Text fz="sm" data-testid="shift-end">{plan.newEnd !== plan.oldEnd && plan.newEnd && plan.oldEnd
                ? t('shift.endChanged', { now: formatDate(plan.newEnd), was: formatDate(plan.oldEnd) })
                : t('shift.endSame')}</Text>
              <Group gap={6}><Badge variant="light">{t('shift.restKept')}</Badge><Badge variant="light">{t('shift.weekTravels')}</Badge></Group>
              <Button size="lg" loading={busy} onClick={() => void go(true)} data-testid="shift-confirm">{t('shift.confirm')}</Button>
            </>
          )}
          {blocked && <Alert color="amber" variant="light" data-testid="shift-blocked">{blocked}</Alert>}
          {(plan || blocked) && <Button variant="default" loading={busy} onClick={() => void go(false)} data-testid="shift-extra">{t('shift.extra')}</Button>}
          <Button variant="subtle" onClick={onClose}>{t('common.cancel')}</Button>
        </Stack>
      
    </Drawer>
  );
}
