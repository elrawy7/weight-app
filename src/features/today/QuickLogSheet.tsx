import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, NumberInput, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { t } from '../../i18n';

export interface QuickValues { durationMin: number | null; kneePain: number | null; energy: number | null; notes: string }

/** Bottom sheet for QL-01: minutes, knee pain 0–10, energy 1–5, note. */
export function QuickLogSheet({ opened, title, initial, submitLabel, onClose, onSubmit }: {
  opened: boolean; title: string; initial?: Partial<QuickValues>; submitLabel: string; onClose: () => void; onSubmit: (v: QuickValues) => Promise<void>;
}) {
  const [v, setV] = useState<QuickValues>({ durationMin: null, kneePain: null, energy: null, notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (opened) { setV({ durationMin: initial?.durationMin ?? null, kneePain: initial?.kneePain ?? null, energy: initial?.energy ?? null, notes: initial?.notes ?? '' }); setErr(null); } }, [opened, initial]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await onSubmit(v); } catch (e) { setErr(e instanceof Error ? e.message : t('common.error')); } finally { setBusy(false); }
  };
  return (
    <Drawer opened={opened} onClose={onClose} size="auto" title={<Text fw={700}>{title}</Text>} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <Stack pb="md" gap="sm">
        <NumberInput label={t('ql.minutes')} min={0} max={600} allowDecimal={false} value={v.durationMin ?? ''} onChange={(x) => setV({ ...v, durationMin: typeof x === 'number' ? x : null })} data-testid="ql-minutes" />
        <div>
          <Text fz="sm" fw={500} mb={4}>{t('ql.knee')}</Text>
          <Scale testId="ql-knee" values={Array.from({ length: 11 }, (_, i) => i)} cols={6} value={v.kneePain} onChange={(n) => setV({ ...v, kneePain: n })} label={t('ql.knee')} />
        </div>
        <div>
          <Text fz="sm" fw={500} mb={4}>{t('ql.energy')}</Text>
          <Scale testId="ql-energy" values={[1, 2, 3, 4, 5]} cols={5} value={v.energy} onChange={(n) => setV({ ...v, energy: n })} label={t('ql.energy')} />
        </div>
        <Textarea label={t('ql.notes')} placeholder={t('ql.notesPlaceholder')} autosize minRows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        {err && <Alert color="red">{err}</Alert>}
        <Button size="lg" onClick={() => void submit()} loading={busy} data-testid="ql-save">{submitLabel}</Button>
      </Stack>
    </Drawer>
  );
}

/** Number picker with ≥ 44 pt buttons (a segmented control with 11 options would be too narrow on a phone). */
function Scale({ values, cols, value, onChange, label, testId }: { values: number[]; cols: number; value: number | null; onChange: (n: number | null) => void; label: string; testId: string }) {
  return (
    <SimpleGrid cols={cols} spacing={6} role="radiogroup" aria-label={label} data-testid={testId}>
      {values.map((n) => (
        <Button key={n} role="radio" aria-checked={value === n} variant={value === n ? 'filled' : 'default'} px={0} h={44} onClick={() => onChange(value === n ? null : n)}>{n}</Button>
      ))}
    </SimpleGrid>
  );
}
