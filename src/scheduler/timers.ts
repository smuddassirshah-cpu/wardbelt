// Decision notes: one armed timer at a time (PLAN.md section 8). `arm` always clears first, so
// a re-entrant `reschedule` from inside a dispatch can never leave two timers armed. Patients
// are read through `getPatients` on every pass and nothing but task ids and due strings is
// retained: `notified` maps a task id to the dueAt it was announced at, so a task drops out
// once it is completed, skipped or removed or its dueAt moves, and re-announces after a
// re-schedule. The delay is computed from tasks still awaiting announcement, so an overdue task
// already announced does not re-arm a zero delay in a loop; `nextDueAt` keeps the plain section
// 8 meaning (earliest dueAt of any outstanding task on an active patient). A backwards clock
// jump only lengthens delays, which the cap bounds. Newly due tasks are announced most overdue
// first so the notification's five-line cut keeps the ones that matter.
import type { Action, Iso, Patient } from '../domain/types';
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

function dueMs(iso: Iso): number | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export function createTimers(options: TimersOptions): Timers {
  const { clock, getPatients, dispatch, notifier } = options;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let timerId: number | undefined;
  let running = false;
  let notified = new Map<string, Iso>();

  const isAnnounced = (taskId: string, dueAt: Iso): boolean => notified.get(taskId) === dueAt;

  const earliest = (skipAnnounced: boolean): number | undefined => {
    let best: number | undefined;
    for (const p of getPatients()) {
      if (p.status !== 'active') {
        continue;
      }
      for (const t of p.tasks) {
        if (t.status !== 'todo' || t.dueAt === undefined) {
          continue;
        }
        if (skipAnnounced && isAnnounced(t.id, t.dueAt)) {
          continue;
        }
        const ms = dueMs(t.dueAt);
        if (ms !== undefined && (best === undefined || ms < best)) {
          best = ms;
        }
      }
    }
    return best;
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
    const next = new Map<string, Iso>();
    const fresh: { ms: number; task: DueTask }[] = [];
    for (const p of getPatients()) {
      if (p.status !== 'active') {
        continue;
      }
      for (const t of p.tasks) {
        if (t.status !== 'todo' || t.dueAt === undefined) {
          continue;
        }
        if (isAnnounced(t.id, t.dueAt)) {
          next.set(t.id, t.dueAt);
          continue;
        }
        const ms = dueMs(t.dueAt);
        if (ms !== undefined && ms <= now) {
          next.set(t.id, t.dueAt);
          fresh.push({
            ms,
            task: {
              patientId: p.id,
              patientName: p.name,
              taskId: t.id,
              label: t.label,
              dueAt: t.dueAt,
            },
          });
        }
      }
    }
    notified = next;
    const due = fresh.sort((a, b) => a.ms - b.ms).map((f) => f.task);
    for (const d of due) {
      dispatch({ type: 'DUE', patientId: d.patientId, taskId: d.taskId, now });
    }
    if (due.length > 0) {
      notifier.due(due);
    }
  };

  const arm = (): void => {
    clear();
    const next = earliest(true);
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
    nextDueAt: () => earliest(false),
  };
}
