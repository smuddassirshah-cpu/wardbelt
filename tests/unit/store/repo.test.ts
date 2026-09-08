import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Event, type Patient } from '../../../src/domain/types';
import { DEFAULT_RETRY_DELAY_MS, openRepo, type Repo } from '../../../src/store/repo';
import {
  FIXED_NOW_ISO,
  FIXTURE_SETTINGS,
  allFixturePatients,
  fixtureEvents,
  isoPlus,
  patientFresh,
  patientPreOp,
  patientRecovery,
} from '../../fixtures/synthetic';
import {
  factoryFiring,
  factoryThrowing,
  failNextClears,
  failNextCursorDeletes,
  failNextPuts,
  freshFactory,
  harness,
  quotaError,
  rawGetAll,
  rawOpen,
  rawPut,
  unhandledRejectionsDuring,
  type Harness,
} from './helpers';

let counter = 0;
function uniqueName(): string {
  counter += 1;
  return `repo-test-${counter}`;
}

async function open(
  h: Harness,
  factory: IDBFactory,
  dbName: string,
  retryDelayMs = 5,
): Promise<Repo> {
  const repo = await openRepo({ dbName, indexedDB: factory, retryDelayMs, wait: h.wait });
  h.attach(repo);
  return repo;
}

function nth<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) {
    throw new Error(`fixture has no element ${i}`);
  }
  return v;
}

function byId<T extends { id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}

const opened: Repo[] = [];
afterEach(() => {
  for (const repo of opened.splice(0)) {
    repo.close();
  }
});

async function seedAll(repo: Repo): Promise<void> {
  for (const p of allFixturePatients()) {
    await repo.savePatient(p);
  }
  for (const e of fixtureEvents()) {
    await repo.appendEvent(e);
  }
  await repo.saveSettings({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO });
}

describe('openRepo in IndexedDB mode', () => {
  it('round-trips patients, events and settings through a reopen', async () => {
    const factory = freshFactory();
    const name = uniqueName();
    const h = harness();
    const first = await open(h, factory, name);
    expect(first.mode).toBe('idb');
    expect(await first.load()).toEqual({
      patients: [],
      events: [],
      settings: DEFAULT_SETTINGS,
      corrupt: 0,
      rawCorrupt: [],
    });
    await seedAll(first);
    first.close();

    const second = await open(h, factory, name);
    opened.push(second);
    const loaded = await second.load();
    expect(byId(loaded.patients)).toEqual(byId(allFixturePatients()));
    expect(loaded.events).toEqual(fixtureEvents());
    expect(loaded.settings).toEqual({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO });
    expect(loaded.corrupt).toBe(0);
    expect(loaded.rawCorrupt).toEqual([]);
    expect(h.notices).toEqual([]);
    expect(h.waits).toEqual([]);

    const raw = await rawOpen(factory, name);
    const rows = await rawGetAll(raw, 'settings');
    raw.close();
    expect(byKey(rows)).toEqual([
      { key: 'lastExportAt', value: FIXED_NOW_ISO },
      { key: 'notifications', value: true },
      { key: 'purgeDays', value: 30 },
      { key: 'showOwnerPhone', value: true },
      { key: 'sound', value: false },
      { key: 'theme', value: 'light' },
    ]);
  });

  it('uses the global indexedDB when no factory is given', async () => {
    const repo = await openRepo({ dbName: uniqueName() });
    opened.push(repo);
    expect(repo.mode).toBe('idb');
    await repo.savePatient(patientFresh());
    expect((await repo.load()).patients).toEqual([patientFresh()]);
  });

  it('defaults the database name to wardbelt', async () => {
    const factory = freshFactory();
    const repo = await openRepo({ indexedDB: factory });
    opened.push(repo);
    await repo.savePatient(patientFresh());
    repo.close();
    const raw = await rawOpen(factory, 'wardbelt');
    expect([...raw.objectStoreNames].sort()).toEqual(['events', 'patients', 'settings']);
    expect(await rawGetAll(raw, 'patients')).toEqual([patientFresh()]);
    raw.close();
  });

  it('describes errors that carry a name but no message', async () => {
    const h = harness();
    const repo = await open(h, factoryThrowing({ name: 'OddError', message: 7 }), uniqueName());
    opened.push(repo);
    expect(h.notices).toEqual([{ kind: 'unavailable', reason: 'OddError' }]);
  });

  it('returns events sorted by at then id regardless of write order', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    const base: Event = { id: 'x', at: FIXED_NOW_ISO, type: 'PATIENT_ADDED', patientId: 'p' };
    const late = { ...base, id: 'e-late', at: isoPlus(FIXED_NOW_ISO, 5) };
    const earlyB = { ...base, id: 'e-b', at: isoPlus(FIXED_NOW_ISO, -5) };
    const earlyA = { ...base, id: 'e-a', at: isoPlus(FIXED_NOW_ISO, -5) };
    for (const e of [late, earlyB, base, earlyA]) {
      await repo.appendEvent(e);
    }
    expect((await repo.load()).events.map((e) => e.id)).toEqual(['e-a', 'e-b', 'x', 'e-late']);
  });

  it('overwrites a patient saved again with the same id', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await repo.savePatient(patientFresh());
    const renamed: Patient = { ...patientFresh(), name: 'Fixture Dog Renamed' };
    await repo.savePatient(renamed);
    expect((await repo.load()).patients).toEqual([renamed]);
  });

  it('deletePatient removes the patient and only its events', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await seedAll(repo);
    const other: Event = {
      id: 'e-other',
      at: FIXED_NOW_ISO,
      type: 'PATIENT_ADDED',
      patientId: 'p-fresh',
    };
    await repo.appendEvent(other);
    await repo.deletePatient('p-recovery');
    const loaded = await repo.load();
    expect(loaded.patients.map((p) => p.id).sort()).toEqual(
      allFixturePatients()
        .map((p) => p.id)
        .filter((id) => id !== 'p-recovery')
        .sort(),
    );
    expect(loaded.events).toEqual([other]);
    await repo.deletePatient('never-existed');
    expect((await repo.load()).patients).toHaveLength(5);
    expect(h.notices).toEqual([]);
  });

  it('clearAll empties every store', async () => {
    const factory = freshFactory();
    const name = uniqueName();
    const h = harness();
    const repo = await open(h, factory, name);
    opened.push(repo);
    await seedAll(repo);
    await repo.clearAll();
    expect(await repo.load()).toEqual({
      patients: [],
      events: [],
      settings: DEFAULT_SETTINGS,
      corrupt: 0,
      rawCorrupt: [],
    });
    const raw = await rawOpen(factory, name);
    expect(await rawGetAll(raw, 'settings')).toEqual([]);
    raw.close();
  });

  it('drops the lastExportAt row when settings are saved without it', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await repo.saveSettings({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO });
    await repo.saveSettings(FIXTURE_SETTINGS);
    expect((await repo.load()).settings).toEqual(FIXTURE_SETTINGS);
  });

  it('surfaces writes that fail after close instead of losing them silently', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    repo.close();
    await repo.savePatient(patientFresh());
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatchObject({ kind: 'write_failed' });
    expect(h.waits).toEqual([5]);
  });
});

