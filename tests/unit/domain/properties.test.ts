// Decision notes: PLAN.md section 11 stage 1 properties. Each case is seeded through the
// xorshift32 helper so a failure prints a reproducible seed. Invalid targets are deliberately
// mixed into the random action stream; the reducer must ignore them without breaking any
// invariant. Every state is deep-frozen before it reaches the reducer, so a mutation throws.
import { describe, expect, it } from 'vitest';
import { completeTask, currentTask, isBeltComplete } from '../../../src/domain/patient';
import { initialState, reduce } from '../../../src/domain/reducer';
import { toIso, toMs } from '../../../src/domain/time';
import { compareUrgency, sortByUrgency, urgencyKey } from '../../../src/domain/urgency';
import {
  CHECK_OFFSETS_MIN,
  type Action,
  type Patient,
  type PatientForm,
  type State,
  type Task,
} from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_CAT,
  FORM_DOG,
  FORM_OTHER,
  FORM_RABBIT,
  allFixturePatients,
  fixturePatient,
  patientInTheatre,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';
import { Prng, deepFreeze, run } from './helpers';

const FORMS: readonly PatientForm[] = [FORM_DOG, FORM_CAT, FORM_RABBIT, FORM_OTHER];
const KINDS = [
  'ADD_PATIENT',
  'COMPLETE_TASK',
  'SKIP_TASK',
  'ADD_TASK',
  'UNDO',
  'SET_THEATRE_RETURN',
  'DISCHARGE',
  'SET_NOTE',
  'TICK',
] as const;

function randomIso(rng: Prng): string {
  return toIso(FIXED_NOW_MS + rng.int(12 * 60 * 60_000) - 6 * 60 * 60_000);
}

function randomPatientId(rng: Prng, state: State): string {
  const ids = Object.keys(state.patients);
  return ids.length === 0 || rng.chance(0.08) ? `ghost-${rng.int(5)}` : rng.pick(ids);
}

function randomTaskId(rng: Prng, state: State, patientId: string): string {
  const p = state.patients[patientId];
  if (p === undefined || p.tasks.length === 0 || rng.chance(0.08)) {
    return `${patientId}:nope-${rng.int(5)}`;
  }
  return rng.pick(p.tasks).id;
}

function randomAction(rng: Prng, state: State, step: number): Action {
  const kind = rng.pick(KINDS);
  const at = randomIso(rng);
  const eventId = `e${step}`;
  const patientId = randomPatientId(rng, state);
  switch (kind) {
    case 'ADD_PATIENT':
      return {
        type: kind,
        patientId: rng.chance(0.1) ? patientId : `p${step}`,
        form: rng.pick(FORMS),
        at,
        eventId,
      };
    case 'COMPLETE_TASK':
    case 'SKIP_TASK':
      return { type: kind, patientId, taskId: randomTaskId(rng, state, patientId), at, eventId };
    case 'ADD_TASK': {
      const a: Action = {
        type: kind,
        patientId,
        taskId: rng.chance(0.1) ? randomTaskId(rng, state, patientId) : `${patientId}:c${step}`,
        label: `Custom ${step}`,
        at,
        eventId,
      };
      if (rng.chance(0.7)) {
        a.afterTaskId = randomTaskId(rng, state, patientId);
      }
      if (rng.chance(0.5)) {
        a.dueAt = randomIso(rng);
      }
      return a;
    }
    case 'UNDO':
    case 'DISCHARGE':
      return { type: kind, patientId, at, eventId };
    case 'SET_THEATRE_RETURN':
      return { type: kind, patientId, returnedAt: randomIso(rng), at, eventId };
    case 'SET_NOTE': {
      const a: Action = { type: kind, patientId, note: rng.chance(0.3) ? '' : `note ${step}` };
      if (rng.chance(0.6)) {
        a.taskId = randomTaskId(rng, state, patientId);
      }
      return a;
    }
    case 'TICK':
      return { type: kind, now: toMs(at) };
  }
}

