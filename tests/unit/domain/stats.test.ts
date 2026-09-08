import { describe, expect, it } from 'vitest';
import { initialState } from '../../../src/domain/reducer';
import { shiftBounds, shiftStats } from '../../../src/domain/stats';
import { toIso } from '../../../src/domain/time';
import { ON_TIME_GRACE_MS, type Event, type Patient, type State } from '../../../src/domain/types';
import { FIXED_NOW_MS, FORM_DOG, fixturePatient } from '../../fixtures/synthetic';

const EMPTY = {
  tasksCompleted: 0,
  tasksSkipped: 0,
  checksOnTimePct: null,
  bestStreak: 0,
  patientsAdmitted: 0,
  patientsDischarged: 0,
  medianAdmitToDischargeMin: null,
};

describe('shiftBounds', () => {
  it('runs 04:00 local to the next 04:00 local, with the boundary at 04:00:00 exactly', () => {
    const start9 = new Date(2026, 2, 9, 4).getTime();
    const start10 = new Date(2026, 2, 10, 4).getTime();
    const start11 = new Date(2026, 2, 11, 4).getTime();
    expect(shiftBounds(new Date(2026, 2, 10, 3, 59, 59).getTime())).toEqual({
      startMs: start9,
      endMs: start10,
    });
    expect(shiftBounds(new Date(2026, 2, 10, 4, 0, 0).getTime())).toEqual({
      startMs: start10,
      endMs: start11,
    });
    expect(shiftBounds(new Date(2026, 2, 10, 23, 30).getTime())).toEqual({
      startMs: start10,
      endMs: start11,
    });
    expect(shiftBounds(new Date(2026, 2, 11, 0, 0, 0, 1).getTime())).toEqual({
      startMs: start10,
      endMs: start11,
    });
  });

  it('crosses month and year boundaries', () => {
    expect(shiftBounds(new Date(2027, 0, 1, 1).getTime())).toEqual({
      startMs: new Date(2026, 11, 31, 4).getTime(),
      endMs: new Date(2027, 0, 1, 4).getTime(),
    });
  });
});

/** Event `at` values are placed relative to the shift start so tests hold in any time zone. */
function shiftClock(nowMs: number) {
  const { startMs, endMs } = shiftBounds(nowMs);
  return {
    startMs,
    endMs,
    at: (offsetMin: number) => toIso(startMs + offsetMin * 60_000),
    atMs: (offsetMin: number) => startMs + offsetMin * 60_000,
  };
}

function state(patients: Patient[], events: Event[]): State {
  return {
    ...initialState(FIXED_NOW_MS),
    patients: Object.fromEntries(patients.map((p) => [p.id, p])),
    events,
  };
}

function completed(id: string, at: string, dueAt?: string): Event {
  const e: Event = {
    id,
    at,
    type: 'TASK_COMPLETED',
    patientId: 'p',
    taskId: `p:${id}`,
    taskKey: 'check_1',
    custom: false,
  };
  if (dueAt !== undefined) {
    e.dueAt = dueAt;
  }
  return e;
}

