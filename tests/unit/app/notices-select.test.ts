import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../../src/domain/reducer';
import { templateTaskId } from '../../../src/domain/types';
import {
  corruptMessage,
  nextStorageBanner,
  STORAGE_UNAVAILABLE,
} from '../../../src/ui/app/notices';
import { boardRows, canUndo, dischargedRows } from '../../../src/ui/app/select';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_DOG,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

describe('nextStorageBanner', () => {
  it('maps unavailable to the permanent banner that recovered never clears', () => {
    const banner = nextStorageBanner(undefined, { kind: 'unavailable', reason: 'private mode' });
    expect(banner).toEqual({ kind: 'unavailable', message: STORAGE_UNAVAILABLE });
    expect(nextStorageBanner(banner, { kind: 'recovered' })).toBe(banner);
    expect(nextStorageBanner(banner, { kind: 'write_failed', reason: 'quota' })).toBe(banner);
    expect(nextStorageBanner(banner, { kind: 'corrupt', count: 2 })).toBe(banner);
  });

  it('maps write_failed to the same headline with the reason and clears it on recovered', () => {
    const banner = nextStorageBanner(undefined, {
      kind: 'write_failed',
      reason: 'QuotaExceededError',
    });
    expect(banner).toEqual({
      kind: 'write_failed',
      message: `${STORAGE_UNAVAILABLE}. QuotaExceededError`,
    });
    expect(nextStorageBanner(banner, { kind: 'write_failed', reason: 'again' })?.message).toContain(
      'again',
    );
    expect(nextStorageBanner(banner, { kind: 'recovered' })).toBeUndefined();
    expect(nextStorageBanner(undefined, { kind: 'recovered' })).toBeUndefined();
    expect(nextStorageBanner(undefined, { kind: 'corrupt', count: 1 })).toBeUndefined();
  });

  it('pluralises the corrupt count', () => {
    expect(corruptMessage(1)).toBe('1 record could not be read');
    expect(corruptMessage(3)).toBe('3 records could not be read');
  });
});

describe('select', () => {
  it('sorts active rows by urgency with the current task and the earliest due time', () => {
    const patients = [
      patientFresh(),
      patientPreOp(),
      patientRecovery(),
      patientWithCustomTask(),
      patientDischarged(),
    ];
    const state = {
      ...initialState(FIXED_NOW_MS),
      patients: Object.fromEntries(patients.map((p) => [p.id, p])),
    };
    const rows = boardRows(state);
    expect(rows.map((r) => r.patient.id)).toEqual(['p-custom', 'p-recovery', 'p-fresh', 'p-preop']);
    expect(rows.map((r) => r.urgency)).toEqual(['overdue', 'overdue', 'intake', 'intake']);
    expect(rows[1]?.currentTaskId).toBe(templateTaskId('p-recovery', 'check_1'));
    expect(rows[1]?.nextDue).toEqual({
      taskId: templateTaskId('p-recovery', 'check_1'),
      dueAt: isoPlus(FIXED_NOW_ISO, -5),
    });
    expect(rows[2]?.nextDue).toBeUndefined();
    const discharged = dischargedRows(state);
    expect(discharged).toEqual([
      { patient: patients[4], currentTaskId: undefined, urgency: 'none', nextDue: undefined },
    ]);
  });

  it('gives the timer chip a due time even when the check is far off', () => {
    const p = patientRecovery();
    const state = { ...initialState(FIXED_NOW_MS - 30 * 60_000), patients: { [p.id]: p } };
    const [row] = boardRows(state);
    expect(row?.urgency).toBe('intake');
    expect(row?.nextDue?.taskId).toBe(templateTaskId('p-recovery', 'check_1'));
  });

  it('orders discharged rows most recent first', () => {
    const a = { ...patientDischarged(), id: 'a', dischargedAt: isoPlus(FIXED_NOW_ISO, -100) };
    const b = { ...patientDischarged(), id: 'b', dischargedAt: isoPlus(FIXED_NOW_ISO, -10) };
    const c = { ...patientDischarged(), id: 'c' };
    delete c.dischargedAt;
    const state = { ...initialState(FIXED_NOW_MS), patients: { a, b, c } };
    expect(dischargedRows(state).map((r) => r.patient.id)).toEqual(['b', 'a', 'c']);
  });

  it('canUndo follows the last completion or skip that has not been undone', () => {
    const stamp = (n: number) => ({ at: isoPlus(FIXED_NOW_ISO, n), eventId: `e${n}` });
    let state = reduce(initialState(FIXED_NOW_MS), {
      type: 'ADD_PATIENT',
      patientId: 'p1',
      form: FORM_DOG,
      ...stamp(0),
    });
    expect(canUndo(state, 'p1')).toBe(false);
    state = reduce(state, {
      type: 'SKIP_TASK',
      patientId: 'p1',
      taskId: templateTaskId('p1', 'bloods'),
      ...stamp(1),
    });
    expect(canUndo(state, 'p1')).toBe(true);
    expect(canUndo(state, 'other')).toBe(false);
    state = reduce(state, { type: 'UNDO', patientId: 'p1', ...stamp(2) });
    expect(canUndo(state, 'p1')).toBe(false);
  });
});
