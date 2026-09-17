// No real timers: the request promise is resolved or rejected by the fake itself and the
// microtask queue is drained with `settle`. Visibility is driven by hand through the deps.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserWakeLockDeps,
  createWakeLock,
  type WakeLockDeps,
  type WakeLockSentinel,
} from '../../../src/scheduler/wakelock';

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
}

interface Fake {
  sentinel: WakeLockSentinel;
  releases: number;
  listeners: number;
  fireRelease(): void;
}

function fakeSentinel(release: () => Promise<void> = () => Promise.resolve()): Fake {
  const listeners: (() => void)[] = [];
  const fake: Fake = {
    releases: 0,
    get listeners() {
      return listeners.length;
    },
    fireRelease: () => {
      for (const cb of [...listeners]) {
        cb();
      }
    },
    sentinel: {
      release: () => {
        fake.releases += 1;
        return release();
      },
      addEventListener: (_type, cb) => {
        listeners.push(cb);
      },
    },
  };
  return fake;
}

function harness(overrides: Partial<WakeLockDeps> = {}) {
  const errors: string[] = [];
  const fakes: Fake[] = [];
  let visible = true;
  let notify: (() => void) | undefined;
  let unsubscribes = 0;
  let attempts = 0;
  let outcome: (() => Promise<WakeLockSentinel>) | undefined;
  const deps: WakeLockDeps = {
    request: () => {
      attempts += 1;
      if (outcome !== undefined) {
        return outcome();
      }
      const fake = fakeSentinel();
      fakes.push(fake);
      return Promise.resolve(fake.sentinel);
    },
    isVisible: () => visible,
    onVisibilityChange: (cb) => {
      notify = cb;
      return () => {
        unsubscribes += 1;
        notify = undefined;
      };
    },
    onError: (r) => errors.push(r),
    ...overrides,
  };
  return {
    deps,
    errors,
    fakes,
    lock: createWakeLock(deps),
    attempts: () => attempts,
    unsubscribes: () => unsubscribes,
    setVisible: (v: boolean) => {
      visible = v;
      notify?.();
    },
    subscribed: () => notify !== undefined,
    failWith: (fn: (() => Promise<WakeLockSentinel>) | undefined) => {
      outcome = fn;
    },
  };
}

