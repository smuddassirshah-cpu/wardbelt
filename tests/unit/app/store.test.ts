import { describe, expect, it, vi } from 'vitest';
import { createFakeClock } from '../../../src/scheduler/clock';
import type { Repo } from '../../../src/store/repo';
import { createStore } from '../../../src/ui/app/store';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FIXTURE_SETTINGS,
  FORM_DOG,
  fixtureEvents,
  isoPlus,
  patientFresh,
  patientRecovery,
} from '../../fixtures/synthetic';
import { fakeRepo, flushMicrotasks } from './helpers';

const add = (n = 0) => ({
  type: 'ADD_PATIENT' as const,
  patientId: `p${n}`,
  form: FORM_DOG,
  at: isoPlus(FIXED_NOW_ISO, n),
  eventId: `e${n}`,
});

describe('createStore', () => {
  it('starts empty at the clock time and hydrates from a load result without writing', () => {
    const repo = fakeRepo();
    const store = createStore({ repo, clock: createFakeClock(FIXED_NOW_MS), onError: vi.fn() });
    expect(store.state.value).toEqual({
      patients: {},
      events: [],
      settings: expect.objectContaining({ theme: 'system' }) as unknown,
      now: FIXED_NOW_MS,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const patients = [patientFresh(), patientRecovery()];
    store.hydrate({ patients, events: fixtureEvents(), settings: FIXTURE_SETTINGS });
    expect(Object.keys(store.state.value.patients)).toEqual(['p-fresh', 'p-recovery']);
    expect(store.state.value.patients['p-recovery']).toBe(patients[1]);
    expect(store.state.value.events).toHaveLength(4);
    expect(store.state.value.settings).toBe(FIXTURE_SETTINGS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repo.calls).toEqual([]);
  });

  it('reduces, moves now to the action time and persists the diff in order', async () => {
    const repo = fakeRepo();
    const clock = createFakeClock(FIXED_NOW_MS);
    const store = createStore({ repo, clock, onError: vi.fn() });
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(add(5));
    expect(store.state.value.now).toBe(FIXED_NOW_MS + 5 * 60_000);
    expect(Object.keys(store.state.value.patients)).toEqual(['p5']);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'TICK', now: FIXED_NOW_MS + 9 * 60_000 });
    expect(store.state.value.now).toBe(FIXED_NOW_MS + 9 * 60_000);
    clock.set(FIXED_NOW_MS + 10 * 60_000);
    store.dispatch({ type: 'SET_SETTINGS', settings: { sound: true } });
    expect(store.state.value.now).toBe(FIXED_NOW_MS + 10 * 60_000);
    await store.flush();
    expect(repo.calls).toEqual([
      { op: 'savePatient', id: 'p5' },
      { op: 'appendEvent', id: 'e5', type: 'PATIENT_ADDED' },
      { op: 'saveSettings' },
    ]);
  });

  it('ignores a no-op action whose time has not moved and skips writes when only now changed', async () => {
    const repo = fakeRepo();
    const store = createStore({ repo, clock: createFakeClock(FIXED_NOW_MS), onError: vi.fn() });
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.state.value;
    store.dispatch({ type: 'TICK', now: FIXED_NOW_MS });
    expect(store.state.value).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({
      type: 'UNDO',
      patientId: 'missing',
      at: isoPlus(FIXED_NOW_ISO, 1),
      eventId: 'x',
    });
    expect(store.state.value).not.toBe(before);
    expect(store.state.value.patients).toBe(before.patients);
    await store.flush();
    expect(repo.calls).toEqual([]);
  });

  it('keeps writes in dispatch order across actions', async () => {
    const repo = fakeRepo();
    const store = createStore({ repo, clock: createFakeClock(FIXED_NOW_MS), onError: vi.fn() });
    store.dispatch(add(1));
    store.dispatch(add(2));
    store.dispatch({ type: 'DELETE_PATIENT', patientId: 'p1', at: FIXED_NOW_ISO, eventId: 'd' });
    store.dispatch({ type: 'RESET' });
    await store.flush();
    expect(repo.calls.map((c) => c.op)).toEqual([
      'savePatient',
      'appendEvent',
      'savePatient',
      'appendEvent',
      'deletePatient',
      'clearAll',
    ]);
  });

  it('waits for a repo promise before the first write', async () => {
    const repo = fakeRepo();
    let resolveRepo: (r: Repo) => void = () => undefined;
    const pending = new Promise<Repo>((resolve) => {
      resolveRepo = resolve;
    });
    const store = createStore({
      repo: pending,
      clock: createFakeClock(FIXED_NOW_MS),
      onError: vi.fn(),
    });
    store.dispatch(add(1));
    await flushMicrotasks();
    expect(repo.calls).toEqual([]);
    resolveRepo(repo);
    await store.flush();
    expect(repo.calls.map((c) => c.op)).toEqual(['savePatient', 'appendEvent']);
  });

  it('reports a rejected write through onError and carries on with the next action', async () => {
    const repo = fakeRepo();
    const onError = vi.fn();
    const store = createStore({ repo, clock: createFakeClock(FIXED_NOW_MS), onError });
    repo.failNext(new DOMException('quota', 'QuotaExceededError'));
    store.dispatch(add(1));
    store.dispatch(add(2));
    await store.flush();
    expect(onError).toHaveBeenCalledWith('Not saving: QuotaExceededError: quota');
    expect(repo.calls.map((c) => ('id' in c ? c.id : c.op))).toEqual(['p1', 'p2', 'e2']);
  });

  it('ignores an unparseable action timestamp when choosing now', () => {
    const repo = fakeRepo();
    const store = createStore({ repo, clock: createFakeClock(FIXED_NOW_MS), onError: vi.fn() });
    const before = store.state.value;
    store.dispatch({ ...add(1), at: 'not a date' });
    expect(store.state.value).toBe(before);
  });
});
