/**
 * WO-01 AC2 + PROG-07: start another workout. Today: pick any planned day (missed or upcoming → shift preview) or an
 * extra workout that leaves the plan alone. A past day (logging afterwards): pick any template or an empty workout.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Drawer, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import * as R from '../../db/repos';
import { shiftSources } from './planShift';

export function StartSheet({ opened, onClose, onPick, onPickDay, today }: {
  opened: boolean; onClose: () => void; onPick: (templateId: string | null) => void;
  /** Only for the real today: planned days that can be pulled into today. */
  onPickDay?: (date: string) => void; today?: string;
}) {
  const db = useDb();
  const withDays = !!onPickDay;
  const data = useLiveQuery(async () => {
    const p = await R.activeProgram(db);
    const templates = p ? await R.templatesOfProgram(db, p.id) : [];
    const sources = opened && withDays && today && p ? await shiftSources(db, today).catch(() => null) : null;
    return { templates, names: new Map(templates.map((x) => [x.id, x.name])), sources };
  }, [db, opened, today, withDays]);
  const templates = data?.templates ?? [];
  const src = data?.sources;
  const row = (key: string, label: string, sub: string, onClick: () => void, badge?: { text: string; color: string }, testId = 'start-pick') => (
    <UnstyledButton key={key} onClick={onClick} py={10} px={6} mih={52} data-testid={testId}>
      <Group justify="space-between" wrap="nowrap">
        <div><Group gap={6}><Text fw={600}>{label}</Text>{badge && <Badge size="xs" variant="light" color={badge.color}>{badge.text}</Badge>}</Group>{sub && <Text fz="xs" c="dimmed">{sub}</Text>}</div>
        <IconChevronRight size={18} aria-hidden />
      </Group>
    </UnstyledButton>
  );
  const head = (text: string) => <Text fz="xs" tt="uppercase" fw={700} c="dimmed" mt="xs">{text}</Text>;
  return (
    <Drawer opened={opened} onClose={onClose} size="auto" title={<Text fw={700}>{t('wo.startWhich')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      
        <Stack gap={2} pb="md">
          {src && (src.missed.length > 0 || src.upcoming.length > 0) && (
            <>
              {head(t('shift.fromPlan'))}
              {src.todayDone && <Text fz="xs" c="dimmed">{t('shift.todayDoneNote')}</Text>}
              {[...src.missed.map((x) => ({ x, missed: true })), ...src.upcoming.map((x) => ({ x, missed: false }))].map(({ x, missed }) =>
                row(`d-${x.date}`, data?.names.get(x.templateId) ?? '?', `${formatDate(x.date)}${x.week ? ` · ${t('common.weekShort', { n: x.week })}` : ''}`, () => onPickDay?.(x.date),
                  missed ? { text: t('plan.status.missed'), color: 'orange' } : undefined, 'start-day'))}
              {head(t('shift.extraHead'))}
            </>
          )}
          {templates.map((tp) => row(tp.id, tp.name, tp.focus, () => onPick(tp.id)))}
          {row('empty', t('wo.emptyName'), t('wo.emptyBody'), () => onPick(null))}
        </Stack>
      
    </Drawer>
  );
}
