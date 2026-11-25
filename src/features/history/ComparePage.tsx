/** HIST-06: two sessions side by side; only the same exercise is compared (BR-EX-03). */
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Card, Group, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { formatDate } from '../../domain/dates';
import { formatWeight } from '../../domain/units';
import { PageHeader } from '../../components/ui';
import { compareSessions, historyItems, sessionDetail, type SideStats } from './historyOps';

function Delta({ a, b, unit, kind }: { a: number | null; b: number | null; unit: 'kg' | 'lb'; kind: 'kg' | 'n' }) {
  if (a == null || b == null) return <Text fz="xs" c="dimmed">—</Text>;
  const d = Math.round((b - a) * 100) / 100;
  const txt = kind === 'kg' ? formatWeight(Math.abs(d), unit) : String(Math.abs(d));
  return <Text fz="sm" fw={700} style={{ whiteSpace: 'nowrap' }} c={d > 0 ? 'mint' : d < 0 ? 'orange' : 'dimmed'} data-testid="compare-delta">{d > 0 ? `▲ ${txt}` : d < 0 ? `▼ ${txt}` : t('cmp.same')}</Text>;
}

/** One compared metric: label, then "A → B" with the change on the right. */
function Metric({ label, a, b, delta }: { label: string; a: string; b: string; delta: React.ReactNode }) {
  return (
    <div>
      <Text fz="xs" c="dimmed">{label}</Text>
      <Group justify="space-between" wrap="nowrap" gap={6}>
        <Text fz="sm">{a} <Text span c="dimmed">→</Text> <Text span fw={700}>{b}</Text></Text>
        <div style={{ flexShrink: 0 }}>{delta}</div>
      </Group>
    </div>
  );
}

const best = (s: SideStats, unit: 'kg' | 'lb') => (s.best ? `${s.best.weightKg ? formatWeight(s.best.weightKg, unit) : t('wo.bw')} × ${s.best.reps ?? '–'}` : s.cardioMin ? `${s.cardioMin} ${t('common.min')}` : '—');

export function ComparePage() {
  const db = useDb();
  const settings = useSettings();
  const nav = useNavigate();
  const [p, setP] = useSearchParams();
  const a = p.get('a'), b = p.get('b');
  const items = useLiveQuery(() => historyItems(db), [db]) ?? [];
  const data = useLiveQuery(async () => {
    if (!a || !b) return null;
    const [A, B] = [await sessionDetail(db, a), await sessionDetail(db, b)];
    if (!A || !B) return null;
    // older on the left
    const [L, Rr] = `${A.session.localDate}` <= `${B.session.localDate}` ? [A, B] : [B, A];
    return { L, R: Rr, cmp: compareSessions(L, Rr) };
  }, [db, a, b]);
  const unit = settings.weightUnit;
  const opts = items.map((i) => ({ value: i.session.id, label: `${formatDate(i.session.localDate)} · ${i.templateName ?? t('wo.emptyName')}` }));
  const set = (k: 'a' | 'b', v: string | null) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); setP(n, { replace: true }); };
  return (
    <>
      <PageHeader back="/history" title={t('cmp.title')} />
      <Stack gap="sm" data-testid="compare-page">
        <SimpleGrid cols={2} spacing="xs">
          <Select aria-label={t('cmp.first')} placeholder={t('cmp.first')} data={opts} value={a} onChange={(v) => set('a', v)} searchable data-testid="compare-a" comboboxProps={{ withinPortal: true }} />
          <Select aria-label={t('cmp.second')} placeholder={t('cmp.second')} data={opts} value={b} onChange={(v) => set('b', v)} searchable data-testid="compare-b" comboboxProps={{ withinPortal: true }} />
        </SimpleGrid>
        {!data && <Text c="dimmed" fz="sm">{t('cmp.pickTwo')}</Text>}
        {data && (
          <>
            <SimpleGrid cols={2} spacing="xs">
              {[data.L, data.R].map((d) => (
                <Card key={d.session.id} withBorder padding="xs" onClick={() => nav(`/history/${d.session.id}`)} style={{ cursor: 'pointer' }}>
                  <Text fw={700} fz="sm" lineClamp={1}>{d.templateName ?? t('wo.emptyName')}</Text>
                  <Text fz="xs" c="dimmed">{formatDate(d.session.localDate)}</Text>
                  <Text fz="xs">{(d.summary.setsDone === 1 ? t('history.set1') : t('history.sets', { n: d.summary.setsDone }))} · {formatWeight(d.summary.volumeKg, unit)}</Text>
                </Card>
              ))}
            </SimpleGrid>
            {data.cmp.rows.length === 0 && <Text c="dimmed" fz="sm">{t('cmp.noCommon')}</Text>}
            {data.cmp.rows.map((r) => (
              <Card key={r.exerciseId} withBorder padding="sm" data-testid="compare-row">
                <Text fw={700} mb={4}>{r.name}</Text>
                <Stack gap={6}>
                  <Metric label={t('cmp.best')} a={best(r.a, unit)} b={best(r.b, unit)} delta={<Delta a={r.a.best?.weightKg ?? null} b={r.b.best?.weightKg ?? null} unit={unit} kind="kg" />} />
                  <Metric label={t('cmp.sets')} a={String(r.a.sets)} b={String(r.b.sets)} delta={<Delta a={r.a.sets} b={r.b.sets} unit={unit} kind="n" />} />
                  {(r.a.volumeKg > 0 || r.b.volumeKg > 0) && <Metric label={t('wo.sumVolume')} a={formatWeight(r.a.volumeKg, unit)} b={formatWeight(r.b.volumeKg, unit)} delta={<Delta a={r.a.volumeKg} b={r.b.volumeKg} unit={unit} kind="kg" />} />}
                  {(r.a.e1rm || r.b.e1rm) && <Metric label={t('an.e1rm')} a={r.a.e1rm ? formatWeight(r.a.e1rm, unit) : '—'} b={r.b.e1rm ? formatWeight(r.b.e1rm, unit) : '—'} delta={<Delta a={r.a.e1rm} b={r.b.e1rm} unit={unit} kind="kg" />} />}
                </Stack>
              </Card>
            ))}
            {(data.cmp.onlyA.length > 0 || data.cmp.onlyB.length > 0) && (
              <Card withBorder padding="sm" data-testid="compare-unmatched">
                <Text fw={700} fz="sm">{t('cmp.unmatched')}</Text>
                <Text fz="xs" c="dimmed" mb={4}>{t('cmp.unmatchedNote')}</Text>
                <Group gap={4}>{data.cmp.onlyA.map((x) => <Badge key={`a${x.se.id}`} variant="light" color="gray">{formatDate(data.L.session.localDate)}: {x.ex?.name}</Badge>)}</Group>
                <Group gap={4} mt={4}>{data.cmp.onlyB.map((x) => <Badge key={`b${x.se.id}`} variant="light" color="gray">{formatDate(data.R.session.localDate)}: {x.ex?.name}</Badge>)}</Group>
              </Card>
            )}
          </>
        )}
      </Stack>
    </>
  );
}
