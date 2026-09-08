// Decision notes: definitions are binding per PLAN.md section 6. A shift runs 04:00 local to
// the next 04:00 local, built with local Date constructors so DST days come out right on the
// phone's own zone. Stats come from events inside the shift; an event named by any UNDO's
// undoOf is nullified and UNDO events themselves are never counted. Two linear passes over
// events (collect undone ids, then tally) keep it O(n). The streak counts consecutive on-time
// timed completions in event order; untimed events in between do not break it. The median is
// over minutes as a fraction, unrounded; the summary screen formats it.
import { MINUTE_MS, toMs } from './time';
import { ON_TIME_GRACE_MS, SHIFT_START_HOUR, type Iso, type State } from './types';

export interface ShiftBounds {
  startMs: number;
  endMs: number;
}

export interface ShiftStats {
  tasksCompleted: number;
  tasksSkipped: number;
  checksOnTimePct: number | null;
  bestStreak: number;
  patientsAdmitted: number;
  patientsDischarged: number;
  medianAdmitToDischargeMin: number | null;
}

export function shiftBounds(nowMs: number): ShiftBounds {
  const now = new Date(nowMs);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const todayStartMs = new Date(y, m, d, SHIFT_START_HOUR).getTime();
  const start = new Date(y, m, nowMs < todayStartMs ? d - 1 : d, SHIFT_START_HOUR);
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 1,
    SHIFT_START_HOUR,
  );
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function medianOf(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n === 0) {
    return null;
  }
  const mid = Math.floor(n / 2);
  const middle = n % 2 === 1 ? sorted.slice(mid, mid + 1) : sorted.slice(mid - 1, mid + 1);
  return middle.reduce((sum, v) => sum + v, 0) / middle.length;
}

export function shiftStats(state: State, nowMs: number): ShiftStats {
  const { startMs, endMs } = shiftBounds(nowMs);
  const inShift = (iso: Iso): boolean => {
    const ms = toMs(iso);
    return ms >= startMs && ms < endMs;
  };

  const undone = new Set<string>();
  for (const e of state.events) {
    if (e.undoOf !== undefined) {
      undone.add(e.undoOf);
    }
  }

  let tasksCompleted = 0;
  let tasksSkipped = 0;
  let timed = 0;
  let onTime = 0;
  let streak = 0;
  let bestStreak = 0;
  let patientsAdmitted = 0;
  let patientsDischarged = 0;
  for (const e of state.events) {
    if (undone.has(e.id) || !inShift(e.at)) {
      continue;
    }
    switch (e.type) {
      case 'PATIENT_ADDED':
        patientsAdmitted += 1;
        break;
      case 'DISCHARGED':
        patientsDischarged += 1;
        break;
      case 'TASK_SKIPPED':
        tasksSkipped += 1;
        break;
      case 'TASK_COMPLETED':
        tasksCompleted += 1;
        if (e.dueAt !== undefined) {
          timed += 1;
          if (toMs(e.at) <= toMs(e.dueAt) + ON_TIME_GRACE_MS) {
            onTime += 1;
            streak += 1;
            bestStreak = Math.max(bestStreak, streak);
          } else {
            streak = 0;
          }
        }
        break;
      case 'TASK_ADDED':
      case 'THEATRE_RETURN':
      case 'UNDO':
      case 'PATIENT_DELETED':
        break;
    }
  }

  // O(k log k) sort over the k patients discharged this shift (about a dozen), for the median.
  const durations: number[] = [];
  for (const p of Object.values(state.patients)) {
    if (p.dischargedAt !== undefined && inShift(p.dischargedAt)) {
      durations.push((toMs(p.dischargedAt) - toMs(p.createdAt)) / MINUTE_MS);
    }
  }
  durations.sort((a, b) => a - b);

  return {
    tasksCompleted,
    tasksSkipped,
    checksOnTimePct: timed === 0 ? null : Math.round((100 * onTime) / timed),
    bestStreak,
    patientsAdmitted,
    patientsDischarged,
    medianAdmitToDischargeMin: medianOf(durations),
  };
}
