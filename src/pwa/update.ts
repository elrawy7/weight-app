import { registerSW } from 'virtual:pwa-register';

type Listener = (ready: boolean) => void;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let needRefresh = false;
let offlineReady = false;
const listeners = new Set<Listener>();

/** PWA-03: register once; a waiting update is only announced, never applied without a tap. */
export function initServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { needRefresh = true; listeners.forEach((l) => l(true)); },
    onOfflineReady() { offlineReady = true; },
    onRegisteredSW(_url, reg) {
      // check for updates hourly while the app is open
      if (reg) setInterval(() => { reg.update().catch(() => undefined); }, 60 * 60 * 1000);
    },
  });
}
export const onUpdateAvailable = (l: Listener) => { listeners.add(l); l(needRefresh); return () => { listeners.delete(l); }; };
export const isOfflineReady = () => offlineReady;
export async function applyUpdate() { if (updateSW) await updateSW(true); }
