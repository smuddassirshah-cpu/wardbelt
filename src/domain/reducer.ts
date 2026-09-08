// Decision notes: pure (state, action) -> state. Unknown patient or task, an invalid
// transition, or an action carrying an unparseable timestamp returns the same state reference
// so callers can skip persistence by identity. Event ids come from the action; when one action
// yields more than one event the extras are `${eventId}:1`, `${eventId}:2`. Completing the
// discharge task yields TASK_COMPLETED plus a derived DISCHARGED; undoing it nullifies both
// with two UNDO events so stats stay consistent. DELETE_PATIENT drops the patient's events and
// appends nothing; PATIENT_DELETED stays unused in this version. The switch is exhaustive at
// compile time and a malformed action at run time (an old persisted queue, say) is ignored.
import {
  addCustomTask,
  completeTask,
  createPatient,
  dischargePatient,
  revertTask,
  setNote,
  skipTask,
} from './patient';
import { scheduleChecks } from './recovery';
import { DAY_MS, toMs } from './time';
import {
  DEFAULT_SETTINGS,
  type Action,
  type Event,
  type EventType,
  type Iso,
  type Patient,
  type State,
  type Task,
  type TransferFile,
} from './types';

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;

export function initialState(nowMs: number): State {
  return { patients: {}, events: [], settings: { ...DEFAULT_SETTINGS }, now: nowMs };
}

export function activePatients(state: State): Patient[] {
  return Object.values(state.patients).filter((p) => p.status === 'active');
}

export function dischargedPatients(state: State): Patient[] {
  return Object.values(state.patients).filter((p) => p.status === 'discharged');
}

function baseEvent(id: string, at: Iso, type: EventType, patientId: string): Event {
  return { id, at, type, patientId };
}

function taskEvent(id: string, at: Iso, type: EventType, patientId: string, task: Task): Event {
  const e: Event = {
    ...baseEvent(id, at, type, patientId),
    taskId: task.id,
    taskKey: task.key,
    custom: task.custom,
  };
  if (task.dueAt !== undefined) {
    e.dueAt = task.dueAt;
  }
  return e;
}

function withPatient(state: State, p: Patient, events: readonly Event[]): State {
  return {
    ...state,
    patients: { ...state.patients, [p.id]: p },
    events: events.length === 0 ? state.events : [...state.events, ...events],
  };
}

function removePatients(state: State, ids: ReadonlySet<string>): State {
  return {
    ...state,
    patients: Object.fromEntries(Object.entries(state.patients).filter(([id]) => !ids.has(id))),
    events: state.events.filter((e) => !ids.has(e.patientId)),
  };
}

function validIso(iso: Iso | undefined): boolean {
  return iso === undefined || Number.isFinite(toMs(iso));
}

function timestampsValid(action: Action): boolean {
  if ('at' in action && !validIso(action.at)) {
    return false;
  }
  if (action.type === 'SET_THEATRE_RETURN') {
    return validIso(action.returnedAt);
  }
  return action.type !== 'ADD_TASK' || validIso(action.dueAt);
}

function addPatient(state: State, action: ActionOf<'ADD_PATIENT'>): State {
  if (state.patients[action.patientId] !== undefined) {
    return state;
  }
  const p = createPatient(action.patientId, action.form, action.at);
  return withPatient(state, p, [baseEvent(action.eventId, action.at, 'PATIENT_ADDED', p.id)]);
}

function settleTask(state: State, action: ActionOf<'COMPLETE_TASK' | 'SKIP_TASK'>): State {
  const p = state.patients[action.patientId];
  const task = p?.tasks.find((t) => t.id === action.taskId);
  if (p === undefined || task === undefined) {
    return state;
  }
  const done = action.type === 'COMPLETE_TASK';
  const next = done ? completeTask(p, task.id, action.at) : skipTask(p, task.id, action.at);
  if (next === p) {
    return state;
  }
  const type: EventType = done ? 'TASK_COMPLETED' : 'TASK_SKIPPED';
  const events = [taskEvent(action.eventId, action.at, type, p.id, task)];
  if (done && task.key === 'discharge') {
    events.push(baseEvent(`${action.eventId}:1`, action.at, 'DISCHARGED', p.id));
  }
  return withPatient(state, next, events);
}

