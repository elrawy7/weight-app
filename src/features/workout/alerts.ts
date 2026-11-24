/** TMR-03: sound, speech, vibration and visual flash for the rest timer (all optional, all local). */
let ctx: AudioContext | null = null;

/** iOS only plays Web Audio after a user gesture: call this from a tap (e.g. ticking a set). */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio unavailable */ }
}

export function beep(): void {
  if (!ctx) unlockAudio();
  if (!ctx) return;
  const c = ctx;
  [0, 0.28].forEach((at) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.25);
  });
}

export function speak(text: string): void {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

/** TMR-03 AC3: Vibration API (not available on iOS Safari; silently ignored there). */
export function vibrate(): void {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
}

export function flash(): void {
  document.body.classList.add('w-flash');
  window.setTimeout(() => document.body.classList.remove('w-flash'), 1300);
}
