// Decision notes: platform feedback for task completion (PLAN.md section 10). Vibration and
// WebAudio are feature-detected and never throw; failures reach the optional onError callback.
// The AudioContext is created lazily on the first sound so no audio resources exist until the
// nurse enables sound; the completion click and the due tone share it, and both route a
// suspended context through the same resume. The due tone is two short notes scheduled on the
// context's own clock rather than with timers, so nothing is left pending if the page is hidden. `reducedMotion` does not silence haptics or sound (neither is on-screen
// motion); it is returned as `animate: false` so callers skip animation classes, which the
// stylesheet also disables under the media query.
export interface FeedbackOptions {
  sound: boolean;
  reducedMotion: boolean;
  onError?: (error: unknown) => void;
}

export interface FeedbackResult {
  animate: boolean;
  vibrated: boolean;
}

const CLICK_SECONDS = 0.04;
const CLICK_HZ = 880;
const CLICK_GAIN = 0.08;
const TONE_SECONDS = 0.15;
const TONE_GAP_SECONDS = 0.08;
const TONE_HZ = [880, 660];

let audio: AudioContext | undefined;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface VibratingNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

interface AudioGlobal {
  AudioContext?: typeof AudioContext;
}

function vibrate(pattern: number | number[], onError: FeedbackOptions['onError']): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const nav: VibratingNavigator = navigator;
  if (typeof nav.vibrate !== 'function') {
    return false;
  }
  try {
    return nav.vibrate(pattern);
  } catch (error: unknown) {
    onError?.(error);
    return false;
  }
}

function note(ctx: AudioContext, hz: number, startAt: number, seconds: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = hz;
  gain.gain.value = CLICK_GAIN;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + seconds);
}

function playClick(ctx: AudioContext): void {
  note(ctx, CLICK_HZ, ctx.currentTime, CLICK_SECONDS);
}

function playDueTone(ctx: AudioContext): void {
  const step = TONE_SECONDS + TONE_GAP_SECONDS;
  TONE_HZ.forEach((hz, i) => {
    note(ctx, hz, ctx.currentTime + i * step, TONE_SECONDS);
  });
}

/** Runs `play` on the lazy context, resuming it first; every failure reaches `onError`. */
function withAudio(onError: FeedbackOptions['onError'], play: (ctx: AudioContext) => void): void {
  const g: AudioGlobal = globalThis;
  const Ctor = g.AudioContext;
  if (typeof Ctor !== 'function') {
    return;
  }
  try {
    audio ??= new Ctor();
    const ctx = audio;
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          play(ctx);
        })
        .catch((error: unknown) => {
          onError?.(error);
        });
    } else {
      play(ctx);
    }
  } catch (error: unknown) {
    onError?.(error);
  }
}

function click(onError: FeedbackOptions['onError']): void {
  withAudio(onError, playClick);
}

export interface ToneOptions {
  sound: boolean;
  onError?: (error: unknown) => void;
}

/** Two short notes when a check falls due, while the app is open. Silent when Sound is off. */
export function dueTone(opts: ToneOptions): void {
  if (!opts.sound) {
    return;
  }
  withAudio(opts.onError, playDueTone);
}

function feedback(pattern: number | number[], opts: FeedbackOptions): FeedbackResult {
  const vibrated = vibrate(pattern, opts.onError);
  if (opts.sound) {
    click(opts.onError);
  }
  return { animate: !opts.reducedMotion, vibrated };
}

/** One task completed: a 30 ms buzz and an optional 40 ms click. */
export function completionFeedback(opts: FeedbackOptions): FeedbackResult {
  return feedback(30, opts);
}

/** Every task on a belt done or skipped: a three-pulse buzz and an optional click. */
export function beltCompleteFeedback(opts: FeedbackOptions): FeedbackResult {
  return feedback([30, 40, 30], opts);
}

/** Test seam: drop the lazily created context so a fresh one is built on the next click. */
export function resetAudioForTests(): void {
  audio = undefined;
}
