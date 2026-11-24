import { useEffect, useState } from 'react';
import { Alert, Button, Group, Text } from '@mantine/core';
import { IconCloudUpload, IconDownload, IconDeviceMobile } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { useDb, useSettings, saveSettings } from '../app/db';
import { backupState, daysSince } from '../features/backup/backup';
import { onUpdateAvailable, applyUpdate } from '../pwa/update';
import { isStandalone } from '../pwa/platform';

/** DASH-06 + BAK-03: last-backup indicator / reminder. */
export function BackupIndicator({ compact }: { compact?: boolean }) {
  const db = useDb();
  const s = useSettings();
  const nav = useNavigate();
  const hasData = useLiveQuery(async () => (await db.sessions.count()) + (await db.programs.count()) + (await db.bodyMeasurements.count()) > 0, [db]) ?? false;
  const state = backupState(s.lastBackupAt, s.backupReminderDays, hasData);
  if (!hasData) return null;
  const days = daysSince(s.lastBackupAt);
  if (state === 'ok') {
    return compact ? null : <Text fz="xs" c="dimmed" data-testid="backup-ok">{t('backup.indicator.ok', { when: days === 0 ? t('backup.when.today') : t('backup.when.days', { n: days ?? 0 }) })}</Text>;
  }
  return (
    <Alert color="orange" variant="light" icon={<IconCloudUpload />} title={state === 'never' ? t('backup.indicator.never') : t('backup.indicator.due', { days: days ?? 0 })} data-testid="backup-due">
      <Text fz="sm">{t('backup.reminderBody')}</Text>
      <Button size="sm" mt="xs" onClick={() => nav('/backup')}>{t('backup.now')}</Button>
    </Alert>
  );
}

/** PWA-03: non-blocking update prompt; suppressed while a workout is active. */
export function UpdatePrompt() {
  const db = useDb();
  const [avail, setAvail] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const active = useLiveQuery(() => db.sessions.where('status').anyOf('active', 'paused').count(), [db]) ?? 0;
  useEffect(() => onUpdateAvailable(setAvail), []);
  if (!avail || dismissed || active > 0) return null;
  return (
    <Alert variant="filled" color="mint" icon={<IconDownload />} mb="md" data-testid="update-prompt">
      <Group justify="space-between" wrap="nowrap"><Text fw={600}>{t('upd.available')}</Text>
        <Group gap={6} wrap="nowrap"><Button variant="white" size="sm" onClick={() => void applyUpdate()}>{t('upd.reload')}</Button><Button variant="subtle" color="dark" size="sm" onClick={() => setDismissed(true)}>{t('upd.later')}</Button></Group>
      </Group>
    </Alert>
  );
}

/** PWA-01 AC2: install guide shown once when not installed; always reachable in More. */
export function InstallBanner() {
  const db = useDb();
  const s = useSettings();
  const nav = useNavigate();
  if (isStandalone() || s.installGuideSeen) return null;
  return (
    <Alert variant="light" color="blue" icon={<IconDeviceMobile />} mb="md" data-testid="install-banner">
      <Text fz="sm">{t('inst.banner')}</Text>
      <Group gap="xs" mt="xs"><Button size="sm" variant="light" onClick={() => nav('/install')}>{t('inst.how')}</Button><Button size="sm" variant="subtle" onClick={() => void saveSettings(db, { installGuideSeen: true })}>{t('inst.dismiss')}</Button></Group>
    </Alert>
  );
}
