import { describe, expect, it } from 'vitest';
import { DAY_MS, MINUTE_MS, addMinutes, toIso, toMs } from '../../../src/domain/time';
import { FIXED_NOW_ISO, FIXED_NOW_MS } from '../../fixtures/synthetic';

describe('time', () => {
  it('converts both ways in UTC Z form', () => {
    expect(toMs(FIXED_NOW_ISO)).toBe(FIXED_NOW_MS);
    expect(toIso(FIXED_NOW_MS)).toBe(FIXED_NOW_ISO);
    expect(toIso(toMs('2026-03-10T11:30:00+01:00'))).toBe(FIXED_NOW_ISO);
    expect(Number.isNaN(toMs('not a date'))).toBe(true);
  });

  it('adds minutes exactly', () => {
    expect(addMinutes(FIXED_NOW_ISO, 15)).toBe('2026-03-10T10:45:00.000Z');
    expect(addMinutes(FIXED_NOW_ISO, -1)).toBe('2026-03-10T10:29:00.000Z');
    expect(MINUTE_MS).toBe(60_000);
    expect(DAY_MS).toBe(86_400_000);
  });
});
