import { describe, expect, it } from 'vitest';
import { currentTask } from '../../../src/domain/patient';
import {
  activePatients,
  dischargedPatients,
  initialState,
  reduce,
} from '../../../src/domain/reducer';
import {
  DEFAULT_SETTINGS,
  TRANSFER_SCHEMA_VERSION,
  templateTaskId,
  type Action,
  type Event,
  type Patient,
  type State,
  type TransferFile,
} from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FIXTURE_SETTINGS,
  FORM_CAT,
  FORM_DOG,
  fixtureEvents,
  isoPlus,
  patientDischarged,
  patientRecovery,
} from '../../fixtures/synthetic';
import { deepFreeze, run, stamp } from './helpers';

const T0 = FIXED_NOW_ISO;
const T1 = isoPlus(T0, 1);
const T2 = isoPlus(T0, 2);
const T3 = isoPlus(T0, 3);

function patient(s: State, id: string): Patient {
  const p = s.patients[id];
  if (p === undefined) {
    throw new Error(`no patient ${id}`);
  }
  return p;
}

function task(s: State, patientId: string, key: string) {
  const t = patient(s, patientId).tasks.find((x) => x.key === key);
  if (t === undefined) {
    throw new Error(`no task ${key}`);
  }
  return t;
}

const add = (patientId: string, at = T0, eventId = `add-${patientId}`): Action => ({
  type: 'ADD_PATIENT',
  patientId,
  form: FORM_DOG,
  ...stamp(at, eventId),
});

function withDog(): State {
  return run(initialState(FIXED_NOW_MS), [add('d')]);
}

describe('initialState and selectors', () => {
  it('starts empty with default settings and a copied settings object', () => {
    const s = initialState(FIXED_NOW_MS);
    expect(s).toEqual({ patients: {}, events: [], settings: DEFAULT_SETTINGS, now: FIXED_NOW_MS });
    expect(s.settings).not.toBe(DEFAULT_SETTINGS);
    expect(activePatients(s)).toEqual([]);
    expect(dischargedPatients(s)).toEqual([]);
  });

  it('splits patients by status', () => {
    const s = run(withDog(), [
      { type: 'ADD_PATIENT', patientId: 'c', form: FORM_CAT, ...stamp(T1, 'e2') },
    ]);
    const t = run(s, [{ type: 'DISCHARGE', patientId: 'c', ...stamp(T2, 'e3') }]);
    expect(activePatients(t).map((p) => p.id)).toEqual(['d']);
    expect(dischargedPatients(t).map((p) => p.id)).toEqual(['c']);
  });
});

describe('ADD_PATIENT', () => {
  it('creates the patient from the template and logs PATIENT_ADDED', () => {
    const s = withDog();
    expect(patient(s, 'd')).toMatchObject({
      ...FORM_DOG,
      id: 'd',
      status: 'active',
      createdAt: T0,
    });
    expect(patient(s, 'd').tasks).toHaveLength(19);
    expect(s.events).toEqual([{ id: 'add-d', at: T0, type: 'PATIENT_ADDED', patientId: 'd' }]);
  });

  it('ignores an existing id', () => {
    const s = withDog();
    expect(reduce(s, add('d', T1, 'again'))).toBe(s);
  });
});

