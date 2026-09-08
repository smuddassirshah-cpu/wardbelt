// Decision notes: the board order is a strict total order so any permutation of the input
// sorts to the same output. Ties inside a rank are broken on stored ISO strings compared
// lexicographically (they are normalised UTC, so that is chronological and never NaN-prone),
// then createdAt, then id, which is unique. Keys are computed once per patient (O(n)) and the
// comparator only reads them, so a sort is O(n log n).
import { MINUTE_MS, toMs } from './time';
import { type Iso, type Patient, type Task } from './types';

export const DUE_SOON_MS = 5 * MINUTE_MS;

export type UrgencyRank = 0 | 1 | 2 | 3;

export interface DueTask {
  taskId: string;
  dueAt: Iso;
}

export interface Urgency {
  rank: UrgencyRank;
  dueAt?: Iso;
  taskId?: string;
}

export interface UrgencyKey {
  id: string;
  rank: UrgencyRank;
  dueAt: string;
  intake: string;
  createdAt: string;
}

/** Earliest due time among the patient's unfinished tasks. */
export function nextDue(p: Patient): DueTask | undefined {
  let found: DueTask | undefined;
  let foundMs = Infinity;
  for (const t of p.tasks) {
    if (t.status !== 'todo' || t.dueAt === undefined) {
      continue;
    }
    const ms = toMs(t.dueAt);
    if (ms < foundMs) {
      found = { taskId: t.id, dueAt: t.dueAt };
      foundMs = ms;
    }
  }
  return found;
}

export function overdueTasks(p: Patient, nowMs: number): Task[] {
  return p.tasks.filter(
    (t) => t.status === 'todo' && t.dueAt !== undefined && toMs(t.dueAt) <= nowMs,
  );
}

/** 0 overdue, 1 due within DUE_SOON_MS, 2 has an intake tag, 3 otherwise. */
export function urgencyOf(p: Patient, nowMs: number): Urgency {
  const due = nextDue(p);
  if (due !== undefined) {
    const delta = toMs(due.dueAt) - nowMs;
    if (delta <= 0) {
      return { rank: 0, ...due };
    }
    if (delta <= DUE_SOON_MS) {
      return { rank: 1, ...due };
    }
  }
  return { rank: p.intake === 'none' ? 3 : 2 };
}

export function urgencyKey(p: Patient, nowMs: number): UrgencyKey {
  const u = urgencyOf(p, nowMs);
  return { id: p.id, rank: u.rank, dueAt: u.dueAt ?? '', intake: p.intake, createdAt: p.createdAt };
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Strict total order over keys of distinct patients: never 0 unless the ids are equal. */
export function compareUrgency(a: UrgencyKey, b: UrgencyKey): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  const byDue = a.rank <= 1 ? compareStrings(a.dueAt, b.dueAt) : 0;
  if (byDue !== 0) {
    return byDue;
  }
  const byIntake = a.rank === 2 ? compareStrings(a.intake, b.intake) : 0;
  if (byIntake !== 0) {
    return byIntake;
  }
  const byCreated = compareStrings(a.createdAt, b.createdAt);
  return byCreated !== 0 ? byCreated : compareStrings(a.id, b.id);
}

export function sortByUrgency(patients: readonly Patient[], nowMs: number): Patient[] {
  const keyed = patients.map((p) => ({ p, key: urgencyKey(p, nowMs) }));
  keyed.sort((x, y) => compareUrgency(x.key, y.key));
  return keyed.map((k) => k.p);
}