function undo(state: State, action: ActionOf<'UNDO'>): State {
  const p = state.patients[action.patientId];
  if (p === undefined) {
    return state;
  }
  const undone = new Set<string>();
  for (const e of state.events) {
    if (e.undoOf !== undefined) {
      undone.add(e.undoOf);
    }
  }
  let target: Event | undefined;
  for (const e of state.events) {
    const revertible = e.type === 'TASK_COMPLETED' || e.type === 'TASK_SKIPPED';
    if (revertible && e.patientId === p.id && !undone.has(e.id)) {
      target = e;
    }
  }
  if (target?.taskId === undefined) {
    return state;
  }
  const events: Event[] = [
    { ...baseEvent(action.eventId, action.at, 'UNDO', p.id), undoOf: target.id },
  ];
  const companionId = `${target.id}:1`;
  const companion = state.events.find((e) => e.id === companionId && e.type === 'DISCHARGED');
  if (companion !== undefined) {
    events.push({
      ...baseEvent(`${action.eventId}:1`, action.at, 'UNDO', p.id),
      undoOf: companion.id,
    });
  }
  return withPatient(state, revertTask(p, target.taskId), events);
}

function addTask(state: State, action: ActionOf<'ADD_TASK'>): State {
  const p = state.patients[action.patientId];
  if (p === undefined) {
    return state;
  }
  const next = addCustomTask(p, action);
  if (next === p) {
    return state;
  }
  const e: Event = {
    ...baseEvent(action.eventId, action.at, 'TASK_ADDED', p.id),
    taskId: action.taskId,
    taskKey: 'custom',
    custom: true,
  };
  if (action.dueAt !== undefined) {
    e.dueAt = action.dueAt;
  }
  return withPatient(state, next, [e]);
}

function setTheatreReturn(state: State, action: ActionOf<'SET_THEATRE_RETURN'>): State {
  const p = state.patients[action.patientId];
  if (p === undefined || p.status === 'discharged') {
    return state;
  }
  const next: Patient = {
    ...p,
    theatreReturnAt: action.returnedAt,
    tasks: scheduleChecks(p.tasks, action.returnedAt),
  };
  return withPatient(state, next, [baseEvent(action.eventId, action.at, 'THEATRE_RETURN', p.id)]);
}

function discharge(state: State, action: ActionOf<'DISCHARGE'>): State {
  const p = state.patients[action.patientId];
  if (p === undefined) {
    return state;
  }
  const next = dischargePatient(p, action.at);
  if (next === p) {
    return state;
  }
  return withPatient(state, next, [baseEvent(action.eventId, action.at, 'DISCHARGED', p.id)]);
}

function deletePatient(state: State, action: ActionOf<'DELETE_PATIENT'>): State {
  if (state.patients[action.patientId] === undefined) {
    return state;
  }
  return removePatients(state, new Set([action.patientId]));
}

function setNoteOn(state: State, action: ActionOf<'SET_NOTE'>): State {
  const p = state.patients[action.patientId];
  if (p === undefined) {
    return state;
  }
  const next = setNote(p, action.taskId, action.note);
  return next === p ? state : withPatient(state, next, []);
}

function purgeDischarged(state: State, action: ActionOf<'PURGE_DISCHARGED'>): State {
  const cutoffMs = toMs(action.at) - state.settings.purgeDays * DAY_MS;
  const stale = new Set<string>();
  for (const p of Object.values(state.patients)) {
    if (
      p.status === 'discharged' &&
      p.dischargedAt !== undefined &&
      toMs(p.dischargedAt) < cutoffMs
    ) {
      stale.add(p.id);
    }
  }
  return stale.size === 0 ? state : removePatients(state, stale);
}

function tick(state: State, now: number): State {
  return now === state.now ? state : { ...state, now };
}

function importData(state: State, data: TransferFile): State {
  const patients: Record<string, Patient> = { ...state.patients };
  for (const p of data.patients) {
    patients[p.id] = p;
  }
  const known = new Set(state.events.map((e) => e.id));
  const added: Event[] = [];
  for (const e of data.events) {
    if (!known.has(e.id)) {
      known.add(e.id);
      added.push(e);
    }
  }
  return {
    ...state,
    patients,
    events: added.length === 0 ? state.events : [...state.events, ...added],
    settings: { ...data.settings },
  };
}

function ignoreUnknown(_action: never, state: State): State {
  return state;
}

export function reduce(state: State, action: Action): State {
  if (!timestampsValid(action)) {
    return state;
  }
  switch (action.type) {
    case 'ADD_PATIENT':
      return addPatient(state, action);
    case 'COMPLETE_TASK':
    case 'SKIP_TASK':
      return settleTask(state, action);
    case 'UNDO':
      return undo(state, action);
    case 'ADD_TASK':
      return addTask(state, action);
    case 'SET_THEATRE_RETURN':
      return setTheatreReturn(state, action);
    case 'DISCHARGE':
      return discharge(state, action);
    case 'DELETE_PATIENT':
      return deletePatient(state, action);
    case 'SET_NOTE':
      return setNoteOn(state, action);
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'PURGE_DISCHARGED':
      return purgeDischarged(state, action);
    case 'RESET':
      return initialState(state.now);
    case 'TICK':
    case 'DUE':
      return tick(state, action.now);
    case 'IMPORT':
      return importData(state, action.data);
    default:
      return ignoreUnknown(action, state);
  }
}
