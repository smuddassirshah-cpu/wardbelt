// Decision notes: the export fallback chain from PLAN.md section 8 (Share API, then an
// `<a download>` blob, then a copyable textarea) plus the weekly nudge rule from section 9,
// all pure or injectable so the session tests run with fakes. Web Share is attempted only
// when the browser can share a File; a share the nurse dismisses (AbortError) is reported as
// cancelled and nothing else happens, while any other share failure falls through to the
// download. The textarea outcome is never a failure: the caller shows the text. The file name
// carries the local calendar date because that is the date the nurse reads on the ward clock.
import { DAY_MS } from '@domain/time';
import type { Settings } from '@domain/types';

export type ExportOutcome = 'shared' | 'downloaded' | 'textarea' | 'cancelled';

/** The subset of Navigator the export uses; both members are feature-detected. */
export interface ShareApi {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export interface ExportDeps {
  share: ShareApi;
  download: (filename: string, text: string) => boolean;
}

export const EXPORT_NUDGE_MS = 7 * DAY_MS;
export const EXPORT_TITLE = 'Wardbelt export';
export const NUDGE_MESSAGE = 'No export in the last 7 days. Back up your data.';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function exportFileName(nowMs: number): string {
  const d = new Date(nowMs);
  return `wardbelt-export-${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
}

function jsonFile(name: string, text: string): File | undefined {
  return typeof File === 'function'
    ? new File([text], name, { type: 'application/json' })
    : undefined;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
}

/** 'shared' or 'cancelled' when the Share API handled it; undefined means try the next step. */
async function tryShare(
  name: string,
  text: string,
  api: ShareApi,
): Promise<'shared' | 'cancelled' | undefined> {
  const { canShare, share } = api;
  const file = jsonFile(name, text);
  if (canShare === undefined || share === undefined || file === undefined) {
    return undefined;
  }
  const data: ShareData = { files: [file], title: EXPORT_TITLE };
  try {
    if (!canShare.call(api, data)) {
      return undefined;
    }
    await share.call(api, data);
    return 'shared';
  } catch (e: unknown) {
    return isAbort(e) ? 'cancelled' : undefined;
  }
}

export async function exportText(
  name: string,
  text: string,
  deps: ExportDeps,
): Promise<ExportOutcome> {
  const shared = await tryShare(name, text, deps.share);
  if (shared !== undefined) {
    return shared;
  }
  return deps.download(name, text) ? 'downloaded' : 'textarea';
}

/** The browser's own share surface, or an empty object where Web Share does not exist. */
export function browserShare(): ShareApi {
  return typeof navigator === 'undefined' ? {} : navigator;
}

/** PLAN.md section 9: nudge weekly, and only once there is something worth exporting. */
export function needsExportNudge(
  settings: Pick<Settings, 'lastExportAt'>,
  patientCount: number,
  nowMs: number,
): boolean {
  if (patientCount === 0) {
    return false;
  }
  const last = settings.lastExportAt === undefined ? NaN : Date.parse(settings.lastExportAt);
  return !Number.isFinite(last) || nowMs - last > EXPORT_NUDGE_MS;
}