describe('createWakeLock: acquire and release', () => {
  it('acquires when enabled while visible and reports held', async () => {
    const h = harness();
    expect(h.lock.held()).toBe(false);
    h.lock.enable();
    expect(h.lock.held()).toBe(false);
    await settle();
    expect(h.lock.held()).toBe(true);
    expect(h.attempts()).toBe(1);
    expect(h.errors).toEqual([]);
  });

  it('is idempotent on enable and on disable', async () => {
    const h = harness();
    h.lock.enable();
    h.lock.enable();
    h.lock.enable();
    await settle();
    expect(h.attempts()).toBe(1);
    expect(h.lock.held()).toBe(true);
    h.lock.disable();
    h.lock.disable();
    await settle();
    expect(h.lock.held()).toBe(false);
    expect(h.fakes[0]?.releases).toBe(1);
    expect(h.unsubscribes()).toBe(1);
    expect(h.subscribed()).toBe(false);
    expect(h.errors).toEqual([]);
  });

  it('does not acquire while hidden and acquires on the next visibility change', async () => {
    const h = harness();
    h.setVisible(false);
    h.lock.enable();
    await settle();
    expect(h.attempts()).toBe(0);
    expect(h.lock.held()).toBe(false);
    h.setVisible(true);
    await settle();
    expect(h.attempts()).toBe(1);
    expect(h.lock.held()).toBe(true);
  });

  it('re-acquires after the platform releases the lock when the page hides', async () => {
    const h = harness();
    h.lock.enable();
    await settle();
    expect(h.lock.held()).toBe(true);
    expect(h.fakes[0]?.listeners).toBe(1);
    h.setVisible(false);
    h.fakes[0]?.fireRelease();
    expect(h.lock.held()).toBe(false);
    expect(h.attempts()).toBe(1);
    h.setVisible(true);
    await settle();
    expect(h.attempts()).toBe(2);
    expect(h.lock.held()).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('ignores a release event from a sentinel it has already given up', async () => {
    const h = harness();
    h.lock.enable();
    await settle();
    const first = h.fakes[0];
    h.lock.disable();
    h.lock.enable();
    await settle();
    expect(h.lock.held()).toBe(true);
    first?.fireRelease();
    expect(h.lock.held()).toBe(true);
  });

  it('does nothing and never throws without a request dep', async () => {
    const lock = createWakeLock({ isVisible: () => true });
    expect(() => {
      lock.enable();
      lock.disable();
      lock.enable();
    }).not.toThrow();
    await settle();
    expect(lock.held()).toBe(false);
  });

  it('acquires with no deps at all without throwing', async () => {
    const lock = createWakeLock();
    expect(() => {
      lock.enable();
    }).not.toThrow();
    await settle();
    expect(lock.held()).toBe(false);
    lock.disable();
  });
});

describe('createWakeLock: failure', () => {
  it('reports a rejected request once per attempt in plain English and stays wanted', async () => {
    const h = harness();
    h.failWith(() => Promise.reject(new Error('battery too low')));
    h.lock.enable();
    await settle();
    expect(h.errors).toEqual(['Could not keep the screen on: battery too low']);
    expect(h.lock.held()).toBe(false);
    h.setVisible(false);
    h.setVisible(true);
    await settle();
    expect(h.errors).toHaveLength(2);
    expect(h.attempts()).toBe(2);
    h.failWith(undefined);
    h.setVisible(false);
    h.setVisible(true);
    await settle();
    expect(h.lock.held()).toBe(true);
    expect(h.errors).toHaveLength(2);
  });

  it('reports a request that throws synchronously', async () => {
    const h = harness();
    h.failWith(() => {
      throw new Error('not allowed here');
    });
    h.lock.enable();
    await settle();
    expect(h.errors).toEqual(['Could not keep the screen on: not allowed here']);
    expect(h.lock.held()).toBe(false);
  });

  it('describes a rejection with no message plainly', async () => {
    const h = harness();
    h.failWith(() => Promise.reject(new Error('')));
    h.lock.enable();
    await settle();
    expect(h.errors).toEqual(['Could not keep the screen on']);
  });

  it('reports a rejected release', async () => {
    const fake = fakeSentinel(() => Promise.reject(new Error('already released')));
    const errors: string[] = [];
    const lock = createWakeLock({
      request: () => Promise.resolve(fake.sentinel),
      isVisible: () => true,
      onError: (r) => errors.push(r),
    });
    lock.enable();
    await settle();
    lock.disable();
    await settle();
    expect(errors).toEqual(['Could not release the screen wake lock: already released']);
    expect(lock.held()).toBe(false);
  });

  it('stays quiet without an onError handler', async () => {
    const lock = createWakeLock({
      request: () => Promise.reject(new Error('denied')),
      isVisible: () => true,
    });
    lock.enable();
    await expect(settle()).resolves.toBeUndefined();
    expect(lock.held()).toBe(false);
  });
});

describe('createWakeLock: in-flight disable', () => {
  it('releases a sentinel that arrives after disable and never reports it held', async () => {
    const h = harness();
    let resolve: (s: WakeLockSentinel) => void = () => undefined;
    const fake = fakeSentinel();
    h.failWith(
      () =>
        new Promise<WakeLockSentinel>((r) => {
          resolve = r;
        }),
    );
    h.lock.enable();
    h.lock.disable();
    expect(h.lock.held()).toBe(false);
    resolve(fake.sentinel);
    await settle();
    expect(h.lock.held()).toBe(false);
    expect(fake.releases).toBe(1);
    expect(fake.listeners).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('does not start a second request while one is in flight', async () => {
    const h = harness();
    let resolve: (s: WakeLockSentinel) => void = () => undefined;
    const fake = fakeSentinel();
    h.failWith(
      () =>
        new Promise<WakeLockSentinel>((r) => {
          resolve = r;
        }),
    );
    h.lock.enable();
    h.setVisible(false);
    h.setVisible(true);
    h.setVisible(false);
    h.setVisible(true);
    expect(h.attempts()).toBe(1);
    resolve(fake.sentinel);
    await settle();
    expect(h.lock.held()).toBe(true);
    expect(h.attempts()).toBe(1);
  });
});

describe('browserWakeLockDeps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('feature-detects without throwing in jsdom, where there is no wakeLock', async () => {
    const deps = browserWakeLockDeps();
    expect(deps.request).toBeUndefined();
    expect(deps.onError).toBeUndefined();
    expect(deps.isVisible?.()).toBe(true);
    const lock = createWakeLock(deps);
    expect(() => {
      lock.enable();
    }).not.toThrow();
    await settle();
    expect(lock.held()).toBe(false);
    lock.disable();
  });

  it('subscribes to visibilitychange and unsubscribes cleanly', () => {
    const deps = browserWakeLockDeps();
    let seen = 0;
    const off = deps.onVisibilityChange?.(() => {
      seen += 1;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toBe(1);
    off?.();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toBe(1);
  });

  it('copes with neither a navigator nor a document', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', undefined);
    const deps = browserWakeLockDeps();
    expect(deps.request).toBeUndefined();
    expect(deps.isVisible).toBeUndefined();
    expect(deps.onVisibilityChange).toBeUndefined();
  });

  it('wires navigator.wakeLock when it exists', async () => {
    const fake = fakeSentinel();
    const asked: string[] = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          asked.push(type);
          return Promise.resolve(fake.sentinel);
        },
      },
    });
    const deps = browserWakeLockDeps();
    const lock = createWakeLock(deps);
    lock.enable();
    await settle();
    expect(asked).toEqual(['screen']);
    expect(lock.held()).toBe(true);
    lock.disable();
    await settle();
    expect(fake.releases).toBe(1);
  });

  it('ignores a wakeLock object without a request function', () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {} });
    expect(browserWakeLockDeps().request).toBeUndefined();
  });
});
