// WebAudio-generated beeps — no audio assets. Used to alert students that an
// order is ready, and to alert the shopkeeper of new incoming orders.

type AudioContextCtor = typeof AudioContext;

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) return null;
  if (!sharedContext) sharedContext = new ctor();
  return sharedContext;
}

/**
 * iOS keeps an AudioContext created outside a user gesture permanently
 * `suspended`, so a chime fired later (e.g. an SSE event while the student
 * isn't actively tapping) would silently never play. Call once at app
 * startup — it attaches a one-time listener that creates/resumes the shared
 * context on the student's first touch, so by the time a real chime is
 * needed the context is already running.
 */
export function unlockAudioOnFirstTouch(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
}

function tone(
  ctx: AudioContext,
  startTime: number,
  frequency: number,
  duration: number,
  peakGain: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.setValueAtTime(peakGain, startTime + duration - 0.03);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** Loud triple beep — played for the student when their order becomes ready. */
export function playReadyChime(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const gap = 0.24;
  const duration = 0.17;
  tone(ctx, now, 880, duration, 0.4);
  tone(ctx, now + gap, 880, duration, 0.4);
  tone(ctx, now + gap * 2, 880, duration, 0.4);
}

/** Two-tone alert — played for the shopkeeper when a new order comes in. */
export function playIncomingAlert(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  tone(ctx, now, 660, 0.18, 0.45);
  tone(ctx, now + 0.22, 990, 0.24, 0.45);
}

/**
 * Short single "ting" — played for a student on any order state change
 * (submitted → preparing → ready → awaiting payment).
 */
export function playStatusChange(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  tone(ctx, now, 1046, 0.16, 0.32); // C6
}

/**
 * Distinct rising chime — played for the shopkeeper when an order becomes fully
 * ready / awaiting payment, so it can be handed out fast.
 */
export function playOrderComplete(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  tone(ctx, now, 784, 0.16, 0.4); // G5
  tone(ctx, now + 0.18, 1175, 0.22, 0.4); // D6
}