describe('COMPLETE_TASK and SKIP_TASK', () => {
  it('logs the task fields and the due time when set', () => {
    const s = run(withDog(), [
      { type: 'SET_THEATRE_RETURN', patientId: 'd', returnedAt: T0, ...stamp(T0, 'ret') },
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:check_1', ...stamp(T1, 'c1') },
      { type: 'SKIP_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T2, 's1') },
    ]);
    expect(task(s, 'd', 'check_1')).toMatchObject({ status: 'done', doneAt: T1 });
    expect(task(s, 'd', 'bloods')).toMatchObject({ status: 'skipped', doneAt: T2 });
    expect(s.events.slice(-2)).toEqual([
      {
        id: 'c1',
        at: T1,
        type: 'TASK_COMPLETED',
        patientId: 'd',
        taskId: 'd:check_1',
        taskKey: 'check_1',
        custom: false,
        dueAt: isoPlus(T0, 15),
      },
      {
        id: 's1',
        at: T2,
        type: 'TASK_SKIPPED',
        patientId: 'd',
        taskId: 'd:bloods',
        taskKey: 'bloods',
        custom: false,
      },
    ]);
  });

  it('returns the same state for an unknown patient, unknown task or finished task', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
    ]);
    const cases: Action[] = [
      { type: 'COMPLETE_TASK', patientId: 'ghost', taskId: 'd:bloods', ...stamp(T2, 'x1') },
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:ghost', ...stamp(T2, 'x2') },
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T2, 'x3') },
      { type: 'SKIP_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T2, 'x4') },
      { type: 'SKIP_TASK', patientId: 'nope', taskId: 'd:bloods', ...stamp(T2, 'x5') },
    ];
    for (const a of cases) {
      expect(reduce(s, a)).toBe(s);
    }
  });

  it('completing discharge also logs a derived DISCHARGED event and discharges the patient', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:discharge', ...stamp(T1, 'dc') },
    ]);
    expect(patient(s, 'd')).toMatchObject({ status: 'discharged', dischargedAt: T1 });
    expect(s.events.slice(-2).map((e) => [e.id, e.type])).toEqual([
      ['dc', 'TASK_COMPLETED'],
      ['dc:1', 'DISCHARGED'],
    ]);
    expect(s.events.at(-1)).toEqual({ id: 'dc:1', at: T1, type: 'DISCHARGED', patientId: 'd' });
  });

  it('completing in_theatre schedules the checks through the patient rules', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:in_theatre', ...stamp(T1, 'it') },
    ]);
    expect(patient(s, 'd').theatreReturnAt).toBe(T1);
    expect(task(s, 'd', 'check_3').dueAt).toBe(isoPlus(T1, 45));
  });
});

describe('UNDO', () => {
  it('reverts the newest completion or skip not already undone, one per action', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
      { type: 'SKIP_TASK', patientId: 'd', taskId: 'd:premed', ...stamp(T2, 's1') },
    ]);
    const u1 = run(s, [{ type: 'UNDO', patientId: 'd', ...stamp(T3, 'u1') }]);
    expect(task(u1, 'd', 'premed').status).toBe('todo');
    expect(task(u1, 'd', 'bloods').status).toBe('done');
    expect(u1.events.at(-1)).toEqual({
      id: 'u1',
      at: T3,
      type: 'UNDO',
      patientId: 'd',
      undoOf: 's1',
    });
    const u2 = run(u1, [{ type: 'UNDO', patientId: 'd', ...stamp(T3, 'u2') }]);
    expect(task(u2, 'd', 'bloods').status).toBe('todo');
    expect(u2.events.at(-1)?.undoOf).toBe('c1');
    expect(reduce(u2, { type: 'UNDO', patientId: 'd', ...stamp(T3, 'u3') })).toBe(u2);
    expect(JSON.stringify(patient(u2, 'd'))).toBe(JSON.stringify(patient(withDog(), 'd')));
  });

  it('is a no-op for unknown patients, patients with nothing to undo, or events without a task', () => {
    const s = withDog();
    expect(reduce(s, { type: 'UNDO', patientId: 'ghost', ...stamp(T1, 'u') })).toBe(s);
    expect(reduce(s, { type: 'UNDO', patientId: 'd', ...stamp(T1, 'u') })).toBe(s);
    const odd: State = deepFreeze({
      ...s,
      events: [...s.events, { id: 'weird', at: T1, type: 'TASK_COMPLETED', patientId: 'd' }],
    });
    expect(reduce(odd, { type: 'UNDO', patientId: 'd', ...stamp(T2, 'u') })).toBe(odd);
  });

  it('only touches the named patient and skips events of others', () => {
    const s = run(withDog(), [
      { type: 'ADD_PATIENT', patientId: 'c', form: FORM_CAT, ...stamp(T0, 'add-c') },
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
      { type: 'COMPLETE_TASK', patientId: 'c', taskId: 'c:bloods', ...stamp(T2, 'c2') },
      { type: 'UNDO', patientId: 'd', ...stamp(T3, 'u1') },
    ]);
    expect(task(s, 'd', 'bloods').status).toBe('todo');
    expect(task(s, 'c', 'bloods').status).toBe('done');
  });

  it('undoing a discharge completion reactivates the patient and nullifies the derived event', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:discharge', ...stamp(T1, 'dc') },
      { type: 'UNDO', patientId: 'd', ...stamp(T2, 'u1') },
    ]);
    expect(patient(s, 'd').status).toBe('active');
    expect('dischargedAt' in patient(s, 'd')).toBe(false);
    expect(s.events.slice(-2)).toEqual([
      { id: 'u1', at: T2, type: 'UNDO', patientId: 'd', undoOf: 'dc' },
      { id: 'u1:1', at: T2, type: 'UNDO', patientId: 'd', undoOf: 'dc:1' },
    ]);
    expect(new Set(s.events.map((e) => e.id)).size).toBe(s.events.length);
  });

  it('still records the undo when the task was already reverted by an import', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
    ]);
    const replaced = run(s, [
      {
        type: 'IMPORT',
        data: {
          schemaVersion: TRANSFER_SCHEMA_VERSION,
          exportedAt: T2,
          patients: [patient(withDog(), 'd')],
          events: [],
          settings: FIXTURE_SETTINGS,
        },
      },
    ]);
    const undone = run(replaced, [{ type: 'UNDO', patientId: 'd', ...stamp(T3, 'u1') }]);
    expect(undone.patients.d).toBe(replaced.patients.d);
    expect(undone.events.at(-1)?.undoOf).toBe('c1');
    expect(reduce(undone, { type: 'UNDO', patientId: 'd', ...stamp(T3, 'u2') })).toBe(undone);
  });
});

