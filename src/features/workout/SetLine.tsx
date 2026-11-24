/** One set row: type badge (menu), previous value, weight/reps (or seconds) steppers with ghost prefill, ✓. Swipe left to delete. */
import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Card, Checkbox, Group, Menu, NativeSelect, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconCheck, IconMinus, IconPlus, IconTrash } from '@tabler/icons-react';
import type { SetType, WorkoutSet } from '../../db/types';
import { t } from '../../i18n';
import { step } from '../../domain/rounding';

export interface Ghost { weightKg: number | null; reps: number | null; durationSec: number | null }

/** Repeats an action while pressed (WO-05 AC2 long-press). */
function useRepeat(action: () => void) {
  const timer = useRef<number>();
  const repeated = useRef(false);
  const ref = useRef(action);
  ref.current = action;
  const stop = () => { window.clearTimeout(timer.current); window.clearInterval(timer.current); };
  useEffect(() => stop, []);
  return {
    onPointerDown: () => {
      repeated.current = false;
      stop();
      timer.current = window.setTimeout(() => { repeated.current = true; ref.current(); timer.current = window.setInterval(() => ref.current(), 110); }, 450);
    },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
    onClick: () => { if (!repeated.current) ref.current(); repeated.current = false; },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/** Numeric field that keeps what you type (e.g. "12.") locally and commits valid numbers immediately (BR-SES-02 ≤ 300 ms). */
function NumField({ value, ghost, onCommit, label, decimals, testId, width = 64 }: { value: number | null; ghost: number | null; onCommit: (v: number | null) => void; label: string; decimals: boolean; testId: string; width?: number }) {
  const fmt = (v: number | null) => (v === null ? '' : String(Math.round(v * 100) / 100));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  return (
    <TextInput aria-label={label} value={text} placeholder={ghost === null ? '' : fmt(ghost)} inputMode={decimals ? 'decimal' : 'numeric'} w={width} data-testid={testId}
      styles={{ input: { textAlign: 'center', fontSize: 20, fontWeight: 700, paddingInline: 4 } }}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onBlur={() => { focused.current = false; setText(fmt(value)); }}
      onChange={(e) => {
        const raw = e.currentTarget.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw === '') onCommit(null);
        else if (!raw.endsWith('.')) { const n = decimals ? Number(raw) : Math.trunc(Number(raw)); if (Number.isFinite(n)) onCommit(n); }
      }} />
  );
}

function Stepper({ value, ghost, inc, onCommit, label, decimals, testId, max }: { value: number | null; ghost: number | null; inc: number; onCommit: (v: number | null) => void; label: string; decimals: boolean; testId: string; max: number }) {
  // refs so a long-press keeps stepping from the latest committed value
  const cur = useRef(value ?? ghost ?? 0);
  cur.current = value ?? ghost ?? 0;
  const bump = (dir: 1 | -1) => { const v = Math.min(max, Math.max(0, step(cur.current, inc, dir))); cur.current = v; onCommit(v); };
  const down = useRepeat(() => bump(-1));
  const up = useRepeat(() => bump(1));
  return (
    <Group gap={2} wrap="nowrap">
      <ActionIcon variant="light" aria-label={`${t('ui.decrease')} ${label}`} {...down} data-testid={`${testId}-minus`}><IconMinus size={20} /></ActionIcon>
      <NumField value={value} ghost={ghost} onCommit={onCommit} label={label} decimals={decimals} testId={testId} />
      <ActionIcon variant="light" aria-label={`${t('ui.increase')} ${label}`} {...up} data-testid={`${testId}-plus`}><IconPlus size={20} /></ActionIcon>
    </Group>
  );
}

const TYPE_KEYS: Record<SetType, 'wo.typeWorking' | 'wo.typeWarmup' | 'wo.typeDrop' | 'wo.typeFailure'> = { working: 'wo.typeWorking', warmup: 'wo.typeWarmup', drop: 'wo.typeDrop', failure: 'wo.typeFailure' };
const RPE_OPTIONS = ['', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];

export function SetLine({ set, badge, prevText, ghost, measure, showWeight, unitLabel, weightInc, toDisplay, fromDisplay, showRpe, pr, onPatch, onToggle, onDelete }: {
  set: WorkoutSet; badge: string; prevText: string; ghost: Ghost; measure: 'reps' | 'duration'; showWeight: boolean; unitLabel: string; weightInc: number;
  toDisplay: (kg: number) => number; fromDisplay: (v: number) => number; showRpe: boolean; pr: boolean;
  onPatch: (p: Partial<Pick<WorkoutSet, 'weightKg' | 'reps' | 'rpe' | 'setType' | 'durationSec'>>) => void; onToggle: () => void; onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const done = set.completed === 1;
  const repsLabel = t('ui.reps');
  return (
    <Card withBorder padding="xs" radius="md" data-testid="set-row" data-done={done ? '1' : '0'} bg={done ? 'var(--mantine-color-mint-light)' : undefined}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: start.current ? undefined : 'transform .15s', touchAction: 'pan-y' }}
      onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={(e) => { if (!start.current) return; const mx = e.touches[0].clientX - start.current.x; const my = Math.abs(e.touches[0].clientY - start.current.y); if (my < 30 && mx < 0) setDx(Math.max(-140, mx)); }}
      onTouchEnd={() => { const d = dx; start.current = null; setDx(0); if (d < -100) onDelete(); }}>
      <Group justify="space-between" wrap="nowrap" mb={6} gap={6}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <UnstyledButton aria-label={t('wo.setMenu', { n: badge })} className="w-hit" data-testid="set-badge" style={{ display: 'grid', placeItems: 'center' }}>
                <Badge size="lg" radius="sm" variant={set.setType === 'working' ? 'filled' : 'outline'} color={set.setType === 'warmup' ? 'gray' : set.setType === 'working' ? 'mint' : 'orange'}>{badge}</Badge>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              {(Object.keys(TYPE_KEYS) as SetType[]).map((k) => (
                <Menu.Item key={k} onClick={() => onPatch({ setType: k })} data-testid={`set-type-${k}`} leftSection={set.setType === k ? <IconCheck size={16} /> : <span style={{ width: 16 }} />}>{t(TYPE_KEYS[k])}</Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete} data-testid="set-delete">{t('wo.deleteSet')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Text fz="sm" c="dimmed" lineClamp={1} data-testid="set-prev">{prevText}</Text>
          {pr && <Badge size="sm" color="amber" variant="filled" data-testid="pr-badge">{t('wo.pr')}</Badge>}
        </Group>
        <Checkbox size="xl" aria-label={t('wo.completeSet', { n: badge })} checked={done} onChange={onToggle} data-testid="set-check" icon={({ className }) => <IconCheck className={className} />} />
      </Group>
      <Group justify="space-between" wrap="wrap" gap={6}>
        {showWeight && (
          <Group gap={4} wrap="nowrap">
            <Stepper label={`${t('ui.weight')} (${unitLabel})`} value={set.weightKg === null ? null : toDisplay(set.weightKg)} ghost={ghost.weightKg === null ? null : toDisplay(ghost.weightKg)} inc={weightInc} decimals max={2000}
              onCommit={(v) => onPatch({ weightKg: v === null ? null : fromDisplay(v) })} testId="set-weight" />
            <Text fz="xs" c="dimmed">{unitLabel}</Text>
          </Group>
        )}
        {measure === 'duration'
          ? <Group gap={4} wrap="nowrap"><Stepper label={t('wo.seconds')} value={set.durationSec ?? null} ghost={ghost.durationSec} inc={5} decimals={false} max={3600} onCommit={(v) => onPatch({ durationSec: v })} testId="set-sec" /><Text fz="xs" c="dimmed">{t('common.sec')}</Text></Group>
          : <Group gap={4} wrap="nowrap"><Stepper label={repsLabel} value={set.reps} ghost={ghost.reps} inc={1} decimals={false} max={200} onCommit={(v) => onPatch({ reps: v })} testId="set-reps" /><Text fz="xs" c="dimmed">{t('wo.repsShort')}</Text></Group>}
        {showRpe && (
          <NativeSelect aria-label={t('wo.rpe')} data={RPE_OPTIONS.map((v) => ({ value: v, label: v ? t('common.rpe', { v }) : t('wo.rpe') }))} w={104}
            value={set.rpe == null ? '' : String(set.rpe)} onChange={(e) => onPatch({ rpe: e.currentTarget.value ? Number(e.currentTarget.value) : null })} data-testid="set-rpe" />
        )}
      </Group>
    </Card>
  );
}
