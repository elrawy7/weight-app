import { useState } from 'react';
import { Badge, Button, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconMoodEmpty } from '@tabler/icons-react';
import { t } from '../../i18n';
import { ConfirmSheet, EmptyState, ExerciseCard, NumberStepper, PageHeader, RestTimerBar, Section, SetRow, StatCard } from '../../components/ui';

/** FND-02 AC1: every design-system component, used for dark/light visual snapshots (Playwright). Static demo props only. */
export function GalleryPage() {
  const [w, setW] = useState(40);
  const [set, setSet] = useState({ w: 40, r: 8, done: false });
  const [open, setOpen] = useState(false);
  const [restStart, setRestStart] = useState(() => Date.now());
  return (
    <>
      <PageHeader title={t('dev.title')} back="/more" subtitle={t('dev.body')} />
      <Stack data-testid="gallery">
        <Section title={t('dev.c.NumberStepper')}><NumberStepper label={t('ui.weight')} value={w} increment={2.5} onChange={setW} unit={t('common.kg')} /></Section>
        <Section title={t('dev.c.SetRow')}><SetRow index={1} weight={set.w} reps={set.r} increment={2.5} unit={t('common.kg')} done={set.done} previous={t('demo.previous')} onChange={(a, b) => setSet({ ...set, w: a, r: b })} onToggle={() => setSet({ ...set, done: !set.done })} /></Section>
        <Section title={t('dev.c.ExerciseCard')}><ExerciseCard title={t('demo.exercise')} meta={t('demo.meta')} badges={<Badge size="sm" variant="outline">{t('today.superset', { g: 'A' })}</Badge>} onClick={() => undefined} /></Section>
        <Section title={t('dev.c.RestTimerBar')}><RestTimerBar totalSec={90} startedAt={restStart} paused onSkip={() => setRestStart(Date.now())} onAdd={() => setRestStart(restStart + 30000)} /></Section>
        <Section title={t('dev.c.StatCard')}><SimpleGrid cols={2}><StatCard label={t('demo.statLabel')} value={t('demo.statValue')} hint={t('demo.statHint')} /><StatCard label={t('progress.goal')} value={t('demo.statValue')} color="mint" /></SimpleGrid></Section>
        <Section title={t('dev.c.EmptyState')}><EmptyState icon={<IconMoodEmpty />} title={t('demo.emptyTitle')} body={t('demo.emptyBody')} /></Section>
        <Section title={t('dev.c.ConfirmSheet')}><Button variant="light" onClick={() => setOpen(true)}>{t('demo.open')}</Button></Section>
        <Text fz="xs" c="dimmed">{t('dev.body')}</Text>
      </Stack>
      <ConfirmSheet opened={open} title={t('demo.confirmTitle')} body={t('demo.confirmBody')} confirmLabel={t('common.confirm')} danger onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </>
  );
}
