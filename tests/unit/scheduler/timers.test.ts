// Fake clock only: no vi.useFakeTimers, no real timers. Patients are synthetic fixtures with
// custom timed tasks built here so each test states its own due times.
import { describe, expect, it } from 'vitest';
import type { Action, Patient, PatientForm, Task, TaskStatus } from '../../../src/domain/types';
import { createFakeClock } from '../../../src/scheduler/clock';
import {
  DEFAULT_MAX_DELAY_MS,
  createTimers,
  type DueTask,
  type TimersOptions,
} from '../../../src/scheduler/timers';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_CAT,
  FORM_DOG,
  FORM_RABBIT,
  fixturePatient,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

const MIN = 60_000;

function timedTask(id: string, label: string, dueAt: string, status: TaskStatus = 'todo'): Task {
  return { id, key: 'custom', label, phase: 'RECOVERY', order: 99, status, dueAt, custom: true };
}

function withTasks(id: string, form: PatientForm, tasks: Task[]): Patient {
  return { ...fixturePatient(id, form), tasks };
}

function harness(patients: readonly Patient[], extra: Partial<TimersOptions> = {}) {
  const clock = createFakeClock(FIXED_NOW_MS);
  const actions: Action[] = [];
  const batches: DueTask[][] = [];
  const log: string[] = [];
  let list = patients;
  const timers = createTimers({
    clock,
    getPatients: () => list,
    dispatch: (a) => {
      actions.push(a);
      log.push(a.type);
    },
    notifier: {
      due: (t) => {
        batches.push([...t]);
        log.push('notify');
      },
    },
    ...extra,
  });
  return {
    clock,
    actions,
    batches,
    log,
    timers,
    setPatients: (p: readonly Patient[]) => {
      list = p;
    },
    ticks: () => actions.filter((a) => a.type === 'TICK'),
    dues: () => actions.filter((a) => a.type === 'DUE'),
  };
}

