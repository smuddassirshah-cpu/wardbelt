// Decision notes: Android freezes a hidden page's timers and there is no server to push from, so
// an opt-in screen wake lock is the only way an overdue check can alert on time. Everything
// platform-specific arrives through `WakeLockDeps` and `browserWakeLockDeps` is the single place
// that reads globals, feature-detected so the module never throws where the API is missing
// (jsdom, iOS Safari before 16.4). The lock is *wanted* state plus an *held* sentinel: the
// platform drops the sentinel whenever the page hides, so `enable` subscribes to visibility and
// re-acquires on every return rather than assuming one acquisition lasts. A rejected request
// (permission, low battery, unsupported) is reported once per attempt and leaves the lock wanted,
// so the next visibility change retries; a rejection that arrives after `disable` is not reported,
// because the user has already said they no longer want the lock. `disable` during an in-flight
// request releases the sentinel on arrival. Every platform call is guarded both ways, since
// `release` and `addEventListener` may throw synchronously and neither `enable` nor `disable` may
// ever throw; the sentinel is adopted only once its release listener is attached, so `held` and
// the reported message always agree. No patient data reaches this module and nothing is logged.

export interface WakeLockSentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

export interface WakeLockDeps {
  request?: () => Promise<WakeLockSentinel>;
  /** Subscribe to page visibility changes; returns the unsubscribe. */
  onVisibilityChange?: (cb: () => void) => () => void;
  isVisible?: () => boolean;
  onError?: (reason: string) => void;
}

export interface WakeLock {
  /** Acquire now if visible, and re-acquire whenever the page becomes visible again. */
  enable(): void;
  /** Release and stop re-acquiring. */
  disable(): void;
  held(): boolean;
}

function describe(err: unknown): string {
  return err instanceof Error && err.message !== '' ? `: ${err.message}` : '';
}

export function createWakeLock(deps: WakeLockDeps = {}): WakeLock {
  const onError = deps.onError ?? ((): void => undefined);
  let wanted = false;
  let sentinel: WakeLockSentinel | undefined;
  let pending = false;
  let unsubscribe: (() => void) | undefined;

  const releaseFailed = (err: unknown): void => {
    onError(`Could not release the screen wake lock${describe(err)}`);
  };

  const drop = (held: WakeLockSentinel): void => {
    try {
      held.release().catch(releaseFailed);
    } catch (err: unknown) {
      releaseFailed(err);
    }
  };

  /** Reports an acquisition failure, unless the lock has since stopped being wanted. */
  const acquireFailed = (err: unknown): void => {
    pending = false;
    if (wanted) {
      onError(`Could not keep the screen on${describe(err)}`);
    }
  };

  const adopt = (held: WakeLockSentinel): void => {
    pending = false;
    if (!wanted) {
      drop(held);
      return;
    }
    try {
      held.addEventListener('release', () => {
        if (sentinel === held) {
          sentinel = undefined;
        }
      });
    } catch (err: unknown) {
      drop(held);
      acquireFailed(err);
      return;
    }
    sentinel = held;
  };

  const acquire = (): void => {
    const request = deps.request;
    if (!wanted || pending || sentinel !== undefined || request === undefined) {
      return;
    }
    if (deps.isVisible !== undefined && !deps.isVisible()) {
      return;
    }
    pending = true;
    try {
      request().then(adopt).catch(acquireFailed);
    } catch (err: unknown) {
      acquireFailed(err);
    }
  };

  return {
    enable: () => {
      if (wanted) {
        return;
      }
      wanted = true;
      if (deps.onVisibilityChange !== undefined) {
        unsubscribe = deps.onVisibilityChange(acquire);
      }
      acquire();
    },
    disable: () => {
      if (!wanted) {
        return;
      }
      wanted = false;
      if (unsubscribe !== undefined) {
        unsubscribe();
        unsubscribe = undefined;
      }
      const held = sentinel;
      sentinel = undefined;
      if (held !== undefined) {
        drop(held);
      }
    },
    held: () => sentinel !== undefined,
  };
}

/** A partial view of the globals so feature checks stay honest under the strict lint. */
interface DetectedNavigator {
  wakeLock?: { request?: (type: 'screen') => Promise<WakeLockSentinel> };
}

export function browserWakeLockDeps(): WakeLockDeps {
  const deps: WakeLockDeps = {};
  const nav: DetectedNavigator | undefined =
    typeof navigator === 'undefined' ? undefined : navigator;
  const api = nav?.wakeLock;
  if (api !== undefined && typeof api.request === 'function') {
    const request = api.request.bind(api);
    deps.request = () => request('screen');
  }
  if (typeof document !== 'undefined') {
    deps.isVisible = () => document.visibilityState === 'visible';
    deps.onVisibilityChange = (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => {
        document.removeEventListener('visibilitychange', cb);
      };
    };
  }
  return deps;
}
