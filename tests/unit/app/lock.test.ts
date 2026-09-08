import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireTabLock,
  browserChannel,
  LOCK_CHANNEL,
  LOCK_WAIT_MS,
  type ChannelLike,
  type LockMessage,
} from '../../../src/ui/app/lock';

/** An in-memory bus: every channel hears every other channel's posts, asynchronously. */
function bus() {
  const channels = new Set<{ listeners: ((e: { data: unknown }) => void)[] }>();
  const posted: unknown[] = [];
  const open = (): ChannelLike => {
    const self = { listeners: [] as ((e: { data: unknown }) => void)[] };
    channels.add(self);
    return {
      postMessage: (message) => {
        posted.push(message);
        for (const other of channels) {
          if (other !== self) {
            for (const l of other.listeners) {
              queueMicrotask(() => {
                l({ data: message });
              });
            }
          }
        }
      },
      addEventListener: (_type, listener) => {
        self.listeners.push(listener);
      },
      close: () => {
        channels.delete(self);
      },
    };
  };
  const inject = (message: unknown): void => {
    for (const c of channels) {
      for (const l of c.listeners) {
        l({ data: message });
      }
    }
  };
  return { open, posted, inject, size: () => channels.size };
}

describe('acquireTabLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('becomes primary when nobody answers within the window and then answers claims', async () => {
    const b = bus();
    const pageHide = vi.fn<(fn: () => void) => void>();
    const pending = acquireTabLock({ channel: b.open, id: 'A', onPageHide: pageHide });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const lock = await pending;
    expect(lock.role).toBe('primary');
    expect(pageHide).toHaveBeenCalledTimes(1);
    expect(b.posted).toEqual([{ type: 'claim', id: 'A' }]);

    const second = acquireTabLock({ channel: b.open, id: 'B', waitMs: 300 });
    await vi.advanceTimersByTimeAsync(10);
    const readonly = await second;
    expect(readonly.role).toBe('readonly');
    expect(b.posted).toEqual([
      { type: 'claim', id: 'A' },
      { type: 'claim', id: 'B' },
      { type: 'held', id: 'A' },
    ]);
  });

  it('tells a read-only tab when the primary releases, and closes channels on release', async () => {
    const b = bus();
    const primaryPending = acquireTabLock({ channel: b.open, id: 'A' });
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
    const primary = await primaryPending;
    const onReleased = vi.fn();
    const readonlyPending = acquireTabLock({ channel: b.open, id: 'B', onReleased });
    await vi.advanceTimersByTimeAsync(5);
    const readonly = await readonlyPending;
    expect(readonly.role).toBe('readonly');
    expect(b.size()).toBe(2);
    primary.release();
    primary.release();
    await vi.advanceTimersByTimeAsync(1);
    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(b.posted.filter((m) => (m as LockMessage).type === 'released')).toHaveLength(1);
    readonly.release();
    expect(b.size()).toBe(0);
    expect(b.posted.filter((m) => (m as LockMessage).type === 'released')).toHaveLength(1);
  });

  it('ignores malformed messages, its own messages and a late held', async () => {
    const b = bus();
    const pending = acquireTabLock({ channel: b.open, id: 'A' });
    b.inject(null);
    b.inject('held');
    b.inject({ type: 'held' });
    b.inject({ type: 'nonsense', id: 'Z' });
    b.inject({ type: 'held', id: 'A' });
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
    const lock = await pending;
    expect(lock.role).toBe('primary');
    b.inject({ type: 'held', id: 'Z' });
    b.inject({ type: 'released', id: 'Z' });
    await vi.advanceTimersByTimeAsync(1);
    expect(b.posted).toEqual([{ type: 'claim', id: 'A' }]);
  });

  it('is primary without a BroadcastChannel', async () => {
    const lock = await acquireTabLock({ channel: () => undefined, id: 'A' });
    expect(lock.role).toBe('primary');
    lock.release();
  });
});

describe('browserChannel', () => {
  it('returns undefined without BroadcastChannel and wraps it when present', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(browserChannel()).toBeUndefined();
    const instances: { name: string; posted: unknown[]; closed: boolean; listeners: number }[] = [];
    class Fake {
      posted: unknown[] = [];
      closed = false;
      listeners = 0;
      constructor(readonly name: string) {
        instances.push(this);
      }
      postMessage(message: unknown): void {
        this.posted.push(message);
      }
      addEventListener(): void {
        this.listeners += 1;
      }
      close(): void {
        this.closed = true;
      }
    }
    vi.stubGlobal('BroadcastChannel', Fake);
    const channel = browserChannel();
    expect(channel).toBeDefined();
    channel?.postMessage({ type: 'claim', id: 'x' });
    channel?.addEventListener('message', () => undefined);
    channel?.close();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      name: LOCK_CHANNEL,
      posted: [{ type: 'claim', id: 'x' }],
      listeners: 1,
      closed: true,
    });
    vi.unstubAllGlobals();
  });
});
