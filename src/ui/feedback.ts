// Decision notes: platform feedback for task completion (PLAN.md section 10). Vibration and
// WebAudio are feature-detected and never throw; failures reach the optional onError callback.
// The AudioContext is created lazily on the first click so no audio resources exist until the
// nurse enables sound. `reducedMotion` does not silence haptics or sound (neither is on-screen
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

function playClick(ctx: AudioContext): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = CLICK_HZ;
  gain.gain.value = CLICK_GAIN;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + CLICK_SECONDS);
}

function click(onError: FeedbackOptions['onError']): void {
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
          playClick(ctx);
        })
        .catch((error: unknown) => {
          onError?.(error);
        });
    } else {
      playClick(ctx);
    }
  } catch (error: unknown) {
    onError?.(error);
  }
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
