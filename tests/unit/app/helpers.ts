// Decision notes: test doubles for the app wiring. The fake repo records every call in order
// (the persist diff tests assert exact sequences), resolves writes immediately unless told to
// fail, serves an injectable load result and can emit notices to its subscribers. The fake
// platform wires a fake clock, that repo, a scripted lock role and spies for every browser
// touchpoint so a whole Session runs under jsdom. Everything is synthetic.
import { createFakeClock, type FakeClock } from '../../../src/scheduler/clock';
import type { NotifyDeps } from '../../../src/scheduler/notify';
import type { LoadResult, Repo, StorageNotice } from '../../../src/store/repo';
import { emptyLoad } from '../../../src/ui/app/boot';
import type { TabLock } from '../../../src/ui/app/lock';
import type { Platform } from '../../../src/ui/app/session';
import type { RegisterSwOptions } from '../../../src/ui/app/sw';
import { FIXED_NOW_MS } from '../../fixtures/synthetic';
import { vi } from 'vitest';

export type RepoCall =
  | { op: 'savePatient'; id: string }
  | { op: 'deletePatient'; id: string }
  | { op: 'appendEvent'; id: string; type: string }
  | { op: 'saveSettings' }
  | { op: 'clearAll' };

export interface FakeRepo extends Repo {
  calls: RepoCall[];
  emit(notice: StorageNotice): void;
  failNext(error: Error): void;
  loadResult: LoadResult;
  closed: boolean;
}

export function fakeRepo(mode: 'idb' | 'memory' = 'idb'): FakeRepo {
  const listeners = new Set<(n: StorageNotice) => void>();
  let failure: { error: Error } | undefined;
  const settle = (): Promise<void> => {
    if (failure !== undefined) {
      const { error } = failure;
      failure = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  };
  const repo: FakeRepo = {
    mode,
    calls: [],
    closed: false,
    loadResult: emptyLoad(),
    emit: (notice) => {
      for (const l of listeners) {
        l(notice);
      }
    },
    failNext: (error) => {
      failure = { error };
    },
    load: () => Promise.resolve(repo.loadResult),
    savePatient: (p) => {
      repo.calls.push({ op: 'savePatient', id: p.id });
      return settle();
    },
    deletePatient: (id) => {
      repo.calls.push({ op: 'deletePatient', id });
      return settle();
    },
    appendEvent: (e) => {
      repo.calls.push({ op: 'appendEvent', id: e.id, type: e.type });
      return settle();
    },
    saveSettings: () => {
      repo.calls.push({ op: 'saveSettings' });
      return settle();
    },
    clearAll: () => {
      repo.calls.push({ op: 'clearAll' });
      return settle();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      repo.closed = true;
    },
  };
  return repo;
}

export interface FakeSw {
  register: ReturnType<
    typeof vi.fn<(options: RegisterSwOptions) => (reload?: boolean) => Promise<void>>
  >;
  update: ReturnType<typeof vi.fn<(reload?: boolean) => Promise<void>>>;
  options: () => RegisterSwOptions | undefined;
}

export function fakeSw(): FakeSw {
  let captured: RegisterSwOptions | undefined;
  const update = vi.fn<(reload?: boolean) => Promise<void>>(() => Promise.resolve());
  const register = vi.fn<(options: RegisterSwOptions) => (reload?: boolean) => Promise<void>>(
    (options) => {
      captured = options;
      return update;
    },
  );
  return { register, update, options: () => captured };
}

export interface FakePlatformOptions {
  repo?: FakeRepo;
  role?: 'primary' | 'readonly';
  openRepo?: Platform['openRepo'];
  notifyDeps?: NotifyDeps;
  bootTimeoutMs?: number;
  startMs?: number;
}

export interface FakePlatform extends Platform {
  clock: FakeClock;
  repo: FakeRepo;
  released: () => void;
  lockRelease: ReturnType<typeof vi.fn<() => void>>;
  visible: () => void;
  downloads: { filename: string; text: string }[];
  downloadOk: boolean;
  sw: FakeSw;
}

export function fakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const clock = createFakeClock(options.startMs ?? FIXED_NOW_MS);
  const repo = options.repo ?? fakeRepo();
  const sw = fakeSw();
  let onReleased: () => void = () => undefined;
  let onVisible: () => void = () => undefined;
  const lockRelease = vi.fn<() => void>();
  const platform: FakePlatform = {
    clock,
    repo,
    sw,
    lockRelease,
    downloads: [],
    downloadOk: true,
    released: () => {
      onReleased();
    },
    visible: () => {
      onVisible();
    },
    openRepo: options.openRepo ?? (() => Promise.resolve(repo)),
    acquireLock: (released) => {
      onReleased = released;
      const lock: TabLock = { role: options.role ?? 'primary', release: lockRelease };
      return Promise.resolve(lock);
    },
    notifyDeps: options.notifyDeps ?? {},
    registerSw: sw.register,
    swSupported: true,
    onVisible: (fn) => {
      onVisible = fn;
    },
    download: (filename, text) => {
      platform.downloads.push({ filename, text });
      return platform.downloadOk;
    },
    reducedMotion: () => true,
    version: 'test',
  };
  if (options.bootTimeoutMs !== undefined) {
    platform.bootTimeoutMs = options.bootTimeoutMs;
  }
  return platform;
}

/** Lets pending microtasks (promise chains, effects) settle. */
export async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}
