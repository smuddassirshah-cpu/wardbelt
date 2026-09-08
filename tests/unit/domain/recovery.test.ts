import { describe, expect, it } from 'vitest';
import { clearChecks, scheduleChecks } from '../../../src/domain/recovery';
import { toMs } from '../../../src/domain/time';
import { CHECK_OFFSETS_MIN, type Task } from '../../../src/domain/types';
import { FIXED_NOW_ISO, patientRecovery, templateTasks } from '../../fixtures/synthetic';

describe('scheduleChecks', () => {
  it('sets dueAt on the four checks at +15/30/45/60 minutes and leaves the rest untouched', () => {
    const tasks = templateTasks('p');
    const out = scheduleChecks(tasks, FIXED_NOW_ISO);
    expect(out).not.toBe(tasks);
    expect(out).toHaveLength(tasks.length);
    out.forEach((t, i) => {
      const src = tasks[i];
      if (t.key in CHECK_OFFSETS_MIN && !t.custom) {
        const offset = CHECK_OFFSETS_MIN[t.key as keyof typeof CHECK_OFFSETS_MIN];
        expect(t).not.toBe(src);
        expect(t.dueAt).toBeDefined();
        expect(toMs(t.dueAt ?? '') - toMs(FIXED_NOW_ISO)).toBe(offset * 60_000);
      } else {
        expect(t).toBe(src);
      }
    });
    expect(out.filter((t) => t.dueAt !== undefined).map((t) => t.key)).toEqual([
      'check_1',
      'check_2',
      'check_3',
      'check_4',
    ]);
  });

  it('does not mutate its input and overwrites earlier due times', () => {
    const tasks = Object.freeze(patientRecovery().tasks.map((t) => Object.freeze(t)));
    const out = scheduleChecks(tasks, '2026-03-10T12:00:00.000Z');
    expect(out.find((t) => t.key === 'check_1')?.dueAt).toBe('2026-03-10T12:15:00.000Z');
    expect(tasks.find((t) => t.key === 'check_1')?.dueAt).toBe('2026-03-10T10:25:00.000Z');
  });
});

describe('clearChecks', () => {
  it('removes check due times, keeps identity of tasks without one, ignores custom timed tasks', () => {
    const scheduled = scheduleChecks(templateTasks('p'), FIXED_NOW_ISO);
    const custom: Task = {
      id: 'p:custom:1',
      key: 'custom',
      label: 'Bandage check',
      phase: 'RECOVERY',
      order: scheduled.length,
      status: 'todo',
      dueAt: FIXED_NOW_ISO,
      custom: true,
    };
    const withCustom = [...scheduled, custom];
    const cleared = clearChecks(withCustom);
    expect(cleared.every((t) => t.custom || t.dueAt === undefined)).toBe(true);
    expect(cleared.at(-1)).toBe(custom);
    cleared.forEach((t, i) => {
      if (t.key.startsWith('check_')) {
        expect('dueAt' in t).toBe(false);
      } else {
        expect(t).toBe(withCustom[i]);
      }
    });
    const again = clearChecks(cleared);
    again.forEach((t, i) => {
      expect(t).toBe(cleared[i]);
    });
  });
});
