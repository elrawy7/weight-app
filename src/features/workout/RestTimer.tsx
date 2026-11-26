/** TMR-01…03: rest timer panel (on the workout screen) and mini-bar + alerts (everywhere else). */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, Button, Card, Group, Progress, Text, UnstyledButton } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconPlayerSkipForward, IconRotateClockwise, IconClock } from '@tabler/icons-react';
import { useDb, useSettings } from '../../app/db';
import { t } from '../../i18n';
import { adjustRest, REST_KEY, restRemaining, type RestTimerState } from './workoutOps';
import { beep, flash, speak, vibrate } from './alerts';

export function useRestTimer(): RestTimerState | undefined {
  const db = useDb();
  return useLiveQuery(async () => (await db.kv.get(REST_KEY))?.value as RestTimerState | undefined, [db]);
}

export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [active, ms]);
  return now;
}

export const mmss = (sec: number) => `${Math.floor(Math.abs(sec) / 60)}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;

/** Mounted once in the shell: fires the alert at 0 (foreground only) and shows the mini-bar off the workout screen. */
export function RestTimerHost() {
  const db = useDb();
  const timer = useRestTimer();
  const settings = useSettings();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const now = useNow(!!timer && !timer.pausedAt);
  const left = timer ? restRemaining(timer, now) : 0;
  const key = timer ? `${timer.sessionId}|${timer.startedAt}|${timer.durationSec}` : null;
  const alerted = useRef<string | null>(null);
  useEffect(() => {
    if (!timer || timer.pausedAt || !key) return;
    if (left <= 0 && alerted.current !== key) {
      alerted.current = key;
      // BR-TIMER-04: alert only when it ends in the foreground; otherwise the "finished … ago" line is shown on return.
      if (left > -3 && document.visibilityState === 'visible') {
        if (settings.sound) beep();
        if (settings.spokenCues) speak(t('tmr.spoken'));
        vibrate();
        flash();
      }
    }
    if (left < -600) void adjustRest(db, 'skip'); // clear a long-finished timer
  }, [left, key, timer, settings.sound, settings.spokenCues, db]);
  if (!timer || pathname.startsWith('/workout/')) return null;
  return (
    <UnstyledButton onClick={() => nav(`/workout/${timer.sessionId}`)} w="100%" mb="sm" data-testid="rest-minibar" aria-label={t('tmr.backToWorkout')}
      style={{ position: 'sticky', top: 'calc(var(--w-safe-top) + 4px)', zIndex: 150 }}>
      <Card withBorder radius="xl" padding="xs" bg="var(--mantine-color-body)">
        <Group justify="space-between" wrap="nowrap" px={6} mih={32}>
          <Group gap={6} wrap="nowrap"><IconClock size={18} aria-hidden /><Text fz="sm" fw={600} lineClamp={1}>{timer.exerciseName}</Text></Group>
          <Text fw={800} ff="monospace" c={left <= 0 ? 'mint' : undefined}>{left > 0 ? mmss(left) : t('tmr.done')}</Text>
        </Group>
      </Card>
    </UnstyledButton>
  );
}

/** Publishes an element's height as a CSS variable while mounted (layout offsets for sticky/fixed bars). */
export function useHeightVar(ref: React.RefObject<HTMLElement | null>, name: string, on = true) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || !on) { root.style.removeProperty(name); return; }
    const set = () => root.style.setProperty(name, `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty(name); };
  }, [ref, name, on]);
}

export interface NextUp { name: string; set: number; target?: string }

/**
 * TMR-01 AC2 / D-06: rest timer docked at the bottom, above the tab bar, so the controls are in thumb reach and the
 * exercise list stays visible above it. Shows what comes next. A spacer keeps the end of the list reachable.
 */
export function RestTimerPanel({ sessionId, next }: { sessionId: string; next?: NextUp | null }) {
  const db = useDb();
  const timer = useRestTimer();
  const now = useNow(!!timer && !timer.pausedAt);
  const ref = useRef<HTMLDivElement>(null);
  const shown = !!timer && timer.sessionId === sessionId;
  useHeightVar(ref, '--w-dock-h', shown);
  if (!timer || !shown) return null;
  const left = restRemaining(timer, now);
  const act = (a: Parameters<typeof adjustRest>[1]) => void adjustRest(db, a);
  const nextLine = next ? <Text fz="xs" c="dimmed" lineClamp={1} data-testid="rest-next">{t('tmr.next', { name: next.name, n: next.set })}{next.target ? ` · ${next.target}` : ''}</Text> : null;
  const spacer = <div aria-hidden style={{ height: 'var(--w-dock-h, 96px)' }} />;
  if (left <= 0) {
    return (
      <>
        {spacer}
        <div className="w-dock" ref={ref}>
          <Card withBorder radius="lg" padding="xs" data-testid="rest-panel" bg="var(--mantine-color-mint-light)">
            <Group justify="space-between" wrap="nowrap" gap={6}>
              <div style={{ minWidth: 0 }}>
                <Text fw={700} role="status" data-testid="rest-finished">{left > -3 ? t('tmr.finished') : t('tmr.finishedAgo', { t: mmss(-left) })}</Text>
                {nextLine}
              </div>
              <Button variant="light" onClick={() => act('skip')} data-testid="rest-dismiss" style={{ flexShrink: 0 }}>{t('tmr.dismiss')}</Button>
            </Group>
          </Card>
        </div>
      </>
    );
  }
  const pct = timer.durationSec ? (100 * left) / timer.durationSec : 0;
  return (
    <>
      {spacer}
      <div className="w-dock" ref={ref}>
        <Card withBorder radius="lg" padding="xs" role="timer" aria-live="off" aria-label={t('ui.restLeft', { s: left })} data-testid="rest-panel" bg="var(--mantine-color-body)">
          <Group justify="space-between" wrap="nowrap" gap={4}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Group gap={8} wrap="nowrap" align="baseline">
                <Text fw={800} fz={26} ff="monospace" lh={1.1} data-testid="rest-left" c={timer.pausedAt ? 'dimmed' : undefined}>{mmss(left)}</Text>
                <Text fz="xs" c="dimmed" lineClamp={2}>{timer.pausedAt ? t('tmr.paused') : t('tmr.rest', { name: timer.exerciseName })}</Text>
              </Group>
            </div>
            <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
              <ActionIcon variant="subtle" aria-label={t('tmr.minus')} onClick={() => act('minus')} data-testid="rest-minus"><Text fz="xs" fw={700}>−15</Text></ActionIcon>
              <ActionIcon variant="subtle" aria-label={t('tmr.plus')} onClick={() => act('plus')} data-testid="rest-plus"><Text fz="xs" fw={700}>+15</Text></ActionIcon>
              {timer.pausedAt
                ? <ActionIcon variant="light" aria-label={t('tmr.resume')} onClick={() => act('resume')} data-testid="rest-resume"><IconPlayerPlay /></ActionIcon>
                : <ActionIcon variant="subtle" aria-label={t('ui.pause')} onClick={() => act('pause')} data-testid="rest-pause"><IconPlayerPause /></ActionIcon>}
              <ActionIcon variant="subtle" aria-label={t('tmr.restart')} onClick={() => act('restart')} data-testid="rest-restart"><IconRotateClockwise /></ActionIcon>
              <ActionIcon variant="light" aria-label={t('ui.skip')} onClick={() => act('skip')} data-testid="rest-skip"><IconPlayerSkipForward /></ActionIcon>
            </Group>
          </Group>
          {nextLine}
          <Progress value={pct} size={4} radius="xl" mt={4} aria-hidden />
        </Card>
      </div>
    </>
  );
}