describe('createTimers: arming', () => {
  it('arms a single timer on start and keeps it single across reschedules and repeated starts', () => {
    const h = harness([patientFresh()]);
    expect(h.clock.pending()).toBe(0);
    h.timers.start();
    expect(h.clock.pending()).toBe(1);
    h.timers.start();
    expect(h.clock.pending()).toBe(1);
    for (let i = 0; i < 25; i += 1) {
      h.timers.reschedule();
      expect(h.clock.pending()).toBe(1);
    }
    expect(h.actions).toEqual([]);
  });

  it('re-arms after every tick', () => {
    const h = harness([patientFresh()]);
    h.timers.start();
    for (let i = 1; i <= 5; i += 1) {
      h.clock.advance(MIN);
      expect(h.clock.pending()).toBe(1);
      expect(h.ticks()).toHaveLength(i);
    }
  });

  it('fires a TICK every 60 s when nothing is due', () => {
    const h = harness([patientFresh()]);
    h.timers.start();
    h.clock.advance(MIN - 1);
    expect(h.actions).toEqual([]);
    h.clock.advance(1);
    expect(h.actions).toEqual([{ type: 'TICK', now: FIXED_NOW_MS + MIN }]);
    h.clock.advance(MIN);
    expect(h.actions).toEqual([
      { type: 'TICK', now: FIXED_NOW_MS + MIN },
      { type: 'TICK', now: FIXED_NOW_MS + 2 * MIN },
    ]);
    expect(h.batches).toEqual([]);
  });

  it('caps the delay at 60 s when the next due is far away', () => {
    const far = withTasks('p-far', FORM_DOG, [
      timedTask('p-far:t', 'Bandage check', isoPlus(FIXED_NOW_ISO, 40)),
    ]);
    const h = harness([far]);
    h.timers.start();
    h.clock.advance(MIN - 1);
    expect(h.ticks()).toHaveLength(0);
    h.clock.advance(1);
    expect(h.ticks()).toHaveLength(1);
    expect(h.dues()).toHaveLength(0);
    expect(h.clock.pending()).toBe(1);
  });

  it('uses the exact remaining time when the next due is nearer than the cap', () => {
    const near = withTasks('p-near', FORM_DOG, [
      timedTask('p-near:t', 'Bandage check', new Date(FIXED_NOW_MS + 30_000).toISOString()),
    ]);
    const h = harness([near]);
    h.timers.start();
    h.clock.advance(29_999);
    expect(h.actions).toEqual([]);
    h.clock.advance(1);
    expect(h.ticks()).toEqual([{ type: 'TICK', now: FIXED_NOW_MS + 30_000 }]);
    expect(h.dues()).toHaveLength(1);
  });

  it('honours a custom maxDelayMs', () => {
    const h = harness([patientFresh()], { maxDelayMs: 10_000 });
    h.timers.start();
    h.clock.advance(9_999);
    expect(h.ticks()).toHaveLength(0);
    h.clock.advance(1);
    expect(h.ticks()).toHaveLength(1);
    expect(DEFAULT_MAX_DELAY_MS).toBe(MIN);
  });

  it('stop clears the timer idempotently and a later start re-arms', () => {
    const h = harness([patientFresh()]);
    h.timers.start();
    expect(h.clock.pending()).toBe(1);
    h.timers.stop();
    expect(h.clock.pending()).toBe(0);
    h.timers.stop();
    expect(h.clock.pending()).toBe(0);
    h.timers.reschedule();
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(10 * MIN);
    expect(h.actions).toEqual([]);
    h.timers.start();
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(MIN);
    expect(h.ticks()).toHaveLength(1);
  });

  it('stop from inside a dispatch prevents the re-arm', () => {
    const h = harness([patientFresh()]);
    const stopping = createTimers({
      clock: h.clock,
      getPatients: () => [patientFresh()],
      dispatch: () => {
        stopping.stop();
      },
      notifier: { due: () => undefined },
    });
    stopping.start();
    h.clock.advance(MIN);
    expect(h.clock.pending()).toBe(0);
  });
});

