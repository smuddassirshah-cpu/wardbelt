import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beltCompleteFeedback,
  completionFeedback,
  prefersReducedMotion,
  resetAudioForTests,
} from '../../../src/ui/feedback';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAudioForTests();
});

class FakeOscillator {
  frequency = { value: 0 };
  connect = vi.fn(() => this);
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = { value: 0 };
  connect = vi.fn(() => this);
}

function fakeAudioContext(state: 'running' | 'suspended', resumeFails = false) {
  const oscillators: FakeOscillator[] = [];
  class FakeAudioContext {
    state = state;
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => (resumeFails ? Promise.reject(new Error('resume')) : Promise.resolve()));
    createOscillator() {
      const o = new FakeOscillator();
      oscillators.push(o);
      return o;
    }
    createGain() {
      return new FakeGain();
    }
  }
  return { FakeAudioContext, oscillators };
}

describe('feedback', () => {
  it('vibrates when navigator.vibrate exists', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    expect(completionFeedback({ sound: false, reducedMotion: false })).toEqual({
      animate: true,
      vibrated: true,
    });
    expect(vibrate).toHaveBeenCalledWith(30);
    expect(beltCompleteFeedback({ sound: false, reducedMotion: true })).toEqual({
      animate: false,
      vibrated: true,
    });
    expect(vibrate).toHaveBeenLastCalledWith([30, 40, 30]);
  });

  it('does nothing without vibrate and never throws when AudioContext is missing', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('AudioContext', undefined);
    const onError = vi.fn();
    expect(completionFeedback({ sound: true, reducedMotion: false, onError })).toEqual({
      animate: true,
      vibrated: false,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a throwing vibrate through onError', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('nope');
      },
    });
    const onError = vi.fn();
    expect(completionFeedback({ sound: false, reducedMotion: false, onError }).vibrated).toBe(
      false,
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('plays a 40 ms click through a lazily created AudioContext', () => {
    vi.stubGlobal('navigator', {});
    const { FakeAudioContext, oscillators } = fakeAudioContext('running');
    vi.stubGlobal('AudioContext', FakeAudioContext);
    completionFeedback({ sound: true, reducedMotion: false });
    completionFeedback({ sound: true, reducedMotion: false });
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0]?.start).toHaveBeenCalledTimes(1);
    expect(oscillators[0]?.stop).toHaveBeenCalledWith(0.04);
    completionFeedback({ sound: false, reducedMotion: false });
    expect(oscillators).toHaveLength(2);
  });

  it('resumes a suspended context before clicking and reports resume failures', async () => {
    vi.stubGlobal('navigator', {});
    const ok = fakeAudioContext('suspended');
    vi.stubGlobal('AudioContext', ok.FakeAudioContext);
    completionFeedback({ sound: true, reducedMotion: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(ok.oscillators).toHaveLength(1);
    resetAudioForTests();
    const failing = fakeAudioContext('suspended', true);
    vi.stubGlobal('AudioContext', failing.FakeAudioContext);
    const onError = vi.fn();
    completionFeedback({ sound: true, reducedMotion: false, onError });
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failing.oscillators).toHaveLength(0);
  });

  it('reports a failing AudioContext constructor through onError and never throws', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('AudioContext', function Blocked() {
      throw new Error('blocked');
    });
    const onError = vi.fn();
    expect(() => completionFeedback({ sound: true, reducedMotion: false, onError })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(() => completionFeedback({ sound: true, reducedMotion: false })).not.toThrow();
  });

  it('reads prefers-reduced-motion with feature detection', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(prefersReducedMotion()).toBe(true);
  });
});
