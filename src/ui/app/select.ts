// Decision notes: read-only queries the views need that the domain does not export. Board rows
// come from sortByUrgency over the active patients (O(n log n)); the urgency rank maps onto the
// PatientRow prop and the timer chip reads the earliest outstanding due time whatever the rank,
// so a check fifteen minutes away still shows "C1 in 15:00". canUndo mirrors the reducer's
// UNDO target search (last completion or skip for the patient not already undone) in one pass
// over the events. Discharged rows are listed most recently discharged first.
import { currentTask } from '@domain/patient';
import { activePatients, dischargedPatients } from '@domain/reducer';
import { nextDue, sortByUrgency, urgencyOf, type UrgencyRank } from '@domain/urgency';
import type { Patient, State } from '@domain/types';
import type { NextDue, Urgency } from '../PatientRow';

export interface BoardRow {
  patient: Patient;
  currentTaskId: string | undefined;
  urgency: Urgency;
  nextDue: NextDue | undefined;
}

const URGENCY_BY_RANK: Readonly<Record<UrgencyRank, Urgency>> = {
  0: 'overdue',
  1: 'due_soon',
  2: 'intake',
  3: 'none',
};

export function boardRows(state: State): BoardRow[] {
  return sortByUrgency(activePatients(state), state.now).map((patient) => ({
    patient,
    currentTaskId: currentTask(patient)?.id,
    urgency: URGENCY_BY_RANK[urgencyOf(patient, state.now).rank],
    nextDue: nextDue(patient),
  }));
}

export function dischargedRows(state: State): BoardRow[] {
  return dischargedPatients(state)
    .sort((a, b) => (b.dischargedAt ?? '').localeCompare(a.dischargedAt ?? ''))
    .map((patient) => ({ patient, currentTaskId: undefined, urgency: 'none', nextDue: undefined }));
}

export function canUndo(state: State, patientId: string): boolean {
  const undone = new Set<string>();
  let target: string | undefined;
  for (const e of state.events) {
    if (e.undoOf !== undefined) {
      undone.add(e.undoOf);
    }
  }
  for (const e of state.events) {
    const revertible = e.type === 'TASK_COMPLETED' || e.type === 'TASK_SKIPPED';
    if (revertible && e.patientId === patientId && !undone.has(e.id)) {
      target = e.id;
    }
  }
  return target !== undefined;
}
