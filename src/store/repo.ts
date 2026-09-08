// Decision notes: one Repo wraps one of two backends (IndexedDB or in-memory maps) so the
// retry, queue and notice logic is written once and memory mode is a real, fully working repo
// rather than a stub. All writes are serialised through a single promise chain: it costs
// nothing at ~300 events a shift and guarantees that a retried write can never land after a
// newer write to the same record. A failed write is retried once after `retryDelayMs`; a second
// failure queues it, emits `write_failed`, and the queue is flushed in order (ahead of the next
// write) the next time a write is submitted; `recovered` fires when the queue drains. Methods
// resolve rather than reject on storage failure because the notice is the surfacing channel
// and the action has already been applied in memory (PLAN.md section 8). `load()` propagates a
// read failure. Events are read from the store rather than the `at` index because the index
// cannot see rows whose `at` is not a valid key, and those are exactly the corrupt rows that
// must be counted and kept; the validated rows are then sorted by (at, id), which is the
// index order, at O(n log n). Settings are one logical record assembled from the rows: missing
// rows take defaults, any invalid value marks the whole record corrupt and keeps every row.
import { DEFAULT_SETTINGS, type Event, type Patient, type Settings } from '../domain/types';
import { validateEvent, validatePatientRecord, validateSettings } from '../domain/validate';
import { DB_NAME, openDatabase, type Db, type SettingsRow } from './db';

export type StorageNotice =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'write_failed'; reason: string }
  | { kind: 'corrupt'; count: number }
  | { kind: 'recovered' };

export interface LoadResult {
  patients: Patient[];
  events: Event[];
  settings: Settings;
  corrupt: number;
  rawCorrupt: unknown[];
}

export interface Repo {
  readonly mode: 'idb' | 'memory';
  load(): Promise<LoadResult>;
  savePatient(p: Patient): Promise<void>;
  deletePatient(id: string): Promise<void>;
  appendEvent(e: Event): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  clearAll(): Promise<void>;
  subscribe(listener: (n: StorageNotice) => void): () => void;
  close(): void;
}

export interface RepoOptions {
  dbName?: string;
  retryDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
  indexedDB?: IDBFactory | undefined;
}

export const DEFAULT_RETRY_DELAY_MS = 250;

const SETTINGS_KEYS = [
  'notifications',
  'sound',
  'theme',
  'purgeDays',
  'showOwnerPhone',
  'lastExportAt',
] as const satisfies readonly (keyof Settings)[];

interface RawStore {
  patients: unknown[];
  events: unknown[];
  settings: unknown[];
}

interface Backend {
  readAll(): Promise<RawStore>;
  putPatient(p: Patient): Promise<void>;
  deletePatient(id: string): Promise<void>;
  putEvent(e: Event): Promise<void>;
  putSettings(rows: SettingsRow[]): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

function settingsToRows(s: Settings): SettingsRow[] {
  const rows: SettingsRow[] = [];
  for (const key of SETTINGS_KEYS) {
    const value = s[key];
    if (value !== undefined) {
      rows.push({ key, value });
    }
  }
  return rows;
}

const noop = (): void => undefined;

/** Duck-typed: a DOMException is not an instanceof Error across realms (jsdom, workers). */
function describeError(e: unknown): string {
  if (typeof e === 'string') {
    return e;
  }
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') {
    const message = 'message' in e && typeof e.message === 'string' ? e.message : '';
    return message === '' ? e.name : `${e.name}: ${message}`;
  }
  return 'Unknown storage error';
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class IdbBackend implements Backend {
  constructor(private readonly db: Db) {}

  async readAll(): Promise<RawStore> {
    const tx = this.db.transaction(['patients', 'events', 'settings']);
    const [patients, events, settings] = await Promise.all([
      tx.objectStore('patients').getAll(),
      tx.objectStore('events').getAll(),
      tx.objectStore('settings').getAll(),
      tx.done,
    ]);
    return { patients, events, settings };
  }

  async putPatient(p: Patient): Promise<void> {
    await this.db.put('patients', p);
  }

  async deletePatient(id: string): Promise<void> {
    const tx = this.db.transaction(['patients', 'events'], 'readwrite');
    await tx.objectStore('patients').delete(id);
    for await (const cursor of tx.objectStore('events')) {
      if (cursor.value.patientId === id) {
        await cursor.delete();
      }
    }
    await tx.done;
  }

  async putEvent(e: Event): Promise<void> {
    await this.db.put('events', e);
  }

  async putSettings(rows: SettingsRow[]): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await tx.store.clear();
    await Promise.all(rows.map((row) => tx.store.put(row)));
    await tx.done;
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(['patients', 'events', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('patients').clear(),
      tx.objectStore('events').clear(),
      tx.objectStore('settings').clear(),
      tx.done,
    ]);
  }

  close(): void {
    this.db.close();
  }
}

class MemoryBackend implements Backend {
  private readonly patients = new Map<string, Patient>();
  private readonly events = new Map<string, Event>();
  private settings: SettingsRow[] = [];

  readAll(): Promise<RawStore> {
    return Promise.resolve({
      patients: [...this.patients.values()],
      events: [...this.events.values()],
      settings: [...this.settings],
    });
  }

  putPatient(p: Patient): Promise<void> {
    this.patients.set(p.id, p);
    return Promise.resolve();
  }

  deletePatient(id: string): Promise<void> {
    this.patients.delete(id);
    for (const [eventId, e] of this.events) {
      if (e.patientId === id) {
        this.events.delete(eventId);
      }
    }
    return Promise.resolve();
  }

