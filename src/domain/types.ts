// Decision notes: this file is the contract between stages (PLAN.md section 6) and is owned
// by the orchestrator. Timestamps stored on records are ISO 8601 UTC strings so they survive
// JSON round-trips and clock jumps; the transient State.now is epoch milliseconds for cheap
// comparison. Ids are supplied by the caller (crypto.randomUUID in the UI, fixed strings in
// tests) so the reducer stays pure. Template task ids are `${patientId}:${key}`.

export type Iso = string;

export type Species = 'dog' | 'cat' | 'rabbit' | 'other';
export const SPECIES: readonly Species[] = ['dog', 'cat', 'rabbit', 'other'];

export type Sex = 'M' | 'MN' | 'F' | 'FN' | 'unknown';
export const SEXES: readonly Sex[] = ['M', 'MN', 'F', 'FN', 'unknown'];

export type Intake = '08:00' | '09:00' | '10:00' | 'none';
export const INTAKES: readonly Intake[] = ['08:00', '09:00', '10:00', 'none'];

export type Phase = 'PRE_OP' | 'THEATRE' | 'RECOVERY' | 'DISCHARGE_PREP' | 'DONE';
export const PHASES: readonly Phase[] = ['PRE_OP', 'THEATRE', 'RECOVERY', 'DISCHARGE_PREP', 'DONE'];

export type StepKey =
  | 'handover_admit'
  | 'bloods'
  | 'draw_meds'
  | 'premed'
  | 'to_theatre'
  | 'in_theatre'
  | 'handover_theatre'
  | 'check_1'
  | 'check_2'
  | 'check_3'
  | 'check_4'
  | 'food_water'
  | 'take_out'
  | 'pain_score'
  | 'invoice'
  | 'call_owner'
  | 'pharmacy_collect'
  | 'remove_iv'
  | 'discharge';

export type TaskKey = StepKey | 'custom';
export type TaskStatus = 'todo' | 'done' | 'skipped';
export type PatientStatus = 'active' | 'discharged';

export interface Task {
  id: string;
  key: TaskKey;
  label: string;
  phase: Phase;
  order: number;
  status: TaskStatus;
  dueAt?: Iso;
  doneAt?: Iso;
  note?: string;
  custom: boolean;
}

/** Validated output of the add-patient form (PLAN.md section 7). */
export interface PatientForm {
  name: string;
  species: Species;
  breed: string;
  sex: Sex;
  weightKg?: number;
  procedure: string;
  kennel: string;
  intake: Intake;
  ownerPhone?: string;
  notes: string;
}

export interface Patient extends PatientForm {
  id: string;
  status: PatientStatus;
  createdAt: Iso;
  theatreReturnAt?: Iso;
  dischargedAt?: Iso;
  tasks: Task[];
}

export type EventType =
  | 'PATIENT_ADDED'
  | 'TASK_COMPLETED'
  | 'TASK_SKIPPED'
  | 'TASK_ADDED'
  | 'UNDO'
  | 'THEATRE_RETURN'
  | 'DISCHARGED'
  | 'PATIENT_DELETED';

/** Append-only. UNDO events carry `undoOf`, the id of the completion or skip they reverted. */
export interface Event {
  id: string;
  at: Iso;
  type: EventType;
  patientId: string;
  taskId?: string;
  taskKey?: TaskKey;
  custom?: boolean;
  dueAt?: Iso;
  undoOf?: string;
}

export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  notifications: boolean;
  sound: boolean;
  theme: Theme;
  purgeDays: number;
  showOwnerPhone: boolean;
  lastExportAt?: Iso;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  notifications: false,
  sound: false,
  theme: 'system',
  purgeDays: 30,
  showOwnerPhone: false,
});

export interface State {
  patients: Readonly<Record<string, Patient>>;
  events: readonly Event[];
  settings: Settings;
  now: number;
}

export const TRANSFER_SCHEMA_VERSION = 1;

export interface TransferFile {
  schemaVersion: number;
  exportedAt: Iso;
  patients: Patient[];
  events: Event[];
  settings: Settings;
}

/** Every mutating action carries the wall-clock time and a fresh event id from the caller. */
export interface Stamp {
  at: Iso;
  eventId: string;
}

export type Action =
  | ({ type: 'ADD_PATIENT'; patientId: string; form: PatientForm } & Stamp)
  | ({ type: 'COMPLETE_TASK'; patientId: string; taskId: string } & Stamp)
  | ({ type: 'SKIP_TASK'; patientId: string; taskId: string } & Stamp)
  | ({ type: 'UNDO'; patientId: string } & Stamp)
  | ({
      type: 'ADD_TASK';
      patientId: string;
      taskId: string;
      label: string;
      afterTaskId?: string;
      dueAt?: Iso;
    } & Stamp)
  | ({ type: 'SET_THEATRE_RETURN'; patientId: string; returnedAt: Iso } & Stamp)
  | ({ type: 'DISCHARGE'; patientId: string } & Stamp)
  | ({ type: 'DELETE_PATIENT'; patientId: string } & Stamp)
  | { type: 'SET_NOTE'; patientId: string; taskId?: string; note: string }
  | { type: 'SET_SETTINGS'; settings: Partial<Settings> }
  | { type: 'PURGE_DISCHARGED'; at: Iso }
  | { type: 'RESET' }
  | { type: 'TICK'; now: number }
  | { type: 'DUE'; patientId: string; taskId: string; now: number }
  | { type: 'IMPORT'; data: TransferFile };

export type ActionType = Action['type'];

/** Minutes after theatre return at which each post-op check falls due. */
export const CHECK_OFFSETS_MIN: Readonly<
  Record<'check_1' | 'check_2' | 'check_3' | 'check_4', number>
> = Object.freeze({ check_1: 15, check_2: 30, check_3: 45, check_4: 60 });

/** Grace applied when deciding whether a timed task was on time (PLAN.md section 6). */
export const ON_TIME_GRACE_MS = 3 * 60_000;

/** A shift runs from 04:00 local to the next 04:00 local. */
export const SHIFT_START_HOUR = 4;

export function templateTaskId(patientId: string, key: StepKey): string {
  return `${patientId}:${key}`;
}
