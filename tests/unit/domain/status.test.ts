// Decision notes: the chip rules are ordered, so every test pins the rule that should win
// rather than only the answer, and the out-of-order cases settle a later cell first.
import { describe, expect, it } from 'vitest';
import { completeTask, skipTask } from '../../../src/domain/patient';
import { wardStatus } from '../../../src/domain/status';
import { type Patient, type Task } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  patientDischarged,
  patientFresh,
  patientPreOp,
  patientRecovery,
} from '../../fixtures/synthetic';

function idOf(p: Patient, key: string): string {
  const t = p.tasks.find((x) => x.key === key);
  if (t === undefined) {
    throw new Error(`no task ${key}`);
  }
  return t.id;
}

describe('wardStatus', () => {
  it('is undefined once discharged, whatever the belt says', () => {
    expect(wardStatus(patientDischarged())).toBeUndefined();
    const active: Patient = { ...patientDischarged(), status: 'active' };
    expect(wardStatus(active)).toBe('waiting');
  });

  it('follows the belt through the normal run', () => {
    const fresh = patientFresh();
    expect(wardStatus(fresh)).toBe('waiting');
    expect(wardStatus(patientPreOp())).toBe('waiting');
    const inTheatre = completeTask(fresh, idOf(fresh, 'in_theatre'), FIXED_NOW_ISO);
    expect(wardStatus(inTheatre)).toBe('theatre');
    const handed = completeTask(inTheatre, idOf(fresh, 'handover_theatre'), FIXED_NOW_ISO);
    expect(wardStatus(handed)).toBe('recovery');
    expect(wardStatus(patientRecovery())).toBe('recovery');
  });

  it('counts a skip as settled at either step', () => {
    const fresh = patientFresh();
    const skippedTheatre = skipTask(fresh, idOf(fresh, 'in_theatre'), FIXED_NOW_ISO);
    expect(wardStatus(skippedTheatre)).toBe('theatre');
    const skippedHandover = skipTask(
      skippedTheatre,
      idOf(fresh, 'handover_theatre'),
      FIXED_NOW_ISO,
    );
    expect(wardStatus(skippedHandover)).toBe('recovery');
  });

  it('is waiting again once every recovery cell is settled', () => {
    let p = patientRecovery();
    for (const t of p.tasks.filter((x) => x.phase === 'RECOVERY' && x.status === 'todo')) {
      p = completeTask(p, t.id, FIXED_NOW_ISO);
    }
    expect(wardStatus(p)).toBe('waiting');
  });

  it('handles out-of-order completion: handover before in_theatre wins', () => {
    const fresh = patientFresh();
    const handed = completeTask(fresh, idOf(fresh, 'handover_theatre'), FIXED_NOW_ISO);
    expect(wardStatus(handed)).toBe('recovery');
    const alsoTheatre = completeTask(handed, idOf(fresh, 'in_theatre'), FIXED_NOW_ISO);
    expect(wardStatus(alsoTheatre)).toBe('recovery');
  });

  it('counts a custom task by its phase', () => {
    const p = patientRecovery();
    const settled: Patient = {
      ...p,
      tasks: p.tasks.map((t) => (t.status === 'todo' ? { ...t, status: 'done' as const } : t)),
    };
    expect(wardStatus(settled)).toBe('waiting');
    const custom: Task = {
      id: 'c1',
      key: 'custom',
      label: 'Bandage check',
      phase: 'RECOVERY',
      order: settled.tasks.length,
      status: 'todo',
      custom: true,
    };
    expect(wardStatus({ ...settled, tasks: [...settled.tasks, custom] })).toBe('recovery');
    const preOp: Task = { ...custom, phase: 'PRE_OP' };
    expect(wardStatus({ ...settled, tasks: [...settled.tasks, preOp] })).toBe('waiting');
  });

  it('is waiting for a belt with no theatre cells at all', () => {
    const p = patientFresh();
    const stripped: Patient = {
      ...p,
      tasks: p.tasks.filter((t) => t.key !== 'in_theatre' && t.key !== 'handover_theatre'),
    };
    expect(wardStatus(stripped)).toBe('waiting');
    expect(wardStatus({ ...p, tasks: [] })).toBe('waiting');
  });
});