  putEvent(e: Event): Promise<void> {
    this.events.set(e.id, e);
    return Promise.resolve();
  }

  putSettings(rows: SettingsRow[]): Promise<void> {
    this.settings = rows;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.patients.clear();
    this.events.clear();
    this.settings = [];
    return Promise.resolve();
  }

  readonly close = noop;
}

function isRow(u: unknown): u is SettingsRow {
  return typeof u === 'object' && u !== null && 'key' in u && typeof u.key === 'string';
}

function byAtThenId(a: Event, b: Event): number {
  if (a.at !== b.at) {
    return a.at < b.at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

type Write = () => Promise<void>;

class RepoImpl implements Repo {
  private readonly listeners = new Set<(n: StorageNotice) => void>();
  private readonly queue: Write[] = [];
  private chain: Promise<void> = Promise.resolve();
  private unavailable: StorageNotice | undefined;

  constructor(
    readonly mode: 'idb' | 'memory',
    private readonly backend: Backend,
    private readonly retryDelayMs: number,
    private readonly wait: (ms: number) => Promise<void>,
    unavailableReason?: string,
  ) {
    if (unavailableReason !== undefined) {
      this.unavailable = { kind: 'unavailable', reason: unavailableReason };
    }
  }

  subscribe(listener: (n: StorageNotice) => void): () => void {
    this.listeners.add(listener);
    if (this.unavailable !== undefined) {
      listener(this.unavailable);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(n: StorageNotice): void {
    for (const listener of this.listeners) {
      listener(n);
    }
  }

  async load(): Promise<LoadResult> {
    const raw = await this.backend.readAll();
    const rawCorrupt: unknown[] = [];
    const patients: Patient[] = [];
    for (const row of raw.patients) {
      const r = validatePatientRecord(row);
      if (r.ok) {
        patients.push(r.value);
      } else {
        rawCorrupt.push(row);
      }
    }
    const events: Event[] = [];
    for (const row of raw.events) {
      const r = validateEvent(row);
      if (r.ok) {
        events.push(r.value);
      } else {
        rawCorrupt.push(row);
      }
    }
    events.sort(byAtThenId);
    let corrupt = rawCorrupt.length;
    let settings: Settings = { ...DEFAULT_SETTINGS };
    if (raw.settings.length > 0) {
      const assembled: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      let wellFormed = true;
      for (const row of raw.settings) {
        if (isRow(row)) {
          assembled[row.key] = row.value;
        } else {
          wellFormed = false;
        }
      }
      const r = validateSettings(assembled);
      if (wellFormed && r.ok) {
        settings = r.value;
      } else {
        corrupt += 1;
        rawCorrupt.push(...raw.settings);
      }
    }
    if (corrupt > 0) {
      this.emit({ kind: 'corrupt', count: corrupt });
    }
    return { patients, events, settings, corrupt, rawCorrupt };
  }

  savePatient(p: Patient): Promise<void> {
    return this.submit(() => this.backend.putPatient(p));
  }

  deletePatient(id: string): Promise<void> {
    return this.submit(() => this.backend.deletePatient(id));
  }

  appendEvent(e: Event): Promise<void> {
    return this.submit(() => this.backend.putEvent(e));
  }

  saveSettings(s: Settings): Promise<void> {
    const rows = settingsToRows(s);
    return this.submit(() => this.backend.putSettings(rows));
  }

  clearAll(): Promise<void> {
    return this.submit(() => this.backend.clear());
  }

  close(): void {
    this.backend.close();
  }

  private submit(write: Write): Promise<void> {
    const run = this.chain.then(() => this.process(write));
    this.chain = run.then(noop, noop);
    return run;
  }

  private async process(write: Write): Promise<void> {
    this.queue.push(write);
    const hadBacklog = this.queue.length > 1;
    for (let next = this.queue[0]; next !== undefined; next = this.queue[0]) {
      const failure = await this.attempt(next);
      if (failure !== undefined) {
        this.emit({ kind: 'write_failed', reason: failure });
        return;
      }
      this.queue.shift();
    }
    if (hadBacklog) {
      this.emit({ kind: 'recovered' });
    }
  }

  /** One try plus one retry after the delay; resolves the failure reason, or undefined. */
  private async attempt(write: Write): Promise<string | undefined> {
    try {
      await write();
      return undefined;
    } catch (first) {
      await this.wait(this.retryDelayMs);
      try {
        await write();
        return undefined;
      } catch (second) {
        return `${describeError(second)} (first attempt: ${describeError(first)})`;
      }
    }
  }
}

function resolveFactory(options: RepoOptions): IDBFactory | undefined {
  if ('indexedDB' in options) {
    return options.indexedDB;
  }
  const g: { indexedDB?: IDBFactory } = globalThis;
  return g.indexedDB;
}

/** Never rejects: any open failure yields a memory-mode repo plus an `unavailable` notice. */
export async function openRepo(options: RepoOptions = {}): Promise<Repo> {
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const wait = options.wait ?? defaultWait;
  const factory = resolveFactory(options);
  if (factory === undefined) {
    return new RepoImpl(
      'memory',
      new MemoryBackend(),
      retryDelayMs,
      wait,
      'IndexedDB is not available in this browser or mode',
    );
  }
  try {
    const db = await openDatabase(factory, options.dbName ?? DB_NAME);
    return new RepoImpl('idb', new IdbBackend(db), retryDelayMs, wait);
  } catch (e) {
    return new RepoImpl('memory', new MemoryBackend(), retryDelayMs, wait, describeError(e));
  }
}
