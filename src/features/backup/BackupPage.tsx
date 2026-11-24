import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert, Button, Card, FileButton, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCloudUpload, IconRestore, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { PageHeader, Section, ConfirmSheet, StatCard } from '../../components/ui';
import { BackupIndicator } from '../../components/banners';
import { createBackup, deliverFile, inspectBackup, recordBackup, restoreBackup, BackupError, type RestorePreview } from './backup';

declare const __APP_VERSION__: string;
const SHOWN = ['sessions', 'sets', 'exercises', 'templates', 'bodyMeasurements', 'progressPhotos'] as const;

export function BackupPage() {
  const db = useDb();
  const s = useSettings();
  const history = useLiveQuery(() => db.backups.orderBy('createdAt').reverse().limit(5).toArray(), [db]) ?? [];
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<RestorePreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const resetRef = useRef<() => void>(null);

  const backupNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await createBackup(db, __APP_VERSION__);
      const how = await deliverFile(r.blob, r.fileName);
      if (how === 'cancelled') setMsg({ color: 'orange', text: t('backup.cancelled') });
      else { await recordBackup(db, r); setMsg({ color: 'mint', text: t('backup.created', { file: r.fileName }) }); }
    } catch (e) { setMsg({ color: 'red', text: e instanceof Error ? e.message : t('common.error') }); } finally { setBusy(false); }
  };
  const pick = async (f: File | null) => {
    resetRef.current?.();
    if (!f) return;
    setBusy(true); setMsg(null); setPv(null);
    try { setPv(await inspectBackup(db, f)); } catch (e) { setMsg({ color: 'red', text: e instanceof BackupError ? e.message : t('common.error') }); } finally { setBusy(false); }
  };
  const doRestore = async () => {
    if (!pv) return;
    setBusy(true);
    try {
      const r = await restoreBackup(db, pv);
      setConfirm(false); setPv(null);
      setMsg(r.status === 'identical' ? { color: 'blue', text: t('backup.identical') } : { color: 'mint', text: t('backup.restored', { n: r.records }) });
      notifications.show({ message: t('common.done'), icon: <IconCheck size={16} /> });
    } catch (e) { setMsg({ color: 'red', text: e instanceof Error ? e.message : t('common.error') }); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={t('backup.title')} back="/more" />
      <Stack>
        <Text c="dimmed" fz="sm">{t('backup.body')}</Text>
        <BackupIndicator />
        <Button size="lg" leftSection={<IconCloudUpload />} onClick={() => void backupNow()} loading={busy} data-testid="backup-now">{t('backup.now')}</Button>
        {s.lastBackupAt && <Text fz="sm" c="dimmed">{t('backup.last')}: {new Date(s.lastBackupAt).toLocaleString()}</Text>}
        {msg && <Alert color={msg.color} data-testid="backup-msg">{msg.text}</Alert>}

        <Section title={t('backup.restore')}>
          <Text fz="sm" c="dimmed">{t('backup.restoreBody')}</Text>
          <FileButton onChange={(f) => void pick(f)} accept="application/zip,.zip" resetRef={resetRef}>
            {(props) => <Button {...props} variant="light" size="lg" leftSection={<IconRestore />} loading={busy} data-testid="restore-pick">{t('backup.chooseFile')}</Button>}
          </FileButton>
          {pv && (
            <Card withBorder padding="md" data-testid="restore-preview">
              <Stack gap="sm">
                <Text fw={700}>{t('backup.preview', { date: new Date(pv.manifest.createdAt).toLocaleString(), version: pv.manifest.appVersion })}</Text>
                <SimpleGrid cols={3} spacing="xs">
                  {SHOWN.map((k) => <StatCard key={k} label={t(`backup.counts.${k}` as MsgKey)} value={pv.counts[k] ?? 0} />)}
                </SimpleGrid>
                {pv.identicalToCurrent ? <Alert color="blue" data-testid="restore-identical">{t('backup.identical')}</Alert> : (
                  <>
                    <Alert color="orange" icon={<IconAlertTriangle />}>{t('backup.replaceWarning')}</Alert>
                    <Group grow><Button variant="default" onClick={() => setPv(null)}>{t('common.cancel')}</Button><Button color="orange" onClick={() => setConfirm(true)} data-testid="restore-go">{t('backup.restoreConfirm')}</Button></Group>
                  </>
                )}
              </Stack>
            </Card>
          )}
        </Section>

        {history.length > 0 && (
          <Section title={t('backup.history')}>
            {history.map((b) => <Card key={b.id} withBorder padding="xs"><Text fz="sm" fw={500}>{b.fileName ?? b.id}</Text><Text fz="xs" c="dimmed">{new Date(b.createdAt).toLocaleString()} · {t('backup.records', { n: Object.values(b.counts).reduce((a, x) => a + x, 0) })}</Text></Card>)}
          </Section>
        )}
      </Stack>
      <ConfirmSheet opened={confirm} danger title={t('backup.restoreConfirm')} body={t('backup.replaceWarning')} confirmLabel={t('backup.restoreConfirm')} loading={busy}
        onClose={() => setConfirm(false)} onConfirm={() => void doRestore()} />
    </>
  );
}