describe('createTimers: due sweep', () => {
  it('fires exactly one DUE and one notification when a task becomes due, and never again', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const p = withTasks('p-one', FORM_CAT, [timedTask('p-one:t', 'Bandage check', dueAt)]);
    const h = harness([p]);
    h.timers.start();
    h.clock.advance(30_000);
    expect(h.dues()).toEqual([
      { type: 'DUE', patientId: 'p-one', taskId: 'p-one:t', now: FIXED_NOW_MS + 30_000 },
    ]);
    expect(h.batches).toEqual([
      [
        {
          patientId: 'p-one',
          patientName: FORM_CAT.name,
          taskId: 'p-one:t',
          label: 'Bandage check',
          dueAt,
        },
      ],
    ]);
    expect(h.log).toEqual(['TICK', 'DUE', 'notify']);
    for (let i = 0; i < 10; i += 1) {
      h.timers.reschedule();
      h.clock.advance(MIN);
    }
    expect(h.dues()).toHaveLength(1);
    expect(h.batches).toHaveLength(1);
    expect(h.ticks()).toHaveLength(11);
    expect(h.clock.pending()).toBe(1);
  });

  it('announces two tasks due in the same tick with two DUE actions and one notification', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const a = withTasks('p-a', FORM_DOG, [timedTask('p-a:t', 'Bandage check', dueAt)]);
    const b = withTasks('p-b', FORM_CAT, [timedTask('p-b:t', 'Temperature', dueAt)]);
    const h = harness([a, b]);
    h.timers.start();
    h.clock.advance(30_000);
    expect(h.dues().map((d) => d.taskId)).toEqual(['p-a:t', 'p-b:t']);
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]?.map((t) => t.taskId)).toEqual(['p-a:t', 'p-b:t']);
    expect(h.log).toEqual(['TICK', 'DUE', 'DUE', 'notify']);
  });

  it('catches up on visibility after a 40 minute forward jump with one combined notification', () => {
    const p = patientRecovery();
    const h = harness([p]);
    h.timers.start();
    h.clock.set(FIXED_NOW_MS + 40 * MIN);
    h.timers.onVisible();
    const now = FIXED_NOW_MS + 40 * MIN;
    expect(h.ticks()).toEqual([{ type: 'TICK', now }]);
    expect(h.dues()).toEqual(
      ['check_1', 'check_2', 'check_3', 'check_4'].map((k) => ({
        type: 'DUE',
        patientId: 'p-recovery',
        taskId: `p-recovery:${k}`,
        now,
      })),
    );
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]?.map((t) => t.label)).toEqual([
      'Post-op check 1',
      'Post-op check 2',
      'Post-op check 3',
      'Post-op check 4',
    ]);
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(MIN);
    expect(h.ticks()).toHaveLength(2);
    expect(h.batches).toHaveLength(1);
  });

  it('lists a combined catch-up most overdue first regardless of patient order', () => {
    const late = withTasks('p-late', FORM_DOG, [
      timedTask('p-late:t', 'Later task', isoPlus(FIXED_NOW_ISO, 30)),
    ]);
    const early = withTasks('p-early', FORM_CAT, [
      timedTask('p-early:t', 'Earlier task', isoPlus(FIXED_NOW_ISO, 10)),
    ]);
    const h = harness([late, early]);
    h.timers.start();
    h.clock.set(FIXED_NOW_MS + 40 * MIN);
    h.timers.onVisible();
    expect(h.batches[0]?.map((t) => t.taskId)).toEqual(['p-early:t', 'p-late:t']);
    expect(h.dues().map((d) => d.taskId)).toEqual(['p-early:t', 'p-late:t']);
  });

  it('catches up on visibility before start and arms nothing until started', () => {
    const p = patientRecovery();
    const h = harness([p]);
    h.timers.onVisible();
    expect(h.ticks()).toHaveLength(1);
    expect(h.dues()).toEqual([
      { type: 'DUE', patientId: 'p-recovery', taskId: 'p-recovery:check_1', now: FIXED_NOW_MS },
    ]);
    expect(h.clock.pending()).toBe(0);
    h.timers.start();
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(10 * MIN);
    expect(h.dues()).toHaveLength(2);
    expect(h.batches).toHaveLength(2);
  });

  it('neither throws nor notifies on a backwards clock jump and caps the delay', () => {
    const p = patientRecovery();
    const h = harness([p]);
    h.timers.start();
    h.clock.set(FIXED_NOW_MS - 60 * MIN);
    expect(() => {
      h.timers.onVisible();
      h.timers.reschedule();
    }).not.toThrow();
    expect(h.dues()).toEqual([]);
    expect(h.batches).toEqual([]);
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(MIN - 1);
    expect(h.ticks()).toHaveLength(1);
    h.clock.advance(1);
    expect(h.ticks()).toEqual([
      { type: 'TICK', now: FIXED_NOW_MS - 60 * MIN },
      { type: 'TICK', now: FIXED_NOW_MS - 59 * MIN },
    ]);
    expect(h.dues()).toEqual([]);
  });

  it('does not re-notify a task when the clock runs back over its due time', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const p = withTasks('p-one', FORM_CAT, [timedTask('p-one:t', 'Bandage check', dueAt)]);
    const h = harness([p]);
    h.timers.start();
    h.clock.advance(30_000);
    expect(h.batches).toHaveLength(1);
    h.clock.set(FIXED_NOW_MS);
    h.timers.reschedule();
    h.timers.onVisible();
    h.clock.advance(MIN);
    h.clock.advance(MIN);
    expect(h.batches).toHaveLength(1);
    expect(h.dues()).toHaveLength(1);
  });

  it('ignores discharged patients and done or skipped tasks', () => {
    const overdue = isoPlus(FIXED_NOW_ISO, -5);
    const discharged: Patient = {
      ...withTasks('p-d', FORM_DOG, [timedTask('p-d:t', 'Check', overdue)]),
      status: 'discharged',
    };
    const finished = withTasks('p-f', FORM_CAT, [
      timedTask('p-f:done', 'Check', overdue, 'done'),
      timedTask('p-f:skipped', 'Check', overdue, 'skipped'),
    ]);
    const h = harness([discharged, finished, patientDischarged()]);
    h.timers.start();
    h.timers.onVisible();
    h.clock.advance(60 * MIN);
    expect(h.dues()).toEqual([]);
    expect(h.batches).toEqual([]);
    expect(h.timers.nextDueAt()).toBeUndefined();
    expect(h.ticks()).toHaveLength(61);
  });

  it('re-notifies a task whose dueAt is rescheduled, at the new time', () => {
    const first = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const second = new Date(FIXED_NOW_MS + 5 * MIN).toISOString();
    const h = harness([withTasks('p-r', FORM_DOG, [timedTask('p-r:t', 'Check', first)])]);
    h.timers.start();
    h.clock.advance(30_000);
    expect(h.batches).toHaveLength(1);
    h.setPatients([withTasks('p-r', FORM_DOG, [timedTask('p-r:t', 'Check', second)])]);
    h.timers.reschedule();
    h.clock.advance(4 * MIN + 30_000 - 1);
    expect(h.batches).toHaveLength(1);
    h.clock.advance(1);
    expect(h.batches).toHaveLength(2);
    expect(h.batches[1]?.[0]?.dueAt).toBe(second);
    expect(h.dues()).toEqual([
      { type: 'DUE', patientId: 'p-r', taskId: 'p-r:t', now: FIXED_NOW_MS + 30_000 },
      { type: 'DUE', patientId: 'p-r', taskId: 'p-r:t', now: FIXED_NOW_MS + 5 * MIN },
    ]);
  });

  it('re-notifies a task that returns to todo after being completed', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const h = harness([withTasks('p-u', FORM_DOG, [timedTask('p-u:t', 'Check', dueAt)])]);
    h.timers.start();
    h.clock.advance(30_000);
    expect(h.batches).toHaveLength(1);
    h.setPatients([withTasks('p-u', FORM_DOG, [timedTask('p-u:t', 'Check', dueAt, 'done')])]);
    h.timers.reschedule();
    h.clock.advance(MIN);
    expect(h.batches).toHaveLength(1);
    h.setPatients([withTasks('p-u', FORM_DOG, [timedTask('p-u:t', 'Check', dueAt)])]);
    h.timers.reschedule();
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(0);
    expect(h.batches).toHaveLength(2);
    expect(h.dues()).toHaveLength(2);
    h.clock.advance(5 * MIN);
    expect(h.batches).toHaveLength(2);
  });

  it('announces a task added with a past dueAt on the next reschedule without a busy loop', () => {
    const h = harness([patientFresh()]);
    h.timers.start();
    h.clock.advance(MIN);
    const overdue = isoPlus(FIXED_NOW_ISO, -5);
    h.setPatients([withTasks('p-p', FORM_RABBIT, [timedTask('p-p:t', 'Check', overdue)])]);
    h.timers.reschedule();
    h.clock.advance(0);
    expect(h.batches).toHaveLength(1);
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(MIN - 1);
    expect(h.ticks()).toHaveLength(2);
    h.clock.advance(1);
    expect(h.ticks()).toHaveLength(3);
    expect(h.batches).toHaveLength(1);
  });

  it('skips a task whose dueAt does not parse', () => {
    const h = harness([
      withTasks('p-bad', FORM_DOG, [timedTask('p-bad:t', 'Check', 'not-a-date')]),
    ]);
    h.timers.start();
    expect(() => {
      h.timers.onVisible();
    }).not.toThrow();
    expect(h.timers.nextDueAt()).toBeUndefined();
    h.clock.advance(MIN);
    expect(h.dues()).toEqual([]);
    expect(h.ticks()).toHaveLength(2);
  });

  it('stays single-timered when dispatch reschedules re-entrantly', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const clock = createFakeClock(FIXED_NOW_MS);
    const actions: Action[] = [];
    const batches: DueTask[][] = [];
    const timers = createTimers({
      clock,
      getPatients: () => [withTasks('p-re', FORM_DOG, [timedTask('p-re:t', 'Check', dueAt)])],
      dispatch: (a) => {
        actions.push(a);
        timers.reschedule();
      },
      notifier: {
        due: (t) => {
          batches.push([...t]);
          timers.reschedule();
        },
      },
    });
    timers.start();
    clock.advance(30_000);
    expect(clock.pending()).toBe(1);
    expect(actions.filter((a) => a.type === 'DUE')).toHaveLength(1);
    expect(batches).toHaveLength(1);
    clock.advance(5 * MIN);
    expect(clock.pending()).toBe(1);
    expect(batches).toHaveLength(1);
  });

  it('re-arms even when dispatch throws, and lets the error propagate', () => {
    const dueAt = new Date(FIXED_NOW_MS + 30_000).toISOString();
    const clock = createFakeClock(FIXED_NOW_MS);
    const timers = createTimers({
      clock,
      getPatients: () => [withTasks('p-x', FORM_DOG, [timedTask('p-x:t', 'Check', dueAt)])],
      dispatch: (a) => {
        if (a.type === 'DUE') {
          throw new Error('reducer failed');
        }
      },
      notifier: { due: () => undefined },
    });
    timers.start();
    expect(() => {
      clock.advance(30_000);
    }).toThrow('reducer failed');
    expect(clock.pending()).toBe(1);
    expect(() => {
      timers.onVisible();
    }).not.toThrow();
    expect(clock.pending()).toBe(1);
  });

  it('reads patients fresh each pass and retains only names and labels in what it hands out', () => {
    const p = patientRecovery();
    let reads = 0;
    const h = harness([p], {
      getPatients: () => {
        reads += 1;
        return [p];
      },
    });
    h.timers.start();
    const afterStart = reads;
    expect(afterStart).toBeGreaterThan(0);
    h.timers.onVisible();
    expect(reads).toBeGreaterThan(afterStart);
    const first = h.batches[0]?.[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'dueAt',
      'label',
      'patientId',
      'patientName',
      'taskId',
    ]);
  });
});

