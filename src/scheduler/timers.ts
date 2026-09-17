// Decision notes: one armed timer at a time (PLAN.md section 8). `arm` always clears first, so
// a re-entrant `reschedule` from inside a dispatch can never leave two timers armed. Patients
// are read through `getPatients` on every pass and nothing but task ids, due strings and the
// moment of the last announcement is retained: `announced` maps a task id to
// `{ dueAt, announcedAt }`. It is rebuilt from the board on every arm as well as every sweep,
// so a task drops out the moment it is completed, skipped or removed or its dueAt moves, and a
// task undone back to outstanding (or back to its old dueAt) re-announces on the next sweep
// even when no tick fell in between. An overdue task that stays outstanding is announced again
// every REPEAT_MS, so an alert missed with the screen off comes back; `DUE` is a tick and is
// dispatched on the first announcement of a dueAt only. The delay is the earlier of the next
// unannounced dueAt and the next repeat, so an overdue task never re-arms a zero delay in a
// loop; `nextDueAt` keeps the plain section 8 meaning (earliest dueAt of any outstanding task
// on an active patient). A backwards clock jump only lengthens delays, which the cap bounds,
// and suspends repeats until the task is overdue again. Newly due tasks are announced most
// overdue first (k log k over the announced subset only) so the notification's five-line cut
// keeps the ones that matter.
import type { Action, Iso, Patient, Task } from '../domain/types';
import type { Clock } from './clock';

export interface DueTask {
  patientId: string;
  patientName: string;
  taskId: string;
  label: string;
  dueAt: Iso;
}

export interface Notifier {
  due(tasks: readonly DueTask[]): void;
}

export interface TimersOptions {
  clock: Clock;
  getPatients: () => readonly Patient[];
  dispatch: (action: Action) => void;
  notifier: Notifier;
  maxDelayMs?: number;
}

export interface Timers {
  start(): void;
  stop(): void;
  reschedule(): void;
  onVisible(): void;
  nextDueAt(): number | undefined;
}

export const DEFAULT_MAX_DELAY_MS = 60_000;

/** An overdue task is announced again this often until it is completed, skipped or removed. */
export const REPEAT_MS = 5 * 60_000;

interface Announcement {
  dueAt: Iso;
  announcedAt: number;
}

interface Timed {
  patient: Patient;
  task: Task;
  dueAt: Iso;
  ms: number;
}

/** Every outstanding task with a parseable dueAt on an active patient, in board order. */
function* timedTodo(patients: readonly Patient[]): Generator<Timed, void, undefined> {
  for (const patient of patients) {
    if (patient.status !== 'active') {
      continue;
    }
    for (const task of patient.tasks) {
      if (task.status !== 'todo' || task.dueAt === undefined) {
        continue;
      }
      const ms = Date.parse(task.dueAt);
      if (!Number.isNaN(ms)) {
        yield { patient, task, dueAt: task.dueAt, ms };
      }
    }
  }
}

export function createTimers(options: TimersOptions): Timers {
  const { clock, getPatients, dispatch, notifier } = options;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let timerId: number | undefined;
  let running = false;
  let announced = new Map<string, Announcement>();

  /** The live announcement for this task, or undefined when it has never had this dueAt. */
  const current = (t: Timed): Announcement | undefined => {
    const a = announced.get(t.task.id);
    return a?.dueAt === t.dueAt ? a : undefined;
  };

  const clear = (): void => {
    if (timerId !== undefined) {
      clock.clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const sweep = (): void => {
    const now = clock.now();
    dispatch({ type: 'TICK', now });
    const kept = new Map<string, Announcement>();
    const fresh: { ms: number; first: boolean; task: DueTask }[] = [];
    for (const t of timedTodo(getPatients())) {
      const a = current(t);
      const overdue = t.ms <= now;
      const repeating = a !== undefined && overdue && now - a.announcedAt >= REPEAT_MS;
      if (a !== undefined && !repeating) {
        kept.set(t.task.id, a);
        continue;
      }
      if (!overdue) {
        continue;
      }
      kept.set(t.task.id, { dueAt: t.dueAt, announcedAt: now });
      fresh.push({
        ms: t.ms,
        first: a === undefined,
        task: {
          patientId: t.patient.id,
          patientName: t.patient.name,
          taskId: t.task.id,
          label: t.task.label,
          dueAt: t.dueAt,
        },
      });
    }
    announced = kept;
    fresh.sort((a, b) => a.ms - b.ms);
    for (const f of fresh) {
      if (f.first) {
        dispatch({ type: 'DUE', patientId: f.task.patientId, taskId: f.task.taskId, now });
      }
    }
    if (fresh.length > 0) {
      notifier.due(fresh.map((f) => f.task));
    }
  };

  /** Drops stale `announced` entries and returns the moment the next announcement is wanted. */
  const prune = (): number | undefined => {
    const kept = new Map<string, Announcement>();
    let best: number | undefined;
    for (const t of timedTodo(getPatients())) {
      const a = current(t);
      const at = a === undefined ? t.ms : a.announcedAt + REPEAT_MS;
      if (a !== undefined) {
        kept.set(t.task.id, a);
      }
      if (best === undefined || at < best) {
        best = at;
      }
    }
    announced = kept;
    return best;
  };

  const arm = (): void => {
    clear();
    const next = prune();
    const delay =
      next === undefined ? maxDelayMs : Math.min(Math.max(next - clock.now(), 0), maxDelayMs);
    timerId = clock.setTimeout(fire, delay);
  };

  const fire = (): void => {
    timerId = undefined;
    try {
      sweep();
    } finally {
      if (running) {
        arm();
      }
    }
  };

  return {
    start: () => {
      if (!running) {
        running = true;
        arm();
      }
    },
    stop: () => {
      running = false;
      clear();
    },
    reschedule: () => {
      if (running) {
        arm();
      }
    },
    onVisible: () => {
      try {
        sweep();
      } finally {
        if (running) {
          arm();
        }
      }
    },
    nextDueAt: () => {
      let best: number | undefined;
      for (const t of timedTodo(getPatients())) {
        if (best === undefined || t.ms < best) {
          best = t.ms;
        }
      }
      return best;
    },
  };
}
