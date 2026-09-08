// Decision notes: test-only helpers. The PRNG is xorshift32 so property tests are seeded and
// reproducible without a dependency. deepFreeze turns any accidental mutation inside the
// domain into a thrown TypeError (modules run in strict mode), which is how purity is asserted.
import { reduce } from '../../../src/domain/reducer';
import { type Action, type Iso, type State } from '../../../src/domain/types';

export class Prng {
  private s: number;

  constructor(seed: number) {
    const u = seed >>> 0;
    this.s = u === 0 ? 0x9e3779b9 : u;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 0x1_0000_0000;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const v = items[this.int(items.length)];
    if (v === undefined) {
      throw new Error('pick from an empty list');
    }
    return v;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const a = out[i];
      const b = out[j];
      if (a !== undefined && b !== undefined) {
        out[i] = b;
        out[j] = a;
      }
    }
    return out;
  }
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return value;
}

/** Applies actions in order, freezing every intermediate state to prove the reducer is pure. */
export function run(state: State, actions: readonly Action[]): State {
  let s = deepFreeze(state);
  for (const a of actions) {
    s = deepFreeze(reduce(s, deepFreeze(a)));
  }
  return s;
}

export function stamp(at: Iso, eventId: string): { at: Iso; eventId: string } {
  return { at, eventId };
}
