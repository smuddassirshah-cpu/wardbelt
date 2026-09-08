import { describe, expect, it } from 'vitest';
import {
  addCustomTask,
  completeTask,
  createPatient,
  currentTask,
  dischargePatient,
  isBeltComplete,
  revertTask,
  setNote,
  skipTask,
} from '../../../src/domain/patient';
import { TEMPLATE } from '../../../src/domain/template';
import { templateTaskId, type Patient, type Task } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FORM_CAT,
  FORM_DOG,
  isoPlus,
  patientFresh,
  patientInTheatre,
  patientRecovery,
  patientWithCustomTask,
  templateTasks,
} from '../../fixtures/synthetic';
import { deepFreeze } from './helpers';

const T1 = isoPlus(FIXED_NOW_ISO, 1);
const T2 = isoPlus(FIXED_NOW_ISO, 2);

function taskOf(p: Patient, key: string): Task {
  const t = p.tasks.find((x) => x.key === key);
  if (t === undefined) {
    throw new Error(`no task ${key}`);
  }
  return t;
}

describe('createPatient', () => {
  it('builds the template belt in order with ids derived from the patient id', () => {
    const p = createPatient('p1', FORM_DOG, FIXED_NOW_ISO);
    expect(p).toMatchObject({ ...FORM_DOG, id: 'p1', status: 'active', createdAt: FIXED_NOW_ISO });
    expect(p.tasks).toHaveLength(TEMPLATE.length);
    p.tasks.forEach((t, i) => {
      const step = TEMPLATE[i];
      expect(t).toEqual({
        id: templateTaskId('p1', step?.key ?? 'discharge'),
        key: step?.key,
        label: step?.label,
        phase: step?.phase,
        order: i,
        status: 'todo',
        custom: false,
      });
    });
    expect(p.tasks).toEqual(templateTasks('p1'));
    expect('theatreReturnAt' in p).toBe(false);
    expect('dischargedAt' in p).toBe(false);
  });
});

describe('currentTask and isBeltComplete', () => {
  it('returns the first unfinished task by order regardless of array position', () => {
    const p = deepFreeze(patientFresh());
    expect(currentTask(p)?.key).toBe('handover_admit');
    expect(isBeltComplete(p)).toBe(false);
    const reversed: Patient = { ...p, tasks: [...p.tasks].reverse() };
    expect(currentTask(reversed)?.key).toBe('handover_admit');
    const later = completeTask(p, taskOf(p, 'handover_admit').id, T1);
    expect(currentTask(later)?.key).toBe('bloods');
  });

  it('is complete when every task is done or skipped, whichever order they finished in', () => {
    let p = patientFresh();
    for (const t of [...p.tasks].reverse()) {
      p = t.order % 2 === 0 ? completeTask(p, t.id, T1) : skipTask(p, t.id, T1);
    }
    expect(currentTask(p)).toBeUndefined();
    expect(isBeltComplete(p)).toBe(true);
    expect(isBeltComplete({ ...p, tasks: [] })).toBe(true);
  });
});

describe('completeTask and skipTask', () => {
  it('only moves a task out of todo and returns the same reference otherwise', () => {
    const p = deepFreeze(patientFresh());
    const id = taskOf(p, 'bloods').id;
    const done = completeTask(p, id, T1);
    expect(done).not.toBe(p);
    expect(taskOf(done, 'bloods')).toMatchObject({ status: 'done', doneAt: T1 });
    expect(taskOf(p, 'bloods').status).toBe('todo');
    expect(completeTask(done, id, T2)).toBe(done);
    expect(skipTask(done, id, T2)).toBe(done);
    expect(completeTask(p, 'nope', T1)).toBe(p);
    expect(skipTask(p, 'nope', T1)).toBe(p);
    done.tasks.forEach((t, i) => {
      if (t.id !== id) {
        expect(t).toBe(p.tasks[i]);
      }
    });
  });

  it('records when a skip happened', () => {
    const p = patientFresh();
    const s = skipTask(p, taskOf(p, 'premed').id, T1);
    expect(taskOf(s, 'premed')).toMatchObject({ status: 'skipped', doneAt: T1 });
    expect(s.status).toBe('active');
  });

  it('completing in_theatre records the return and schedules the checks; skipping does not', () => {
    const p = deepFreeze(patientInTheatre());
    const back = completeTask(p, taskOf(p, 'in_theatre').id, T1);
    expect(back.theatreReturnAt).toBe(T1);
    expect(taskOf(back, 'check_1').dueAt).toBe(isoPlus(T1, 15));
    expect(taskOf(back, 'check_4').dueAt).toBe(isoPlus(T1, 60));
    expect(taskOf(back, 'handover_theatre').dueAt).toBeUndefined();
    const skipped = skipTask(p, taskOf(p, 'in_theatre').id, T1);
    expect(skipped.theatreReturnAt).toBeUndefined();
    expect(taskOf(skipped, 'check_1').dueAt).toBeUndefined();
  });

  it('completing discharge discharges the patient; skipping it does not', () => {
    const p = deepFreeze(patientFresh());
    const id = taskOf(p, 'discharge').id;
    const gone = completeTask(p, id, T1);
    expect(gone).toMatchObject({ status: 'discharged', dischargedAt: T1 });
    const skipped = skipTask(p, id, T1);
    expect(skipped.status).toBe('active');
    expect(skipped.dischargedAt).toBeUndefined();
  });
});

