/** Installed to the Home Screen (standalone) – iOS uses navigator.standalone, others the display-mode media query. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}

/** OPT-06: Screen Wake Lock (iOS 18.4+ in Home-Screen apps). Used by the active workout (Phase 2). */
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
  if (!wl) return null;
  try { return await wl.request('screen'); } catch { return null; }
}
export const wakeLockSupported = () => 'wakeLock' in navigator;
export const speechSupported = () => 'speechSynthesis' in window;
