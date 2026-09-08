// Decision notes: pure functions over the section 6 transfer format; the Share API and file
// download live in the UI (stage 6). Parsing delegates to validateImport, which enforces the
// schema and per-record rules, after a UTF-8 byte-length check so a multi-byte file cannot slip
// under the 10 MB cap measured in characters. Export copies records so the caller's state is
// never aliased by the serialised object.
import { IMPORT_SIZE_CAP_BYTES, validateImport, type ImportResult } from '../domain/validate';
import {
  TRANSFER_SCHEMA_VERSION,
  type Event,
  type Iso,
  type Patient,
  type Settings,
  type TransferFile,
} from '../domain/types';

export function buildExport(
  patients: readonly Patient[],
  events: readonly Event[],
  settings: Settings,
  exportedAt: Iso,
): TransferFile {
  return {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    exportedAt,
    patients: patients.map((p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t })) })),
    events: events.map((e) => ({ ...e })),
    settings: { ...settings },
  };
}

export function serialiseExport(file: TransferFile): string {
  return JSON.stringify(file, null, 2);
}

export function parseImport(text: string): ImportResult {
  if (new TextEncoder().encode(text).byteLength > IMPORT_SIZE_CAP_BYTES) {
    return { ok: false, message: 'File is larger than 10 MB', failingRecords: 0 };
  }
  return validateImport(text);
}

/** Raw corrupt rows from a load, for the recovery export offered by the UI. */
export function exportRawStore(rawCorrupt: readonly unknown[]): string {
  return JSON.stringify(
    { schemaVersion: TRANSFER_SCHEMA_VERSION, kind: 'raw-corrupt-records', records: rawCorrupt },
    null,
    2,
  );
}