describe('addCustomTask', () => {
  it('inserts after the chosen task, inherits its phase and renumbers', () => {
    const p = deepFreeze(patientFresh());
    const after = taskOf(p, 'check_2');
    const next = addCustomTask(p, {
      taskId: 'p-fresh:custom:1',
      label: 'Bandage check',
      afterTaskId: after.id,
      dueAt: T1,
    });
    const idx = next.tasks.findIndex((t) => t.id === 'p-fresh:custom:1');
    expect(idx).toBe(after.order + 1);
    expect(next.tasks[idx]).toEqual({
      id: 'p-fresh:custom:1',
      key: 'custom',
      label: 'Bandage check',
      phase: 'RECOVERY',
      order: idx,
      status: 'todo',
      custom: true,
      dueAt: T1,
    });
    next.tasks.forEach((t, i) => {
      expect(t.order).toBe(i);
    });
    next.tasks.slice(0, idx).forEach((t, i) => {
      expect(t).toBe(p.tasks[i]);
    });
    expect(next.tasks).toHaveLength(p.tasks.length + 1);
  });

  it('appends after the last task when afterTaskId is absent or unknown', () => {
    const p = patientFresh();
    const absent = addCustomTask(p, { taskId: 'c1', label: 'Weigh' });
    expect(absent.tasks.at(-1)).toMatchObject({ id: 'c1', phase: 'DONE', order: p.tasks.length });
    expect('dueAt' in (absent.tasks.at(-1) ?? {})).toBe(false);
    const unknown = addCustomTask(p, { taskId: 'c2', label: 'Weigh', afterTaskId: 'ghost' });
    expect(unknown.tasks.at(-1)?.id).toBe('c2');
    expect(unknown.tasks.at(-1)?.order).toBe(p.tasks.length);
  });

  it('is PRE_OP when it becomes the first task and ignores duplicate ids', () => {
    const empty: Patient = { ...patientFresh(), tasks: [] };
    const first = addCustomTask(empty, { taskId: 'c1', label: 'Weigh' });
    expect(first.tasks).toEqual([
      {
        id: 'c1',
        key: 'custom',
        label: 'Weigh',
        phase: 'PRE_OP',
        order: 0,
        status: 'todo',
        custom: true,
      },
    ]);
    expect(addCustomTask(first, { taskId: 'c1', label: 'Again' })).toBe(first);
    const p = patientWithCustomTask();
    expect(addCustomTask(p, { taskId: 'p-custom:custom:1', label: 'Dup' })).toBe(p);
  });
});

describe('setNote', () => {
  it('sets, replaces and clears a task note, returning the same reference when nothing changes', () => {
    const p = deepFreeze(patientFresh());
    const id = taskOf(p, 'bloods').id;
    expect(setNote(p, id, '')).toBe(p);
    expect(setNote(p, 'ghost', 'x')).toBe(p);
    const noted = setNote(p, id, 'Fasted');
    expect(taskOf(noted, 'bloods').note).toBe('Fasted');
    expect(setNote(noted, id, 'Fasted')).toBe(noted);
    const replaced = setNote(noted, id, 'Not fasted');
    expect(taskOf(replaced, 'bloods').note).toBe('Not fasted');
    const cleared = setNote(replaced, id, '');
    expect('note' in taskOf(cleared, 'bloods')).toBe(false);
    expect(taskOf(cleared, 'bloods')).toEqual(taskOf(p, 'bloods'));
  });

  it('sets the patient notes when no task is given', () => {
    const p = deepFreeze(patientFresh());
    expect(setNote(p, undefined, p.notes)).toBe(p);
    const next = setNote(p, undefined, 'Owner phoning at noon');
    expect(next.notes).toBe('Owner phoning at noon');
    expect(next.tasks).toBe(p.tasks);
  });
});

