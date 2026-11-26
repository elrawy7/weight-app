/** DASH-01…04 on Today: this week, streak, totals, weekly volume & muscles, recent PRs, recommendations. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, Group, Progress, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconFlame, IconTrophy, IconTrendingUp, IconAlertTriangle, IconChevronRight, IconBatteryCharging } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { BackupIndicator } from '../../components/banners';
import { Section, StatCard } from '../../components/ui';
import { backupState } from '../backup/backup';
import { dashboard, recommendations, type Recommendation } from '../progress/progressOps';
import { prText } from '../progress/prText';

export function Dashboard({ today }: { today: string }) {
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const d = useLiveQuery(() => dashboard(db, today), [db, today, settings.weekStartsOn, settings.secondaryMuscleWeight]);
  const hasData = useLiveQuery(async () => (await db.sessions.count()) + (await db.programs.count()) > 0, [db]) ?? false;
  const backupDue = backupState(settings.lastBackupAt, settings.backupReminderDays, hasData) !== 'ok';
  const recs = useLiveQuery(() => recommendations(db, today, backupDue ? 2 : 3), [db, today, backupDue, settings.minWeeklySets, settings.defaultStrategy]) ?? [];
  if (!d) return null;
  const unit = settings.weightUnit;
  const pct = d.week.scheduled ? (100 * d.week.done) / d.week.scheduled : 0;
  const rec = (r: Recommendation, i: number) => {
    const [icon, title, body, to] = r.kind === 'deload'
      ? [<IconBatteryCharging key="i" />, t('dash.deloadTitle'), r.reason === 'stall' ? t('dash.deloadStall', { name: r.exercise ?? '' }) : t('dash.deloadBody', { pct: settings.deloadPct, sets: settings.deloadSets }), '/plan']
      : r.kind === 'progress'
        ? [<IconTrendingUp key="i" color="var(--w-info)" />, t('dash.progressTitle', { name: r.name }), (r.assist ? t('dash.progressBodyAssist', { w: formatWeight(r.topKg, unit) }) : t('dash.progressBody', { w: formatWeight(r.topKg, unit) })), `/progress/exercise/${r.exerciseId}`]
        : [<IconAlertTriangle key="i" color="var(--w-pr)" />, t('dash.limitedTitle', { name: r.name }), t('dash.limitedBody', { n: r.sets, min: r.min }), '/progress/muscles'];
    return (
      <Card key={`${r.kind}${i}`} withBorder radius="md" padding={0}>
        <UnstyledButton onClick={() => nav(to as string)} p="sm" w="100%" mih={56} data-testid={`rec-${r.kind}`}>
          <Group justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap">{icon}<div><Text fw={700} fz="sm">{title}</Text><Text fz="xs" c="dimmed">{body}</Text></div></Group><IconChevronRight size={16} aria-hidden /></Group>
        </UnstyledButton>
      </Card>
    );
  };
  return (
    <Stack gap="sm" data-testid="dashboard">
      {(backupDue || recs.length > 0) && (
        <Section title={t('dash.recommended')}>
          <Stack gap={6} data-testid="recommendations">
            <BackupIndicator compact />
            {recs.map(rec)}
          </Stack>
        </Section>
      )}
      <Card withBorder radius="md" padding="sm" data-testid="dash-week">
        <Group justify="space-between" mb={4}>
          <Text fw={700}>{t('dash.thisWeek')}</Text>
          <Group gap={4}><IconFlame size={18} color="var(--w-pr)" aria-hidden /><Text fw={700} data-testid="dash-streak">{t('dash.streak', { n: d.streak })}</Text></Group>
        </Group>
        <Text fz="sm" data-testid="dash-completion">{t('dash.completion', { done: d.week.done, total: d.week.scheduled })}</Text>
        <Progress value={pct} size="lg" radius="xl" mt={6} aria-label={t('dash.completion', { done: d.week.done, total: d.week.scheduled })} />
        <SimpleGrid cols={3} spacing="xs" mt="sm">
          <StatCard label={t('dash.totalWorkouts')} value={<span data-testid="dash-total">{d.totalWorkouts}</span>} />
          <StatCard label={t('dash.totalTime')} value={d.totalMinutes >= 60 ? t('dash.hours', { h: Math.round(d.totalMinutes / 6) / 10 }) : `${d.totalMinutes} ${t('common.min')}`} />
          <StatCard label={t('dash.weekVolume')} value={<span data-testid="dash-volume">{d.weekVolumeKg ? formatWeight(d.weekVolumeKg, unit) : '—'}</span>} />
        </SimpleGrid>
        {d.weekMuscles.length > 0 && (
          <UnstyledButton onClick={() => nav('/progress/muscles')} mt="sm" w="100%" mih={48} data-testid="dash-muscles">
            <Text fz="xs" c="dimmed" mb={4}>{t('dash.musclesTrained')}</Text>
            <Group gap={4}>{d.weekMuscles.slice(0, 8).map((m) => <Badge key={m.id} variant="light" color={m.sets < settings.minWeeklySets ? 'gray' : 'mint'}>{m.name} {m.sets}</Badge>)}</Group>
          </UnstyledButton>
        )}
      </Card>
      {d.recentPrs.length > 0 && (
        <Section title={t('dash.recentPrs')}>
          <Stack gap={6} data-testid="dash-prs">
            {d.recentPrs.map((r) => (
              <Card key={r.id} withBorder radius="md" padding={0}>
                <UnstyledButton onClick={() => nav(`/progress/exercise/${r.exerciseId}`)} p="sm" w="100%" mih={48}>
                  <Group justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap"><IconTrophy size={18} color="var(--w-pr)" /><Text fw={600} fz="sm" lineClamp={1}>{r.name}</Text></Group>
                    <Text fz="sm" fw={700}>{prText({ type: r.type, value: r.value, weightKg: r.weightKg }, unit)} <Text span fz="xs" c="dimmed" fw={400}>{formatDate(r.achievedAt)}</Text></Text></Group>
                </UnstyledButton>
              </Card>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}