function patientViolations(p: Patient): string[] {
  const out: string[] = [];
  const current = currentTask(p);
  const complete = isBeltComplete(p);
  if ((current === undefined) !== complete) {
    out.push(`${p.id}: current task and belt completion disagree`);
  }
  const unfinished = p.tasks.filter((t) => t.status === 'todo');
  if (current !== undefined) {
    if (!unfinished.every((t) => t.order >= current.order)) {
      out.push(`${p.id}: an unfinished task precedes the current task`);
    }
    if (unfinished.filter((t) => t.order === current.order).length !== 1) {
      out.push(`${p.id}: more than one current task`);
    }
  }
  p.tasks.forEach((t, i) => {
    if (t.order !== i) {
      out.push(`${p.id}: task ${t.id} has order ${t.order} at index ${i}`);
    }
    if ((t.status === 'todo') !== (t.doneAt === undefined)) {
      out.push(`${p.id}: task ${t.id} status ${t.status} disagrees with doneAt`);
    }
    if (p.theatreReturnAt !== undefined && !t.custom && Object.hasOwn(CHECK_OFFSETS_MIN, t.key)) {
      if (t.dueAt === undefined) {
        out.push(`${p.id}: check ${t.key} has no due time after theatre return`);
      }
    }
  });
  if (new Set(p.tasks.map((t) => t.id)).size !== p.tasks.length) {
    out.push(`${p.id}: duplicate task ids`);
  }
  const discharge = p.tasks.find((t) => t.key === 'discharge');
  if ((p.status === 'discharged') !== (p.dischargedAt !== undefined)) {
    out.push(`${p.id}: status ${p.status} disagrees with dischargedAt`);
  }
  if (discharge?.status === 'done' && p.status !== 'discharged') {
    out.push(`${p.id}: discharge task done but patient active`);
  }
  if (p.status === 'discharged' && discharge?.status === 'todo') {
    out.push(`${p.id}: discharged with the discharge task unfinished`);
  }
  return out;
}

function violations(state: State): string[] {
  const out = Object.values(state.patients).flatMap(patientViolations);
  if (new Set(state.events.map((e) => e.id)).size !== state.events.length) {
    out.push('duplicate event ids');
  }
  for (const e of state.events) {
    if (state.patients[e.patientId] === undefined) {
      out.push(`event ${e.id} names an unknown patient`);
    }
  }
  return out;
}

describe('property (a): random action sequences keep every invariant', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('seed %i', (seed) => {
    const rng = new Prng(seed * 7919);
    let state = deepFreeze(initialState(FIXED_NOW_MS));
    const steps = 150 + rng.int(150);
    for (let step = 0; step < steps; step += 1) {
      const action = deepFreeze(randomAction(rng, state, step));
      state = deepFreeze(reduce(state, action));
      expect(violations(state)).toEqual([]);
    }
    expect(Object.keys(state.patients).length).toBeGreaterThan(0);
    expect(state.events.length).toBeGreaterThan(steps / 4);
  });
});

function unfinishedIds(p: Patient): string[] {
  return p.tasks.filter((t) => t.status === 'todo').map((t) => t.id);
}

function snapshots(rng: Prng): State[] {
  const fixtures = [patientPreOp(), patientInTheatre(), patientRecovery(), patientWithCustomTask()];
  const base: State = {
    ...initialState(FIXED_NOW_MS),
    patients: Object.fromEntries(fixtures.map((p) => [p.id, p])),
  };
  const fresh = run(initialState(FIXED_NOW_MS), [
    { type: 'ADD_PATIENT', patientId: 'f', form: FORM_DOG, at: FIXED_NOW_ISO, eventId: 'a' },
    {
      type: 'ADD_TASK',
      patientId: 'f',
      taskId: 'f:c1',
      label: 'Custom',
      afterTaskId: 'f:premed',
      dueAt: FIXED_NOW_ISO,
      at: FIXED_NOW_ISO,
      eventId: 'b',
    },
  ]);
  let evolved = fresh;
  for (let step = 0; step < 40; step += 1) {
    const action = randomAction(rng, evolved, 1000 + step);
    if (action.type !== 'SET_THEATRE_RETURN') {
      evolved = reduce(evolved, action);
    }
  }
  return [base, fresh, evolved];
}

describe('property (b): N completions or skips then N undos restore the record byte-for-byte', () => {
  it.each([3, 11, 19, 27, 35, 43, 51, 59])('seed %i', (seed) => {
    const rng = new Prng(seed);
    for (const snapshot of snapshots(rng)) {
      for (const patientId of Object.keys(snapshot.patients)) {
        const before = JSON.stringify(snapshot.patients[patientId]);
        let state = deepFreeze(snapshot);
        let applied = 0;
        let appended = 0;
        const n = rng.int(25);
        for (let i = 0; i < n; i += 1) {
          const p = state.patients[patientId];
          if (p === undefined) {
            throw new Error('patient vanished');
          }
          const open = unfinishedIds(p);
          const taskId = open.length === 0 || rng.chance(0.1) ? 'missing' : rng.pick(open);
          const type = rng.chance(0.5) ? 'COMPLETE_TASK' : 'SKIP_TASK';
          const next = reduce(state, {
            type,
            patientId,
            taskId,
            at: randomIso(rng),
            eventId: `s${seed}-${patientId}-${i}`,
          });
          if (next !== state) {
            applied += 1;
            appended += next.events.length - state.events.length;
          }
          state = deepFreeze(next);
        }
        for (let i = 0; i < applied; i += 1) {
          state = deepFreeze(
            reduce(state, {
              type: 'UNDO',
              patientId,
              at: randomIso(rng),
              eventId: `u${seed}-${patientId}-${i}`,
            }),
          );
        }
        expect(JSON.stringify(state.patients[patientId])).toBe(before);
        expect(state.events).toHaveLength(snapshot.events.length + 2 * appended);
      }
    }
  });
});

