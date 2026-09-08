import { describe, expect, it } from 'vitest';
import {
  IMPORT_SIZE_CAP_BYTES,
  parseIso,
  validateCustomTask,
  validateEvent,
  validateImport,
  validatePatientForm,
  validatePatientRecord,
  validateSettings,
} from '../../../src/domain/validate';
import { TRANSFER_SCHEMA_VERSION, type Event } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FIXTURE_SETTINGS,
  FORM_CAT,
  FORM_DOG,
  allFixturePatients,
  fixtureEvents,
  isoPlus,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

function errorsOf(r: { ok: true } | { ok: false; errors: Readonly<Record<string, string>> }) {
  return r.ok ? {} : r.errors;
}

describe('parseIso', () => {
  it('normalises valid dates and rejects the rest', () => {
    expect(parseIso('2026-03-10T10:30:00Z')).toBe('2026-03-10T10:30:00.000Z');
    expect(parseIso('2026-03-10T11:30:00+01:00')).toBe('2026-03-10T10:30:00.000Z');
    expect(parseIso(123)).toBeUndefined();
    expect(parseIso('short')).toBeUndefined();
    expect(parseIso('x'.repeat(41))).toBeUndefined();
    expect(parseIso('2026-13-45T99:99:99Z')).toBeUndefined();
  });
});

describe('validatePatientForm', () => {
  it('accepts a full form and drops unknown fields', () => {
    const r = validatePatientForm({ ...FORM_CAT, extra: 'dropped', weightKg: '4.256' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ ...FORM_CAT, weightKg: 4.26 });
      expect('extra' in r.value).toBe(false);
    }
  });

  it('accepts a minimal form without optional fields', () => {
    const r = validatePatientForm({
      name: '  Fixture  ',
      species: 'dog',
      sex: 'M',
      procedure: 'Castrate',
      intake: 'none',
      weightKg: '',
      ownerPhone: '  ',
    });
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Fixture',
        species: 'dog',
        breed: '',
        sex: 'M',
        procedure: 'Castrate',
        kennel: '',
        intake: 'none',
        notes: '',
      },
    });
  });

  it('rejects non-objects', () => {
    expect(validatePatientForm(null)).toEqual({ ok: false, errors: { form: 'Invalid form' } });
    expect(validatePatientForm([])).toEqual({ ok: false, errors: { form: 'Invalid form' } });
  });

  it('reports every failing field with the section 7 rules', () => {
    const errors = errorsOf(
      validatePatientForm({
        name: '',
        species: 'horse',
        breed: 'b'.repeat(41),
        sex: 'X',
        weightKg: 'heavy',
        procedure: 42,
        kennel: 'k'.repeat(11),
        intake: '11:00',
        ownerPhone: 'abc-123',
        notes: 'n'.repeat(501),
      }),
    );
    expect(errors).toEqual({
      name: 'Required',
      species: 'Choose a species',
      breed: 'At most 40 characters',
      sex: 'Choose a sex',
      weightKg: 'Must be a number',
      procedure: 'Must be text',
      kennel: 'At most 10 characters',
      intake: 'Choose an intake slot',
      ownerPhone: 'Digits, spaces and + only',
      notes: 'At most 500 characters',
    });
  });

  it('checks weight range, phone length, phone type and missing required fields', () => {
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, weightKg: 0.01 }))).toEqual({
      weightKg: 'Between 0.05 and 150 kg',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, weightKg: 150.01 }))).toEqual({
      weightKg: 'Between 0.05 and 150 kg',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, weightKg: true }))).toEqual({
      weightKg: 'Must be a number',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, ownerPhone: '12345' }))).toEqual({
      ownerPhone: 'Between 6 and 20 characters',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, ownerPhone: 7 }))).toEqual({
      ownerPhone: 'Must be text',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, ownerPhone: null }))).toEqual({});
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, name: '   ' }))).toEqual({
      name: 'Required',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, name: undefined }))).toEqual({
      name: 'Required',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, procedure: null }))).toEqual({
      procedure: 'Required',
    });
    expect(errorsOf(validatePatientForm({ ...FORM_DOG, breed: null }))).toEqual({});
  });
});

