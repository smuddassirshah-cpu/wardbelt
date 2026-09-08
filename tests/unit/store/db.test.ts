import { describe, expect, it, vi } from 'vitest';
import {
  BlockedError,
  DB_NAME,
  DB_VERSION,
  MIGRATIONS,
  openDatabase,
  upgrade,
  type Db,
} from '../../../src/store/db';
import { patientFresh } from '../../fixtures/synthetic';
import { factoryFiring, freshFactory, rawGetAll, rawOpen } from './helpers';

describe('openDatabase', () => {
  it('creates the three stores and their indexes on a fresh open', async () => {
    const db = await openDatabase(freshFactory());
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['events', 'patients', 'settings']);
    const tx = db.transaction(['patients', 'events', 'settings']);
    const patients = tx.objectStore('patients');
    const events = tx.objectStore('events');
    const settings = tx.objectStore('settings');
    expect(patients.keyPath).toBe('id');
    expect([...patients.indexNames]).toEqual(['status']);
    expect(patients.index('status').keyPath).toBe('status');
    expect(events.keyPath).toBe('id');
    expect([...events.indexNames]).toEqual(['at']);
    expect(events.index('at').keyPath).toBe('at');
    expect(settings.keyPath).toBe('key');
    expect([...settings.indexNames]).toEqual([]);
    await tx.done;
    db.close();
  });

  it('keeps records when an existing v1 database is reopened', async () => {
    const factory = freshFactory();
    const first = await openDatabase(factory, 'reopen');
    await first.put('patients', patientFresh());
    await first.put('settings', { key: 'theme', value: 'dark' });
    first.close();
    const second = await openDatabase(factory, 'reopen');
    expect(second.version).toBe(1);
    expect(await second.get('patients', 'p-fresh')).toEqual(patientFresh());
    expect(await second.getAll('settings')).toEqual([{ key: 'theme', value: 'dark' }]);
    second.close();
    const raw = await rawOpen(factory, 'reopen');
    expect(await rawGetAll(raw, 'patients')).toHaveLength(1);
    raw.close();
  });

  it('rejects with BlockedError when another connection blocks the upgrade', async () => {
    const factory = freshFactory();
    const holder = await rawOpen(factory, 'blocked', 1);
    const seen: number[] = [];
    holder.addEventListener('versionchange', (event) => {
      seen.push(event.newVersion ?? -1);
    });
    const pending = openDatabase(factory, 'blocked', 2);
    await expect(pending).rejects.toBeInstanceOf(BlockedError);
    expect(seen).toEqual([2]);
    holder.close();
  });

  it('closes a connection that succeeds after it was reported blocked', async () => {
    const close = vi.fn();
    const addEventListener = vi.fn();
    const factory = factoryFiring(['blocked', 'success'], null, { close, addEventListener });
    await expect(openDatabase(factory, 'late')).rejects.toBeInstanceOf(BlockedError);
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('rejects with the request error, or a generic error when none is set', async () => {
    const quota = new DOMException('quota', 'QuotaExceededError');
    await expect(openDatabase(factoryFiring(['error'], quota), 'err')).rejects.toBe(quota);
    await expect(openDatabase(factoryFiring(['error']), 'err')).rejects.toThrow(
      'Database open failed',
    );
  });

  it('rejects with VersionError when the stored version is newer', async () => {
    const factory = freshFactory();
    const newer = await rawOpen(factory, 'newer', 3);
    newer.close();
    await expect(openDatabase(factory, 'newer', 1)).rejects.toMatchObject({
      name: 'VersionError',
    });
  });

  it('closes itself on versionchange so a later upgrade is not blocked', async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory, 'vc');
    const blocked = vi.fn();
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('vc', 2);
      req.addEventListener('blocked', blocked);
      req.addEventListener('success', () => {
        resolve(req.result);
      });
      req.addEventListener('error', () => {
        reject(req.error ?? new Error('open failed'));
      });
    });
    expect(blocked).not.toHaveBeenCalled();
    expect(upgraded.version).toBe(2);
    expect(() => db.transaction('patients')).toThrow();
    upgraded.close();
  });
});

describe('upgrade', () => {
  function fakeDb(): { db: Db; created: string[] } {
    const created: string[] = [];
    const db = {
      createObjectStore: (name: string) => {
        created.push(name);
        return {
          createIndex: (index: string) => {
            created.push(`${name}.${index}`);
          },
        };
      },
    } as unknown as Db;
    return { db, created };
  }

  it('applies every step after oldVersion up to newVersion in order', () => {
    const { db, created } = fakeDb();
    upgrade(db, 0, 1);
    expect(created).toEqual(['patients', 'patients.status', 'events', 'events.at', 'settings']);
  });

  it('applies nothing when already at the target version', () => {
    const { db, created } = fakeDb();
    upgrade(db, 1, 1);
    expect(created).toEqual([]);
  });

  it('throws for a version with no migration step', () => {
    const { db } = fakeDb();
    expect(() => {
      upgrade(db, 1, 2);
    }).toThrow('No migration step for database version 2');
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
  });

  it('aborts and rolls back the open when a step throws', async () => {
    const factory = freshFactory();
    await expect(openDatabase(factory, 'abort', 2)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const probe = await rawOpen(factory, 'abort', 1);
    expect([...probe.objectStoreNames]).toEqual([]);
    probe.close();
  });
});
