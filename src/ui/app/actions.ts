// Decision notes: builds stamped Action objects; nothing here dispatches. The discharge button
// goes through COMPLETE_TASK on the patient's discharge task while that task is still to do
// (undoable, counted in stats) and falls back to DISCHARGE only when the task was skipped
// (STATE.md stage 1 verifier note). Patient and custom task ids come from the same IdSource as
// event ids.
import type { CustomTaskInput } from '@domain/validate';
import type { Action, Iso, Patient, PatientForm, Settings, TransferFile } from '@domain/types';
import type { IdSource } from './ids';

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;

export interface ActionFactory {
  addPatient(form: PatientForm): { action: Action; patientId: string };
  completeTask(patientId: string, taskId: string): Action;
  skipTask(patientId: string, taskId: string): Action;
  undo(patientId: string): Action;
  addTask(patientId: string, input: CustomTaskInput, afterTaskId?: string): Action;
  setTheatreReturn(patientId: string, returnedAt: Iso): Action;
  discharge(patient: Patient): Action;
  deletePatient(patientId: string): Action;
  setNote(patientId: string, taskId: string | undefined, note: string): Action;
  setSettings(settings: Partial<Settings>): Action;
  purgeDischarged(): Action;
  reset(): Action;
  importData(data: TransferFile): Action;
}

/** The discharge action is undoable exactly when it completes the discharge task. */
export function dischargeIsUndoable(patient: Patient): boolean {
  return patient.tasks.some((t) => t.key === 'discharge' && t.status === 'todo');
}

export function createActionFactory(ids: IdSource): ActionFactory {
  return {
    addPatient: (form) => {
      const patientId = ids.id();
      return { action: { type: 'ADD_PATIENT', patientId, form, ...ids.stamp() }, patientId };
    },
    completeTask: (patientId, taskId) => ({
      type: 'COMPLETE_TASK',
      patientId,
      taskId,
      ...ids.stamp(),
    }),
    skipTask: (patientId, taskId) => ({ type: 'SKIP_TASK', patientId, taskId, ...ids.stamp() }),
    undo: (patientId) => ({ type: 'UNDO', patientId, ...ids.stamp() }),
    addTask: (patientId, input, afterTaskId) => {
      const action: ActionOf<'ADD_TASK'> = {
        type: 'ADD_TASK',
        patientId,
        taskId: ids.id(),
        label: input.label,
        ...ids.stamp(),
      };
      if (afterTaskId !== undefined) {
        action.afterTaskId = afterTaskId;
      }
      if (input.dueAt !== undefined) {
        action.dueAt = input.dueAt;
      }
      return action;
    },
    setTheatreReturn: (patientId, returnedAt) => ({
      type: 'SET_THEATRE_RETURN',
      patientId,
      returnedAt,
      ...ids.stamp(),
    }),
    discharge: (patient) => {
      const task = patient.tasks.find((t) => t.key === 'discharge');
      if (task?.status === 'todo') {
        return { type: 'COMPLETE_TASK', patientId: patient.id, taskId: task.id, ...ids.stamp() };
      }
      return { type: 'DISCHARGE', patientId: patient.id, ...ids.stamp() };
    },
    deletePatient: (patientId) => ({ type: 'DELETE_PATIENT', patientId, ...ids.stamp() }),
    setNote: (patientId, taskId, note) => {
      const action: ActionOf<'SET_NOTE'> = { type: 'SET_NOTE', patientId, note };
      if (taskId !== undefined) {
        action.taskId = taskId;
      }
      return action;
    },
    setSettings: (settings) => ({ type: 'SET_SETTINGS', settings }),
    purgeDischarged: () => ({ type: 'PURGE_DISCHARGED', at: ids.stamp().at }),
    reset: () => ({ type: 'RESET' }),
    importData: (data) => ({ type: 'IMPORT', data }),
  };
}