describe('ADD_TASK', () => {
  it('inserts the custom task and logs TASK_ADDED with the due time when given', () => {
    const s = run(withDog(), [
      {
        type: 'ADD_TASK',
        patientId: 'd',
        taskId: 'd:custom:1',
        label: 'Bandage check',
        afterTaskId: 'd:pain_score',
        dueAt: T2,
        ...stamp(T1, 'a1'),
      },
      {
        type: 'ADD_TASK',
        patientId: 'd',
        taskId: 'd:custom:2',
        label: 'Weigh',
        ...stamp(T1, 'a2'),
      },
    ]);
    const tasks = patient(s, 'd').tasks;
    expect(tasks.findIndex((t) => t.id === 'd:custom:1')).toBe(
      tasks.findIndex((t) => t.key === 'pain_score') + 1,
    );
    expect(tasks.at(-1)?.id).toBe('d:custom:2');
    expect(s.events.slice(-2)).toEqual([
      {
        id: 'a1',
        at: T1,
        type: 'TASK_ADDED',
        patientId: 'd',
        taskId: 'd:custom:1',
        taskKey: 'custom',
        custom: true,
        dueAt: T2,
      },
      {
        id: 'a2',
        at: T1,
        type: 'TASK_ADDED',
        patientId: 'd',
        taskId: 'd:custom:2',
        taskKey: 'custom',
        custom: true,
      },
    ]);
  });

  it('ignores unknown patients and duplicate task ids', () => {
    const s = withDog();
    expect(
      reduce(s, { type: 'ADD_TASK', patientId: 'x', taskId: 't', label: 'L', ...stamp(T1, 'a') }),
    ).toBe(s);
    expect(
      reduce(s, {
        type: 'ADD_TASK',
        patientId: 'd',
        taskId: templateTaskId('d', 'bloods'),
        label: 'L',
        ...stamp(T1, 'a'),
      }),
    ).toBe(s);
  });
});

