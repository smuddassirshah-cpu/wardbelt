// Decision notes: opens the repo and loads the store with the two fallbacks the stage 2 notes
// call for. openRepo never rejects but has no timeout, so the whole open-plus-load is raced
// against a real-clock timer (5 s) and a stall falls back to a memory repo with the
// "storage unavailable" banner; the late connection is closed if it ever arrives. load() can
// reject when the read transaction fails; that also falls back to memory with an empty state,
// because writing new records next to unreadable ones would be worse than an honest banner.
// The notice listener is attached before load() because corrupt is not replayed.
import { DEFAULT_SETTINGS } from '@domain/types';
import type { LoadResult, Repo, RepoOptions, StorageNotice } from '@store/repo';
import { describeError } from './errors';

export const BOOT_TIMEOUT_MS = 5000;
export const BOOT_TIMED_OUT = 'Storage did not respond within 5 seconds';

export interface BootDeps {
  openRepo: (options?: RepoOptions) => Promise<Repo>;
  onNotice: (notice: StorageNotice) => void;
  timeoutMs?: number | undefined;
}

export interface BootResult {
  repo: Repo;
  load: LoadResult;
}

export function emptyLoad(): LoadResult {
  return {
    patients: [],
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    corrupt: 0,
    rawCorrupt: [],
  };
}

const noop = (): void => undefined;

export async function bootRepo(deps: BootDeps): Promise<BootResult> {
  const timeoutMs = deps.timeoutMs ?? BOOT_TIMEOUT_MS;
  let first: Repo | undefined;
  let unsubscribe: () => void = noop;
  const opened = deps.openRepo().then(async (repo) => {
    first = repo;
    unsubscribe = repo.subscribe(deps.onNotice);
    const load = await repo.load();
    return { repo, load };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, timeoutMs);
  });
  let reason: string;
  try {
    const result = await Promise.race([opened, timeout]);
    if (result !== 'timeout') {
      clearTimeout(timer);
      return result;
    }
    reason = BOOT_TIMED_OUT;
  } catch (e: unknown) {
    clearTimeout(timer);
    reason = `Storage could not be read. ${describeError(e)}`;
  }
  const discard = (): void => {
    unsubscribe();
    first?.close();
  };
  opened.then(discard, discard);
  const repo = await deps.openRepo({ indexedDB: undefined });
  repo.subscribe(deps.onNotice);
  deps.onNotice({ kind: 'unavailable', reason });
  return { repo, load: emptyLoad() };
}
