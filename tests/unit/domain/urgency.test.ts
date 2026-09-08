import { describe, expect, it } from 'vitest';
import {
  DUE_SOON_MS,
  compareUrgency,
  nextDue,
  overdueTasks,
  sortByUrgency,
  urgencyKey,
  urgencyOf,
} from '../../../src/domain/urgency';
import { toIso } from '../../../src/domain/time';
import { type Patient, type Task } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_DOG,
  FORM_OTHER,
  fixturePatient,
  isoPlus,
  patientFresh,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

function timed(
  p: Patient,
  key: string,
  dueAt: string | undefined,
  status: Task['status'] = 'todo',
) {
  return {
    ...p,
    tasks: p.tasks.map((t) => {
      if (t.key !== key) {
        return t;
      }
      const next: Task = { ...t, status };
      if (dueAt !== undefined) {
        next.dueAt = dueAt;
      }
      return next;
    }),
  };
}

describe('nextDue and overdueTasks', () => {
  it('finds the earliest unfinished due time, ignoring done tasks and unparseable dates', () => {
    const p = patientRecovery();
    expect(nextDue(p)).toEqual({ taskId: 'p-recovery:check_1', dueAt: isoPlus(FIXED_NOW_ISO, -5) });
    const c1Done = timed(p, 'check_1', undefined, 'done');
    expect(nextDue(c1Done)?.taskId).toBe('p-recovery:check_2');
    expect(nextDue(patientFresh())).toBeUndefined();
    const garbage = timed(p, 'handover_theatre', 'never');
    expect(nextDue(garbage)?.taskId).toBe('p-recovery:check_1');
    const earlyCustom = timed(patientWithCustomTask(), 'custom', isoPlus(FIXED_NOW_ISO, -30));
    expect(nextDue(earlyCustom)?.taskId).toBe('p-custom:custom:1');
  });

  it('lists overdue unfinished tasks in belt order, inclusive of the exact due time', () => {
    const p = patientRecovery();
    expect(overdueTasks(p, FIXED_NOW_MS).map((t) => t.key)).toEqual(['check_1']);
    expect(overdueTasks(p, FIXED_NOW_MS + 10 * 60_000).map((t) => t.key)).toEqual([
      'check_1',
      'check_2',
    ]);
    expect(overdueTasks(p, FIXED_NOW_MS - 5 * 60_000 - 1)).toEqual([]);
    expect(overdueTasks(patientFresh(), FIXED_NOW_MS)).toEqual([]);
  });
});

describe('urgencyOf', () => {
  it('ranks overdue, due soon, intake tagged and plain patients', () => {
    const p = patientRecovery();
    expect(urgencyOf(p, FIXED_NOW_MS)).toEqual({
      rank: 0,
      taskId: 'p-recovery:check_1',
      dueAt: isoPlus(FIXED_NOW_ISO, -5),
    });
    const soon = timed(p, 'check_1', undefined, 'done');
    expect(urgencyOf(soon, FIXED_NOW_MS)).toEqual({ rank: 2 });
    expect(urgencyOf(soon, FIXED_NOW_MS + 6 * 60_000)).toEqual({
      rank: 1,
      taskId: 'p-recovery:check_2',
      dueAt: isoPlus(FIXED_NOW_ISO, 10),
    });
    expect(urgencyOf(patientFresh(), FIXED_NOW_MS)).toEqual({ rank: 2 });
    expect(urgencyOf(fixturePatient('x', FORM_OTHER), FIXED_NOW_MS)).toEqual({ rank: 3 });
    const farOff = timed(fixturePatient('y', FORM_OTHER), 'bloods', isoPlus(FIXED_NOW_ISO, 120));
    expect(urgencyOf(farOff, FIXED_NOW_MS)).toEqual({ rank: 3 });
  });

  it('is overdue at exactly the due time and due soon at exactly DUE_SOON_MS', () => {
    const base = fixturePatient('z', FORM_OTHER);
    const atDue = timed(base, 'bloods', FIXED_NOW_ISO);
    expect(urgencyOf(atDue, FIXED_NOW_MS).rank).toBe(0);
    expect(urgencyOf(atDue, FIXED_NOW_MS - 1).rank).toBe(1);
    const edge = timed(base, 'bloods', toIso(FIXED_NOW_MS + DUE_SOON_MS));
    expect(urgencyOf(edge, FIXED_NOW_MS).rank).toBe(1);
    expect(urgencyOf(edge, FIXED_NOW_MS - 1).rank).toBe(3);
  });
});

describe('sortByUrgency', () => {
  it('orders rank, then due time, then intake, then created, then id, without mutating input', () => {
    const now = FIXED_NOW_MS;
    const mk = (id: string, form = FORM_OTHER, createdAt = FIXED_NOW_ISO) =>
      fixturePatient(id, form, createdAt);
    const overdueLate = timed(mk('a'), 'bloods', isoPlus(FIXED_NOW_ISO, -1));
    const overdueEarly = timed(mk('b'), 'bloods', isoPlus(FIXED_NOW_ISO, -30));
    const soon = timed(mk('c'), 'bloods', isoPlus(FIXED_NOW_ISO, 2));
    const intake10 = mk('d', { ...FORM_OTHER, intake: '10:00' });
    const intake08 = mk('e', { ...FORM_DOG, intake: '08:00' }, isoPlus(FIXED_NOW_ISO, -10));
    const intake08Older = mk('f', { ...FORM_DOG, intake: '08:00' }, isoPlus(FIXED_NOW_ISO, -20));
    const plainNewer = mk('g', FORM_OTHER, isoPlus(FIXED_NOW_ISO, 5));
    const plainTwinA = mk('h');
    const plainTwinB = mk('i');
    const input = Object.freeze([
      plainTwinB,
      plainNewer,
      intake10,
      overdueLate,
      plainTwinA,
      soon,
      intake08,
      overdueEarly,
      intake08Older,
    ]);
    const out = sortByUrgency(input, now);
    expect(out.map((p) => p.id)).toEqual(['b', 'a', 'c', 'f', 'e', 'd', 'h', 'i', 'g']);
    expect(input.map((p) => p.id)).toEqual(['i', 'g', 'd', 'a', 'h', 'c', 'e', 'b', 'f']);
    expect(out).not.toBe(input);
  });

  it('compares keys as a strict total order', () => {
    const now = FIXED_NOW_MS;
    const a = urgencyKey(fixturePatient('a', FORM_OTHER), now);
    const b = urgencyKey(fixturePatient('b', FORM_OTHER), now);
    expect(compareUrgency(a, b)).toBeLessThan(0);
    expect(compareUrgency(b, a)).toBeGreaterThan(0);
    expect(compareUrgency(a, a)).toBe(0);
    expect(a).toEqual({ id: 'a', rank: 3, dueAt: '', intake: 'none', createdAt: FIXED_NOW_ISO });
    const overdue = urgencyKey(
      timed(fixturePatient('o', FORM_OTHER), 'bloods', FIXED_NOW_ISO),
      now,
    );
    expect(overdue.dueAt).toBe(FIXED_NOW_ISO);
    expect(compareUrgency(overdue, a)).toBeLessThan(0);
    expect(sortByUrgency([], now)).toEqual([]);
  });
});