describe('dischargePatient', () => {
  it('completes the discharge task when it is unfinished', () => {
    const p = deepFreeze(patientFresh());
    const d = dischargePatient(p, T1);
    expect(d).toMatchObject({ status: 'discharged', dischargedAt: T1 });
    expect(taskOf(d, 'discharge')).toMatchObject({ status: 'done', doneAt: T1 });
    expect(dischargePatient(d, T2)).toBe(d);
  });

  it('discharges without touching a skipped discharge task or a belt without one', () => {
    const p = patientFresh();
    const skipped = skipTask(p, taskOf(p, 'discharge').id, T1);
    const d = dischargePatient(skipped, T2);
    expect(d).toMatchObject({ status: 'discharged', dischargedAt: T2 });
    expect(taskOf(d, 'discharge')).toMatchObject({ status: 'skipped', doneAt: T1 });
    const noTask: Patient = { ...p, tasks: p.tasks.filter((t) => t.key !== 'discharge') };
    expect(dischargePatient(noTask, T2)).toMatchObject({ status: 'discharged', dischargedAt: T2 });
  });
});

describe('revertTask', () => {
  it('puts a done or skipped task back byte-for-byte and ignores the rest', () => {
    const p = deepFreeze(patientFresh());
    const id = taskOf(p, 'bloods').id;
    expect(revertTask(p, id)).toBe(p);
    expect(revertTask(p, 'ghost')).toBe(p);
    expect(JSON.stringify(revertTask(completeTask(p, id, T1), id))).toBe(JSON.stringify(p));
    expect(JSON.stringify(revertTask(skipTask(p, id, T1), id))).toBe(JSON.stringify(p));
  });

  it('reverting a completed in_theatre clears the return and check due times', () => {
    const p = deepFreeze(patientInTheatre());
    const id = taskOf(p, 'in_theatre').id;
    const back = completeTask(p, id, T1);
    const reverted = revertTask(back, id);
    expect(JSON.stringify(reverted)).toBe(JSON.stringify(p));
    expect('theatreReturnAt' in reverted).toBe(false);
  });

  it('reverting a skipped in_theatre keeps a separately recorded return', () => {
    const p = patientRecovery();
    const withSkip: Patient = {
      ...p,
      tasks: p.tasks.map((t) =>
        t.key === 'in_theatre' ? { ...t, status: 'skipped' as const, doneAt: T1 } : t,
      ),
    };
    const reverted = revertTask(withSkip, taskOf(p, 'in_theatre').id);
    expect(reverted.theatreReturnAt).toBe(p.theatreReturnAt);
    expect(taskOf(reverted, 'check_1').dueAt).toBe(taskOf(p, 'check_1').dueAt);
    expect(taskOf(reverted, 'in_theatre').status).toBe('todo');
  });

  it('reverting discharge makes the patient active again', () => {
    const p = deepFreeze(patientFresh());
    const id = taskOf(p, 'discharge').id;
    const gone = completeTask(p, id, T1);
    const back = revertTask(gone, id);
    expect(JSON.stringify(back)).toBe(JSON.stringify(p));
    const viaSkip = dischargePatient(skipTask(p, id, T1), T2);
    const backAgain = revertTask(viaSkip, id);
    expect(backAgain.status).toBe('active');
    expect('dischargedAt' in backAgain).toBe(false);
  });

  it('keeps identity of untouched tasks', () => {
    const p = deepFreeze(createPatient('p2', FORM_CAT, FIXED_NOW_ISO));
    const id = taskOf(p, 'invoice').id;
    const done = completeTask(p, id, T1);
    const back = revertTask(done, id);
    back.tasks.forEach((t, i) => {
      if (t.id !== id) {
        expect(t).toBe(p.tasks[i]);
      }
    });
  });
});