describe('validateCustomTask', () => {
  it('accepts a label with and without dueAt inside the window', () => {
    expect(validateCustomTask({ label: ' Bandage ' }, FIXED_NOW_MS)).toEqual({
      ok: true,
      value: { label: 'Bandage' },
    });
    const due = isoPlus(FIXED_NOW_ISO, 30);
    expect(validateCustomTask({ label: 'Bandage', dueAt: due }, FIXED_NOW_MS)).toEqual({
      ok: true,
      value: { label: 'Bandage', dueAt: due },
    });
    expect(validateCustomTask({ label: 'Bandage', dueAt: '' }, FIXED_NOW_MS)).toEqual({
      ok: true,
      value: { label: 'Bandage' },
    });
  });

  it('rejects bad labels, bad dates and dates outside the window', () => {
    expect(validateCustomTask('x', FIXED_NOW_MS)).toEqual({
      ok: false,
      errors: { form: 'Invalid form' },
    });
    expect(errorsOf(validateCustomTask({ label: 'x'.repeat(61) }, FIXED_NOW_MS))).toEqual({
      label: 'At most 60 characters',
    });
    expect(errorsOf(validateCustomTask({ label: 'ok', dueAt: 'nope' }, FIXED_NOW_MS))).toEqual({
      dueAt: 'Must be an ISO 8601 date',
    });
    expect(
      errorsOf(
        validateCustomTask(
          { label: 'ok', dueAt: isoPlus(FIXED_NOW_ISO, -24 * 60 - 1) },
          FIXED_NOW_MS,
        ),
      ),
    ).toEqual({ dueAt: 'More than 24 hours in the past' });
    expect(
      errorsOf(
        validateCustomTask(
          { label: 'ok', dueAt: isoPlus(FIXED_NOW_ISO, 48 * 60 + 1) },
          FIXED_NOW_MS,
        ),
      ),
    ).toEqual({ dueAt: 'More than 48 hours ahead' });
  });
});

describe('validatePatientRecord', () => {
  it('round-trips every fixture patient', () => {
    for (const p of allFixturePatients()) {
      const r = validatePatientRecord(JSON.parse(JSON.stringify(p)));
      expect(r).toEqual({ ok: true, value: p });
    }
  });

  it('keeps a task note and drops an empty one', () => {
    const p = patientWithCustomTask();
    const raw = JSON.parse(JSON.stringify(p)) as { tasks: { note?: string }[] };
    const first = raw.tasks[0];
    if (first !== undefined) {
      first.note = '';
    }
    const r = validatePatientRecord(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tasks[0]?.note).toBeUndefined();
      expect(r.value.tasks.find((t) => t.custom)?.note).toBe('Left fore, check for slippage');
    }
  });

  it('rejects non-objects and bad record fields', () => {
    expect(validatePatientRecord('x')).toEqual({ ok: false, errors: { record: 'Not an object' } });
    const p = allFixturePatients()[0];
    const errors = errorsOf(
      validatePatientRecord({
        ...p,
        id: '',
        status: 'gone',
        createdAt: 'never',
        theatreReturnAt: 'bad',
        dischargedAt: 5,
        tasks: 'none',
      }),
    );
    expect(errors).toEqual({
      id: 'Invalid id',
      status: 'Unknown status',
      createdAt: 'Must be an ISO 8601 date',
      theatreReturnAt: 'Must be an ISO 8601 date',
      dischargedAt: 'Must be an ISO 8601 date',
      tasks: 'Must be a list of at most 200 tasks',
    });
    expect(
      errorsOf(validatePatientRecord({ ...p, tasks: new Array<unknown>(201).fill({}) })),
    ).toEqual({
      tasks: 'Must be a list of at most 200 tasks',
    });
  });

  it('rejects bad tasks individually with their reasons', () => {
    const p = allFixturePatients()[0];
    if (p === undefined) {
      throw new Error('fixture missing');
    }
    const good = p.tasks[0];
    const errors = errorsOf(
      validatePatientRecord({
        ...p,
        tasks: [
          'not an object',
          { ...good, key: 'nope' },
          { ...good, key: 'custom', custom: false },
          { ...good, custom: 'yes' },
          { ...good, id: 'dup' },
          { ...good, id: 'dup' },
          { ...good, phase: 'LIMBO', order: -1, status: 'maybe', label: '' },
          { ...good, dueAt: 'x', doneAt: 'y', note: 7 },
        ],
      }),
    );
    expect(errors).toEqual({
      'tasks.0': 'Not an object',
      'tasks.1': 'Unknown task key',
      'tasks.2': 'Custom flag does not match key',
      'tasks.3': 'Must be true or false',
      'tasks.5': 'Duplicate task id',
      'tasks.6': 'Required; Unknown phase; Must be a non-negative integer; Unknown status',
      'tasks.7': 'Must be an ISO 8601 date; Must be an ISO 8601 date; Must be text',
    });
  });
});