describe('SET_THEATRE_RETURN', () => {
  it('records the return, schedules checks and logs a base event without touching statuses', () => {
    const before = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:check_1', ...stamp(T0, 'c1') },
    ]);
    const s = run(before, [
      { type: 'SET_THEATRE_RETURN', patientId: 'd', returnedAt: T1, ...stamp(T2, 'r1') },
    ]);
    expect(patient(s, 'd').theatreReturnAt).toBe(T1);
    expect(task(s, 'd', 'check_1')).toMatchObject({ status: 'done', dueAt: isoPlus(T1, 15) });
    expect(task(s, 'd', 'check_4')).toMatchObject({ status: 'todo', dueAt: isoPlus(T1, 60) });
    expect(task(s, 'd', 'in_theatre').status).toBe('todo');
    expect(s.events.at(-1)).toEqual({ id: 'r1', at: T2, type: 'THEATRE_RETURN', patientId: 'd' });
  });

  it('ignores unknown and discharged patients', () => {
    const s = run(withDog(), [{ type: 'DISCHARGE', patientId: 'd', ...stamp(T1, 'dc') }]);
    expect(
      reduce(s, { type: 'SET_THEATRE_RETURN', patientId: 'd', returnedAt: T1, ...stamp(T2, 'r') }),
    ).toBe(s);
    expect(
      reduce(s, { type: 'SET_THEATRE_RETURN', patientId: 'q', returnedAt: T1, ...stamp(T2, 'r') }),
    ).toBe(s);
  });
});

describe('DISCHARGE', () => {
  it('discharges through the patient rules and logs DISCHARGED once', () => {
    const s = run(withDog(), [{ type: 'DISCHARGE', patientId: 'd', ...stamp(T1, 'dc') }]);
    expect(patient(s, 'd')).toMatchObject({ status: 'discharged', dischargedAt: T1 });
    expect(task(s, 'd', 'discharge')).toMatchObject({ status: 'done', doneAt: T1 });
    expect(s.events.at(-1)).toEqual({ id: 'dc', at: T1, type: 'DISCHARGED', patientId: 'd' });
    expect(reduce(s, { type: 'DISCHARGE', patientId: 'd', ...stamp(T2, 'dc2') })).toBe(s);
    expect(reduce(s, { type: 'DISCHARGE', patientId: 'zz', ...stamp(T2, 'dc3') })).toBe(s);
  });
});

describe('DELETE_PATIENT', () => {
  it('removes the patient and its events, appending nothing', () => {
    const s = run(withDog(), [
      { type: 'ADD_PATIENT', patientId: 'c', form: FORM_CAT, ...stamp(T0, 'add-c') },
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
      { type: 'COMPLETE_TASK', patientId: 'c', taskId: 'c:bloods', ...stamp(T1, 'c2') },
    ]);
    const after = run(s, [{ type: 'DELETE_PATIENT', patientId: 'd', ...stamp(T2, 'del') }]);
    expect(Object.keys(after.patients)).toEqual(['c']);
    expect(after.events.map((e) => e.id)).toEqual(['add-c', 'c2']);
    expect(reduce(after, { type: 'DELETE_PATIENT', patientId: 'd', ...stamp(T2, 'del2') })).toBe(
      after,
    );
  });
});

describe('SET_NOTE', () => {
  it('sets task and patient notes without events and ignores no-ops and unknown patients', () => {
    const s = withDog();
    const noted = run(s, [
      { type: 'SET_NOTE', patientId: 'd', taskId: 'd:bloods', note: 'Fasted' },
      { type: 'SET_NOTE', patientId: 'd', note: 'Owner waiting' },
    ]);
    expect(task(noted, 'd', 'bloods').note).toBe('Fasted');
    expect(patient(noted, 'd').notes).toBe('Owner waiting');
    expect(noted.events).toBe(s.events);
    expect(reduce(noted, { type: 'SET_NOTE', patientId: 'd', note: 'Owner waiting' })).toBe(noted);
    expect(reduce(noted, { type: 'SET_NOTE', patientId: 'nope', note: 'x' })).toBe(noted);
  });
});