function byKey(rows: unknown[]): unknown[] {
  return [...rows].sort((a, b) => {
    const ka = (a as { key: string }).key;
    const kb = (b as { key: string }).key;
    return ka.localeCompare(kb);
  });
}

describe('openRepo fallback to memory mode', () => {
  async function expectMemoryRepo(repo: Repo, reasonPart: string, h: Harness): Promise<void> {
    opened.push(repo);
    expect(repo.mode).toBe('memory');
    expect(h.notices).toHaveLength(1);
    const first = h.notices[0];
    expect(first).toMatchObject({ kind: 'unavailable' });
    if (first?.kind === 'unavailable') {
      expect(first.reason).toContain(reasonPart);
    }
    const replayed: unknown[] = [];
    const unsubscribe = repo.subscribe((n) => replayed.push(n));
    expect(replayed).toEqual([first]);
    unsubscribe();

    expect(await repo.load()).toEqual({
      patients: [],
      events: [],
      settings: DEFAULT_SETTINGS,
      corrupt: 0,
      rawCorrupt: [],
    });
    await seedAll(repo);
    const loaded = await repo.load();
    expect(byId(loaded.patients)).toEqual(byId(allFixturePatients()));
    expect(loaded.events).toEqual(fixtureEvents());
    expect(loaded.settings).toEqual({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO });
    const other: Event = { id: 'e-other', at: FIXED_NOW_ISO, type: 'UNDO', patientId: 'p-fresh' };
    await repo.appendEvent(other);
    await repo.deletePatient('p-recovery');
    const afterDelete = await repo.load();
    expect(afterDelete.patients.map((p) => p.id)).not.toContain('p-recovery');
    expect(afterDelete.events).toEqual([other]);
    await repo.saveSettings(FIXTURE_SETTINGS);
    expect((await repo.load()).settings).toEqual(FIXTURE_SETTINGS);
    await repo.clearAll();
    expect((await repo.load()).patients).toEqual([]);
    expect(h.notices).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    repo.close();
  }

  it('when the open request is blocked', async () => {
    const h = harness();
    const repo = await open(h, factoryFiring(['blocked']), uniqueName());
    await expectMemoryRepo(repo, 'BlockedError', h);
  });

  it('when the open request errors', async () => {
    const h = harness();
    const repo = await open(h, factoryFiring(['error'], quotaError()), uniqueName());
    await expectMemoryRepo(repo, 'QuotaExceededError: quota', h);
  });

  it('when the stored database version is newer (VersionError)', async () => {
    const factory = freshFactory();
    const name = uniqueName();
    const newer = await rawOpen(factory, name, 2);
    newer.close();
    const h = harness();
    const repo = await open(h, factory, name);
    await expectMemoryRepo(repo, 'VersionError', h);
  });

  it('when open throws synchronously', async () => {
    const h = harness();
    const repo = await open(
      h,
      factoryThrowing(new DOMException('Access denied', 'SecurityError')),
      uniqueName(),
    );
    await expectMemoryRepo(repo, 'SecurityError: Access denied', h);
  });

  it('when open throws a non-Error value', async () => {
    const h = harness();
    const repo = await open(h, factoryThrowing('plain string'), uniqueName());
    await expectMemoryRepo(repo, 'plain string', h);
    const h2 = harness();
    const repo2 = await open(h2, factoryThrowing(42), uniqueName());
    await expectMemoryRepo(repo2, 'Unknown storage error', h2);
  });

  it('when indexedDB is undefined (private mode or unsupported)', async () => {
    const h = harness();
    const repo = await openRepo({ indexedDB: undefined, wait: h.wait });
    h.attach(repo);
    await expectMemoryRepo(repo, 'IndexedDB is not available', h);
  });

  it('when the migration itself aborts', async () => {
    const h = harness();
    const factory = freshFactory();
    const name = uniqueName();
    vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(() => {
      throw new DOMException('no space', 'QuotaExceededError');
    });
    const repo = await open(h, factory, name);
    await expectMemoryRepo(repo, 'AbortError', h);
  });
});

