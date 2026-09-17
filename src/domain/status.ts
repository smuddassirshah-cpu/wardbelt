// Decision notes: the at-a-glance ward chip (CHANGES-2026-09.md section 3). The rules are
// evaluated in the order given there, so a single pass over the tasks gathers the three facts
// they need and the decision is made afterwards; that keeps it O(n) with no sorting. Custom
// tasks count by their phase, which is why the recovery test is on phase rather than key.
import { type Patient } from './types';

export type WardStatus = 'waiting' | 'theatre' | 'recovery';

/** Undefined once discharged. Settled means done or skipped. Follows the furthest-along cell. */
export function wardStatus(p: Patient): WardStatus | undefined {
  if (p.status === 'discharged') {
    return undefined;
  }
  let handoverSettled = false;
  let theatreSettled = false;
  let recoveryTodo = false;
  for (const t of p.tasks) {
    const settled = t.status !== 'todo';
    if (t.key === 'handover_theatre') {
      handoverSettled = settled;
    } else if (t.key === 'in_theatre') {
      theatreSettled = settled;
    }
    if (!settled && t.phase === 'RECOVERY') {
      recoveryTodo = true;
    }
  }
  if (handoverSettled) {
    return recoveryTodo ? 'recovery' : 'waiting';
  }
  return theatreSettled ? 'theatre' : 'waiting';
}