describe('SET_SETTINGS, RESET, TICK and DUE', () => {
  it('merges settings shallowly', () => {
    const s = run(initialState(FIXED_NOW_MS), [
      { type: 'SET_SETTINGS', settings: { theme: 'dark', purgeDays: 7 } },
    ]);
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', purgeDays: 7 });
    const t = run(s, [{ type: 'SET_SETTINGS', settings: { lastExportAt: T1 } }]);
    expect(t.settings.lastExportAt).toBe(T1);
    expect(t.settings.theme).toBe('dark');
  });

  it('resets everything except the clock', () => {
    const s = run(withDog(), [
      { type: 'SET_SETTINGS', settings: { sound: true } },
      { type: 'TICK', now: FIXED_NOW_MS + 5 },
    ]);
    expect(reduce(s, { type: 'RESET' })).toEqual(initialState(FIXED_NOW_MS + 5));
  });

  it('ticks set now only and keep identity when unchanged', () => {
    const s = withDog();
    expect(reduce(s, { type: 'TICK', now: FIXED_NOW_MS })).toBe(s);
    const later = reduce(s, { type: 'TICK', now: FIXED_NOW_MS + 1 });
    expect(later).toEqual({ ...s, now: FIXED_NOW_MS + 1 });
    expect(later.patients).toBe(s.patients);
    expect(
      reduce(later, { type: 'DUE', patientId: 'd', taskId: 'd:check_1', now: later.now }),
    ).toBe(later);
    const due = reduce(later, { type: 'DUE', patientId: 'd', taskId: 'd:check_1', now: 7 });
    expect(due).toEqual({ ...later, now: 7 });
    expect(reduce(due, { type: 'TICK', now: FIXED_NOW_MS - 60_000 }).now).toBe(
      FIXED_NOW_MS - 60_000,
    );
  });
});

describe('PURGE_DISCHARGED', () => {
  it('removes discharged patients older than purgeDays with their events, keeping the rest', () => {
    const s = run(initialState(FIXED_NOW_MS), [
      add('old', isoPlus(T0, -40 * 24 * 60)),
      add('recent', isoPlus(T0, -40 * 24 * 60)),
      add('active', isoPlus(T0, -40 * 24 * 60)),
      { type: 'DISCHARGE', patientId: 'old', ...stamp(isoPlus(T0, -31 * 24 * 60), 'd-old') },
      { type: 'DISCHARGE', patientId: 'recent', ...stamp(isoPlus(T0, -29 * 24 * 60), 'd-recent') },
    ]);
    const purged = run(s, [{ type: 'PURGE_DISCHARGED', at: T0 }]);
    expect(Object.keys(purged.patients).sort()).toEqual(['active', 'recent']);
    expect(purged.events.map((e) => e.id)).toEqual(['add-recent', 'add-active', 'd-recent']);
    expect(reduce(purged, { type: 'PURGE_DISCHARGED', at: T0 })).toBe(purged);
    const exact = run(initialState(FIXED_NOW_MS), [
      add('edge'),
      { type: 'DISCHARGE', patientId: 'edge', ...stamp(T0, 'd-edge') },
    ]);
    const cutoff = isoPlus(T0, 30 * 24 * 60);
    expect(reduce(exact, { type: 'PURGE_DISCHARGED', at: cutoff })).toBe(exact);
    expect(reduce(exact, { type: 'PURGE_DISCHARGED', at: isoPlus(cutoff, 1) }).patients).toEqual(
      {},
    );
  });

  it('respects the purgeDays setting and skips discharged records without a timestamp', () => {
    const s = run(initialState(FIXED_NOW_MS), [
      add('a', isoPlus(T0, -10 * 24 * 60)),
      { type: 'DISCHARGE', patientId: 'a', ...stamp(isoPlus(T0, -8 * 24 * 60), 'd-a') },
      { type: 'SET_SETTINGS', settings: { purgeDays: 7 } },
    ]);
    expect(reduce(s, { type: 'PURGE_DISCHARGED', at: T0 }).patients).toEqual({});
    const stale = patientDischarged();
    const noStamp: Patient = { ...stale, tasks: stale.tasks };
    delete noStamp.dischargedAt;
    const odd = deepFreeze({
      ...initialState(FIXED_NOW_MS),
      patients: { [noStamp.id]: noStamp },
    });
    expect(reduce(odd, { type: 'PURGE_DISCHARGED', at: isoPlus(T0, 365 * 24 * 60) })).toBe(odd);
  });
});

