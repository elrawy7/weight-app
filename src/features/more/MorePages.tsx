import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, List, NavLink as MNavLink, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, ThemeIcon } from '@mantine/core';
import { IconCalendarStats, IconSettings, IconBarbell, IconDatabase, IconCloudUpload, IconFileImport, IconReportAnalytics, IconDeviceMobile, IconInfoCircle, IconComponents, IconChevronRight, IconShieldCheck, IconCheck } from '@tabler/icons-react';
import { useDb, useSettings, saveSettings } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { nowIso } from '../../domain/dates';
import { PageHeader, Section } from '../../components/ui';
import { BackupIndicator } from '../../components/banners';
import { requestPersistence, storageStatus, formatBytes, type StorageStatus } from '../settings/storage';
import { isStandalone, speechSupported, wakeLockSupported } from '../../pwa/platform';
import { WEEKDAYS, type ThemePref, type Weekday } from '../../db/types';

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const items: { to: string; key: MsgKey; icon: typeof IconSettings; group: 'data' | 'app' }[] = [
  { to: '/programs', key: 'more.programs', icon: IconCalendarStats, group: 'data' },
  { to: '/backup', key: 'more.backup', icon: IconCloudUpload, group: 'data' },
  { to: '/import', key: 'more.import', icon: IconFileImport, group: 'data' },
  { to: '/migration', key: 'more.migration', icon: IconReportAnalytics, group: 'data' },
  { to: '/settings', key: 'more.settings', icon: IconSettings, group: 'app' },
  { to: '/settings/equipment', key: 'more.equipment', icon: IconBarbell, group: 'app' },
  { to: '/settings/storage', key: 'more.storage', icon: IconDatabase, group: 'app' },
  { to: '/install', key: 'more.install', icon: IconDeviceMobile, group: 'app' },
  { to: '/dev/components', key: 'more.components', icon: IconComponents, group: 'app' },
];

export function MorePage() {
  const nav = useNavigate();
  const list = (g: 'data' | 'app') => (
    <Card withBorder padding={0} radius="md">
      {items.filter((i) => i.group === g).map(({ to, key, icon: Icon }) => (
        <MNavLink key={to} label={t(key)} leftSection={<ThemeIcon variant="light" size={34}><Icon size={20} /></ThemeIcon>} rightSection={<IconChevronRight size={18} />} onClick={() => nav(to)} py={12} data-testid={`more-${to}`} />
      ))}
    </Card>
  );
  return (
    <>
      <PageHeader title={t('more.title')} />
      <Stack gap="xs">
        <BackupIndicator />
        <Section title={t('more.data')}>{list('data')}</Section>
        <Section title={t('more.app')}>{list('app')}</Section>
        <Section title={t('more.about')}>
          <Card withBorder padding="sm"><Group gap="xs" wrap="nowrap" align="flex-start"><IconShieldCheck color="var(--mantine-color-mint-5)" /><Stack gap={2}>
            <Text fz="sm">{t('more.privacy')}</Text>
            <Text fz="xs" c="dimmed" data-testid="app-version">{t('more.version', { v: __APP_VERSION__, d: __BUILD_TIME__.slice(0, 10) })}</Text>
          </Stack></Group></Card>
        </Section>
      </Stack>
    </>
  );
}

