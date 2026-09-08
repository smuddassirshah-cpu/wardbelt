// Decision notes: the only abstraction over wall-clock time and timers. `realClock` uses the
// window timers so the id type is a number in the browser. The fake clock keeps its armed
// timers in an array sorted by (due, sequence); `advance` pops from the front so a callback
// that arms a new timer inside the advanced window fires in the same call. `set` never fires
// anything, so tests can model a device clock jump in either direction.

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id);
  },
};

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(nowMs: number): void;
  pending(): number;
}

interface Armed {
  id: number;
  due: number;
  seq: number;
  fn: () => void;
}

function delayOf(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function createFakeClock(startMs: number): FakeClock {
  let now = startMs;
  let seq = 0;
  const armed: Armed[] = [];

  const insert = (t: Armed): void => {
    let lo = 0;
    let hi = armed.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = armed[mid];
      if (m !== undefined && (m.due < t.due || (m.due === t.due && m.seq < t.seq))) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    armed.splice(lo, 0, t);
  };

  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      seq += 1;
      insert({ id: seq, due: now + delayOf(ms), seq, fn });
      return seq;
    },
    clearTimeout: (id) => {
      const i = armed.findIndex((t) => t.id === id);
      if (i >= 0) {
        armed.splice(i, 1);
      }
    },
    advance: (ms) => {
      const target = now + delayOf(ms);
      for (let head = armed[0]; head !== undefined && head.due <= target; head = armed[0]) {
        armed.shift();
        now = Math.max(now, head.due);
        head.fn();
      }
      now = target;
    },
    set: (nowMs) => {
      now = nowMs;
    },
    pending: () => armed.length,
  };
}
