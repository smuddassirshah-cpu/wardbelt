// Decision notes: maps repo StorageNotice values to the banners in PLAN.md section 8. The
// storage banner is one slot: `unavailable` is permanent for the session (memory mode);
// `write_failed` shows the same headline with the reason and is cleared by `recovered`, which
// never touches an `unavailable` banner. Corrupt is a separate dismissible count with the raw
// rows kept for the recovery export. Pure functions over plain values so the mapping is
// unit-tested without signals.
import type { StorageNotice } from '@store/repo';

export const STORAGE_UNAVAILABLE = 'Not saving: storage unavailable';

export interface StorageBanner {
  kind: 'unavailable' | 'write_failed';
  message: string;
}

export function nextStorageBanner(
  current: StorageBanner | undefined,
  notice: StorageNotice,
): StorageBanner | undefined {
  switch (notice.kind) {
    case 'unavailable':
      return { kind: 'unavailable', message: STORAGE_UNAVAILABLE };
    case 'write_failed':
      return current?.kind === 'unavailable'
        ? current
        : { kind: 'write_failed', message: `${STORAGE_UNAVAILABLE}. ${notice.reason}` };
    case 'recovered':
      return current?.kind === 'write_failed' ? undefined : current;
    case 'corrupt':
      return current;
  }
}

export function corruptMessage(count: number): string {
  return `${count} record${count === 1 ? '' : 's'} could not be read`;
}
