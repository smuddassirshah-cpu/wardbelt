// Decision notes: every test gets its own fake IDBFactory so databases never leak between
// cases. Open failures are simulated with request-like EventTargets that fire the wanted event
// once listeners are attached. Write failures go through the real fake-indexeddb request and
// transaction machinery (`_execRequestAsync` with a throwing operation) so the error event,
// transaction abort and idb promise rejection are all genuine; a sync-throw variant covers the
// other way an object-store method can fail.
import { IDBFactory as FakeFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { type StorageNotice, type Repo } from '../../../src/store/repo';

export function freshFactory(): IDBFactory {
  return new FakeFactory();
}

class FakeOpenRequest extends EventTarget {
  result: unknown = undefined;
  error: DOMException | null = null;
}

interface FakeDb {
  close: () => void;
  addEventListener: (type: string, listener: () => void) => void;
}

/** A factory whose open request fires `events` in order, one per microtask. */
export function factoryFiring(
  events: readonly ('blocked' | 'error' | 'success')[],
  error: DOMException | null = null,
  result?: FakeDb,
): IDBFactory {
  const open = (): IDBOpenDBRequest => {
    const req = new FakeOpenRequest();
    req.error = error;
    req.result = result;
    let chain = Promise.resolve();
    for (const type of events) {
      chain = chain.then(() => {
        req.dispatchEvent(new Event(type));
      });
    }
    return req as unknown as IDBOpenDBRequest;
  };
  return { open } as unknown as IDBFactory;
}

export function factoryThrowing(err: unknown): IDBFactory {
  const open = (): IDBOpenDBRequest => {
    throw err;
  };
  return { open } as unknown as IDBFactory;
}

interface FakeTransaction {
  _execRequestAsync<T>(o: { operation: () => T; source: unknown }): IDBRequest<T>;
}

/** A genuine fake-indexeddb request that fails with `error` and so aborts its transaction. */
function erroringRequest<T>(
  tx: IDBTransaction | null,
  source: unknown,
  error: DOMException,
): IDBRequest<T> {
  if (tx === null) {
    throw new Error('request has no transaction');
  }
  return (tx as unknown as FakeTransaction)._execRequestAsync<T>({
    operation: () => {
      throw error;
    },
    source,
  });
}

/**
 * Makes the next `count` object-store puts fail with `error`, then restores normal behaviour.
 * `sync` throws from `put` itself; otherwise the request fires an error event and aborts the
 * transaction, as a real quota failure does.
 */
export function failNextPuts(count: number, error: DOMException, sync = false) {
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put');
  for (let i = 0; i < count; i += 1) {
    spy.mockImplementationOnce(function (this: IDBObjectStore) {
      if (sync) {
        throw error;
      }
      return erroringRequest(this.transaction, this, error);
    });
  }
  return spy;
}

/** Same as `failNextPuts` for object-store clears. */
export function failNextClears(count: number, error: DOMException, sync = false) {
  const spy = vi.spyOn(IDBObjectStore.prototype, 'clear');
  for (let i = 0; i < count; i += 1) {
    spy.mockImplementationOnce(function (this: IDBObjectStore) {
      if (sync) {
        throw error;
      }
      return erroringRequest(this.transaction, this, error);
    });
  }
  return spy;
}

/** Same as `failNextPuts` for the cursor deletes that `deletePatient` issues mid-transaction. */
export function failNextCursorDeletes(count: number, error: DOMException, sync = false) {
  const spy = vi.spyOn(IDBCursor.prototype, 'delete');
  for (let i = 0; i < count; i += 1) {
    spy.mockImplementationOnce(function (this: IDBCursor) {
      if (sync) {
        throw error;
      }
      return erroringRequest(this.request.transaction, this, error);
    });
  }
  return spy;
}

export function quotaError(): DOMException {
  return new DOMException('quota', 'QuotaExceededError');
}

/**
 * Records every unhandled promise rejection raised while `run` executes, then lets the task queue
 * drain twice so a rejection settled by a queued IndexedDB event is not missed. Vitest fails the
 * run on these anyway; capturing them keeps the assertion next to the behaviour under test.
 */
export async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const record = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', record);
  try {
    await run();
    await flushTasks();
    await flushTasks();
  } finally {
    process.off('unhandledRejection', record);
  }
  return seen;
}

function flushTasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Collects every notice the repo emits; `wait` resolves at once and records the delays. */
export interface Harness {
  notices: StorageNotice[];
  waits: number[];
  wait: (ms: number) => Promise<void>;
  attach: (repo: Repo) => () => void;
}

export function harness(): Harness {
  const notices: StorageNotice[] = [];
  const waits: number[] = [];
  return {
    notices,
    waits,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    attach: (repo) =>
      repo.subscribe((n) => {
        notices.push(n);
      }),
  };
}

/** Opens a raw connection to inspect or seed a database outside the repo. */
export function rawOpen(factory: IDBFactory, name: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.addEventListener('success', () => {
      resolve(req.result);
    });
    req.addEventListener('error', () => {
      reject(req.error ?? new Error('open failed'));
    });
  });
}

export function rawPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.addEventListener('complete', () => {
      resolve();
    });
    tx.addEventListener('error', () => {
      reject(tx.error ?? new Error('put failed'));
    });
    tx.addEventListener('abort', () => {
      reject(tx.error ?? new Error('put aborted'));
    });
  });
}

export function rawGetAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.addEventListener('success', () => {
      resolve(req.result as unknown[]);
    });
    req.addEventListener('error', () => {
      reject(req.error ?? new Error('getAll failed'));
    });
  });
}