export function SettingsPage() {
  const db = useDb();
  const s = useSettings();
  const profile = useLiveQuery(() => db.profile.get('me'), [db]);
  const set = (p: Parameters<typeof saveSettings>[1]) => void saveSettings(db, p);
  const support = (ok: boolean) => <Badge size="xs" variant="light" color={ok ? 'mint' : 'gray'}>{ok ? t('set.supported') : t('set.unsupported')}</Badge>;
  return (
    <>
      <PageHeader title={t('set.title')} back="/more" />
      <Stack>
        <SegmentedControl fullWidth data={[{ value: 'kg', label: t('common.kg') }, { value: 'lb', label: t('common.lb') }]} value={s.weightUnit} onChange={(v) => set({ weightUnit: v as 'kg' | 'lb' })} aria-label={t('set.units')} data-testid="unit-toggle" />
        <div><Text fz="sm" fw={500} mb={4}>{t('set.theme')}</Text>
          <SegmentedControl fullWidth data={(['system', 'dark', 'light'] as ThemePref[]).map((v) => ({ value: v, label: t(`set.theme.${v}` as MsgKey) }))} value={s.theme} onChange={(v) => set({ theme: v as ThemePref })} data-testid="theme-toggle" /></div>
        <Select label={t('set.weekStart')} data={WEEKDAYS.map((w) => ({ value: w, label: w }))} value={s.weekStartsOn} onChange={(v) => v && set({ weekStartsOn: v as Weekday })} />
        <NumberInput label={t('set.defaultRest')} suffix=" s" min={0} max={900} step={15} value={s.defaultRestSec} onChange={(v) => set({ defaultRestSec: Number(v) || 0 })} />
        <NumberInput label={t('set.backupDays')} min={1} max={60} value={s.backupReminderDays} onChange={(v) => set({ backupReminderDays: Math.max(1, Number(v) || 7) })} />
        <Switch label={t('set.showRpe')} checked={s.showRpe} onChange={(e) => set({ showRpe: e.currentTarget.checked })} />
        <Section title={t('set.workout')}>
          <Alert variant="light" color="gray" icon={<IconInfoCircle />}><Text fz="sm">{t('set.workoutNote')}</Text></Alert>
          <Switch label={t('set.sound')} checked={s.sound} onChange={(e) => set({ sound: e.currentTarget.checked })} />
          <Group justify="space-between"><Switch label={t('set.spoken')} checked={s.spokenCues} onChange={(e) => set({ spokenCues: e.currentTarget.checked })} />{support(speechSupported())}</Group>
          <Group justify="space-between"><Switch label={t('set.keepAwake')} checked={s.keepAwake} onChange={(e) => set({ keepAwake: e.currentTarget.checked })} />{support(wakeLockSupported())}</Group>
        </Section>
        {profile && (
          <Section title={t('set.profile')}>
            <TextInput label={t('set.name')} defaultValue={profile.name} onBlur={(e) => void db.profile.update('me', { name: e.currentTarget.value, updatedAt: nowIso() })} />
            <NumberInput label={t('set.height')} defaultValue={profile.heightCm} min={100} max={250} onBlur={(e) => void db.profile.update('me', { heightCm: Number(e.currentTarget.value) || undefined, updatedAt: nowIso() })} />
            <TextInput label={t('set.timezone')} defaultValue={profile.timezone} onBlur={(e) => void db.profile.update('me', { timezone: e.currentTarget.value || 'UTC', updatedAt: nowIso() })} />
          </Section>
        )}
      </Stack>
    </>
  );
}

