/**
 * A-04: notes autosave. Saves a text value shortly after typing stops, and immediately when the page is hidden
 * (app switch, lock screen, iOS killing the tab), when the component unmounts (navigation) and on blur. A failed write
 * keeps the text on screen, shows an error and is retried on the next change or flush.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { t } from '../../i18n';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave(value: string, stored: string, save: (v: string) => Promise<void>, opts: { delayMs?: number; enabled?: boolean } = {}): { state: SaveState; flush: () => Promise<void> } {
  const { delayMs = 600, enabled = true } = opts;
  const [state, setState] = useState<SaveState>('idle');
  const latest = useRef(value);
  latest.current = value;
  const on = useRef(enabled);
  on.current = enabled;
  const saved = useRef(stored);
  // what is stored now counts as saved when it equals what is on screen (e.g. after our own write, or on open)
  if (stored === value) saved.current = stored;
  const saveRef = useRef(save);
  saveRef.current = save;
  const inFlight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (!on.current) return;
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const v = latest.current;
    if (v === saved.current) return;
    setState('saving');
    const p = saveRef.current(v);
    inFlight.current = p;
    try {
      await p;
      saved.current = v;
      setState(latest.current === v ? 'saved' : 'idle');
    } catch {
      setState('error');
      notifications.show({ id: 'note-save-failed', color: 'red', message: t('wo.noteSaveFailed') });
    } finally {
      inFlight.current = null;
    }
  }, []);

  // debounce while typing
  useEffect(() => {
    if (!enabled || value === saved.current) return;
    const h = window.setTimeout(() => void flush(), delayMs);
    return () => window.clearTimeout(h);
  }, [value, delayMs, flush, enabled]);

  // flush when the page is hidden or the screen is left
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    };
  }, [flush]);

  return { state, flush };
}
