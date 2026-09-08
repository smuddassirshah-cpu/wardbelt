// Decision notes: synthetic fixtures only (CLAUDE.md security floor). Names are placeholders
// that cannot match a real client or animal. Patients are built from the template here rather
// than through domain/patient.ts so the fixtures stay usable by every stage independently.
// All timestamps are fixed UTC values so tests are deterministic.
import { TEMPLATE } from '../../src/domain/template';
import {
  CHECK_OFFSETS_MIN,
  templateTaskId,
  type Event,
  type Iso,
  type Patient,
  type PatientForm,
  type Settings,
  type StepKey,
  type Task,
  type TaskStatus,
} from '../../src/domain/types';

/** A fixed "now" for tests: 2026-03-10 10:30 UTC. */
export const FIXED_NOW_ISO: Iso = '2026-03-10T10:30:00.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

export function isoPlus(base: Iso, minutes: number): Iso {
  return new Date(Date.parse(base) + minutes * 60_000).toISOString();
}

export const FORM_DOG: PatientForm = {
  name: 'Fixture Dog One',
  species: 'dog',
  breed: 'Crossbreed',
  sex: 'MN',
  weightKg: 24.5,
  procedure: 'Lump removal',
  kennel: 'K1',
  intake: '08:00',
  notes: '',
};

export const FORM_CAT: PatientForm = {
  name: 'Fixture Cat Two',
  species: 'cat',
  breed: 'Domestic shorthair',
  sex: 'FN',
  weightKg: 4.2,
  procedure: 'Dental',
  kennel: 'C3',
  intake: '10:00',
  ownerPhone: '+44 0000 000000',
  notes: 'Nervous handler required',
};

export const FORM_RABBIT: PatientForm = {
  name: 'Fixture Rabbit Three',
  species: 'rabbit',
  breed: '',
  sex: 'F',
  procedure: 'Spay',
  kennel: 'R2',
  intake: '09:00',
  notes: '',
};

export const FORM_OTHER: PatientForm = {
  name: 'Fixture Other Four',
  species: 'other',
  breed: 'Guinea pig',
  sex: 'unknown',
  weightKg: 0.9,
  procedure: 'Abscess lance',
  kennel: '',
  intake: 'none',
  notes: '',
};

export function templateTasks(patientId: string): Task[] {
  return TEMPLATE.map((step, order) => ({
    id: templateTaskId(patientId, step.key),
    key: step.key,
    label: step.label,
    phase: step.phase,
    order,
    status: 'todo',
    custom: false,
  }));
}

export function fixturePatient(
  id: string,
  form: PatientForm,
  createdAt: Iso = FIXED_NOW_ISO,
): Patient {
  return { ...form, id, status: 'active', createdAt, tasks: templateTasks(id) };
}

function setTask(p: Patient, key: StepKey, status: TaskStatus, doneAt?: Iso): void {
  const t = p.tasks.find((x) => x.key === key);
  if (t === undefined) {
    throw new Error(`fixture: no task ${key}`);
  }
  t.status = status;
  if (doneAt !== undefined) {
    t.doneAt = doneAt;
  }
}

/** Fresh admission, nothing done. */
export function patientFresh(): Patient {
  return fixturePatient('p-fresh', FORM_DOG, isoPlus(FIXED_NOW_ISO, -150));
}

/** Pre-op in progress: two done, one skipped, current is premed. */
export function patientPreOp(): Patient {
  const p = fixturePatient('p-preop', FORM_CAT, isoPlus(FIXED_NOW_ISO, -30));
  setTask(p, 'handover_admit', 'done', isoPlus(FIXED_NOW_ISO, -28));
  setTask(p, 'bloods', 'skipped', isoPlus(FIXED_NOW_ISO, -27));
  setTask(p, 'draw_meds', 'done', isoPlus(FIXED_NOW_ISO, -20));
  return p;
}

/** In theatre, waiting. */
export function patientInTheatre(): Patient {
  const p = fixturePatient('p-theatre', FORM_RABBIT, isoPlus(FIXED_NOW_ISO, -90));
  for (const k of ['handover_admit', 'bloods', 'draw_meds', 'premed', 'to_theatre'] as const) {
    setTask(p, k, 'done', isoPlus(FIXED_NOW_ISO, -60));
  }
  return p;
}

