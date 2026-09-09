import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserShare,
  EXPORT_NUDGE_MS,
  EXPORT_TITLE,
  exportFileName,
  exportText,
  needsExportNudge,
  type ShareApi,
} from '../../../src/ui/app/transfer';
import { FIXED_NOW_ISO, FIXED_NOW_MS, isoPlus } from '../../fixtures/synthetic';

const NAME = 'wardbelt-export-2026-03-10.json';
const TEXT = '{"schemaVersion":1}';

function shareApi(
  can: boolean,
  outcome: 'ok' | 'abort' | 'error' = 'ok',
): ShareApi & { canShare: ReturnType<typeof vi.fn>; share: ReturnType<typeof vi.fn> } {
  const canShare = vi.fn(() => can);
  const share = vi.fn(() => {
    if (outcome === 'ok') {
      return Promise.resolve();
    }
    const e = new Error(outcome);
    e.name = outcome === 'abort' ? 'AbortError' : 'NotAllowedError';
    return Promise.reject(e);
  });
  return { canShare, share };
}

describe('exportText fallback chain', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares a File when the browser can, without downloading', async () => {
    const api = shareApi(true);
    const download = vi.fn(() => true);
    await expect(exportText(NAME, TEXT, { share: api, download })).resolves.toBe('shared');
    expect(download).not.toHaveBeenCalled();
    const data = api.share.mock.calls[0]?.[0] as ShareData | undefined;
    expect(data?.title).toBe(EXPORT_TITLE);
    const file = data?.files?.[0];
    expect(file?.name).toBe(NAME);
    expect(file?.type).toBe('application/json');
    await expect(file?.text()).resolves.toBe(TEXT);
    expect(api.canShare.mock.calls[0]?.[0]).toBe(data);
  });

  it('downloads when canShare rejects files, when share throws, or when share is absent', async () => {
    const download = vi.fn(() => true);
    await expect(exportText(NAME, TEXT, { share: shareApi(false), download })).resolves.toBe(
      'downloaded',
    );
    await expect(
      exportText(NAME, TEXT, { share: shareApi(true, 'error'), download }),
    ).resolves.toBe('downloaded');
    await expect(exportText(NAME, TEXT, { share: {}, download })).resolves.toBe('downloaded');
    await expect(
      exportText(NAME, TEXT, { share: { canShare: () => true }, download }),
    ).resolves.toBe('downloaded');
    const throwing: ShareApi = {
      canShare: () => {
        throw new TypeError('bad data');
      },
      share: () => Promise.resolve(),
    };
    await expect(exportText(NAME, TEXT, { share: throwing, download })).resolves.toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(5);
    expect(download).toHaveBeenLastCalledWith(NAME, TEXT);
  });

  it('reports a dismissed share sheet as cancelled and does not download', async () => {
    const download = vi.fn(() => true);
    await expect(
      exportText(NAME, TEXT, { share: shareApi(true, 'abort'), download }),
    ).resolves.toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('ends in the textarea when the download fails too', async () => {
    const download = vi.fn(() => false);
    await expect(exportText(NAME, TEXT, { share: shareApi(false), download })).resolves.toBe(
      'textarea',
    );
  });

  it('skips sharing when the File constructor is missing', async () => {
    vi.stubGlobal('File', undefined);
    const api = shareApi(true);
    const download = vi.fn(() => true);
    await expect(exportText(NAME, TEXT, { share: api, download })).resolves.toBe('downloaded');
    expect(api.canShare).not.toHaveBeenCalled();
  });

  it('reads the browser share surface from navigator, or nothing without one', () => {
    expect(browserShare()).toBe(navigator);
    vi.stubGlobal('navigator', undefined);
    expect(browserShare()).toEqual({});
  });

  it('names the file by the local calendar date', () => {
    expect(exportFileName(new Date(2026, 2, 10, 23, 30).getTime())).toBe(NAME);
    expect(exportFileName(new Date(2026, 0, 1, 0, 0).getTime())).toBe(
      'wardbelt-export-2026-01-01.json',
    );
  });
});

describe('needsExportNudge', () => {
  it('nudges only with patients and no export in the last 7 days', () => {
    expect(needsExportNudge({}, 0, FIXED_NOW_MS)).toBe(false);
    expect(needsExportNudge({}, 1, FIXED_NOW_MS)).toBe(true);
    expect(needsExportNudge({ lastExportAt: 'garbage' }, 1, FIXED_NOW_MS)).toBe(true);
    const sevenDaysAgo = new Date(FIXED_NOW_MS - EXPORT_NUDGE_MS).toISOString();
    expect(needsExportNudge({ lastExportAt: sevenDaysAgo }, 1, FIXED_NOW_MS)).toBe(false);
    expect(needsExportNudge({ lastExportAt: sevenDaysAgo }, 1, FIXED_NOW_MS + 1)).toBe(true);
    expect(needsExportNudge({ lastExportAt: FIXED_NOW_ISO }, 3, FIXED_NOW_MS)).toBe(false);
    expect(needsExportNudge({ lastExportAt: isoPlus(FIXED_NOW_ISO, 60) }, 3, FIXED_NOW_MS)).toBe(
      false,
    );
  });
});
