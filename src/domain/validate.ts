// Decision notes: the single place PLAN.md section 7 rules live. The add-patient sheet, the
// custom-task form and the import path all call these; nothing else validates. Inputs are
// `unknown` and outputs are typed records with unknown fields dropped. Field readers record an
// error and return a fallback; a result is only built when nothing failed. Weight is normalised
// to two decimal places rather than rejected. ISO timestamps are normalised to UTC `Z` form so
// stored values compare lexicographically.
import { TEMPLATE_BY_KEY } from './template';
import {
  DEFAULT_SETTINGS,
  INTAKES,
  PHASES,
  SEXES,
  SPECIES,
  TRANSFER_SCHEMA_VERSION,
  type Event,
  type EventType,
  type Iso,
  type Patient,
  type PatientForm,
  type PatientStatus,
  type Settings,
  type Task,
  type TaskKey,
  type TaskStatus,
  type Theme,
  type TransferFile,
} from './types';

export type FieldErrors = Readonly<Record<string, string>>;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const IMPORT_SIZE_CAP_BYTES = 10 * 1024 * 1024;
export const CUSTOM_DUE_PAST_MS = 24 * 3_600_000;
export const CUSTOM_DUE_AHEAD_MS = 48 * 3_600_000;
const MAX_TASKS_PER_PATIENT = 200;
const ID_MAX = 120;

const EVENT_TYPES = [
  'PATIENT_ADDED',
  'TASK_COMPLETED',
  'TASK_SKIPPED',
  'TASK_ADDED',
  'UNDO',
  'THEATRE_RETURN',
  'DISCHARGED',
  'PATIENT_DELETED',
] as const satisfies readonly EventType[];
const TASK_STATUSES = ['todo', 'done', 'skipped'] as const satisfies readonly TaskStatus[];
const PATIENT_STATUSES = ['active', 'discharged'] as const satisfies readonly PatientStatus[];
const THEMES = ['light', 'dark', 'system'] as const satisfies readonly Theme[];
const PHONE_RE = /^[0-9+ ]+$/;

type Obj = Record<string, unknown>;

function isObj(u: unknown): u is Obj {
  return typeof u === 'object' && u !== null && !Array.isArray(u);
}

function isAbsent(u: unknown): boolean {
  return u === undefined || u === null || u === '';
}

/** Normalised ISO string, or undefined when the input is not a parseable ISO 8601 date. */
export function parseIso(u: unknown): Iso | undefined {
  if (typeof u !== 'string' || u.length < 10 || u.length > 40) {
    return undefined;
  }
  const ms = Date.parse(u);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function isTaskKey(u: unknown): u is TaskKey {
  return u === 'custom' || (typeof u === 'string' && u in TEMPLATE_BY_KEY);
}

/** Collects field errors; readers return a fallback after recording one. */
class Fields {
  readonly errors: Record<string, string> = {};

  constructor(private readonly o: Obj) {}

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  fail(field: string, message: string): void {
    this.errors[field] = message;
  }

  str(field: string, min: number, max: number): string {
    const raw = this.o[field];
    if (raw === undefined || raw === null) {
      if (min > 0) {
        this.fail(field, 'Required');
      }
      return '';
    }
    if (typeof raw !== 'string') {
      this.fail(field, 'Must be text');
      return '';
    }
    const s = raw.trim();
    if (s.length < min) {
      this.fail(field, 'Required');
    } else if (s.length > max) {
      this.fail(field, `At most ${max} characters`);
    }
    return s;
  }

  optStr(field: string, max: number): string | undefined {
    return this.o[field] === undefined ? undefined : this.str(field, 0, max);
  }

  choice<T extends string>(field: string, allowed: readonly [T, ...T[]], message: string): T {
    const raw = this.o[field];
    if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) {
      return raw as T;
    }
    this.fail(field, message);
    return allowed[0];
  }

  iso(field: string): Iso {
    const iso = parseIso(this.o[field]);
    if (iso === undefined) {
      this.fail(field, 'Must be an ISO 8601 date');
      return '';
    }
    return iso;
  }

  optIso(field: string): Iso | undefined {
    return isAbsent(this.o[field]) ? undefined : this.iso(field);
  }

  bool(field: string): boolean {
    const raw = this.o[field];
    if (typeof raw === 'boolean') {
      return raw;
    }
    this.fail(field, 'Must be true or false');
    return false;
  }

  optBool(field: string): boolean | undefined {
    return this.o[field] === undefined ? undefined : this.bool(field);
  }

  id(field: string): string {
    const raw = this.o[field];
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= ID_MAX) {
      return raw;
    }
    this.fail(field, 'Invalid id');
    return '';
  }

  optId(field: string): string | undefined {
    return this.o[field] === undefined ? undefined : this.id(field);
  }

  int(field: string, min: number, max: number, message: string): number {
    const raw = this.o[field];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max) {
      return raw;
    }
    this.fail(field, message);
    return min;
  }

  weightKg(): number | undefined {
    const raw = this.o.weightKg;
    if (isAbsent(raw)) {
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(n)) {
      this.fail('weightKg', 'Must be a number');
      return undefined;
    }
    const rounded = Math.round(n * 100) / 100;
    if (rounded < 0.05 || rounded > 150) {
      this.fail('weightKg', 'Between 0.05 and 150 kg');
      return undefined;
    }
    return rounded;
  }

  ownerPhone(): string | undefined {
    const raw = this.o.ownerPhone;
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.fail('ownerPhone', 'Must be text');
      return undefined;
    }
    const s = raw.trim();
    if (s === '') {
      return undefined;
    }
    if (s.length < 6 || s.length > 20) {
      this.fail('ownerPhone', 'Between 6 and 20 characters');
    } else if (!PHONE_RE.test(s)) {
      this.fail('ownerPhone', 'Digits, spaces and + only');
    }
    return s;
  }

  taskKey(field: string): TaskKey {
    const raw = this.o[field];
    if (isTaskKey(raw)) {
      return raw;
    }
    this.fail(field, 'Unknown task key');
    return 'custom';
  }
}

