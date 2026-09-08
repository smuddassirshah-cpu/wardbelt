import { describe, expect, it } from 'vitest';
import { IMPORT_SIZE_CAP_BYTES } from '../../../src/domain/validate';
import { TRANSFER_SCHEMA_VERSION, type Task, type TransferFile } from '../../../src/domain/types';
import { openRepo } from '../../../src/store/repo';
import {
  buildExport,
  exportRawStore,
  parseImport,
  serialiseExport,
} from '../../../src/store/transfer';
import {
  FIXED_NOW_ISO,
  FIXTURE_SETTINGS,
  allFixturePatients,
  fixtureEvents,
  isoPlus,
  patientFresh,
} from '../../fixtures/synthetic';
import { freshFactory } from './helpers';

const SETTINGS = { ...FIXTURE_SETTINGS, lastExportAt: isoPlus(FIXED_NOW_ISO, -60) };

function goodFile(): TransferFile {
  return buildExport(allFixturePatients(), fixtureEvents(), SETTINGS, FIXED_NOW_ISO);
}

/** Deep JSON clone so a variant can mutate freely. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Mutator = (file: TransferFile) => unknown;

function withFile(mutate: Mutator): string {
  const file = clone(goodFile());
  const result = mutate(file);
  return JSON.stringify(result === undefined ? file : result);
}

function patient0(file: TransferFile): Record<string, unknown> {
  const p = file.patients[0];
  if (p === undefined) {
    throw new Error('fixture has no patients');
  }
  return p as unknown as Record<string, unknown>;
}

function event0(file: TransferFile): Record<string, unknown> {
  const e = file.events[0];
  if (e === undefined) {
    throw new Error('fixture has no events');
  }
  return e as unknown as Record<string, unknown>;
}

interface Variant {
  name: string;
  text: () => string;
  message?: string;
  failingRecords?: number;
}

const VARIANTS: Variant[] = [
  {
    name: 'oversize text (ASCII padding past the cap)',
    text: () => serialiseExport(goodFile()) + ' '.repeat(IMPORT_SIZE_CAP_BYTES),
    message: 'File is larger than 10 MB',
  },
  {
    name: 'oversize in UTF-8 bytes although under the cap in characters',
    text: () => {
      const pad = 'é'.repeat(Math.floor(IMPORT_SIZE_CAP_BYTES / 2) + 64);
      return withFile((f) => ({ ...f, pad }));
    },
    message: 'File is larger than 10 MB',
  },
  {
    name: 'truncated JSON',
    text: () => serialiseExport(goodFile()).slice(0, -40),
    message: 'File is not valid JSON',
  },
  {
    name: 'not an object',
    text: () => JSON.stringify([goodFile()]),
    message: 'File is not a Wardbelt export',
  },
  {
    name: 'wrong schema version',
    text: () => withFile((f) => ({ ...f, schemaVersion: TRANSFER_SCHEMA_VERSION + 1 })),
    message: `Unsupported schema version (expected ${TRANSFER_SCHEMA_VERSION})`,
  },
  {
    name: 'missing export timestamp',
    text: () => withFile((f) => ({ ...f, exportedAt: 'yesterday' })),
    message: 'Missing export timestamp',
  },
  {
    name: 'patients not an array',
    text: () => withFile((f) => ({ ...f, patients: {} })),
    message: 'Missing patients or events list',
  },
  {
    name: 'events not an array',
    text: () => withFile((f) => ({ ...f, events: 'none' })),
    message: 'Missing patients or events list',
  },
  {
    name: 'top-level fields hidden behind a __proto__ key',
    text: () => `{"__proto__": ${serialiseExport(goodFile())}}`,
    message: `Unsupported schema version (expected ${TRANSFER_SCHEMA_VERSION})`,
  },
  {
    name: 'patient name smuggled through a __proto__ key',
    text: () =>
      serialiseExport(goodFile()).replace(
        '"name": "Fixture Dog One"',
        '"__proto__": {"name": "Fixture Dog One"}',
      ),
    failingRecords: 1,
  },
  {
    name: 'event with a bad type',
    text: () =>
      withFile((f) => {
        event0(f).type = 'TASK_EXPLODED';
      }),
    failingRecords: 1,
  },
  {
    name: 'event with an unparseable timestamp',
    text: () =>
      withFile((f) => {
        event0(f).at = '2026-99-99T99:99:99Z';
      }),
    failingRecords: 1,
  },
  {
    name: 'patient with 201 tasks',
    text: () =>
      withFile((f) => {
        const p = patient0(f);
        const tasks = p.tasks as Task[];
        const template = tasks[0];
        if (template === undefined) {
          throw new Error('fixture has no tasks');
        }
        while (tasks.length < 201) {
          tasks.push({ ...template, id: `extra-${tasks.length}`, key: 'custom', custom: true });
        }
      }),
    failingRecords: 1,
  },
  {
    name: 'task with a mismatched custom flag',
    text: () =>
      withFile((f) => {
        const tasks = patient0(f).tasks as Task[];
        const t = tasks[0];
        if (t !== undefined) {
          t.custom = true;
        }
      }),
    failingRecords: 1,
  },
  {
    name: 'duplicate task ids inside a patient',
    text: () =>
      withFile((f) => {
        const tasks = patient0(f).tasks as Task[];
        const [a, b] = tasks;
        if (a !== undefined && b !== undefined) {
          b.id = a.id;
        }
      }),
    failingRecords: 1,
  },
  {
    name: 'patient with an unlisted species',
    text: () =>
      withFile((f) => {
        patient0(f).species = 'ferret';
      }),
    failingRecords: 1,
  },
  {
    name: 'settings with purgeDays 0',
    text: () => withFile((f) => ({ ...f, settings: { ...f.settings, purgeDays: 0 } })),
    message: '1 record failed validation',
    failingRecords: 1,
  },
  {
    name: 'settings missing entirely',
    text: () => withFile((f) => ({ ...f, settings: undefined })),
    failingRecords: 1,
  },
  {
    name: 'duplicate patient ids',
    text: () =>
      withFile((f) => {
        f.patients.push(clone(patient0(f)) as unknown as TransferFile['patients'][number]);
      }),
    message: '1 record failed validation',
    failingRecords: 1,
  },
  {
    name: 'duplicate event ids',
    text: () =>
      withFile((f) => {
        f.events.push({ ...f.events[0], id: 'e1' } as TransferFile['events'][number]);
      }),
    failingRecords: 1,
  },
  {
    name: 'several bad records counted together',
    text: () =>
      withFile((f) => {
        patient0(f).name = '';
        event0(f).patientId = '';
        return { ...f, settings: { ...f.settings, theme: 'neon' } };
      }),
    message: '3 records failed validation',
    failingRecords: 3,
  },
];

describe('parseImport rejects malformed files whole', () => {
  it.each(VARIANTS)('$name', ({ text, message, failingRecords }) => {
    const r = parseImport(text());
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    if (message !== undefined) {
      expect(r.message).toBe(message);
    }
    expect(r.failingRecords).toBe(failingRecords ?? 0);
  });

  it('covers at least ten distinct malformed variants', () => {
    expect(VARIANTS.length).toBeGreaterThanOrEqual(10);
  });

  it('leaves existing stored data untouched after every rejection', async () => {
    const repo = await openRepo({ dbName: 'transfer-untouched', indexedDB: freshFactory() });
    await repo.savePatient(patientFresh());
    await repo.saveSettings(SETTINGS);
    const before = await repo.load();
    for (const variant of VARIANTS) {
      expect(parseImport(variant.text()).ok).toBe(false);
      expect(await repo.load()).toEqual(before);
    }
    repo.close();
  });
});

describe('export and import', () => {
  it('round-trips deep-equal through serialise and parse', () => {
    const file = goodFile();
    const r = parseImport(serialiseExport(file));
    expect(r).toEqual({ ok: true, value: file });
  });

  it('builds an export that does not alias the inputs', () => {
    const patients = allFixturePatients();
    const events = fixtureEvents();
    const file = buildExport(patients, events, SETTINGS, FIXED_NOW_ISO);
    expect(file.schemaVersion).toBe(TRANSFER_SCHEMA_VERSION);
    expect(file.exportedAt).toBe(FIXED_NOW_ISO);
    expect(file.patients).toEqual(patients);
    expect(file.events).toEqual(events);
    expect(file.settings).toEqual(SETTINGS);
    const first = file.patients[0];
    const firstTask = first?.tasks[0];
    if (first === undefined || firstTask === undefined) {
      throw new Error('fixture has no patients');
    }
    first.name = 'Mutated';
    firstTask.status = 'done';
    file.settings.purgeDays = 1;
    expect(patients[0]?.name).toBe('Fixture Dog One');
    expect(patients[0]?.tasks[0]?.status).toBe('todo');
    expect(SETTINGS.purgeDays).toBe(30);
  });

  it('serialises as pretty JSON that parses back to the same object', () => {
    const file = goodFile();
    const text = serialiseExport(file);
    expect(text.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(JSON.parse(text)).toEqual(file);
  });

  it('drops unknown fields and normalises timestamps on import', () => {
    const text = withFile((f) => {
      patient0(f).mystery = 'dropped';
      event0(f).at = '2026-03-10T11:30:00+01:00';
      return { ...f, extra: true };
    });
    const r = parseImport(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('extra' in r.value).toBe(false);
      expect('mystery' in (r.value.patients[0] ?? {})).toBe(false);
      expect(r.value.events[0]?.at).toBe('2026-03-10T10:30:00.000Z');
    }
  });

  it('accepts a file exactly at the byte cap', () => {
    const base = withFile((f) => ({ ...f, pad: '' }));
    const room = IMPORT_SIZE_CAP_BYTES - new TextEncoder().encode(base).byteLength;
    const text = base.replace('"pad":""', `"pad":"${'x'.repeat(room)}"`);
    expect(new TextEncoder().encode(text).byteLength).toBe(IMPORT_SIZE_CAP_BYTES);
    expect(parseImport(text).ok).toBe(true);
  });
});

describe('exportRawStore', () => {
  it('serialises the raw corrupt rows for recovery', () => {
    const rows: unknown[] = [{ id: 'p-bad', species: 'dragon' }, 'not even an object', 7];
    const parsed = JSON.parse(exportRawStore(rows)) as Record<string, unknown>;
    expect(parsed).toEqual({
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      kind: 'raw-corrupt-records',
      records: rows,
    });
    expect(JSON.parse(exportRawStore([]))).toMatchObject({ records: [] });
  });
});
