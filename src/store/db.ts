// Decision notes: the open request is issued on an injected IDBFactory rather than through
// idb's openDB (which reads the global) so tests can pass an isolated factory or undefined to
// simulate private mode; idb's `wrap` still supplies the promise API. Migrations are a map of
// versioned steps applied incrementally from oldVersion + 1 to newVersion, so a version 2 is a
// new map entry and never a change to version 1. A `blocked` event rejects immediately (PLAN.md
// section 8: no retry loop); if the request later succeeds the late connection is closed. A
// `versionchange` from another tab closes the connection so a future upgrade is not blocked.
import { wrap, type DBSchema, type IDBPDatabase } from 'idb';
import { type Event, type Patient } from '../domain/types';

export const DB_NAME = 'wardbelt';
export const DB_VERSION = 1;

/** One row per Settings field. */
export interface SettingsRow {
  key: string;
  value: unknown;
}

export interface WardbeltDB extends DBSchema {
  patients: { key: string; value: Patient; indexes: { status: string } };
  events: { key: string; value: Event; indexes: { at: string } };
  settings: { key: string; value: SettingsRow };
}

export type Db = IDBPDatabase<WardbeltDB>;

type MigrationStep = (db: Db) => void;

export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = Object.freeze({
  1: (db) => {
    db.createObjectStore('patients', { keyPath: 'id' }).createIndex('status', 'status');
    db.createObjectStore('events', { keyPath: 'id' }).createIndex('at', 'at');
    db.createObjectStore('settings', { keyPath: 'key' });
  },
});

/** Applies every step after `oldVersion` up to and including `newVersion`, in order. */
export function upgrade(db: Db, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion + 1; v <= newVersion; v += 1) {
    const step = MIGRATIONS[v];
    if (step === undefined) {
      throw new Error(`No migration step for database version ${v}`);
    }
    step(db);
  }
}

export class BlockedError extends Error {
  constructor() {
    super('Another open connection is blocking the database upgrade');
    this.name = 'BlockedError';
  }
}

function asDb(raw: IDBDatabase): Db {
  return wrap(raw) as Db;
}

/** Opens (creating or migrating as needed). Rejects on error, blocked, or a synchronous throw. */
export function openDatabase(
  factory: IDBFactory,
  name: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<Db> {
  return new Promise<Db>((resolve, reject) => {
    const request = factory.open(name, version);
    let gaveUp = false;
    request.addEventListener('upgradeneeded', (event) => {
      upgrade(asDb(request.result), event.oldVersion, event.newVersion ?? version);
    });
    request.addEventListener('blocked', () => {
      gaveUp = true;
      reject(new BlockedError());
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Database open failed'));
    });
    request.addEventListener('success', () => {
      const raw = request.result;
      if (gaveUp) {
        raw.close();
        return;
      }
      raw.addEventListener('versionchange', () => {
        raw.close();
      });
      resolve(asDb(raw));
    });
  });
}
