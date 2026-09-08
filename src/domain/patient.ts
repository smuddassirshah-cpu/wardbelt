// Decision notes: every function returns the same reference when the action is a no-op and a
// fresh object otherwise; nothing is mutated. Property order is kept stable (spread then
// overwrite, delete for removal) so an undo restores a record byte-for-byte. Tasks are found
// by id with a linear scan; a patient holds at most a few dozen tasks. Reverting a completed
// in_theatre undoes its side effects (theatre return and check due times); reverting a
// skipped one does not, because a skip never set them.
import { clearChecks, scheduleChecks } from './recovery';
import { TEMPLATE } from './template';
import { templateTaskId, type Iso, type Patient, type PatientForm, type Task } from './types';

export interface CustomTaskSpec {
  taskId: string;
  label: string;
  afterTaskId?: string | undefined;
  dueAt?: Iso | undefined;
}

export function createPatient(id: string, form: PatientForm, createdAt: Iso): Patient {
  const tasks = TEMPLATE.map((step, order): Task => ({
    id: templateTaskId(id, step.key),
    key: step.key,
    label: step.label,
    phase: step.phase,
    order,
    status: 'todo',
    custom: false,
  }));
  return { ...form, id, status: 'active', createdAt, tasks };
}

/** The first unfinished task by order, or undefined when the belt is complete. */
export function currentTask(p: Patient): Task | undefined {
  let current: Task | undefined;
  for (const t of p.tasks) {
    if (t.status === 'todo' && (current === undefined || t.order < current.order)) {
      current = t;
    }
  }
  return current;
}

export function isBeltComplete(p: Patient): boolean {
  return !p.tasks.some((t) => t.status === 'todo');
}

function findTask(p: Patient, taskId: string): Task | undefined {
  return p.tasks.find((t) => t.id === taskId);
}

function replaceTask(tasks: readonly Task[], next: Task): Task[] {
  return tasks.map((t) => (t.id === next.id ? next : t));
}

function settle(p: Patient, taskId: string, status: 'done' | 'skipped', at: Iso): Patient {
  const task = findTask(p, taskId);
  if (task?.status !== 'todo') {
    return p;
  }
  const tasks = replaceTask(p.tasks, { ...task, status, doneAt: at });
  if (status === 'done' && task.key === 'in_theatre') {
    return { ...p, tasks: scheduleChecks(tasks, at), theatreReturnAt: at };
  }
  if (status === 'done' && task.key === 'discharge') {
    return { ...p, tasks, status: 'discharged', dischargedAt: at };
  }
  return { ...p, tasks };
}

export function completeTask(p: Patient, taskId: string, at: Iso): Patient {
  return settle(p, taskId, 'done', at);
}

export function skipTask(p: Patient, taskId: string, at: Iso): Patient {
  return settle(p, taskId, 'skipped', at);
}

/** Inserts a custom task after `afterTaskId` (or last) and renumbers orders 0..n-1. */
export function addCustomTask(p: Patient, spec: CustomTaskSpec): Patient {
  if (findTask(p, spec.taskId) !== undefined) {
    return p;
  }
  const afterIdx =
    spec.afterTaskId === undefined ? -1 : p.tasks.findIndex((t) => t.id === spec.afterTaskId);
  const at = afterIdx < 0 ? p.tasks.length : afterIdx + 1;
  const previous = p.tasks[at - 1];
  const task: Task = {
    id: spec.taskId,
    key: 'custom',
    label: spec.label,
    phase: previous === undefined ? 'PRE_OP' : previous.phase,
    order: at,
    status: 'todo',
    custom: true,
  };
  if (spec.dueAt !== undefined) {
    task.dueAt = spec.dueAt;
  }
  const tasks = [...p.tasks.slice(0, at), task, ...p.tasks.slice(at)].map((t, order) =>
    t.order === order ? t : { ...t, order },
  );
  return { ...p, tasks };
}

/** Task note when `taskId` is given (empty note deletes it), otherwise the patient notes. */
export function setNote(p: Patient, taskId: string | undefined, note: string): Patient {
  if (taskId === undefined) {
    return p.notes === note ? p : { ...p, notes: note };
  }
  const task = findTask(p, taskId);
  if (task === undefined) {
    return p;
  }
  if (note === '') {
    if (task.note === undefined) {
      return p;
    }
    const cleared = { ...task };
    delete cleared.note;
    return { ...p, tasks: replaceTask(p.tasks, cleared) };
  }
  return task.note === note ? p : { ...p, tasks: replaceTask(p.tasks, { ...task, note }) };
}

export function dischargePatient(p: Patient, at: Iso): Patient {
  if (p.status === 'discharged') {
    return p;
  }
  const discharge = p.tasks.find((t) => t.key === 'discharge');
  if (discharge?.status === 'todo') {
    return completeTask(p, discharge.id, at);
  }
  return { ...p, status: 'discharged', dischargedAt: at };
}

/** Puts a done or skipped task back to unfinished, undoing the effects of its completion. */
export function revertTask(p: Patient, taskId: string): Patient {
  const task = findTask(p, taskId);
  if (task === undefined || task.status === 'todo') {
    return p;
  }
  const reverted: Task = { ...task, status: 'todo' };
  delete reverted.doneAt;
  const tasks = replaceTask(p.tasks, reverted);
  if (task.status === 'done' && task.key === 'in_theatre') {
    const next = { ...p, tasks: clearChecks(tasks) };
    delete next.theatreReturnAt;
    return next;
  }
  if (task.key === 'discharge') {
    const next: Patient = { ...p, tasks, status: 'active' };
    delete next.dischargedAt;
    return next;
  }
  return { ...p, tasks };
}