describe('IMPORT', () => {
  const file = (over: Partial<TransferFile>): TransferFile => ({
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    exportedAt: T1,
    patients: [],
    events: [],
    settings: FIXTURE_SETTINGS,
    ...over,
  });

  it('merges by id: replaces patients, adds unknown events, replaces settings', () => {
    const s = run(withDog(), [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:bloods', ...stamp(T1, 'c1') },
    ]);
    const incomingDog = patientRecovery();
    const dupEvent: Event = { id: 'c1', at: T3, type: 'PATIENT_DELETED', patientId: 'd' };
    const newEvents = fixtureEvents();
    const imported = run(s, [
      {
        type: 'IMPORT',
        data: file({
          patients: [incomingDog, { ...patient(s, 'd'), notes: 'replaced' }],
          events: [dupEvent, ...newEvents, dupEvent],
        }),
      },
    ]);
    expect(Object.keys(imported.patients).sort()).toEqual(['d', 'p-recovery']);
    expect(patient(imported, 'd').notes).toBe('replaced');
    expect(imported.patients['p-recovery']).toBe(incomingDog);
    expect(imported.events.map((e) => e.id)).toEqual([
      'add-d',
      'c1',
      ...newEvents.map((e) => e.id),
    ]);
    expect(imported.events[1]?.type).toBe('TASK_COMPLETED');
    expect(imported.settings).toEqual(FIXTURE_SETTINGS);
    expect(imported.settings).not.toBe(FIXTURE_SETTINGS);
    expect(imported.now).toBe(s.now);
  });

  it('keeps the events array identity when nothing new arrives', () => {
    const s = withDog();
    const same = reduce(s, { type: 'IMPORT', data: file({ events: [...s.events] }) });
    expect(same.events).toBe(s.events);
    expect(same.patients).toEqual(s.patients);
  });
});

describe('malformed input', () => {
  it('ignores actions carrying unparseable timestamps instead of throwing', () => {
    const s = withDog();
    const bad: Action[] = [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:in_theatre', ...stamp('junk', 'x1') },
      { type: 'ADD_PATIENT', patientId: 'n', form: FORM_CAT, ...stamp('', 'x2') },
      { type: 'SET_THEATRE_RETURN', patientId: 'd', returnedAt: 'soon', ...stamp(T1, 'x3') },
      {
        type: 'ADD_TASK',
        patientId: 'd',
        taskId: 'q',
        label: 'L',
        dueAt: 'later',
        ...stamp(T1, 'x4'),
      },
      { type: 'PURGE_DISCHARGED', at: 'yesterday' },
    ];
    for (const a of bad) {
      expect(reduce(s, a)).toBe(s);
    }
  });

  it('returns the same state for an action type it does not know', () => {
    const s = withDog();
    const bogus = { type: 'EXPLODE', patientId: 'd' } as unknown as Action;
    expect(reduce(s, bogus)).toBe(s);
  });

  it('never mutates its inputs', () => {
    const s = withDog();
    const t = run(s, [
      { type: 'COMPLETE_TASK', patientId: 'd', taskId: 'd:in_theatre', ...stamp(T1, 'c1') },
      { type: 'ADD_TASK', patientId: 'd', taskId: 'd:custom:1', label: 'L', ...stamp(T1, 'a1') },
      { type: 'UNDO', patientId: 'd', ...stamp(T2, 'u1') },
      { type: 'DELETE_PATIENT', patientId: 'd', ...stamp(T2, 'del') },
    ]);
    expect(currentTask(patient(s, 'd'))?.key).toBe('handover_admit');
    expect(s.events).toHaveLength(1);
    expect(t.patients).toEqual({});
  });
});
