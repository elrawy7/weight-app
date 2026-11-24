/** WO-01 AC2: start any template of the active program (or an empty workout) on any day up to today. */
import { useLiveQuery } from 'dexie-react-hooks';
import { Drawer, Stack, Text, UnstyledButton, Group } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t } from '../../i18n';
import * as R from '../../db/repos';

export function StartSheet({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (templateId: string | null) => void }) {
  const db = useDb();
  const templates = useLiveQuery(async () => {
    const p = await R.activeProgram(db);
    return p ? R.templatesOfProgram(db, p.id) : [];
  }, [db]) ?? [];
  const item = (key: string, label: string, sub: string, id: string | null) => (
    <UnstyledButton key={key} onClick={() => onPick(id)} py={10} px={6} mih={52} data-testid="start-pick">
      <Group justify="space-between" wrap="nowrap"><div><Text fw={600}>{label}</Text>{sub && <Text fz="xs" c="dimmed">{sub}</Text>}</div><IconChevronRight size={18} aria-hidden /></Group>
    </UnstyledButton>
  );
  return (
    <Drawer opened={opened} onClose={onClose} size="auto" title={<Text fw={700}>{t('wo.startWhich')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <Stack gap={2} pb="md">
        {templates.map((tp) => item(tp.id, tp.name, tp.focus, tp.id))}
        {item('empty', t('wo.emptyName'), t('wo.emptyBody'), null)}
      </Stack>
    </Drawer>
  );
}
