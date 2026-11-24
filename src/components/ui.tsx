/** Design-system components (FND-02). Large targets (≥ 44 pt), accessible names, dark + light. */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Button, Card, Checkbox, Drawer, Group, NumberInput, Progress, Stack, Text, Title, ThemeIcon } from '@mantine/core';
import { IconMinus, IconPlus, IconChevronLeft, IconCheck, IconPlayerPause, IconPlayerSkipForward } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { step } from '../domain/rounding';

export function PageHeader({ title, back, right, subtitle }: { title: string; back?: boolean | string; right?: ReactNode; subtitle?: ReactNode }) {
  const nav = useNavigate();
  return (
    <Group justify="space-between" align="center" mb="md" wrap="nowrap">
      <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
        {back && (
          <ActionIcon aria-label={t('common.back')} onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} ml={-10}>
            <IconChevronLeft size={26} />
          </ActionIcon>
        )}
        <div style={{ minWidth: 0 }}>
          <Title order={2} fz={26} lineClamp={2}>{title}</Title>
          {subtitle && <Text c="dimmed" fz="sm">{subtitle}</Text>}
        </div>
      </Group>
      {right}
    </Group>
  );
}

export function NumberStepper({ value, onChange, increment, label, min = 0, max = 1000, decimals = 2, unit }: {
  value: number | null; onChange: (v: number) => void; increment: number; label: string; min?: number; max?: number; decimals?: number; unit?: string;
}) {
  const v = value ?? 0;
  return (
    <Group gap={6} wrap="nowrap" align="center">
      <ActionIcon variant="light" aria-label={`${t('ui.decrease')} ${label}`} onClick={() => onChange(Math.max(min, step(v, increment || 1, -1)))}><IconMinus size={22} /></ActionIcon>
      <NumberInput aria-label={label} value={value ?? ''} onChange={(x) => onChange(typeof x === 'number' ? x : Number(x) || 0)} min={min} max={max} decimalScale={decimals}
        hideControls inputMode="decimal" w={68} styles={{ input: { textAlign: 'center', fontSize: 20, fontWeight: 700 } }} rightSection={unit ? <Text fz="xs" c="dimmed">{unit}</Text> : undefined} />
      <ActionIcon variant="light" aria-label={`${t('ui.increase')} ${label}`} onClick={() => onChange(Math.min(max, step(v, increment || 1, 1)))}><IconPlus size={22} /></ActionIcon>
    </Group>
  );
}

export function SetRow({ index, weight, reps, increment, unit, done, previous, onChange, onToggle }: {
  index: number; weight: number | null; reps: number | null; increment: number; unit: string; done: boolean; previous?: string;
  onChange: (w: number, r: number) => void; onToggle: () => void;
}) {
  return (
    <Card withBorder padding="xs" radius="md" bg={done ? 'var(--mantine-color-mint-light)' : undefined} data-testid="set-row">
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Group gap="xs" wrap="nowrap"><Text fw={700}>{t('ui.setN', { n: index })}</Text>{previous && <Text fz="xs" c="dimmed">{previous}</Text>}</Group>
        <Checkbox size="xl" aria-label={t('ui.complete')} checked={done} onChange={onToggle} icon={({ className }) => <IconCheck className={className} />} />
      </Group>
      <Group justify="space-between" wrap="wrap" gap="xs">
        <NumberStepper label={t('ui.weight')} value={weight} increment={increment} unit={unit} onChange={(w) => onChange(w, reps ?? 0)} />
        <NumberStepper label={t('ui.reps')} value={reps} increment={1} decimals={0} onChange={(r) => onChange(weight ?? 0, r)} />
      </Group>
    </Card>
  );
}

export function ExerciseCard({ title, meta, badges, onClick, right, children, testId }: { title: string; meta?: ReactNode; badges?: ReactNode; onClick?: () => void; right?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <Card withBorder padding="sm" radius="md" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined} data-testid={testId}
      role={onClick ? 'button' : undefined} aria-label={onClick ? title : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined} mih={56}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} lineClamp={2}>{title}</Text>
          {meta && <Text fz="sm" c="dimmed">{meta}</Text>}
          {badges && <Group gap={6}>{badges}</Group>}
        </Stack>
        {right}
      </Group>
      {children}
    </Card>
  );
}

/** Rest timer bar (visual component; the timer engine is part of Phase 2 active workout). */
export function RestTimerBar({ totalSec, startedAt, onSkip, onAdd, paused, onPause }: { totalSec: number; startedAt: number; paused?: boolean; onSkip: () => void; onAdd: () => void; onPause?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const ref = useRef<number>();
  useEffect(() => { if (paused) return; ref.current = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(ref.current); }, [paused]);
  const left = Math.max(0, Math.ceil(totalSec - (now - startedAt) / 1000));
  return (
    <Card withBorder padding="sm" radius="lg" role="timer" aria-live="polite" aria-label={t('ui.restLeft', { s: left })}>
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2} style={{ flex: 1 }}>
          <Group justify="space-between"><Text fw={700}>{t('demo.rest')}</Text><Text fw={800} fz={22} ff="monospace">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Text></Group>
          <Progress value={totalSec ? (100 * left) / totalSec : 0} size="lg" radius="xl" />
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Button variant="light" onClick={onAdd}>{t('ui.addTime')}</Button>
          {onPause && <ActionIcon aria-label={t('ui.pause')} onClick={onPause}><IconPlayerPause /></ActionIcon>}
          <ActionIcon aria-label={t('ui.skip')} onClick={onSkip}><IconPlayerSkipForward /></ActionIcon>
        </Group>
      </Group>
    </Card>
  );
}

export function StatCard({ label, value, hint, color }: { label: string; value: ReactNode; hint?: ReactNode; color?: string }) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Text fz="xs" tt="uppercase" fw={700} c="dimmed">{label}</Text>
      <Text fz={24} fw={800} c={color}>{value}</Text>
      {hint && <Text fz="xs" c="dimmed">{hint}</Text>}
    </Card>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <Card withBorder padding="xl" radius="lg">
      <Stack align="center" gap="xs" ta="center">
        {icon && <ThemeIcon size={56} radius="xl" variant="light">{icon}</ThemeIcon>}
        <Title order={4}>{title}</Title>
        {body && <Text c="dimmed" fz="sm" maw={420}>{body}</Text>}
        {action}
      </Stack>
    </Card>
  );
}

export function ConfirmSheet({ opened, title, body, confirmLabel, danger, onConfirm, onClose, loading }: {
  opened: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; loading?: boolean;
}) {
  return (
    <Drawer opened={opened} onClose={onClose} title={<Text fw={700}>{title}</Text>} size="auto" closeButtonProps={{ 'aria-label': t('common.close') }}>
      <Stack pb="md">
        <Text>{body}</Text>
        <Button size="lg" color={danger ? 'red' : undefined} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        <Button size="lg" variant="default" onClick={onClose}>{t('common.cancel')}</Button>
      </Stack>
    </Drawer>
  );
}

export const Section = ({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) => (
  <Stack gap="xs" mt="lg">
    <Group justify="space-between"><Text fz="xs" tt="uppercase" fw={700} c="dimmed">{title}</Text>{right}</Group>
    {children}
  </Stack>
);

export const KneeBadge = ({ tags }: { tags: string[] }) => (
  <>
    {tags.includes('knee_friendly') && <Badge variant="light" color="mint" size="sm">{t('today.knee')}</Badge>}
    {tags.includes('knee_caution') && <Badge variant="light" color="orange" size="sm">{t('today.kneeCaution')}</Badge>}
  </>
);