describe('load with corrupt rows', () => {
  async function seedRaw(rows: { store: string; value: unknown }[]): Promise<{
    factory: IDBFactory;
    name: string;
  }> {
    const factory = freshFactory();
    const name = uniqueName();
    const h = harness();
    const creator = await open(h, factory, name);
    creator.close();
    const raw = await rawOpen(factory, name);
    for (const row of rows) {
      await rawPut(raw, row.store, row.value);
    }
    raw.close();
    return { factory, name };
  }

  it('skips, counts and keeps corrupt patient, event and settings rows', async () => {
    const badPatient = { ...patientFresh(), id: 'p-bad', species: 'dragon' };
    const badEvent = { ...fixtureEvents()[0], id: 'e-bad', type: 'NOT_A_TYPE' };
    const eventWithoutAt = { id: 'e-no-at', type: 'PATIENT_ADDED', patientId: 'p-fresh' };
    const { factory, name } = await seedRaw([
      { store: 'patients', value: patientFresh() },
      { store: 'patients', value: badPatient },
      { store: 'patients', value: { id: 'p-empty' } },
      { store: 'events', value: fixtureEvents()[0] },
      { store: 'events', value: badEvent },
      { store: 'events', value: eventWithoutAt },
      { store: 'settings', value: { key: 'notifications', value: true } },
      { store: 'settings', value: { key: 'purgeDays', value: 0 } },
    ]);
    const h = harness();
    const repo = await open(h, factory, name);
    opened.push(repo);
    const loaded = await repo.load();
    expect(loaded.patients).toEqual([patientFresh()]);
    expect(loaded.events).toEqual([fixtureEvents()[0]]);
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded.corrupt).toBe(5);
    expect(loaded.rawCorrupt).toHaveLength(6);
    expect(loaded.rawCorrupt).toEqual(
      expect.arrayContaining([
        badPatient,
        { id: 'p-empty' },
        badEvent,
        eventWithoutAt,
        { key: 'notifications', value: true },
        { key: 'purgeDays', value: 0 },
      ]),
    );
    expect(h.notices).toEqual([{ kind: 'corrupt', count: 5 }]);
  });

  it('fills missing settings rows from defaults without counting them as corrupt', async () => {
    const { factory, name } = await seedRaw([
      { store: 'settings', value: { key: 'theme', value: 'dark' } },
      { store: 'settings', value: { key: 'futureField', value: 'ignored' } },
    ]);
    const h = harness();
    const repo = await open(h, factory, name);
    opened.push(repo);
    const loaded = await repo.load();
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(loaded.corrupt).toBe(0);
    expect(h.notices).toEqual([]);
  });

  it('drops a settings row keyed __proto__ instead of letting it reach the prototype chain', async () => {
    const injected = { lastExportAt: FIXED_NOW_ISO, theme: 'dark', purgeDays: 7 };
    const { factory, name } = await seedRaw([
      { store: 'settings', value: { key: 'sound', value: true } },
      { store: 'settings', value: { key: '__proto__', value: injected } },
      { store: 'settings', value: { key: 'constructor', value: injected } },
    ]);
    const h = harness();
    const repo = await open(h, factory, name);
    opened.push(repo);
    const loaded = await repo.load();
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, sound: true });
    expect('lastExportAt' in loaded.settings).toBe(false);
    expect(Object.getPrototypeOf(loaded.settings)).toBe(Object.prototype);
    expect(loaded.corrupt).toBe(0);
    expect(loaded.rawCorrupt).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it('treats a settings row whose key is not a string as corrupt', async () => {
    const { factory, name } = await seedRaw([
      { store: 'settings', value: { key: 'theme', value: 'dark' } },
      { store: 'settings', value: { key: 7, value: 'odd' } },
    ]);
    const h = harness();
    const repo = await open(h, factory, name);
    opened.push(repo);
    const loaded = await repo.load();
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded.corrupt).toBe(1);
    expect(loaded.rawCorrupt).toHaveLength(2);
    expect(h.notices).toEqual([{ kind: 'corrupt', count: 1 }]);
  });
});