export function EquipmentPage() {
  const db = useDb();
  const s = useSettings();
  const eq = useLiveQuery(() => db.equipment.toArray(), [db]) ?? [];
  const setOverride = (key: string, v: number | string) => {
    const o = { ...s.incrementOverrides };
    if (typeof v === 'number' && v > 0) o[key] = v; else delete o[key];
    void saveSettings(db, { incrementOverrides: o });
  };
  return (
    <>
      <PageHeader title={t('eq.title')} back="/more" />
      <Text c="dimmed" fz="sm" mb="md">{t('eq.body')}</Text>
      <Section title={t('eq.bars')}>
        <NumberInput label={t('eq.barbell')} min={0} max={50} decimalScale={2} value={s.barbellKg} onChange={(v) => void saveSettings(db, { barbellKg: Number(v) || 0 })} />
        <NumberInput label={t('eq.smith')} min={0} max={50} decimalScale={2} value={s.smithBarKg ?? ''} onChange={(v) => void saveSettings(db, { smithBarKg: typeof v === 'number' ? v : null })} data-testid="smith-bar" />
        <NumberInput label={t('eq.ez')} min={0} max={30} decimalScale={2} value={s.ezBarKg} onChange={(v) => void saveSettings(db, { ezBarKg: Number(v) || 0 })} />
        <TextInput label={t('eq.plates')} defaultValue={s.plateSetKg.join(', ')} onBlur={(e) => void saveSettings(db, { plateSetKg: e.currentTarget.value.split(/[,\s]+/).map(Number).filter((n) => n > 0).sort((a, b) => b - a) })} />
      </Section>
      <Section title={t('more.equipment')}>
        {eq.filter((e) => e.loadMode !== 'none' && e.loadMode !== 'band' && e.loadMode !== 'bodyweight').map((e) => (
          <Card key={e.id} withBorder padding="xs" data-testid={`eq-${e.id}`}>
            <Group justify="space-between" wrap="nowrap">
              <div><Text fw={600}>{e.name}</Text><Text fz="xs" c="dimmed">{t(`loadMode.${e.loadMode}` as MsgKey)} · {t('eq.default', { v: e.incrementKg })}</Text></div>
              <NumberInput w={110} aria-label={`${t('eq.step')} ${e.name}`} placeholder={String(e.incrementKg)} min={0} max={50} decimalScale={2} step={0.25}
                value={s.incrementOverrides[`eq:${e.id}`] ?? ''} onChange={(v) => setOverride(`eq:${e.id}`, v)} />
            </Group>
          </Card>
        ))}
      </Section>
    </>
  );
}

export function StoragePage() {
  const db = useDb();
  const s = useSettings();
  const [st, setSt] = useState<StorageStatus | null>(null);
  useEffect(() => { void storageStatus().then(setSt); }, [s.persistGranted]);
  const granted = st?.persisted ?? s.persistGranted;
  return (
    <>
      <PageHeader title={t('st.title')} back="/more" />
      <Stack>
        <Card withBorder padding="md" data-testid="storage-card">
          <Text fw={700}>{t('st.persisted')}</Text>
          {granted === true && <Alert mt="xs" color="mint" icon={<IconCheck />}>{t('st.granted')}</Alert>}
          {granted === false && <Alert mt="xs" color="orange" data-testid="persist-warning">{t('st.notGranted')}</Alert>}
          {granted === null && <Text c="dimmed" fz="sm">{t('st.unknown')}</Text>}
          {granted !== true && <Button mt="sm" variant="light" onClick={() => void requestPersistence(db, true).then(() => storageStatus().then(setSt))}>{t('st.request')}</Button>}
        </Card>
        <Card withBorder padding="md">
          <Text fw={700}>{t('st.title')}</Text>
          <Text fz="sm" data-testid="storage-usage">{st && st.usage !== null ? t('st.usage', { used: formatBytes(st.usage), quota: formatBytes(st.quota) }) : t('st.usageUnknown')}</Text>
        </Card>
        <Alert variant="light">{t('st.backupAdvice')}</Alert>
      </Stack>
    </>
  );
}

export function InstallPage() {
  const db = useDb();
  const nav = useNavigate();
  useEffect(() => { void saveSettings(db, { installGuideSeen: true }); }, [db]);
  return (
    <>
      <PageHeader title={t('inst.title')} back="/more" />
      <Stack>
        {isStandalone() && <Alert color="mint" icon={<IconCheck />} data-testid="installed">{t('inst.installed')}</Alert>}
        <Card withBorder padding="md">
          <List type="ordered" spacing="sm" size="md">
            {(['inst.step1', 'inst.step2', 'inst.step3', 'inst.step4', 'inst.step5'] as const).map((k) => <List.Item key={k}>{t(k)}</List.Item>)}
          </List>
        </Card>
        <Alert variant="light" color="orange">{t('inst.dataNote')}</Alert>
        <Text c="dimmed" fz="sm">{t('inst.why')}</Text>
        <Button variant="default" onClick={() => nav('/')}>{t('inst.dismiss')}</Button>
      </Stack>
    </>
  );
}
