// Decision notes: pure display helpers shared by the components. They format values that
// arrive as props; none of them decides urgency, current task or stats. Local time is used
// for clocks and datetime-local inputs because the nurse reads the ward clock, while every
// stored timestamp stays ISO UTC.
import { TEMPLATE_BY_KEY, customCode } from '@domain/template';
import { type Iso, type Species, type Task } from '@domain/types';

export const SPECIES_LABEL: Readonly<Record<Species, string>> = Object.freeze({
  dog: 'Dog',
  cat: 'Cat',
  rabbit: 'Rabbit',
  other: 'Other',
});

export type CellState = 'todo' | 'current' | 'done' | 'skipped';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Two-letter uppercase code for a cell: template code or the custom-label code. */
export function taskCode(task: Pick<Task, 'key' | 'label'>): string {
  return task.key === 'custom' ? customCode(task.label) : TEMPLATE_BY_KEY[task.key].code;
}

export function cellState(task: Task, currentTaskId: string | undefined): CellState {
  if (task.status !== 'todo') {
    return task.status;
  }
  return task.id === currentTaskId ? 'current' : 'todo';
}

/** A timed task still to do whose due time has passed. Overdue can combine with current. */
export function isOverdue(task: Task, now: number): boolean {
  return task.status === 'todo' && task.dueAt !== undefined && Date.parse(task.dueAt) <= now;
}

export function cellClass(state: CellState, overdue: boolean): string {
  return classes('belt__square', `belt__square--${state}`, overdue && 'belt__square--overdue');
}

/** `mm:ss` from a millisecond duration; minutes grow past 59 rather than rolling to hours. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** Local wall-clock `HH:MM` for an ISO timestamp. */
export function formatClock(iso: Iso): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Value for a `datetime-local` input (local time, minute precision). */
export function toDatetimeLocal(iso: Iso): string {
  const d = new Date(iso);
  const date = `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatMinutes(min: number): string {
  const whole = Math.round(min);
  if (whole < 60) {
    return `${whole} min`;
  }
  return `${Math.floor(whole / 60)} h ${whole % 60} min`;
}

export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`;
}

export interface Progress {
  done: number;
  total: number;
  complete: boolean;
}

/** Done plus skipped over total; `complete` when nothing is left to do. */
export function progressOf(tasks: readonly Task[]): Progress {
  let done = 0;
  for (const t of tasks) {
    if (t.status !== 'todo') {
      done += 1;
    }
  }
  return { done, total: tasks.length, complete: tasks.length > 0 && done === tasks.length };
}

export function classes(...names: (string | false | undefined)[]): string {
  return names.filter((n): n is string => typeof n === 'string' && n !== '').join(' ');
}
