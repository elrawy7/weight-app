import { useEffect, useState } from 'react';
import { Alert, Button, Card, Code, Container, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { t } from '../i18n';
import { exportRaw, latestSnapshot, restoreLatestSnapshot } from '../db/open';
import { deliverFile } from '../features/backup/backup';

/** BAK-05: never a blank screen – export raw data or restore the pre-upgrade snapshot. */
export function RecoveryScreen({ error }: { error: Error }) {
  const [snapDate, setSnapDate] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { latestSnapshot().then((s) => setSnapDate(s?.createdAt ?? null)).catch(() => setSnapDate(null)); }, []);
  const doExport = async () => {
    setBusy(true);
    try {
      const raw = await exportRaw().catch(async () => ({ version: 0, data: {} as Record<string, unknown[]> }));
      const snap = await latestSnapshot().catch(() => null);
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), error: error.message, database: raw, latestSnapshot: snap }, null, 1)], { type: 'application/json' });
      await deliverFile(blob, `weight-raw-export-${new Date().toISOString().slice(0, 10)}.json`);
      setMsg(t('rec.exported'));
    } finally { setBusy(false); }
  };
  const doRestore = async () => {
    setBusy(true);
    try { const n = await restoreLatestSnapshot(); setMsg(t('rec.restored', { n })); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Container size="xs" py="xl" data-testid="recovery-screen">
      <Stack>
        <IconAlertTriangle size={48} color="var(--w-warn)" />
        <Title order={2}>{t('rec.title')}</Title>
        <Text>{t('rec.body')}</Text>
        <Code block>{t('rec.error', { msg: error.message })}</Code>
        <Button size="lg" onClick={doExport} loading={busy}>{t('rec.export')}</Button>
        <Card withBorder>
          <Stack gap="xs">
            {snapDate ? <Text fz="sm">{t('rec.restoreBody', { date: new Date(snapDate).toLocaleString() })}</Text> : <Text fz="sm" c="dimmed">{t('rec.noSnapshot')}</Text>}
            <Button size="lg" variant="light" disabled={!snapDate} onClick={doRestore} loading={busy}>{t('rec.restore')}</Button>
          </Stack>
        </Card>
        {msg && <Alert>{msg}</Alert>}
        <Button variant="default" size="lg" onClick={() => location.reload()}>{t('rec.reload')}</Button>
      </Stack>
    </Container>
  );
}
