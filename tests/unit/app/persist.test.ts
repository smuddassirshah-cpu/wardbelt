import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../../src/domain/reducer';
import { templateTaskId, type Action, type State } from '../../../src/domain/types';
import { hasPersistableChange, persistDiff } from '../../../src/ui/app/persist';
import { FIXED_NOW_ISO, FIXED_NOW_MS, FORM_DOG, FORM_CAT, isoPlus } from '../../fixtures/synthetic';
import { fakeRepo, type RepoCall } from './helpers';

const stamp = (n: number) => ({ at: isoPlus(FIXED_NOW_ISO, n), eventId: `e${n}` });

async function run(prev: State, action: Action): Promise<{ next: State; calls: RepoCall[] }> {
  const repo = fakeRepo();
  const next = reduce(prev, action);
  await persistDiff(repo, prev, next, action.type === 'RESET');
  return { next, calls: repo.calls };
}

function withPatient(): State {
  return reduce(initialState(FIXED_NOW_MS), {
    type: 'ADD_PATIENT',
    patientId: 'p1',
    form: FORM_DOG,
    ...stamp(0),
  });
}

describe('persistDiff', () => {
  it('ADD_PATIENT saves the patient then appends the event', async () => {
    const { calls } = await run(initialState(FIXED_NOW_MS), {
      type: 'ADD_PATIENT',
      patientId: 'p1',
      form: FORM_DOG,
      ...stamp(0),
    });
    expect(calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e0', type: 'PATIENT_ADDED' },
    ]);
  });

  it('COMPLETE_TASK and SKIP_TASK save the patient and one event each', async () => {
    const state = withPatient();
    const done = await run(state, {
      type: 'COMPLETE_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'bloods'),
      ...stamp(1),
    });
    expect(done.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e1', type: 'TASK_COMPLETED' },
    ]);
    const skipped = await run(done.next, {
      type: 'SKIP_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'premed'),
      ...stamp(2),
    });
    expect(skipped.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e2', type: 'TASK_SKIPPED' },
    ]);
  });

  it('completing discharge appends both the completion and the derived DISCHARGED event', async () => {
    const { calls, next } = await run(withPatient(), {
      type: 'COMPLETE_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'discharge'),
      ...stamp(1),
    });
    expect(calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e1', type: 'TASK_COMPLETED' },
      { op: 'appendEvent', id: 'e1:1', type: 'DISCHARGED' },
    ]);
    const undone = await run(next, { type: 'UNDO', patientId: 'p1', ...stamp(2) });
    expect(undone.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e2', type: 'UNDO' },
      { op: 'appendEvent', id: 'e2:1', type: 'UNDO' },
    ]);
  });

  it('ADD_TASK, SET_THEATRE_RETURN and DISCHARGE each save the patient and one event', async () => {
    const state = withPatient();
    const added = await run(state, {
      type: 'ADD_TASK',
      patientId: 'p1',
      taskId: 't-custom',
      label: 'Bandage check',
      ...stamp(1),
    });
    expect(added.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e1', type: 'TASK_ADDED' },
    ]);
    const returned = await run(added.next, {
      type: 'SET_THEATRE_RETURN',
      patientId: 'p1',
      returnedAt: isoPlus(FIXED_NOW_ISO, -5),
      ...stamp(2),
    });
    expect(returned.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e2', type: 'THEATRE_RETURN' },
    ]);
    const skippedDischarge = reduce(returned.next, {
      type: 'SKIP_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'discharge'),
      ...stamp(3),
    });
    const discharged = await run(skippedDischarge, {
      type: 'DISCHARGE',
      patientId: 'p1',
      ...stamp(4),
    });
    expect(discharged.calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'appendEvent', id: 'e4', type: 'DISCHARGED' },
    ]);
  });

  it('DELETE_PATIENT deletes the patient only; its events go with it in the repo', async () => {
    const state = reduce(withPatient(), {
      type: 'COMPLETE_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'bloods'),
      ...stamp(1),
    });
    const { calls, next } = await run(state, {
      type: 'DELETE_PATIENT',
      patientId: 'p1',
      ...stamp(2),
    });
    expect(calls).toEqual([{ op: 'deletePatient', id: 'p1' }]);
    expect(next.events).toEqual([]);
  });

  it('SET_NOTE saves the patient without an event; SET_SETTINGS saves settings only', async () => {
    const note = await run(withPatient(), {
      type: 'SET_NOTE',
      patientId: 'p1',
      note: 'Quiet',
    });
    expect(note.calls).toEqual([{ op: 'savePatient', id: 'p1' }]);
    const settings = await run(withPatient(), {
      type: 'SET_SETTINGS',
      settings: { theme: 'dark' },
    });
    expect(settings.calls).toEqual([{ op: 'saveSettings' }]);
  });

  it('PURGE_DISCHARGED deletes each stale patient and RESET clears everything', async () => {
    let state = withPatient();
    state = reduce(state, {
      type: 'ADD_PATIENT',
      patientId: 'p2',
      form: FORM_CAT,
      ...stamp(1),
    });
    state = reduce(state, {
      type: 'COMPLETE_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'discharge'),
      at: isoPlus(FIXED_NOW_ISO, -60 * 24 * 40),
      eventId: 'old',
    });
    const purged = await run(state, { type: 'PURGE_DISCHARGED', at: FIXED_NOW_ISO });
    expect(purged.calls).toEqual([{ op: 'deletePatient', id: 'p1' }]);
    expect(Object.keys(purged.next.patients)).toEqual(['p2']);
    const reset = await run(state, { type: 'RESET' });
    expect(reset.calls).toEqual([{ op: 'clearAll' }]);
  });

  it('TICK and DUE change nothing persistable', async () => {
    const state = withPatient();
    const tick = await run(state, { type: 'TICK', now: FIXED_NOW_MS + 1000 });
    expect(tick.calls).toEqual([]);
    expect(hasPersistableChange(state, tick.next)).toBe(false);
    const due = await run(state, {
      type: 'DUE',
      patientId: 'p1',
      taskId: 'x',
      now: FIXED_NOW_MS + 2000,
    });
    expect(due.calls).toEqual([]);
  });

  it('IMPORT saves every imported patient, appends only new events, then saves settings', async () => {
    const state = reduce(withPatient(), {
      type: 'COMPLETE_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'bloods'),
      ...stamp(1),
    });
    const other = withPatient();
    const otherPatient = other.patients.p1;
    if (otherPatient === undefined) {
      throw new Error('fixture');
    }
    const { calls } = await run(state, {
      type: 'IMPORT',
      data: {
        schemaVersion: 1,
        exportedAt: FIXED_NOW_ISO,
        patients: [{ ...otherPatient, id: 'p9' }, otherPatient],
        events: [
          ...state.events,
          { id: 'fresh', at: FIXED_NOW_ISO, type: 'PATIENT_ADDED', patientId: 'p9' },
        ],
        settings: { ...state.settings, sound: true },
      },
    });
    expect(calls).toEqual([
      { op: 'savePatient', id: 'p1' },
      { op: 'savePatient', id: 'p9' },
      { op: 'appendEvent', id: 'fresh', type: 'PATIENT_ADDED' },
      { op: 'saveSettings' },
    ]);
  });

  it('is a no-op for identical states', async () => {
    const state = withPatient();
    const repo = fakeRepo();
    await persistDiff(repo, state, state);
    expect(repo.calls).toEqual([]);
  });
});
