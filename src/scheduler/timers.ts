// Decision notes: one armed timer at a time (PLAN.md section 8). `arm` always clears first, so
// a re-entrant `reschedule` from inside a dispatch can never leave two timers armed. Patients
// are read through `getPatients` on every pass and nothing but task ids and due strings is
// retained: `notified` maps a task id to the dueAt it was announced at. It is rebuilt from the
// board on every arm as well as every sweep, so a task drops out the moment it is completed,
// skipped or removed or its dueAt moves, and a task undone back to outstanding (or back to its
// old dueAt) re-announces on the next sweep even when no tick fell in between. The delay is
// computed from tasks still awaiting announcement, so an overdue task already announced does
// not re-arm a zero delay in a loop; `nextDueAt` keeps the plain section 8 meaning (earliest
// dueAt of any outstanding task on an active patient). A backwards clock jump only lengthens
// delays, which the cap bounds. Newly due tasks are announced most overdue first (k log k over
// the newly due subset only) so the notification's five-line cut keeps the ones that matter.
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
  let notified = new Map<string, Iso>();

  const isAnnounced = (t: Timed): boolean => notified.get(t.task.id) === t.dueAt;

  const clear = (): void => {
    if (timerId !== undefined) {
      clock.clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const sweep = (): void => {
    const now = clock.now();
    dispatch({ type: 'TICK', now });
    const kept = new Map<string, Iso>();
    const fresh: { ms: number; task: DueTask }[] = [];
    for (const t of timedTodo(getPatients())) {
      if (isAnnounced(t)) {
        kept.set(t.task.id, t.dueAt);
      } else if (t.ms <= now) {
        kept.set(t.task.id, t.dueAt);
        fresh.push({
          ms: t.ms,
          task: {
            patientId: t.patient.id,
            patientName: t.patient.name,
            taskId: t.task.id,
            label: t.task.label,
            dueAt: t.dueAt,
          },
        });
      }
    }
    notified = kept;
    const due = fresh.sort((a, b) => a.ms - b.ms).map((f) => f.task);
    for (const d of due) {
      dispatch({ type: 'DUE', patientId: d.patientId, taskId: d.taskId, now });
    }
    if (due.length > 0) {
      notifier.due(due);
    }
  };

  /** Drops stale `notified` entries and returns the earliest dueAt still awaiting announcement. */
  const prune = (): number | undefined => {
    const kept = new Map<string, Iso>();
    let best: number | undefined;
    for (const t of timedTodo(getPatients())) {
      if (isAnnounced(t)) {
        kept.set(t.task.id, t.dueAt);
      } else if (best === undefined || t.ms < best) {
        best = t.ms;
      }
    }
    notified = kept;
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