describe('createTimers: nextDueAt', () => {
  it('is undefined with no timed tasks and otherwise the earliest outstanding due time', () => {
    const fresh = harness([patientFresh()]);
    expect(fresh.timers.nextDueAt()).toBeUndefined();
    const rec = patientRecovery();
    const check1 = rec.tasks.find((t) => t.key === 'check_1');
    const check2 = rec.tasks.find((t) => t.key === 'check_2');
    const h = harness([patientFresh(), rec, patientWithCustomTask()]);
    expect(h.timers.nextDueAt()).toBe(Date.parse(check1?.dueAt ?? ''));
    const done = {
      ...rec,
      tasks: rec.tasks.map((t) => (t.key === 'check_1' ? { ...t, status: 'done' as const } : t)),
    };
    h.setPatients([done]);
    expect(h.timers.nextDueAt()).toBe(Date.parse(check2?.dueAt ?? ''));
    h.setPatients([{ ...done, status: 'discharged' }]);
    expect(h.timers.nextDueAt()).toBeUndefined();
  });

  it('keeps reporting an announced overdue task while it stays outstanding', () => {
    const h = harness([patientRecovery()]);
    h.timers.start();
    h.timers.onVisible();
    expect(h.batches).toHaveLength(1);
    expect(h.timers.nextDueAt()).toBe(FIXED_NOW_MS - 5 * MIN);
  });
});
