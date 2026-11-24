import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, List, Menu, NumberInput, Stack, Text, TextInput, Textarea, ActionIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandYoutube, IconDots, IconSearch, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useDb, useSettings, saveSettings } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { youtubeSearchUrl } from '../../domain/youtube';
import { resolveIncrement } from '../../domain/rounding';
import { nowIso } from '../../domain/dates';
import { ConfirmSheet, EmptyState, ExerciseCard, KneeBadge, PageHeader, Section } from '../../components/ui';
import { ExercisePicker } from '../../components/ExercisePicker';
import { alternativesFor, mergeExercises, renameExercise, setArchived, setUserVideo, LibraryError } from './libraryOps';
import * as R from '../../db/repos';

const err = (e: unknown) => notifications.show({ color: 'red', message: e instanceof LibraryError ? e.message : t('common.error') });

export function ExerciseDetailPage() {
  const { id = '' } = useParams();
  const db = useDb();
  const nav = useNavigate();
  const settings = useSettings();
  const d = useLiveQuery(async () => {
    const ex = await db.exercises.get(id);
    if (!ex) return { ex: null } as const;
    const [muscles, mg, video, alts, usage, eq, into] = await Promise.all([
      R.musclesOfExercise(db, id), db.muscleGroups.toArray(), db.exerciseVideos.where('exerciseId').equals(id).first(), alternativesFor(db, id), R.usageOfExercise(db, id),
      db.equipment.get(ex.equipmentId), ex.mergedInto ? db.exercises.get(ex.mergedInto) : Promise.resolve(undefined),
    ]);
    return { ex, muscles, mgMap: new Map(mg.map((m) => [m.id, m])), video, alts, usage, eq, into } as const;
  }, [db, id]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ id: string; name: string } | null>(null);

  if (!d) return null;
  if (!d.ex) return <><PageHeader title={t('ex.notFound')} back /><EmptyState title={t('ex.notFound')} /></>;
  const { ex, muscles, mgMap, video, alts, usage, eq, into } = d;
  const prim = muscles.filter((m) => m.role === 'primary'), sec = muscles.filter((m) => m.role === 'secondary');
  const inc = resolveIncrement(ex, settings.incrementOverrides);
  const overrideKey = `ex:${ex.id}`;

  const saveLink = async () => {
    try { await setUserVideo(db, ex.id, linkInput ?? ''); setLinkInput(null); setLinkError(null); } catch (e) { setLinkError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      <PageHeader title={ex.name} back subtitle={ex.nameAr ? <span className="w-arabic" dir="rtl" lang="ar">{ex.nameAr}</span> : undefined}
        right={ex.status !== 'unresolved' && (
          <Menu position="bottom-end">
            <Menu.Target><ActionIcon aria-label={t('common.edit')} data-testid="ex-menu"><IconDots /></ActionIcon></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => setRenaming(ex.name)}>{t('ex.rename')}</Menu.Item>
              <Menu.Item onClick={() => setMergeOpen(true)}>{t('ex.merge')}</Menu.Item>
              <Menu.Item onClick={() => void setArchived(db, ex.id, ex.isArchived === 0).catch(err)}>{ex.isArchived ? t('ex.unarchive') : t('ex.archive')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )} />
      <Stack gap="sm">
        {ex.status === 'unresolved' && (
          <Alert color="amber" icon={<IconAlertTriangle />} title={t('ex.unresolvedTitle')}>
            <Text fz="sm">{t('ex.unresolvedBody', { name: ex.resolution?.notionName ?? ex.name })}</Text>
            <Button mt="xs" size="sm" color="amber" onClick={() => nav('/migration')}>{t('today.resolve')}</Button>
          </Alert>
        )}
        {into && <Alert color="gray">{t('ex.merged', { name: into.name })} · <Anchor onClick={() => nav(`/library/${into.id}`)}>{t('common.open')}</Anchor></Alert>}
        {renaming !== null && (
          <Card withBorder><Stack gap="xs">
            <TextInput label={t('ex.name')} value={renaming} onChange={(e) => setRenaming(e.currentTarget.value)} data-autofocus />
            <Group grow><Button variant="default" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
              <Button onClick={() => void renameExercise(db, ex.id, renaming).then(() => setRenaming(null)).catch(err)}>{t('common.save')}</Button></Group>
          </Stack></Card>
        )}
        <Group gap={6}>
          <Badge variant="light">{t(`cat.${ex.category}` as MsgKey)}</Badge><Badge variant="light" color="gray">{t(`mechanic.${ex.mechanic}` as MsgKey)}</Badge>
          {ex.isCustom && <Badge variant="outline">{t('library.custom')}</Badge>}<KneeBadge tags={ex.tags} />
        </Group>

        {/* Video – BR-YT: verified link, the user's own link, or a search fallback (never an invented URL) */}
        <Section title={t('ex.video')}>
          <Card withBorder padding="sm">
            <Stack gap="xs">
              {video?.url && (video.status === 'verified' || video.status === 'user') ? (
                <>
                  <Button component="a" href={video.url} target="_blank" rel="noopener noreferrer" leftSection={<IconBrandYoutube />} size="lg" color="red" data-testid="video-watch">{t('ex.watch')}</Button>
                  <Text fz="xs" c="dimmed">{video.status === 'verified' ? t('ex.videoVerified', { date: video.verifiedAt ?? '', channel: video.channel ?? '' }) : t('ex.videoUser')} · {t('ex.needsInternet')}</Text>
                </>
              ) : (
                <>
                  <Button component="a" href={youtubeSearchUrl(ex.name)} target="_blank" rel="noopener noreferrer" leftSection={<IconSearch />} size="lg" variant="light" color="red" data-testid="video-search">{t('ex.searchYoutube')}</Button>
                  <Text fz="xs" c="dimmed">{t('ex.videoMissing', { q: `${ex.name} form` })} · {t('ex.needsInternet')}</Text>
                </>
              )}
              {linkInput === null ? (
                <Group gap="xs">
                  <Button variant="subtle" size="sm" onClick={() => setLinkInput(video?.status === 'user' ? video.url ?? '' : '')}>{video?.status === 'user' ? t('ex.changeLink') : t('ex.addLink')}</Button>
                  {video?.status === 'user' && <Button variant="subtle" color="red" size="sm" onClick={() => void setUserVideo(db, ex.id, null)}>{t('ex.removeLink')}</Button>}
                </Group>
              ) : (
                <Stack gap="xs">
                  <TextInput label={t('ex.addLink')} placeholder={t('ex.linkPlaceholder')} value={linkInput} onChange={(e) => setLinkInput(e.currentTarget.value)} error={linkError} inputMode="url" data-testid="video-input" />
                  <Group grow><Button variant="default" onClick={() => { setLinkInput(null); setLinkError(null); }}>{t('common.cancel')}</Button><Button onClick={() => void saveLink()} data-testid="video-save">{t('common.save')}</Button></Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Section>

        {ex.instructions.length > 0 && <Section title={t('ex.instructions')}><Card withBorder padding="sm"><List type="ordered" spacing={6}>{ex.instructions.map((s, i) => <List.Item key={i}>{s}</List.Item>)}</List></Card></Section>}
        {ex.commonMistakes.length > 0 && <Section title={t('ex.mistakes')}><Card withBorder padding="sm"><List spacing={4}>{ex.commonMistakes.map((s, i) => <List.Item key={i}>{s}</List.Item>)}</List></Card></Section>}
        {(ex.safetyNotes.length > 0 || ex.tags.includes('knee_caution')) && (
          <Section title={t('ex.safety')}><Card withBorder padding="sm"><List spacing={4}>
            {ex.tags.includes('knee_caution') && <List.Item icon={<IconAlertTriangle size={16} color="var(--w-warn)" />}>{t('ex.kneeTag')}</List.Item>}
            {ex.safetyNotes.map((s, i) => <List.Item key={i}>{s}</List.Item>)}
          </List></Card></Section>
        )}

        <Section title={t('ex.muscles')}>
          <Card withBorder padding="sm"><Stack gap={6}>
            <Group gap={6}><Text fz="sm" fw={600} w={90}>{t('ex.primary')}</Text>{prim.map((m) => <Badge key={m.muscleGroupId}>{mgMap.get(m.muscleGroupId)?.name}</Badge>)}</Group>
            {sec.length > 0 && <Group gap={6}><Text fz="sm" fw={600} w={90}>{t('ex.secondary')}</Text>{sec.map((m) => <Badge key={m.muscleGroupId} variant="outline">{mgMap.get(m.muscleGroupId)?.name}</Badge>)}</Group>}
          </Stack></Card>
        </Section>

        <Section title={t('ex.details')}>
          <Card withBorder padding="sm"><Stack gap={8}>
            <Row k={t('ex.loadMode')} v={t(`loadMode.${ex.loadMode}` as MsgKey)} />
            <Row k={t('ex.tracking')} v={t(`tracking.${ex.tracking}` as MsgKey)} />
            <Row k={t('ex.equipment')} v={eq?.name ?? ex.equipmentId} />
            <Row k={t('ex.rest')} v={`${ex.defaultRestSec} ${t('common.sec')}`} />
            {ex.loadMode !== 'none' && ex.loadMode !== 'bodyweight' && <Row k={t('ex.increment')} v={`${inc} ${t('common.kg')}`} />}
            {ex.aliases.length > 0 && <Row k={t('ex.aliases')} v={ex.aliases.join(', ')} />}
            <Text fz="xs" c="dimmed">{t('ex.usage', { rows: usage.templateRows, sessions: usage.sessionExercises })}</Text>
            {['total', 'per_hand', 'stack', 'assist'].includes(ex.loadMode) && (
              <NumberInput label={t('ex.incrementOverride')} placeholder={String(ex.incrementKg)} min={0} max={50} decimalScale={2} step={0.25}
                value={settings.incrementOverrides[overrideKey] ?? ''} data-testid="ex-increment"
                onChange={(v) => { const o = { ...settings.incrementOverrides }; if (typeof v === 'number' && v > 0) o[overrideKey] = v; else delete o[overrideKey]; void saveSettings(db, { incrementOverrides: o }); }} />
            )}
          </Stack></Card>
        </Section>

        <Section title={t('ex.notes')}>
          <Textarea aria-label={t('ex.notes')} placeholder={t('ex.notesPlaceholder')} autosize minRows={2} defaultValue={ex.personalNotes}
            onBlur={(e) => void db.exercises.update(ex.id, { personalNotes: e.currentTarget.value, updatedAt: nowIso() }).then(() => notifications.show({ message: t('common.saved'), icon: <IconCheck size={16} />, autoClose: 1200 }))} />
        </Section>

        {alts.length > 0 && (
          <Section title={t('ex.alternatives')} right={<Text fz="xs" c="dimmed">{alts[0].defined ? t('ex.altDefined') : t('ex.altSuggested')}</Text>}>
            {alts.map((a) => <ExerciseCard key={a.exercise.id} title={a.exercise.name} onClick={() => nav(`/library/${a.exercise.id}`)} testId="alt-item"
              badges={<Badge size="sm" variant="light" color={a.reason === 'knee_friendly' ? 'mint' : 'gray'}>{t(`ex.reason.${a.reason}` as MsgKey)}</Badge>} />)}
          </Section>
        )}
      </Stack>

      <ExercisePicker opened={mergeOpen} onClose={() => setMergeOpen(false)} title={t('ex.mergeTitle', { name: ex.name })} exclude={[ex.id]}
        filter={(e) => e.loadMode === ex.loadMode && e.status === 'active'} onPick={(e) => setMergeTarget({ id: e.id, name: e.name })} />
      <ConfirmSheet opened={!!mergeTarget} title={t('ex.mergeTitle', { name: ex.name })} body={t('ex.mergeBody', { name: ex.name })} confirmLabel={mergeTarget ? `${t('ex.merge').replace('…', '')} ${mergeTarget.name}` : ''}
        onClose={() => setMergeTarget(null)} onConfirm={() => { const tg = mergeTarget!; void mergeExercises(db, ex.id, tg.id).then(() => { setMergeTarget(null); nav(`/library/${tg.id}`, { replace: true }); }).catch(err); }} />
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <Group justify="space-between" wrap="nowrap" gap="md"><Text fz="sm" c="dimmed">{k}</Text><Text fz="sm" fw={500} ta="right">{v}</Text></Group>;