describe('property (c): recovery checks fall due exactly +15/+30/+45/+60 minutes', () => {
  it.each([101, 202, 303, 404, 505])('seed %i', (seed) => {
    const rng = new Prng(seed);
    for (let i = 0; i < 40; i += 1) {
      const returnedMs =
        FIXED_NOW_MS + rng.int(48 * 60 * 60_000) - 24 * 60 * 60_000 + rng.int(1000);
      const returnedAt = toIso(returnedMs);
      const p = deepFreeze(rng.pick([patientInTheatre(), fixturePatient('x', FORM_CAT)]));
      const viaTask = completeTask(p, `${p.id}:in_theatre`, returnedAt);
      const viaAction = reduce(
        deepFreeze({ ...initialState(FIXED_NOW_MS), patients: { [p.id]: p } }),
        { type: 'SET_THEATRE_RETURN', patientId: p.id, returnedAt, at: returnedAt, eventId: 'r' },
      ).patients[p.id];
      for (const tasks of [viaTask.tasks, viaAction?.tasks ?? []]) {
        expect(tasks.length).toBeGreaterThan(0);
        for (const [key, minutes] of Object.entries(CHECK_OFFSETS_MIN)) {
          const t = tasks.find((x) => x.key === key);
          expect(t?.dueAt).toBeDefined();
          expect(toMs(t?.dueAt ?? '') - returnedMs).toBe(minutes * 60_000);
        }
      }
      expect(viaTask.theatreReturnAt).toBe(returnedAt);
    }
  });
});

function randomPatients(rng: Prng, n: number): Patient[] {
  const out: Patient[] = [];
  const stamps = [FIXED_NOW_ISO, toIso(FIXED_NOW_MS - 60_000), toIso(FIXED_NOW_MS + 60_000)];
  const dues = [
    toIso(FIXED_NOW_MS - 10 * 60_000),
    toIso(FIXED_NOW_MS),
    toIso(FIXED_NOW_MS + 2 * 60_000),
    toIso(FIXED_NOW_MS + 5 * 60_000),
    toIso(FIXED_NOW_MS + 30 * 60_000),
  ];
  for (let i = 0; i < n; i += 1) {
    const base = rng.pick(allFixturePatients());
    const form = rng.pick(FORMS);
    const p: Patient = {
      ...base,
      ...form,
      id: `r${i}`,
      createdAt: rng.pick(stamps),
      tasks: base.tasks.map((t): Task => {
        const next: Task = { ...t, id: `r${i}:${t.key}:${t.order}` };
        if (rng.chance(0.3)) {
          next.dueAt = rng.pick(dues);
        } else {
          delete next.dueAt;
        }
        next.status = rng.chance(0.5) ? 'todo' : 'done';
        return next;
      }),
    };
    out.push(p);
  }
  return out;
}

describe('property (d): urgency sort is stable and total', () => {
  it.each([7, 14, 21, 28, 35, 42, 49, 56])('seed %i', (seed) => {
    const rng = new Prng(seed);
    const patients = deepFreeze(randomPatients(rng, 6 + rng.int(10)));
    const now = FIXED_NOW_MS;
    const a = sortByUrgency(rng.shuffle(patients), now).map((p) => p.id);
    const b = sortByUrgency(rng.shuffle(patients), now).map((p) => p.id);
    const c = sortByUrgency(patients, now).map((p) => p.id);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(new Set(a).size).toBe(patients.length);
    const keys = patients.map((p) => urgencyKey(p, now));
    for (const x of keys) {
      for (const y of keys) {
        const xy = Math.sign(compareUrgency(x, y));
        expect(xy === 0).toBe(x === y);
        expect(Math.sign(compareUrgency(y, x)) === -xy).toBe(true);
        for (const z of keys) {
          if (xy < 0 && compareUrgency(y, z) < 0) {
            expect(compareUrgency(x, z)).toBeLessThan(0);
          }
        }
      }
    }
    for (let i = 1; i < a.length; i += 1) {
      const prev = keys.find((k) => k.id === a[i - 1]);
      const cur = keys.find((k) => k.id === a[i]);
      expect(prev !== undefined && cur !== undefined && prev.rank <= cur.rank).toBe(true);
    }
  });
});
