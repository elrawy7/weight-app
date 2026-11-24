import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Drawer, ScrollArea, Stack, Text, TextInput, UnstyledButton, Group, Badge } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useDb } from '../app/db';
import { t } from '../i18n';
import { searchExercises } from '../features/library/libraryOps';
import type { Exercise } from '../db/types';

export function ExercisePicker({ opened, onClose, onPick, title, exclude = [], filter }: { opened: boolean; onClose: () => void; onPick: (e: Exercise) => void; title?: string; exclude?: string[]; filter?: (e: Exercise) => boolean }) {
  const db = useDb();
  const [q, setQ] = useState('');
  const list = useLiveQuery(() => (opened ? searchExercises(db, { q }) : Promise.resolve([])), [db, q, opened]) ?? [];
  const shown = list.filter((e) => !exclude.includes(e.id) && (!filter || filter(e)));
  return (
    <Drawer opened={opened} onClose={onClose} size="90%" title={<Text fw={700}>{title ?? t('tpl.pick')}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <Stack gap="xs">
        <TextInput leftSection={<IconSearch size={18} />} placeholder={t('library.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus />
        <ScrollArea.Autosize mah="65vh">
          <Stack gap={2}>
            {shown.map((e) => (
              <UnstyledButton key={e.id} onClick={() => { onPick(e); onClose(); setQ(''); }} py={10} px={6} mih={48} data-testid="picker-item">
                <Group justify="space-between" wrap="nowrap"><div><Text fw={500}>{e.name}</Text><Text fz="xs" c="dimmed">{t(`cat.${e.category}`)} · {e.equipmentId.replace(/_/g, ' ')}</Text></div>
                  {e.status === 'unresolved' && <Badge color="amber" size="sm">{t('library.unresolved')}</Badge>}</Group>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Drawer>
  );
}
