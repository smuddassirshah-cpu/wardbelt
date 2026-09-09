import { describe, expect, it } from 'vitest';
import { templateTaskId } from '../../../src/domain/types';
import { createFakeClock } from '../../../src/scheduler/clock';
import { createActionFactory, dischargeIsUndoable } from '../../../src/ui/app/actions';
import { createIdSource } from '../../../src/ui/app/ids';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_CAT,
  patientDischarged,
  patientFresh,
} from '../../fixtures/synthetic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createIdSource', () => {
  it('uses crypto.randomUUID when present and stamps an ISO time from the clock', () => {
    const clock = createFakeClock(FIXED_NOW_MS);
    const ids = createIdSource(clock);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(ids.id());
    }
    expect(seen.size).toBe(1000);
    const stamp = ids.stamp();
    expect(stamp.at).toBe(FIXED_NOW_ISO);
    expect(stamp.eventId).toMatch(UUID);
    clock.set(FIXED_NOW_MS + 61_000);
    expect(ids.stamp().at).toBe('2026-03-10T10:31:01.000Z');
  });

  it('falls back to a counter joined to the clock when randomUUID is missing', () => {
    const clock = createFakeClock(FIXED_NOW_MS);
    const ids = createIdSource(clock, {});
    const a = ids.id();
    const b = ids.id();
    expect(a).not.toBe(b);
    expect(a).toBe(`${FIXED_NOW_MS.toString(36)}-1`);
    expect(b).toBe(`${FIXED_NOW_MS.toString(36)}-2`);
  });

  it('calls randomUUID on its owner so a method that needs this keeps it', () => {
    const owner = {
      prefix: 'own',
      randomUUID(this: { prefix: string }) {
        return `${this.prefix}-id`;
      },
    };
    const ids = createIdSource(createFakeClock(FIXED_NOW_MS), owner);
    expect(ids.id()).toBe('own-id');
  });
});

describe('createActionFactory', () => {
  const clock = createFakeClock(FIXED_NOW_MS);
  const factory = createActionFactory(createIdSource(clock, {}));

  it('stamps every mutating action with the time and a fresh event id', () => {
    const { action, patientId } = factory.addPatient(FORM_CAT);
    expect(action.type).toBe('ADD_PATIENT');
    expect(action).toMatchObject({ patientId, form: FORM_CAT, at: FIXED_NOW_ISO });
    const stamped = [
      action,
      factory.completeTask('p', 't'),
      factory.skipTask('p', 't'),
      factory.undo('p'),
      factory.addTask('p', { label: 'Bandage check' }),
      factory.setTheatreReturn('p', FIXED_NOW_ISO),
      factory.deletePatient('p'),
      factory.discharge(patientFresh()),
    ];
    const ids = new Set<string>();
    for (const a of stamped) {
      expect('at' in a && a.at).toBe(FIXED_NOW_ISO);
      if ('eventId' in a) {
        ids.add(a.eventId);
      }
    }
    expect(ids.size).toBe(stamped.length);
    expect(ids.has(patientId)).toBe(false);
  });

  it('omits optional fields it was not given and keeps the ones it was', () => {
    const bare = factory.addTask('p', { label: 'Bandage check' });
    expect(bare).not.toHaveProperty('afterTaskId');
    expect(bare).not.toHaveProperty('dueAt');
    const full = factory.addTask('p', { label: 'Bandage check', dueAt: FIXED_NOW_ISO }, 'after');
    expect(full).toMatchObject({
      afterTaskId: 'after',
      dueAt: FIXED_NOW_ISO,
      label: 'Bandage check',
    });
    expect(factory.setNote('p', undefined, 'n')).toEqual({
      type: 'SET_NOTE',
      patientId: 'p',
      note: 'n',
    });
    expect(factory.setNote('p', 't', 'n')).toEqual({
      type: 'SET_NOTE',
      patientId: 'p',
      taskId: 't',
      note: 'n',
    });
  });

  it('discharges through COMPLETE_TASK while the discharge task is to do, else DISCHARGE', () => {
    const fresh = patientFresh();
    expect(dischargeIsUndoable(fresh)).toBe(true);
    expect(factory.discharge(fresh)).toMatchObject({
      type: 'COMPLETE_TASK',
      patientId: 'p-fresh',
      taskId: templateTaskId('p-fresh', 'discharge'),
    });
    const done = patientDischarged();
    expect(dischargeIsUndoable(done)).toBe(false);
    expect(factory.discharge(done)).toMatchObject({ type: 'DISCHARGE', patientId: 'p-discharged' });
  });

  it('builds the unstamped settings, purge, reset and import actions', () => {
    expect(factory.setSettings({ sound: true })).toEqual({
      type: 'SET_SETTINGS',
      settings: { sound: true },
    });
    expect(factory.purgeDischarged()).toEqual({ type: 'PURGE_DISCHARGED', at: FIXED_NOW_ISO });
    expect(factory.reset()).toEqual({ type: 'RESET' });
    const data = {
      schemaVersion: 1,
      exportedAt: FIXED_NOW_ISO,
      patients: [],
      events: [],
      settings: {
        notifications: false,
        sound: false,
        theme: 'system' as const,
        purgeDays: 30,
        showOwnerPhone: false,
      },
    };
    expect(factory.importData(data)).toEqual({ type: 'IMPORT', data });
  });
});