describe('validateEvent', () => {
  it('round-trips fixture events and optional fields', () => {
    for (const e of fixtureEvents()) {
      expect(validateEvent(JSON.parse(JSON.stringify(e)))).toEqual({ ok: true, value: e });
    }
    const full: Event = {
      id: 'u1',
      at: FIXED_NOW_ISO,
      type: 'UNDO',
      patientId: 'p',
      taskId: 't',
      taskKey: 'custom',
      custom: true,
      dueAt: FIXED_NOW_ISO,
      undoOf: 'e2',
    };
    expect(validateEvent({ ...full, junk: 1 })).toEqual({ ok: true, value: full });
  });

  it('rejects non-objects and bad fields', () => {
    expect(validateEvent(1)).toEqual({ ok: false, errors: { record: 'Not an object' } });
    expect(
      errorsOf(
        validateEvent({
          id: 5,
          at: 'x',
          type: 'BOOM',
          patientId: '',
          taskId: '',
          taskKey: 'zzz',
          custom: 'no',
          dueAt: 'bad',
          undoOf: 9,
        }),
      ),
    ).toEqual({
      id: 'Invalid id',
      at: 'Must be an ISO 8601 date',
      type: 'Unknown event type',
      patientId: 'Invalid id',
      taskId: 'Invalid id',
      taskKey: 'Unknown task key',
      custom: 'Must be true or false',
      dueAt: 'Must be an ISO 8601 date',
      undoOf: 'Invalid id',
    });
  });
});

describe('validateSettings', () => {
  it('accepts settings with and without lastExportAt', () => {
    expect(validateSettings({ ...FIXTURE_SETTINGS, junk: true })).toEqual({
      ok: true,
      value: FIXTURE_SETTINGS,
    });
    expect(validateSettings({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO })).toEqual({
      ok: true,
      value: { ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO },
    });
  });

  it('rejects non-objects and bad fields', () => {
    expect(validateSettings(null)).toEqual({ ok: false, errors: { record: 'Not an object' } });
    expect(
      errorsOf(
        validateSettings({
          notifications: 1,
          sound: 'off',
          theme: 'sepia',
          purgeDays: 0,
          showOwnerPhone: null,
          lastExportAt: 'never',
        }),
      ),
    ).toEqual({
      notifications: 'Must be true or false',
      sound: 'Must be true or false',
      theme: 'Unknown theme',
      purgeDays: 'Between 1 and 365 days',
      showOwnerPhone: 'Must be true or false',
      lastExportAt: 'Must be an ISO 8601 date',
    });
    expect(errorsOf(validateSettings({ ...FIXTURE_SETTINGS, purgeDays: 366 }))).toEqual({
      purgeDays: 'Between 1 and 365 days',
    });
    expect(errorsOf(validateSettings({ ...FIXTURE_SETTINGS, purgeDays: 1.5 }))).toEqual({
      purgeDays: 'Between 1 and 365 days',
    });
  });
});

