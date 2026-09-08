// Decision notes: the only place the domain converts between stored ISO strings and epoch
// milliseconds. Output is always the UTC `Z` form from toISOString so stored values compare
// lexicographically. Unparseable input yields NaN from toMs; callers that need a guarantee
// check Number.isFinite before converting back (toIso throws on NaN by design).
import { type Iso } from './types';

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export function toMs(iso: Iso): number {
  return Date.parse(iso);
}

export function toIso(ms: number): Iso {
  return new Date(ms).toISOString();
}

export function addMinutes(iso: Iso, minutes: number): Iso {
  return toIso(toMs(iso) + minutes * MINUTE_MS);
}
