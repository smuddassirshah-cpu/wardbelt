import { describe, expect, it } from 'vitest';
import { createFakeClock, realClock } from '../../../src/scheduler/clock';
import { FIXED_NOW_MS } from '../../fixtures/synthetic';

describe('createFakeClock', () => {
  it('starts at the given time and advances without firing when nothing is armed', () => {
    const clock = createFakeClock(FIXED_NOW_MS);
    expect(clock.now()).toBe(FIXED_NOW_MS);
    expect(clock.pending()).toBe(0);
    clock.advance(5_000);
    expect(clock.now()).toBe(FIXED_NOW_MS + 5_000);
  });

  it('set jumps forwards and backwards without firing anything', () => {
    const clock = createFakeClock(FIXED_NOW_MS);
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 1_000);
    clock.set(FIXED_NOW_MS + 3_600_000);
    expect(clock.now()).toBe(FIXED_NOW_MS + 3_600_000);
    expect(fired).toEqual([]);
    expect(clock.pending()).toBe(1);
    clock.set(FIXED_NOW_MS - 3_600_000);
    expect(clock.now()).toBe(FIXED_NOW_MS - 3_600_000);
    expect(fired).toEqual([]);
    expect(clock.pending()).toBe(1);
  });

  it('fires a timer that set jumped past on the next advance without moving now backwards', () => {
    const clock = createFakeClock(FIXED_NOW_MS);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 1_000);
    clock.set(FIXED_NOW_MS + 10_000);
    clock.advance(0);
    expect(seen).toEqual([FIXED_NOW_MS + 10_000]);
    expect(clock.pending()).toBe(0);
  });

  it('returns distinct numeric ids and counts pending timers', () => {
    const clock = createFakeClock(0);
    const a = clock.setTimeout(() => undefined, 10);
    const b = clock.setTimeout(() => undefined, 10);
    expect(typeof a).toBe('number');
    expect(a).not.toBe(b);
    expect(clock.pending()).toBe(2);
  });

  it('fires due callbacks in due order, ties in arming order, with now at each due time', () => {
    const clock = createFakeClock(0);
    const log: string[] = [];
    clock.setTimeout(() => log.push(`c@${clock.now()}`), 30);
    clock.setTimeout(() => log.push(`a@${clock.now()}`), 10);
    clock.setTimeout(() => log.push(`b1@${clock.now()}`), 20);
    clock.setTimeout(() => log.push(`b2@${clock.now()}`), 20);
    clock.advance(25);
    expect(log).toEqual(['a@10', 'b1@20', 'b2@20']);
    expect(clock.now()).toBe(25);
    expect(clock.pending()).toBe(1);
    clock.advance(5);
    expect(log).toEqual(['a@10', 'b1@20', 'b2@20', 'c@30']);
    expect(clock.pending()).toBe(0);
  });

  it('fires timers armed by a callback when they fall inside the advanced window', () => {
    const clock = createFakeClock(0);
    const log: string[] = [];
    clock.setTimeout(() => {
      log.push(`first@${clock.now()}`);
      clock.setTimeout(() => log.push(`chained@${clock.now()}`), 5);
      clock.setTimeout(() => log.push(`later@${clock.now()}`), 100);
    }, 10);
    clock.advance(20);
    expect(log).toEqual(['first@10', 'chained@15']);
    expect(clock.pending()).toBe(1);
    expect(clock.now()).toBe(20);
    clock.advance(90);
    expect(log).toEqual(['first@10', 'chained@15', 'later@110']);
  });

  it('clearTimeout removes an armed timer and ignores unknown or spent ids', () => {
    const clock = createFakeClock(0);
    const fired: number[] = [];
    const a = clock.setTimeout(() => fired.push(1), 10);
    const b = clock.setTimeout(() => fired.push(2), 10);
    clock.clearTimeout(a);
    clock.clearTimeout(999);
    expect(clock.pending()).toBe(1);
    clock.advance(10);
    expect(fired).toEqual([2]);
    clock.clearTimeout(b);
    clock.clearTimeout(a);
    expect(clock.pending()).toBe(0);
  });

  it('lets a callback clear a sibling timer and its own id safely', () => {
    const clock = createFakeClock(0);
    const fired: string[] = [];
    let self = 0;
    let sibling = 0;
    self = clock.setTimeout(() => {
      fired.push('self');
      clock.clearTimeout(self);
      clock.clearTimeout(sibling);
    }, 10);
    sibling = clock.setTimeout(() => fired.push('sibling'), 10);
    clock.advance(10);
    expect(fired).toEqual(['self']);
    expect(clock.pending()).toBe(0);
  });

  it('treats negative and non-finite delays as zero', () => {
    const clock = createFakeClock(100);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), -50);
    clock.setTimeout(() => seen.push(clock.now()), Number.NaN);
    clock.setTimeout(() => seen.push(clock.now()), Number.POSITIVE_INFINITY);
    clock.advance(0);
    expect(seen).toEqual([100, 100, 100]);
    clock.advance(Number.NaN);
    expect(clock.now()).toBe(100);
  });

  it('propagates a throwing callback and leaves the remaining timers armed', () => {
    const clock = createFakeClock(0);
    clock.setTimeout(() => {
      throw new Error('boom');
    }, 5);
    clock.setTimeout(() => undefined, 10);
    expect(() => {
      clock.advance(20);
    }).toThrow('boom');
    expect(clock.now()).toBe(5);
    expect(clock.pending()).toBe(1);
  });
});

describe('realClock', () => {
  it('reads Date.now and hands out timer ids that clear cleanly', () => {
    const before = Date.now();
    const now = realClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    const fired: number[] = [];
    const id = realClock.setTimeout(() => fired.push(1), 600_000);
    realClock.clearTimeout(id);
    expect(fired).toEqual([]);
  });
});