describe('validateImport', () => {
  const good = () => ({
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    exportedAt: FIXED_NOW_ISO,
    patients: allFixturePatients(),
    events: fixtureEvents(),
    settings: FIXTURE_SETTINGS,
  });

  it('accepts a valid file and normalises it', () => {
    const r = validateImport(JSON.stringify({ ...good(), junk: 1 }));
    expect(r).toEqual({ ok: true, value: good() });
  });

  it('rejects whole-file problems with zero failing records', () => {
    expect(validateImport('x'.repeat(IMPORT_SIZE_CAP_BYTES + 1))).toEqual({
      ok: false,
      message: 'File is larger than 10 MB',
      failingRecords: 0,
    });
    expect(validateImport('{not json')).toMatchObject({
      ok: false,
      message: 'File is not valid JSON',
    });
    expect(validateImport('[]')).toMatchObject({
      ok: false,
      message: 'File is not a Wardbelt export',
    });
    expect(validateImport(JSON.stringify({ ...good(), schemaVersion: 99 }))).toMatchObject({
      ok: false,
      message: 'Unsupported schema version (expected 1)',
    });
    expect(validateImport(JSON.stringify({ ...good(), exportedAt: 'x' }))).toMatchObject({
      ok: false,
      message: 'Missing export timestamp',
    });
    expect(validateImport(JSON.stringify({ ...good(), patients: {} }))).toMatchObject({
      ok: false,
      message: 'Missing patients or events list',
    });
    expect(validateImport(JSON.stringify({ ...good(), events: null }))).toMatchObject({
      ok: false,
      message: 'Missing patients or events list',
    });
  });

  it('rejects whole with a count when any record fails, including duplicates and settings', () => {
    const g = good();
    const dupPatient = g.patients[0];
    const withBad = {
      ...g,
      patients: [...g.patients, dupPatient, { id: 'bad' }],
      events: [...g.events, { id: 'e1', at: FIXED_NOW_ISO, type: 'UNDO', patientId: 'p' }, 'junk'],
      settings: { theme: 'sepia' },
    };
    expect(validateImport(JSON.stringify(withBad))).toEqual({
      ok: false,
      message: '5 records failed validation',
      failingRecords: 5,
    });
    expect(validateImport(JSON.stringify({ ...g, settings: null }))).toEqual({
      ok: false,
      message: '1 record failed validation',
      failingRecords: 1,
    });
  });

  it('rejects each of ten malformed variants without partial acceptance', () => {
    const g = good();
    const variants: unknown[] = [
      { ...g, patients: [{ ...g.patients[0], name: 'x'.repeat(41) }] },
      { ...g, patients: [{ ...g.patients[0], species: 'dragon' }] },
      { ...g, patients: [{ ...g.patients[0], weightKg: -1 }] },
      { ...g, patients: [{ ...g.patients[0], tasks: [{ id: 't' }] }] },
      { ...g, patients: [{ ...g.patients[0], createdAt: 12345 }] },
      { ...g, events: [{ ...g.events[0], at: '' }] },
      { ...g, events: [{ ...g.events[0], type: 'TASK_EXPLODED' }] },
      { ...g, events: [{ ...g.events[0], taskKey: 'bloods', custom: 'false' }] },
      { ...g, settings: { ...g.settings, purgeDays: '30' } },
      { ...g, settings: { ...g.settings, theme: null } },
    ];
    for (const v of variants) {
      const r = validateImport(JSON.stringify(v));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failingRecords).toBe(1);
      }
    }
  });
});
