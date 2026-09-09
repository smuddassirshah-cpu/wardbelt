// Decision notes: the tab lock from PLAN.md section 8. A booting tab posts `claim` on
// BroadcastChannel('wardbelt-lock'); a live primary answers `held`; if `held` arrives within
// the window the new tab is read-only, otherwise it becomes primary and answers later claims
// itself. The primary posts `released` on pagehide so a read-only tab can offer a reload to
// take over (it does not reload itself: PLAN.md forbids silent reloads). Nothing is persisted,
// so a tab that dies without pagehide can never leave a stale lock: only live tabs answer. Two
// tabs booting inside the same window would both become primary; a human cannot do that and
// the plan says multiple tabs are unsupported. Without BroadcastChannel the tab is primary.
export const LOCK_CHANNEL = 'wardbelt-lock';
export const LOCK_WAIT_MS = 300;

export type LockRole = 'primary' | 'readonly';

export interface LockMessage {
  type: 'claim' | 'held' | 'released';
  id: string;
}

export interface ChannelLike {
  postMessage(message: LockMessage): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface TabLock {
  role: LockRole;
  /** Posts `released` (primary only) and closes the channel. */
  release: () => void;
}

export interface LockDeps {
  channel: () => ChannelLike | undefined;
  id: string;
  waitMs?: number;
  onReleased?: () => void;
  onPageHide?: (fn: () => void) => void;
}

function isLockMessage(data: unknown): data is LockMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const type = 'type' in data ? data.type : undefined;
  return (
    (type === 'claim' || type === 'held' || type === 'released') &&
    'id' in data &&
    typeof data.id === 'string'
  );
}

export function browserChannel(): ChannelLike | undefined {
  const g: { BroadcastChannel?: typeof BroadcastChannel } = globalThis;
  if (typeof g.BroadcastChannel !== 'function') {
    return undefined;
  }
  const channel = new g.BroadcastChannel(LOCK_CHANNEL);
  return {
    postMessage: (message) => {
      channel.postMessage(message);
    },
    addEventListener: (type, listener) => {
      channel.addEventListener(type, listener);
    },
    close: () => {
      channel.close();
    },
  };
}

export function acquireTabLock(deps: LockDeps): Promise<TabLock> {
  const channel = deps.channel();
  const { id } = deps;
  if (channel === undefined) {
    return Promise.resolve({ role: 'primary', release: () => undefined });
  }
  const waitMs = deps.waitMs ?? LOCK_WAIT_MS;
  return new Promise<TabLock>((resolve) => {
    let role: LockRole | undefined;
    let closed = false;

    const post = (type: LockMessage['type']): void => {
      if (!closed) {
        channel.postMessage({ type, id });
      }
    };
    const release = (): void => {
      if (closed) {
        return;
      }
      if (role === 'primary') {
        post('released');
      }
      closed = true;
      channel.close();
    };
    const settle = (decided: LockRole): void => {
      if (role !== undefined) {
        return;
      }
      role = decided;
      if (decided === 'primary') {
        deps.onPageHide?.(release);
      }
      resolve({ role: decided, release });
    };

    channel.addEventListener('message', (event) => {
      const message = event.data;
      if (!isLockMessage(message) || message.id === id) {
        return;
      }
      if (message.type === 'held' && role === undefined) {
        settle('readonly');
      } else if (message.type === 'claim' && role === 'primary') {
        post('held');
      } else if (message.type === 'released' && role === 'readonly') {
        deps.onReleased?.();
      }
    });
    post('claim');
    setTimeout(() => {
      settle('primary');
    }, waitMs);
  });
}
