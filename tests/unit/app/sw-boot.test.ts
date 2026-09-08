import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../../src/store/repo';
import { BOOT_TIMED_OUT, bootRepo, emptyLoad } from '../../../src/ui/app/boot';
import { setupServiceWorker, SW_INSTALL_FAILED, SW_UPDATE_FAILED } from '../../../src/ui/app/sw';
import { patientFresh } from '../../fixtures/synthetic';
import { fakeRepo, fakeSw, flushMicrotasks } from './helpers';

describe('setupServiceWorker', () => {
  it('does nothing without support or without a register function', () => {
    const sw = fakeSw();
    const onError = vi.fn();
    const none = setupServiceWorker(sw.register, onError, false);
    none.reload();
    expect(sw.register).not.toHaveBeenCalled();
    expect(none.updateReady.value).toBe(false);
    const missing = setupServiceWorker(undefined, onError, true);
    missing.reload();
    expect(missing.updateReady.value).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('registers immediately, raises updateReady on onNeedRefresh and reloads through updateSW', async () => {
    const sw = fakeSw();
    const onError = vi.fn();
    const handle = setupServiceWorker(sw.register, onError, true);
    expect(sw.register).toHaveBeenCalledTimes(1);
    expect(sw.options()?.immediate).toBe(true);
    expect(handle.updateReady.value).toBe(false);
    sw.options()?.onNeedRefresh?.();
    expect(handle.updateReady.value).toBe(true);
    handle.reload();
    expect(sw.update).toHaveBeenCalledWith(true);
    await flushMicrotasks();
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a registration failure and a failed update to the banner', async () => {
    const sw = fakeSw();
    const onError = vi.fn();
    const handle = setupServiceWorker(sw.register, onError, true);
    sw.options()?.onRegisterError?.(new Error('blocked'));
    expect(onError).toHaveBeenCalledWith(SW_INSTALL_FAILED);
    sw.update.mockImplementationOnce(() => Promise.reject(new Error('no')));
    handle.reload();
    await flushMicrotasks();
    expect(onError).toHaveBeenLastCalledWith(SW_UPDATE_FAILED);
  });
});

describe('bootRepo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes before loading so a corrupt notice reaches the listener', async () => {
    const repo = fakeRepo();
    repo.loadResult = {
      ...emptyLoad(),
      patients: [patientFresh()],
      corrupt: 2,
      rawCorrupt: [{}, {}],
    };
    const onNotice = vi.fn();
    repo.load = () => {
      repo.emit({ kind: 'corrupt', count: 2 });
      return Promise.resolve(repo.loadResult);
    };
    const result = await bootRepo({
      openRepo: () => Promise.resolve(repo),
      onNotice,
      timeoutMs: 50,
    });
    expect(result.repo).toBe(repo);
    expect(result.load.patients).toHaveLength(1);
    expect(onNotice).toHaveBeenCalledWith({ kind: 'corrupt', count: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(repo.closed).toBe(false);
  });

  it('falls back to a memory repo with the storage banner when the open stalls, closing a late connection', async () => {
    const late = fakeRepo();
    let resolveLate: (r: Repo) => void = () => undefined;
    const memory = fakeRepo('memory');
    const openRepo = vi.fn((options?: { indexedDB?: IDBFactory | undefined }) => {
      if (options !== undefined && 'indexedDB' in options) {
        expect(options.indexedDB).toBeUndefined();
        return Promise.resolve(memory);
      }
      return new Promise<Repo>((resolve) => {
        resolveLate = resolve;
      });
    });
    const onNotice = vi.fn();
    const pending = bootRepo({ openRepo, onNotice, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(openRepo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.repo).toBe(memory);
    expect(result.load).toEqual(emptyLoad());
    expect(onNotice).toHaveBeenLastCalledWith({ kind: 'unavailable', reason: BOOT_TIMED_OUT });
    resolveLate(late);
    await flushMicrotasks();
    expect(late.closed).toBe(true);
    memory.emit({ kind: 'write_failed', reason: 'x' });
    expect(onNotice).toHaveBeenLastCalledWith({ kind: 'write_failed', reason: 'x' });
  });

  it('falls back when load rejects, closes the opened repo and stops listening to it', async () => {
    const broken = fakeRepo();
    broken.load = () => Promise.reject(new DOMException('tx failed', 'InvalidStateError'));
    const memory = fakeRepo('memory');
    const openRepo = (options?: { indexedDB?: IDBFactory | undefined }) =>
      Promise.resolve(options === undefined ? broken : memory);
    const onNotice = vi.fn();
    const result = await bootRepo({ openRepo, onNotice, timeoutMs: 50 });
    expect(result.repo).toBe(memory);
    expect(onNotice).toHaveBeenLastCalledWith({
      kind: 'unavailable',
      reason: 'Storage could not be read. InvalidStateError: tx failed',
    });
    await flushMicrotasks();
    expect(broken.closed).toBe(true);
    onNotice.mockClear();
    broken.emit({ kind: 'recovered' });
    expect(onNotice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
  });
});
