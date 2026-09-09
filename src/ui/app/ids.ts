// Decision notes: every mutating action carries a wall-clock `at` and a fresh event id from
// the caller (PLAN.md section 6, STATE.md Decisions). Ids come from crypto.randomUUID where
// the platform has it and otherwise from a counter joined to the clock, which is unique within
// a page and practically unique across reloads. Time is read through the injected Clock so
// unit tests and the Playwright clock both control it.
import type { Stamp } from '@domain/types';
import type { Clock } from '@scheduler/clock';

export interface IdSource {
  id(): string;
  stamp(): Stamp;
}

interface RandomSource {
  randomUUID?: () => string;
}

function detectRandom(): RandomSource | undefined {
  const g: { crypto?: RandomSource } = globalThis;
  return g.crypto;
}

export function createIdSource(clock: Clock, random = detectRandom()): IdSource {
  let counter = 0;
  const uuid = random?.randomUUID;
  const id = (): string => {
    if (uuid !== undefined) {
      return uuid.call(random);
    }
    counter += 1;
    return `${clock.now().toString(36)}-${counter.toString(36)}`;
  };
  return {
    id,
    stamp: () => ({ at: new Date(clock.now()).toISOString(), eventId: id() }),
  };
}