function readForm(f: Fields): PatientForm {
  const form: PatientForm = {
    name: f.str('name', 1, 40),
    species: f.choice('species', SPECIES, 'Choose a species'),
    breed: f.str('breed', 0, 40),
    sex: f.choice('sex', SEXES, 'Choose a sex'),
    procedure: f.str('procedure', 1, 80),
    kennel: f.str('kennel', 0, 10),
    intake: f.choice('intake', INTAKES, 'Choose an intake slot'),
    notes: f.str('notes', 0, 500),
  };
  const weightKg = f.weightKg();
  if (weightKg !== undefined) {
    form.weightKg = weightKg;
  }
  const ownerPhone = f.ownerPhone();
  if (ownerPhone !== undefined) {
    form.ownerPhone = ownerPhone;
  }
  return form;
}

/** Add-patient form boundary (PLAN.md section 7). */
export function validatePatientForm(input: unknown): Result<PatientForm> {
  if (!isObj(input)) {
    return { ok: false, errors: { form: 'Invalid form' } };
  }
  const f = new Fields(input);
  const form = readForm(f);
  return f.failed ? { ok: false, errors: f.errors } : { ok: true, value: form };
}

export interface CustomTaskInput {
  label: string;
  dueAt?: Iso;
}

/** Add-custom-task form boundary. `nowMs` anchors the 24 h past / 48 h ahead window. */
export function validateCustomTask(input: unknown, nowMs: number): Result<CustomTaskInput> {
  if (!isObj(input)) {
    return { ok: false, errors: { form: 'Invalid form' } };
  }
  const f = new Fields(input);
  const label = f.str('label', 1, 60);
  const dueAt = f.optIso('dueAt');
  if (dueAt !== undefined) {
    const ms = Date.parse(dueAt);
    if (ms < nowMs - CUSTOM_DUE_PAST_MS) {
      f.fail('dueAt', 'More than 24 hours in the past');
    } else if (ms > nowMs + CUSTOM_DUE_AHEAD_MS) {
      f.fail('dueAt', 'More than 48 hours ahead');
    }
  }
  if (f.failed) {
    return { ok: false, errors: f.errors };
  }
  return { ok: true, value: dueAt === undefined ? { label } : { label, dueAt } };
}

function readTask(input: unknown): Result<Task> {
  if (!isObj(input)) {
    return { ok: false, errors: { record: 'Not an object' } };
  }
  const f = new Fields(input);
  const key = f.taskKey('key');
  const custom = f.bool('custom');
  if (!f.failed && (key === 'custom') !== custom) {
    f.fail('custom', 'Custom flag does not match key');
  }
  const t: Task = {
    id: f.id('id'),
    key,
    label: f.str('label', 1, 60),
    phase: f.choice('phase', PHASES, 'Unknown phase'),
    order: f.int('order', 0, 10_000, 'Must be a non-negative integer'),
    status: f.choice('status', TASK_STATUSES, 'Unknown status'),
    custom,
  };
  const dueAt = f.optIso('dueAt');
  if (dueAt !== undefined) {
    t.dueAt = dueAt;
  }
  const doneAt = f.optIso('doneAt');
  if (doneAt !== undefined) {
    t.doneAt = doneAt;
  }
  const note = f.optStr('note', 500);
  if (note !== undefined && note !== '') {
    t.note = note;
  }
  return f.failed ? { ok: false, errors: f.errors } : { ok: true, value: t };
}

function readTasks(f: Fields, raw: unknown): Task[] {
  if (!Array.isArray(raw) || raw.length > MAX_TASKS_PER_PATIENT) {
    f.fail('tasks', `Must be a list of at most ${MAX_TASKS_PER_PATIENT} tasks`);
    return [];
  }
  const ids = new Set<string>();
  const tasks: Task[] = [];
  (raw as unknown[]).forEach((item, i) => {
    const r = readTask(item);
    if (!r.ok) {
      f.fail(`tasks.${i}`, Object.values(r.errors).join('; '));
    } else if (ids.has(r.value.id)) {
      f.fail(`tasks.${i}`, 'Duplicate task id');
    } else {
      ids.add(r.value.id);
      tasks.push(r.value);
    }
  });
  return tasks;
}