describe('multi-request transactions are atomic', () => {
  async function seedRecovery(repo: Repo): Promise<void> {
    await repo.savePatient(patientRecovery());
    for (const e of fixtureEvents()) {
      await repo.appendEvent(e);
    }
  }

  async function expectDeleteRolledBackThenFlushed(
    repo: Repo,
    h: Harness,
    reasonPart: string,
  ): Promise<void> {
    const unhandled = await unhandledRejectionsDuring(async () => {
      await repo.deletePatient('p-recovery');
    });
    expect(unhandled).toEqual([]);
    vi.restoreAllMocks();
    expect(h.waits).toEqual([5]);
    expect(h.notices).toHaveLength(1);
    const failed = h.notices[0];
    expect(failed).toMatchObject({ kind: 'write_failed' });
    if (failed?.kind === 'write_failed') {
      expect(failed.reason).toContain(reasonPart);
    }
    const intact = await repo.load();
    expect(intact.patients).toEqual([patientRecovery()]);
    expect(intact.events).toEqual(fixtureEvents());

    await repo.savePatient(patientFresh());
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
    const after = await repo.load();
    expect(after.patients).toEqual([patientFresh()]);
    expect(after.events).toEqual([]);
  }

  it('deletePatient rolls back entirely when a cursor delete throws synchronously', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await seedRecovery(repo);
    const spy = failNextCursorDeletes(2, quotaError(), true);
    await expectDeleteRolledBackThenFlushed(repo, h, 'QuotaExceededError: quota');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('deletePatient rolls back entirely when a cursor delete request errors', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await seedRecovery(repo);
    const spy = failNextCursorDeletes(2, quotaError());
    await expectDeleteRolledBackThenFlushed(repo, h, 'QuotaExceededError');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('saveSettings keeps the previous rows when a put throws after the clear', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await repo.saveSettings(FIXTURE_SETTINGS);
    const next = { ...FIXTURE_SETTINGS, theme: 'dark' as const, lastExportAt: FIXED_NOW_ISO };
    failNextPuts(2, new DOMException('cannot clone', 'DataCloneError'), true);
    const unhandled = await unhandledRejectionsDuring(async () => {
      await repo.saveSettings(next);
    });
    expect(unhandled).toEqual([]);
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed']);
    expect((await repo.load()).settings).toEqual(FIXTURE_SETTINGS);

    await repo.appendEvent(nth(fixtureEvents(), 0));
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
    expect((await repo.load()).settings).toEqual(next);
  });

  it('clearAll leaves every store intact when a clear fails, then applies on flush', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    await seedAll(repo);
    const spy = failNextClears(2, quotaError(), true);
    const unhandled = await unhandledRejectionsDuring(async () => {
      await repo.clearAll();
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(unhandled).toEqual([]);
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed']);
    const intact = await repo.load();
    expect(byId(intact.patients)).toEqual(byId(allFixturePatients()));
    expect(intact.events).toEqual(fixtureEvents());
    expect(intact.settings).toEqual({ ...FIXTURE_SETTINGS, lastExportAt: FIXED_NOW_ISO });

    await repo.savePatient(patientFresh());
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
    expect(await repo.load()).toEqual({
      patients: [patientFresh()],
      events: [],
      settings: DEFAULT_SETTINGS,
      corrupt: 0,
      rawCorrupt: [],
    });
  });
});

describe('write retry and queue', () => {
  it('retries once after the delay and emits nothing when the retry succeeds', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName(), 7);
    opened.push(repo);
    const spy = failNextPuts(1, quotaError());
    await repo.savePatient(patientFresh());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(h.waits).toEqual([7]);
    expect(h.notices).toEqual([]);
    expect((await repo.load()).patients).toEqual([patientFresh()]);
  });

  it('queues a write that fails twice, flushes it in order on the next write, then recovers', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    const v1: Patient = { ...patientFresh(), name: 'Fixture Version One' };
    const v2: Patient = { ...patientFresh(), name: 'Fixture Version Two' };
    const spy = failNextPuts(2, quotaError());
    await repo.savePatient(v1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(h.waits).toEqual([5]);
    expect(h.notices).toHaveLength(1);
    const failed = h.notices[0];
    expect(failed).toMatchObject({ kind: 'write_failed' });
    if (failed?.kind === 'write_failed') {
      expect(failed.reason).toContain('QuotaExceededError');
    }
    expect((await repo.load()).patients).toEqual([]);

    await repo.savePatient(v2);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
    expect((await repo.load()).patients).toEqual([v2]);

    await repo.appendEvent(nth(fixtureEvents(), 0));
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
  });

  it('keeps the whole backlog until storage works again, in submission order', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    const events = fixtureEvents();
    failNextPuts(4, quotaError());
    await repo.appendEvent(nth(events, 0));
    await repo.appendEvent(nth(events, 1));
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'write_failed']);
    expect((await repo.load()).events).toEqual([]);

    await repo.appendEvent(nth(events, 2));
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'write_failed', 'recovered']);
    expect((await repo.load()).events).toEqual(events.slice(0, 3));
    expect(h.waits).toEqual([5, 5]);
  });

  it('follows the same path when put throws synchronously', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    failNextPuts(2, new DOMException('cannot clone', 'DataCloneError'), true);
    await repo.savePatient(patientFresh());
    expect(h.notices).toHaveLength(1);
    const failed = h.notices[0];
    if (failed?.kind === 'write_failed') {
      expect(failed.reason).toContain('DataCloneError: cannot clone');
    }
    await repo.savePatient(patientPreOp());
    expect(h.notices.map((n) => n.kind)).toEqual(['write_failed', 'recovered']);
    expect(byId((await repo.load()).patients)).toEqual(byId([patientFresh(), patientPreOp()]));
  });

  it('serialises concurrent writes so a retried write never lands after a newer one', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    const v1: Patient = { ...patientFresh(), name: 'Fixture Version One' };
    const v2: Patient = { ...patientFresh(), name: 'Fixture Version Two' };
    failNextPuts(1, quotaError());
    await Promise.all([repo.savePatient(v1), repo.savePatient(v2)]);
    expect((await repo.load()).patients).toEqual([v2]);
    expect(h.notices).toEqual([]);
  });

  it('waits the default 250 ms with a real timer when none is injected', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const repo = await openRepo({ dbName: uniqueName(), indexedDB: freshFactory() });
      opened.push(repo);
      const notices: unknown[] = [];
      repo.subscribe((n) => notices.push(n));
      const spy = failNextPuts(1, quotaError());
      const pending = repo.savePatient(patientFresh());
      await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAY_MS - 1);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(spy).toHaveBeenCalledTimes(2);
      expect(notices).toEqual([]);
      expect(DEFAULT_RETRY_DELAY_MS).toBe(250);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a listener error to the caller and keeps accepting writes', async () => {
    const h = harness();
    const repo = await open(h, freshFactory(), uniqueName());
    opened.push(repo);
    repo.subscribe(() => {
      throw new Error('listener exploded');
    });
    failNextPuts(2, quotaError());
    await expect(repo.savePatient(patientFresh())).rejects.toThrow('listener exploded');
    await expect(repo.savePatient(patientPreOp())).rejects.toThrow('listener exploded');
    expect(byId((await repo.load()).patients)).toEqual(byId([patientFresh(), patientPreOp()]));
  });
});