/** Back from theatre 20 minutes ago: check_1 overdue, check_2 due in 10 minutes. */
export function patientRecovery(): Patient {
  const returned = isoPlus(FIXED_NOW_ISO, -20);
  const p = fixturePatient('p-recovery', FORM_DOG, isoPlus(FIXED_NOW_ISO, -150));
  for (const k of [
    'handover_admit',
    'bloods',
    'draw_meds',
    'premed',
    'to_theatre',
    'in_theatre',
  ] as const) {
    setTask(p, k, 'done', isoPlus(FIXED_NOW_ISO, -90));
  }
  setTask(p, 'in_theatre', 'done', returned);
  setTask(p, 'handover_theatre', 'done', isoPlus(returned, 2));
  p.theatreReturnAt = returned;
  for (const [key, offset] of Object.entries(CHECK_OFFSETS_MIN) as [StepKey, number][]) {
    const t = p.tasks.find((x) => x.key === key);
    if (t !== undefined) {
      t.dueAt = isoPlus(returned, offset);
    }
  }
  return p;
}

/** Recovery with a custom task inserted after pain_score and a note on it. */
export function patientWithCustomTask(): Patient {
  const p = patientRecovery();
  p.id = 'p-custom';
  p.tasks = templateTasks('p-custom').map((t, i) => {
    const src = p.tasks[i];
    return src === undefined ? t : { ...src, id: t.id };
  });
  const idx = p.tasks.findIndex((t) => t.key === 'pain_score');
  const custom: Task = {
    id: 'p-custom:custom:1',
    key: 'custom',
    label: 'Bandage check',
    phase: 'RECOVERY',
    order: idx + 1,
    status: 'todo',
    dueAt: isoPlus(FIXED_NOW_ISO, 25),
    note: 'Left fore, check for slippage',
    custom: true,
  };
  p.tasks.splice(idx + 1, 0, custom);
  p.tasks.forEach((t, i) => {
    t.order = i;
  });
  return p;
}

/** Every task done or skipped, discharged. */
export function patientDischarged(): Patient {
  const p = fixturePatient('p-discharged', FORM_OTHER, isoPlus(FIXED_NOW_ISO, -300));
  const returned = isoPlus(FIXED_NOW_ISO, -200);
  p.tasks.forEach((t, i) => {
    t.status = t.key === 'bloods' ? 'skipped' : 'done';
    t.doneAt = isoPlus(FIXED_NOW_ISO, -290 + i * 10);
  });
  p.theatreReturnAt = returned;
  p.status = 'discharged';
  p.dischargedAt = isoPlus(FIXED_NOW_ISO, -100);
  return p;
}

export function allFixturePatients(): Patient[] {
  return [
    patientFresh(),
    patientPreOp(),
    patientInTheatre(),
    patientRecovery(),
    patientWithCustomTask(),
    patientDischarged(),
  ];
}

export const FIXTURE_SETTINGS: Settings = {
  notifications: true,
  sound: false,
  theme: 'light',
  purgeDays: 30,
  showOwnerPhone: true,
};

export function fixtureEvents(): Event[] {
  const returned = isoPlus(FIXED_NOW_ISO, -20);
  return [
    { id: 'e1', at: isoPlus(FIXED_NOW_ISO, -150), type: 'PATIENT_ADDED', patientId: 'p-recovery' },
    {
      id: 'e2',
      at: isoPlus(FIXED_NOW_ISO, -90),
      type: 'TASK_COMPLETED',
      patientId: 'p-recovery',
      taskId: 'p-recovery:handover_admit',
      taskKey: 'handover_admit',
      custom: false,
    },
    {
      id: 'e3',
      at: returned,
      type: 'TASK_COMPLETED',
      patientId: 'p-recovery',
      taskId: 'p-recovery:in_theatre',
      taskKey: 'in_theatre',
      custom: false,
    },
    { id: 'e4', at: returned, type: 'THEATRE_RETURN', patientId: 'p-recovery' },
  ];
}