/** Stored patient record: the form rules plus the record fields, field by field. */
export function validatePatientRecord(input: unknown): Result<Patient> {
  if (!isObj(input)) {
    return { ok: false, errors: { record: 'Not an object' } };
  }
  const f = new Fields(input);
  const p: Patient = {
    ...readForm(f),
    id: f.id('id'),
    status: f.choice('status', PATIENT_STATUSES, 'Unknown status'),
    createdAt: f.iso('createdAt'),
    tasks: readTasks(f, input.tasks),
  };
  const theatreReturnAt = f.optIso('theatreReturnAt');
  if (theatreReturnAt !== undefined) {
    p.theatreReturnAt = theatreReturnAt;
  }
  const dischargedAt = f.optIso('dischargedAt');
  if (dischargedAt !== undefined) {
    p.dischargedAt = dischargedAt;
  }
  return f.failed ? { ok: false, errors: f.errors } : { ok: true, value: p };
}

export function validateEvent(input: unknown): Result<Event> {
  if (!isObj(input)) {
    return { ok: false, errors: { record: 'Not an object' } };
  }
  const f = new Fields(input);
  const e: Event = {
    id: f.id('id'),
    at: f.iso('at'),
    type: f.choice('type', EVENT_TYPES, 'Unknown event type'),
    patientId: f.id('patientId'),
  };
  const taskId = f.optId('taskId');
  if (taskId !== undefined) {
    e.taskId = taskId;
  }
  if (input.taskKey !== undefined) {
    e.taskKey = f.taskKey('taskKey');
  }
  const custom = f.optBool('custom');
  if (custom !== undefined) {
    e.custom = custom;
  }
  const dueAt = f.optIso('dueAt');
  if (dueAt !== undefined) {
    e.dueAt = dueAt;
  }
  const undoOf = f.optId('undoOf');
  if (undoOf !== undefined) {
    e.undoOf = undoOf;
  }
  return f.failed ? { ok: false, errors: f.errors } : { ok: true, value: e };
}

export function validateSettings(input: unknown): Result<Settings> {
  if (!isObj(input)) {
    return { ok: false, errors: { record: 'Not an object' } };
  }
  const f = new Fields(input);
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    notifications: f.bool('notifications'),
    sound: f.bool('sound'),
    theme: f.choice('theme', THEMES, 'Unknown theme'),
    purgeDays: f.int('purgeDays', 1, 365, 'Between 1 and 365 days'),
    showOwnerPhone: f.bool('showOwnerPhone'),
  };
  const lastExportAt = f.optIso('lastExportAt');
  if (lastExportAt !== undefined) {
    s.lastExportAt = lastExportAt;
  }
  return f.failed ? { ok: false, errors: f.errors } : { ok: true, value: s };
}

export interface ImportRejection {
  ok: false;
  message: string;
  failingRecords: number;
}

export type ImportResult = { ok: true; value: TransferFile } | ImportRejection;

function reject(message: string, failingRecords = 0): ImportRejection {
  return { ok: false, message, failingRecords };
}

function readList<T extends { id: string }>(
  raw: unknown[],
  read: (u: unknown) => Result<T>,
): { values: T[]; failing: number } {
  const seen = new Set<string>();
  const values: T[] = [];
  let failing = 0;
  for (const item of raw) {
    const r = read(item);
    if (r.ok && !seen.has(r.value.id)) {
      seen.add(r.value.id);
      values.push(r.value);
    } else {
      failing += 1;
    }
  }
  return { values, failing };
}

/**
 * Import boundary: whole-file accept or reject. `text` is the raw file content. The size cap
 * applies to the text; the schema version must match; every record is validated and a
 * rejection reports how many failed. Unknown fields are dropped by the record validators.
 */
export function validateImport(text: string): ImportResult {
  if (text.length > IMPORT_SIZE_CAP_BYTES) {
    return reject('File is larger than 10 MB');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reject('File is not valid JSON');
  }
  if (!isObj(parsed)) {
    return reject('File is not a Wardbelt export');
  }
  if (parsed.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    return reject(`Unsupported schema version (expected ${TRANSFER_SCHEMA_VERSION})`);
  }
  const exportedAt = parseIso(parsed.exportedAt);
  if (exportedAt === undefined) {
    return reject('Missing export timestamp');
  }
  if (!Array.isArray(parsed.patients) || !Array.isArray(parsed.events)) {
    return reject('Missing patients or events list');
  }
  const patients = readList(parsed.patients as unknown[], validatePatientRecord);
  const events = readList(parsed.events as unknown[], validateEvent);
  const settings = validateSettings(parsed.settings);
  const failing = patients.failing + events.failing + (settings.ok ? 0 : 1);
  if (failing > 0 || !settings.ok) {
    return reject(`${failing} record${failing === 1 ? '' : 's'} failed validation`, failing);
  }
  return {
    ok: true,
    value: {
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      exportedAt,
      patients: patients.values,
      events: events.values,
      settings: settings.value,
    },
  };
}
