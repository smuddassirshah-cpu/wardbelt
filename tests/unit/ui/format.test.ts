import { describe, expect, it } from 'vitest';
import {
  cellClass,
  cellState,
  classes,
  formatClock,
  formatCountdown,
  formatMinutes,
  formatPercent,
  isOverdue,
  progressOf,
  taskCode,
  toDatetimeLocal,
} from '../../../src/ui/format';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  isoPlus,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

describe('format helpers', () => {
  it('codes template and custom tasks', () => {
    const p = patientWithCustomTask();
    const custom = p.tasks.find((t) => t.custom);
    expect(custom).toBeDefined();
    expect(taskCode({ key: 'check_1', label: 'x' })).toBe('C1');
    expect(taskCode({ key: 'custom', label: 'Bandage check' })).toBe('BA');
  });

  it('derives cell state and overdue from the task and the clock', () => {
    const p = patientRecovery();
    const check1 = p.tasks.find((t) => t.key === 'check_1');
    const check2 = p.tasks.find((t) => t.key === 'check_2');
    const done = p.tasks.find((t) => t.key === 'bloods');
    if (check1 === undefined || check2 === undefined || done === undefined) {
      throw new Error('fixture');
    }
    expect(cellState(check1, check1.id)).toBe('current');
    expect(cellState(check1, undefined)).toBe('todo');
    expect(cellState(done, done.id)).toBe('done');
    expect(isOverdue(check1, FIXED_NOW_MS)).toBe(true);
    expect(isOverdue(check2, FIXED_NOW_MS)).toBe(false);
    expect(isOverdue(done, FIXED_NOW_MS)).toBe(false);
    expect(cellClass('current', true)).toBe(
      'belt__square belt__square--current belt__square--overdue',
    );
    expect(cellClass('todo', false)).toBe('belt__square belt__square--todo');
  });

  it('formats countdowns as mm:ss with minutes past 59', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(252_000)).toBe('04:12');
    expect(formatCountdown(-190_000)).toBe('03:10');
    expect(formatCountdown(125 * 60_000)).toBe('125:00');
    expect(formatCountdown(999)).toBe('00:00');
  });

  it('formats local clock time and datetime-local values', () => {
    const d = new Date(FIXED_NOW_ISO);
    expect(formatClock(FIXED_NOW_ISO)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    const local = toDatetimeLocal(FIXED_NOW_ISO);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(local).toISOString()).toBe(FIXED_NOW_ISO);
  });

  it('formats minutes and percentages', () => {
    expect(formatMinutes(42)).toBe('42 min');
    expect(formatMinutes(185)).toBe('3 h 5 min');
    expect(formatMinutes(60)).toBe('1 h 0 min');
    expect(formatPercent(87.5)).toBe('88%');
  });

  it('counts done plus skipped over total', () => {
    const p = patientRecovery();
    expect(progressOf(p.tasks)).toEqual({ done: 7, total: 19, complete: false });
    expect(progressOf([])).toEqual({ done: 0, total: 0, complete: false });
    const all = p.tasks.map((t) => ({ ...t, status: 'skipped' as const }));
    expect(progressOf(all).complete).toBe(true);
  });

  it('joins class names and drops falsy ones', () => {
    expect(classes('a', false, undefined, '', 'b')).toBe('a b');
    expect(isoPlus(FIXED_NOW_ISO, 1)).toBe('2026-03-10T10:31:00.000Z');
  });
});
