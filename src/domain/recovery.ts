// Decision notes: check tasks are identified by template key, never by position, so custom
// tasks and reordering cannot capture a check slot. Due times are computed in milliseconds
// from CHECK_OFFSETS_MIN so they are exact. Non-check tasks keep their object identity.
import { addMinutes } from './time';
import { CHECK_OFFSETS_MIN, type Iso, type Task, type TaskKey } from './types';

type CheckKey = keyof typeof CHECK_OFFSETS_MIN;

function isCheckKey(key: TaskKey): key is CheckKey {
  return Object.hasOwn(CHECK_OFFSETS_MIN, key);
}

/** Sets `dueAt` on check_1..check_4 relative to the theatre return; other tasks untouched. */
export function scheduleChecks(tasks: readonly Task[], returnedAt: Iso): Task[] {
  return tasks.map((t) =>
    isCheckKey(t.key) ? { ...t, dueAt: addMinutes(returnedAt, CHECK_OFFSETS_MIN[t.key]) } : t,
  );
}

/** Removes `dueAt` from the check tasks; tasks without one keep their identity. */
export function clearChecks(tasks: readonly Task[]): Task[] {
  return tasks.map((t) => {
    if (!isCheckKey(t.key) || t.dueAt === undefined) {
      return t;
    }
    const next = { ...t };
    delete next.dueAt;
    return next;
  });
}
