import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, FileButton, Group, Radio, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconFileImport, IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import { useDb } from '../../app/db';
import { t, type MsgKey } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { EmptyState, PageHeader, Section, StatCard } from '../../components/ui';
import { applyImport, parsePackage, previewImport, resolveExercise, ImportError, type ImportPackage, type ImportPreview } from './importPackage';
import type { MigrationRecord } from '../../db/types';

const COUNT_KEYS = ['programs', 'templates', 'templateRows', 'warmupRows', 'weeks', 'plannedSessions', 'sessions', 'sets', 'bodyMeasurements', 'goals', 'unresolved', 'legacy'] as const;

export function ImportPage() {
  const db = useDb();
  const nav = useNavigate();
  const [pkg, setPkg] = useState<{ pkg: ImportPackage; pv: ImportPreview } | null>(null);
  const [state, setState] = useState<{ color: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const resetRef = useRef<() => void>(null);
  const pick = async (f: File | null) => {
    resetRef.current?.();
    if (!f) return;
    setBusy(true); setState(null); setPkg(null); setDone(false);
    try {
      const p = await parsePackage(await f.text());
      const pv = await previewImport(db, p, f.name);
      setPkg({ pkg: p, pv });
      if (pv.alreadyImported) setState({ color: 'blue', text: t('imp.already') });
      else if (pv.conflict) setState({ color: 'orange', text: pv.conflict });
      else if (pv.missingExercises.length) setState({ color: 'red', text: t('imp.missing', { ids: pv.missingExercises.join(', ') }) });
    } catch (e) { setState({ color: 'red', text: e instanceof ImportError ? e.message : t('common.error') }); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!pkg) return;
    setBusy(true);
    try {
      const r = await applyImport(db, pkg.pkg, pkg.pv.fileName);
      setDone(true);
      setState(r.status === 'already_imported' ? { color: 'blue', text: t('imp.already') } : { color: 'mint', text: t('imp.imported') });
    } catch (e) { setState({ color: 'red', text: e instanceof ImportError ? e.message : (e as Error).message }); } finally { setBusy(false); }
  };
  const canImport = pkg && !pkg.pv.alreadyImported && !pkg.pv.conflict && !pkg.pv.missingExercises.length && !done;
  return (
    <>
      <PageHeader title={t('imp.title')} back="/more" />
      <Stack>
        <Text c="dimmed" fz="sm">{t('imp.body')}</Text>
        <FileButton onChange={(f) => void pick(f)} accept="application/json,.json" resetRef={resetRef}>
          {(props) => <Button {...props} size="lg" leftSection={<IconFileImport />} loading={busy} data-testid="import-pick">{t('imp.choose')}</Button>}
        </FileButton>
        {state && <Alert color={state.color} data-testid="import-state">{state.text}</Alert>}
        {pkg && (
          <Card withBorder padding="md" data-testid="import-preview">
            <Stack gap="sm">
              <Group justify="space-between"><Text fw={700}>{done ? t('imp.imported') : t('imp.preview')}</Text><Text fz="xs" c="dimmed">{t('imp.file', { f: pkg.pv.fileName })}</Text></Group>
              <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">
                {COUNT_KEYS.map((k) => <StatCard key={k} label={t(`imp.counts.${k}` as MsgKey)} value={<span data-testid={`count-${k}`}>{pkg.pv.counts[k]}</span>} color={k === 'unresolved' && pkg.pv.counts[k] ? 'amber' : undefined} />)}
              </SimpleGrid>
              {pkg.pv.excluded.length > 0 && <><Text fz="xs" tt="uppercase" fw={700} c="dimmed">{t('imp.excluded')}</Text>{pkg.pv.excluded.map((x) => <Text key={x.item} fz="sm">• {x.item} — <Text span c="dimmed">{x.reason}</Text></Text>)}</>}
              {canImport && <Button size="lg" onClick={() => void run()} loading={busy} data-testid="import-confirm">{t('imp.confirm')}</Button>}
              {done && pkg.pv.counts.unresolved > 0 && <Text fz="sm">{t('imp.next', { n: pkg.pv.counts.unresolved })}</Text>}
            </Stack>
          </Card>
        )}
        {done && <Unresolved />}
        {done && <Button variant="default" onClick={() => nav('/')}>{t('imp.goToday')}</Button>}
      </Stack>
    </>
  );
}

/** MIG-02 resolution cards (used on the import result and the migration report). */
export function Unresolved() {
  const db = useDb();
  const d = useLiveQuery(async () => {
    const recs = await db.migrations.toArray();
    const all = await db.exercises.toArray();
    return { recs, names: new Map(all.map((e) => [e.id, e])) };
  }, [db]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (!d) return null;
  const items = d.recs.flatMap((r) => r.unresolved.map((u) => ({ u, rec: r })));
  if (!items.length) return null;
  return (
    <Section title={t('mig.unresolved')}>
      {items.map(({ u, rec }) => {
        const prov = d.names.get(u.provisionalId);
        const dec = [...rec.decisions].reverse().find((x) => x.provisionalId === u.provisionalId);
        const mapped = prov?.status !== 'unresolved' && dec?.mappedTo;
        return (
          <Card key={u.provisionalId} withBorder padding="md" data-testid="unresolved-card">
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap"><Text fw={700}>“{u.notionName}”</Text>
                {mapped ? <Badge color="mint" leftSection={<IconCheck size={12} />}>{t('common.done')}</Badge> : dec ? <Badge color="gray">{t('mig.pendingLater')}</Badge> : <Badge color="amber" leftSection={<IconAlertTriangle size={12} />}>{t('library.unresolved')}</Badge>}</Group>
              <Text fz="sm" c="dimmed">{t('mig.usedIn', { t: u.usedInTemplates.join(', ') })}</Text>
              {u.logged.map((l) => <Text key={l.date} fz="sm">{t('mig.logged')}: {formatDate(l.date)} · {l.sets.join(', ')}</Text>)}
              {mapped ? (
                <Text fz="sm" c="mint" data-testid="mapped-text">{t('mig.mapped', { name: d.names.get(dec!.mappedTo!)?.name ?? dec!.mappedTo!, rows: dec!.affectedRows, sets: dec!.affectedSets })}</Text>
              ) : (
                <>
                  <Radio.Group value={choice[u.provisionalId] ?? ''} onChange={(v) => setChoice({ ...choice, [u.provisionalId]: v })} label={t('mig.mapTo')}>
                    <Stack gap={6} mt={6}>{u.candidates.map((c) => <Radio key={c} value={c} size="md" label={d.names.get(c)?.name ?? c} data-testid={`cand-${c}`} />)}</Stack>
                  </Radio.Group>
                  <Group grow>
                    <Button variant="default" onClick={() => void resolveExercise(db, u.provisionalId, null)}>{t('mig.later')}</Button>
                    <Button disabled={!choice[u.provisionalId]} onClick={() => void resolveExercise(db, u.provisionalId, choice[u.provisionalId])} data-testid={`map-${u.provisionalId}`}>{t('mig.map')}</Button>
                  </Group>
                  {dec && <Text fz="xs" c="dimmed">{t('mig.laterNote')}</Text>}
                </>
              )}
            </Stack>
          </Card>
        );
      })}
    </Section>
  );
}

export function MigrationReportPage() {
  const db = useDb();
  const nav = useNavigate();
  const recs = useLiveQuery(() => db.migrations.toArray(), [db]);
  if (!recs) return null;
  return (
    <>
      <PageHeader title={t('mig.title')} back="/more" />
      {recs.length === 0 ? <EmptyState title={t('mig.none')} body={t('mig.noneBody')} action={<Button onClick={() => nav('/import')}>{t('more.import')}</Button>} /> : recs.map((r) => <Report key={r.id} r={r} />)}
    </>
  );
}

function Report({ r }: { r: MigrationRecord }) {
  return (
    <Stack gap="xs" data-testid="migration-report">
      <Text fz="sm" c="dimmed">{t('mig.importedAt', { when: new Date(r.importedAt).toLocaleString(), file: r.fileName })}</Text>
      <Section title={t('mig.counts')}>
        <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="xs">{COUNT_KEYS.map((k) => <StatCard key={k} label={t(`imp.counts.${k}` as MsgKey)} value={r.counts[k] ?? 0} />)}</SimpleGrid>
      </Section>
      <Unresolved />
      <Section title={t('mig.excluded')}>
        <Card withBorder padding="sm"><Stack gap={4}>{r.excluded.map((x) => <Text key={x.item} fz="sm">• {x.item} — <Text span c="dimmed">{x.reason}</Text></Text>)}</Stack></Card>
      </Section>
      <Section title={t('mig.issues')}>
        <Card withBorder padding="xs"><Table verticalSpacing={4} fz="sm"><Table.Tbody>
          {r.issues.map((i) => <Table.Tr key={i.id}><Table.Td w={56} fw={600}>{i.id}</Table.Td><Table.Td>{i.description}</Table.Td></Table.Tr>)}
        </Table.Tbody></Table></Card>
      </Section>
      <Section title={t('mig.pages')}>
        <Card withBorder padding="xs"><Table verticalSpacing={2} fz="xs"><Table.Tbody>
          {r.notionPageIds.map((p) => <Table.Tr key={p.id + p.label}><Table.Td>{p.label}</Table.Td><Table.Td ff="monospace" c="dimmed">{p.id}</Table.Td></Table.Tr>)}
        </Table.Tbody></Table></Card>
      </Section>
    </Stack>
  );
}