describe('shiftStats', () => {
  const now = FIXED_NOW_MS;
  const clock = shiftClock(now);

  it('is all zero and null on an empty state', () => {
    expect(shiftStats(initialState(now), now)).toEqual(EMPTY);
  });

  it('counts completions, skips, admissions and discharges inside the shift only', () => {
    const events: Event[] = [
      { id: 'a1', at: clock.at(-1), type: 'PATIENT_ADDED', patientId: 'old' },
      { id: 'a2', at: clock.at(0), type: 'PATIENT_ADDED', patientId: 'p' },
      completed('c1', clock.at(60)),
      completed('c2', clock.at(61)),
      { id: 's1', at: clock.at(62), type: 'TASK_SKIPPED', patientId: 'p', taskId: 'p:x' },
      { id: 't1', at: clock.at(63), type: 'THEATRE_RETURN', patientId: 'p' },
      { id: 'n1', at: clock.at(64), type: 'TASK_ADDED', patientId: 'p', taskId: 'p:c' },
      { id: 'x1', at: clock.at(65), type: 'PATIENT_DELETED', patientId: 'q' },
      { id: 'd1', at: clock.at(66), type: 'DISCHARGED', patientId: 'p' },
      { id: 'd2', at: toIso(clock.endMs), type: 'DISCHARGED', patientId: 'p' },
      completed('c3', toIso(clock.endMs - 1)),
    ];
    expect(shiftStats(state([], events), now)).toEqual({
      ...EMPTY,
      tasksCompleted: 3,
      tasksSkipped: 1,
      patientsAdmitted: 1,
      patientsDischarged: 1,
    });
  });

  it('excludes undone events and never counts UNDO itself', () => {
    const events: Event[] = [
      completed('c1', clock.at(10)),
      completed('c2', clock.at(11)),
      { id: 'u1', at: clock.at(12), type: 'UNDO', patientId: 'p', undoOf: 'c2' },
      { id: 's1', at: clock.at(13), type: 'TASK_SKIPPED', patientId: 'p', taskId: 'p:x' },
      { id: 'u2', at: toIso(clock.endMs + 60_000), type: 'UNDO', patientId: 'p', undoOf: 's1' },
      { id: 'd1', at: clock.at(14), type: 'DISCHARGED', patientId: 'p' },
      { id: 'u3', at: clock.at(15), type: 'UNDO', patientId: 'p', undoOf: 'd1' },
    ];
    expect(shiftStats(state([], events), now)).toEqual({ ...EMPTY, tasksCompleted: 1 });
  });

  it('applies the three minute grace at exactly +3:00 on time and +3:00.001 late', () => {
    const due = clock.at(30);
    const dueMs = clock.atMs(30);
    const onTime = completed('c1', toIso(dueMs + ON_TIME_GRACE_MS), due);
    const late = completed('c2', toIso(dueMs + ON_TIME_GRACE_MS + 1), due);
    expect(shiftStats(state([], [onTime]), now)).toMatchObject({
      checksOnTimePct: 100,
      bestStreak: 1,
    });
    expect(shiftStats(state([], [late]), now)).toMatchObject({
      checksOnTimePct: 0,
      bestStreak: 0,
    });
    expect(ON_TIME_GRACE_MS).toBe(180_000);
  });

  it('rounds the percentage and tracks the best streak across mixed events', () => {
    const due = clock.at(30);
    const early = clock.at(20);
    const late = clock.at(40);
    const events: Event[] = [
      completed('c1', early, due),
      completed('u1', clock.at(21)),
      { id: 's1', at: clock.at(22), type: 'TASK_SKIPPED', patientId: 'p', taskId: 'p:x' },
      completed('c2', early, due),
      completed('c3', late, due),
      completed('c4', early, due),
      completed('c5', early, due),
      completed('c6', early, due),
      completed('u2', clock.at(23)),
      completed('c7', late, due),
    ];
    expect(shiftStats(state([], events), now)).toMatchObject({
      tasksCompleted: 9,
      tasksSkipped: 1,
      checksOnTimePct: 71,
      bestStreak: 3,
    });
    const streakBrokenByUndo: Event[] = [
      completed('c1', early, due),
      completed('c2', early, due),
      { id: 'x', at: clock.at(50), type: 'UNDO', patientId: 'p', undoOf: 'c2' },
      completed('c3', late, due),
      completed('c4', early, due),
    ];
    expect(shiftStats(state([], streakBrokenByUndo), now)).toMatchObject({
      checksOnTimePct: 67,
      bestStreak: 1,
    });
  });

  it('takes the median admit-to-discharge time over patients discharged this shift', () => {
    const mk = (id: string, createdMin: number, dischargedMin?: number): Patient => {
      const p = fixturePatient(id, FORM_DOG, clock.at(createdMin));
      if (dischargedMin === undefined) {
        return p;
      }
      return { ...p, status: 'discharged', dischargedAt: clock.at(dischargedMin) };
    };
    const odd = [mk('a', 0, 100), mk('b', 0, 30), mk('c', 0, 300), mk('d', 0), mk('e', 0, -5)];
    expect(shiftStats(state(odd, []), now).medianAdmitToDischargeMin).toBe(100);
    const even = [mk('a', 0, 100), mk('b', 10, 30), mk('c', 0, 300), mk('d', 60, 90)];
    expect(shiftStats(state(even, []), now).medianAdmitToDischargeMin).toBe(65);
    const one = [mk('a', -120, 15.5)];
    expect(shiftStats(state(one, []), now).medianAdmitToDischargeMin).toBe(135.5);
    const outside = [mk('a', -200, -100), mk('b', 0, 24 * 60)];
    expect(shiftStats(state(outside, []), now).medianAdmitToDischargeMin).toBeNull();
  });
});
