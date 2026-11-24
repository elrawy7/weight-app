import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Chip, Group, ScrollArea, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch, IconBooks } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { categories } from '../../seed/exercises';
import { searchExercises } from './libraryOps';
import { EmptyState, ExerciseCard, KneeBadge, PageHeader } from '../../components/ui';

export function LibraryPage() {
  const db = useDb();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '', category = sp.get('cat'), equipment = sp.get('eq'), kneeFriendly = sp.get('knee') === '1', includeArchived = sp.get('arch') === '1';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const list = useLiveQuery(() => searchExercises(db, { q, category, equipment, kneeFriendly, includeArchived }), [db, q, category, equipment, kneeFriendly, includeArchived]);
  const equipmentList = useLiveQuery(() => db.equipment.toArray(), [db]) ?? [];
  return (
    <>
      <PageHeader title={t('library.title')} subtitle={list ? t('library.count', { n: list.length }) : undefined}
        right={<Button leftSection={<IconPlus size={18} />} variant="light" onClick={() => nav('/library/new')}>{t('library.new')}</Button>} />
      <Stack gap="sm">
        <TextInput leftSection={<IconSearch size={18} />} placeholder={t('library.search')} aria-label={t('common.search')} value={q} onChange={(e) => set('q', e.currentTarget.value || null)} data-testid="library-search" />
        <ScrollArea type="never">
          <Chip.Group value={category ?? ''} onChange={(v) => set('cat', (v as string) || null)}>
            <Group gap={6} wrap="nowrap" pb={4}>
              <Chip value="" size="md">{t('common.all')}</Chip>
              {categories.map((c) => <Chip key={c} value={c} size="md" data-testid={`chip-${c}`}>{t(`cat.${c}` as MsgKey)}</Chip>)}
            </Group>
          </Chip.Group>
        </ScrollArea>
        <Group grow align="flex-end">
          <Select label={t('library.equipment')} data={[{ value: '', label: t('common.all') }, ...equipmentList.map((e) => ({ value: e.id, label: e.name }))]} value={equipment ?? ''} onChange={(v) => set('eq', v || null)} data-testid="filter-equipment" />
        </Group>
        <Group>
          <Switch label={t('library.kneeFriendly')} checked={kneeFriendly} onChange={(e) => set('knee', e.currentTarget.checked ? '1' : null)} />
          <Switch label={t('library.showArchived')} checked={includeArchived} onChange={(e) => set('arch', e.currentTarget.checked ? '1' : null)} />
        </Group>
        {list && list.length === 0 && <EmptyState icon={<IconBooks />} title={t('library.empty')} body={t('library.emptyBody')} action={<Button variant="light" onClick={() => setSp({}, { replace: true })}>{t('library.clear')}</Button>} />}
        {list?.map((e) => (
          <ExerciseCard key={e.id} testId="library-item" title={e.name} onClick={() => nav(`/library/${e.id}`)}
            meta={<><span className="w-arabic" dir="rtl" lang="ar">{e.nameAr}</span>{e.nameAr ? ' · ' : ''}{t(`cat.${e.category}` as MsgKey)} · {t(`mechanic.${e.mechanic}` as MsgKey)}</>}
            badges={<>{e.status === 'unresolved' && <Badge color="amber" size="sm">{t('library.unresolved')}</Badge>}{e.isCustom && <Badge variant="outline" size="sm">{t('library.custom')}</Badge>}
              {e.isArchived === 1 && <Badge color="gray" size="sm">{t('library.archived')}</Badge>}<KneeBadge tags={e.tags} /></>} />
        ))}
        {list && <Text fz="xs" c="dimmed" ta="center">{t('library.count', { n: list.length })}</Text>}
      </Stack>
    </>
  );
}
