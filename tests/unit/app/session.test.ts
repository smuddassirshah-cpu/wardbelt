import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, templateTaskId } from '../../../src/domain/types';
import { DUE_VIBRATION } from '../../../src/scheduler/notify';
import { buildExport, exportRawStore, serialiseExport } from '../../../src/store/transfer';
import { BOOT_TIMED_OUT, emptyLoad } from '../../../src/ui/app/boot';
import { STORAGE_UNAVAILABLE } from '../../../src/ui/app/notices';
import {
  createSession,
  EXPORT_FAILED,
  IMPORT_REJECTED,
  LOCK_HELD_MESSAGE,
  LOCK_RELEASED_MESSAGE,
  RAW_EXPORT_FILENAME,
  TRANSIENT_MS,
} from '../../../src/ui/app/session';
import { SW_INSTALL_FAILED } from '../../../src/ui/app/sw';
import { EXPORT_NUDGE_MS } from '../../../src/ui/app/transfer';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FORM_CAT,
  FORM_DOG,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientRecovery,
} from '../../fixtures/synthetic';
import { fakePlatform, fakeRepo, flushMicrotasks, type FakePlatformOptions } from './helpers';

async function booted(options: FakePlatformOptions = {}) {
  const platform = fakePlatform(options);
  const session = createSession(platform);
  await session.start();
  return { platform, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

describe('createSession boot', () => {
  it('renders before boot, then hydrates, arms the scheduler and sweeps once as primary', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientRecovery()] };
    const vibrate = vi.fn(() => true);
    const platform = fakePlatform({ repo, notifyDeps: { vibrate } });
    const session = createSession(platform);
    expect(session.ready.value).toBe(false);
    expect(session.state.value.patients).toEqual({});
    expect(platform.sw.register).toHaveBeenCalledTimes(1);
    await session.start();
    expect(session.ready.value).toBe(true);
    expect(session.readOnly.value).toBe(false);
    expect(session.storageMode.value).toBe('idb');
    expect(Object.keys(session.state.value.patients)).toEqual(['p-recovery']);
    expect(platform.clock.pending()).toBe(1);
    expect(vibrate).toHaveBeenCalledWith([...DUE_VIBRATION]);
    await session.flush();
    expect(repo.calls).toEqual([]);
    await session.start();
    expect(platform.clock.pending()).toBe(1);
  });

  it('is read-only when the lock is held: banner, no scheduler, actions ignored', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { platform, session } = await booted({ repo, role: 'readonly' });
    expect(session.readOnly.value).toBe(true);
    expect(session.banners.lock.value).toBe(LOCK_HELD_MESSAGE);
    expect(platform.clock.pending()).toBe(0);
    const before = session.state.value;
    session.actions.addPatient(FORM_DOG);
    session.actions.complete('p-fresh', templateTaskId('p-fresh', 'handover_admit'));
    session.actions.skip('p-fresh', templateTaskId('p-fresh', 'bloods'));
    session.actions.undo('p-fresh');
    session.actions.discharge('p-fresh');
    session.actions.deletePatient('p-fresh');
    session.actions.setSettings({ sound: true });
    session.actions.purgeDischarged();
    session.actions.reset();
    expect(session.state.value).toBe(before);
    expect(session.toast.value).toBeUndefined();
    expect(session.exportNudge.value).toBe(false);
    await session.flush();
    expect(repo.calls).toEqual([]);
    platform.released();
    expect(session.banners.lock.value).toBe(LOCK_RELEASED_MESSAGE);
  });

  it('ignores actions dispatched before hydration so the load cannot overwrite a write', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const platform = fakePlatform({ repo });
    const session = createSession(platform);
    const id = session.actions.addPatient(FORM_DOG);
    session.actions.setSettings({ sound: true });
    expect(session.state.value.patients[id]).toBeUndefined();
    expect(session.state.value.settings.sound).toBe(false);
    await session.start();
    expect(Object.keys(session.state.value.patients)).toEqual(['p-fresh']);
    await session.flush();
    expect(repo.calls).toEqual([]);
    session.actions.setSettings({ sound: true });
    await session.flush();
    expect(repo.calls).toEqual([{ op: 'saveSettings' }]);
  });

  it('purges stale discharged patients once at boot through the normal diff path', async () => {
    const repo = fakeRepo();
    const stale = { ...patientDischarged(), dischargedAt: isoPlus(FIXED_NOW_ISO, -60 * 24 * 31) };
    const recent = { ...patientDischarged(), id: 'p-recent' };
    repo.loadResult = { ...emptyLoad(), patients: [stale, recent, patientFresh()] };
    const { session } = await booted({ repo });
    expect(Object.keys(session.state.value.patients).sort()).toEqual(['p-fresh', 'p-recent']);
    expect(session.toast.value).toBeUndefined();
    await session.flush();
    expect(repo.calls).toEqual([{ op: 'deletePatient', id: 'p-discharged' }]);
  });

  it('respects purgeDays at boot and never purges in a read-only tab', async () => {
    const repo = fakeRepo();
    const stale = { ...patientDischarged(), dischargedAt: isoPlus(FIXED_NOW_ISO, -60 * 24 * 31) };
    repo.loadResult = {
      ...emptyLoad(),
      patients: [stale],
      settings: { ...DEFAULT_SETTINGS, purgeDays: 60 },
    };
    const kept = await booted({ repo });
    expect(Object.keys(kept.session.state.value.patients)).toEqual(['p-discharged']);
    const other = fakeRepo();
    other.loadResult = { ...emptyLoad(), patients: [stale] };
    const readonly = await booted({ repo: other, role: 'readonly' });
    expect(Object.keys(readonly.session.state.value.patients)).toEqual(['p-discharged']);
    await readonly.session.flush();
    expect(other.calls).toEqual([]);
  });

  it('falls back to memory mode with the storage banner when the open stalls', async () => {
    vi.useFakeTimers();
    const memory = fakeRepo('memory');
    const platform = fakePlatform({
      bootTimeoutMs: 5000,
      openRepo: (options) =>
        options === undefined ? new Promise(() => undefined) : Promise.resolve(memory),
    });
    const session = createSession(platform);
    const pending = session.start();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(session.ready.value).toBe(true);
    expect(session.storageMode.value).toBe('memory');
    expect(session.banners.storage.value).toEqual({
      kind: 'unavailable',
      message: STORAGE_UNAVAILABLE,
    });
    session.actions.addPatient(FORM_DOG);
    await session.flush();
    expect(memory.calls.map((c) => c.op)).toEqual(['savePatient', 'appendEvent']);
    expect(BOOT_TIMED_OUT).toContain('5 seconds');
  });
});

describe('storage notices', () => {
  it('maps notices to banners and exports the raw rows for a corrupt load', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), corrupt: 2, rawCorrupt: [{ id: 'bad' }, 'junk'] };
    repo.load = () => {
      repo.emit({ kind: 'corrupt', count: 2 });
      return Promise.resolve(repo.loadResult);
    };
    const { platform, session } = await booted({ repo });
    expect(session.banners.corrupt.value).toBe(2);
    session.exportRawCorrupt();
    expect(platform.downloads).toEqual([
      { filename: RAW_EXPORT_FILENAME, text: exportRawStore([{ id: 'bad' }, 'junk']) },
    ]);
    session.dismissCorrupt();
    expect(session.banners.corrupt.value).toBe(0);

    repo.emit({ kind: 'write_failed', reason: 'QuotaExceededError' });
    expect(session.banners.storage.value?.message).toBe(
      `${STORAGE_UNAVAILABLE}. QuotaExceededError`,
    );
    repo.emit({ kind: 'recovered' });
    expect(session.banners.storage.value).toBeUndefined();
    repo.emit({ kind: 'unavailable', reason: 'gone' });
    repo.emit({ kind: 'recovered' });
    expect(session.banners.storage.value?.kind).toBe('unavailable');

    platform.downloadOk = false;
    session.exportRawCorrupt();
    expect(session.banners.transient.value).toBe(EXPORT_FAILED);
  });

  it('reports a rejected write chain through the transient banner, which clears itself', async () => {
    const repo = fakeRepo();
    const { platform, session } = await booted({ repo });
    repo.failNext(new Error('listener threw'));
    session.actions.addPatient(FORM_DOG);
    await session.flush();
    expect(session.banners.transient.value).toBe('Not saving: Error: listener threw');
    platform.clock.advance(TRANSIENT_MS - 1);
    expect(session.banners.transient.value).toBeDefined();
    platform.clock.advance(1);
    expect(session.banners.transient.value).toBeUndefined();
    platform.sw.options()?.onRegisterError?.(new Error('x'));
    expect(session.banners.transient.value).toBe(SW_INSTALL_FAILED);
    session.dismissTransient();
    expect(session.banners.transient.value).toBeUndefined();
  });
});

describe('flows', () => {
  it('completes with feedback and an undo toast; undo reverts and clears the toast', async () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    const repo = fakeRepo();
    const { session } = await booted({ repo });
    const id = session.actions.addPatient(FORM_DOG);
    const task = templateTaskId(id, 'handover_admit');
    session.actions.complete(id, task);
    expect(session.state.value.patients[id]?.tasks[0]?.status).toBe('done');
    expect(vibrate).toHaveBeenCalledWith(30);
    expect(session.toast.value).toMatchObject({
      message: 'Handover and admit completed',
      undoPatientId: id,
    });
    session.actions.complete(id, task);
    expect(vibrate).toHaveBeenCalledTimes(1);
    session.actions.complete('missing', task);
    session.actions.undo(id);
    expect(session.state.value.patients[id]?.tasks[0]?.status).toBe('todo');
    expect(session.toast.value).toBeUndefined();
    session.actions.skip(id, task);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(session.toast.value?.message).toBe('Handover and admit skipped');
    session.dismissToast();
    expect(session.toast.value).toBeUndefined();
    await session.flush();
    expect(repo.calls.map((c) => c.op)).toEqual([
      'savePatient',
      'appendEvent',
      'savePatient',
      'appendEvent',
      'savePatient',
      'appendEvent',
      'savePatient',
      'appendEvent',
    ]);
  });

  it('plays the belt-complete pattern on the last task and discharges undoably through the task', async () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    const { session } = await booted();
    const id = session.actions.addPatient(FORM_CAT);
    const patient = session.state.value.patients[id];
    for (const t of patient?.tasks ?? []) {
      if (t.key !== 'discharge') {
        session.actions.skip(id, t.id);
      }
    }
    session.actions.discharge(id);
    expect(session.state.value.patients[id]?.status).toBe('discharged');
    expect(vibrate).toHaveBeenLastCalledWith([30, 40, 30]);
    expect(session.toast.value).toMatchObject({
      message: 'Fixture Cat Two discharged',
      undoPatientId: id,
    });
    session.actions.discharge(id);
    session.actions.undo(id);
    expect(session.state.value.patients[id]?.status).toBe('active');
  });

  it('discharges without undo when the discharge task was skipped', async () => {
    const { session } = await booted();
    const id = session.actions.addPatient(FORM_DOG);
    session.actions.skip(id, templateTaskId(id, 'discharge'));
    session.actions.discharge(id);
    expect(session.state.value.patients[id]?.status).toBe('discharged');
    expect(session.toast.value).toEqual({ id: 2, message: 'Fixture Dog One discharged' });
    session.actions.discharge('missing');
    session.actions.deletePatient(id);
    expect(session.state.value.patients[id]).toBeUndefined();
    expect(session.toast.value).toBeUndefined();
  });

  it('adds tasks, notes and a theatre return', async () => {
    const { session } = await booted();
    const id = session.actions.addPatient(FORM_DOG);
    session.actions.addTask(
      id,
      { label: 'Bandage check', dueAt: isoPlus(FIXED_NOW_ISO, 20) },
      templateTaskId(id, 'premed'),
    );
    const tasks = session.state.value.patients[id]?.tasks ?? [];
    expect(tasks[4]).toMatchObject({ label: 'Bandage check', custom: true, order: 4 });
    session.actions.setNote(id, undefined, 'Calm');
    session.actions.setNote(id, tasks[4]?.id, 'Left fore');
    expect(session.state.value.patients[id]?.notes).toBe('Calm');
    expect(session.state.value.patients[id]?.tasks[4]?.note).toBe('Left fore');
    session.actions.setTheatreReturn(id, FIXED_NOW_ISO);
    expect(session.state.value.patients[id]?.theatreReturnAt).toBe(FIXED_NOW_ISO);
    expect(session.state.value.patients[id]?.tasks.find((t) => t.key === 'check_1')?.dueAt).toBe(
      isoPlus(FIXED_NOW_ISO, 15),
    );
  });
});

describe('settings, transfer and scheduler wiring', () => {
  it('applies the theme from settings and persists changes', async () => {
    const repo = fakeRepo();
    const { session } = await booted({ repo });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    session.actions.setSettings({ theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    session.actions.setSettings({ theme: 'system' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await session.flush();
    expect(repo.calls).toEqual([{ op: 'saveSettings' }, { op: 'saveSettings' }]);
  });

  it('exports through the download when the browser cannot share, and records the time', async () => {
    const { platform, session } = await booted();
    const id = session.actions.addPatient(FORM_DOG);
    await expect(session.actions.exportData()).resolves.toBe('downloaded');
    const s = session.state.value;
    const expected = serialiseExport(
      buildExport(Object.values(s.patients), s.events, { ...DEFAULT_SETTINGS }, FIXED_NOW_ISO),
    );
    expect(platform.downloads[0]?.filename).toBe('wardbelt-export-2026-03-10.json');
    expect(JSON.parse(platform.downloads[0]?.text ?? '')).toEqual(JSON.parse(expected));
    expect(s.settings.lastExportAt).toBe(FIXED_NOW_ISO);
    expect(s.patients[id]).toBeDefined();
    expect(session.toast.value?.message).toBe('Exported');
    expect(session.exportText.value).toBeUndefined();
  });

  it('prefers the Share API and treats a dismissed share sheet as no export', async () => {
    const share = vi.fn(() => Promise.resolve());
    const { platform, session } = await booted({ share: { canShare: () => true, share } });
    session.actions.addPatient(FORM_DOG);
    await expect(session.actions.exportData()).resolves.toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect(platform.downloads).toEqual([]);
    expect(session.state.value.settings.lastExportAt).toBe(FIXED_NOW_ISO);
    expect(session.toast.value?.message).toBe('Exported');

    session.dismissToast();
    platform.clock.set(FIXED_NOW_MS + 60_000);
    const abort = new Error('dismissed');
    abort.name = 'AbortError';
    share.mockImplementationOnce(() => Promise.reject(abort));
    await expect(session.actions.exportData()).resolves.toBe('cancelled');
    expect(session.state.value.settings.lastExportAt).toBe(FIXED_NOW_ISO);
    expect(session.toast.value).toBeUndefined();
    expect(platform.downloads).toEqual([]);
  });

  it('falls back to the copyable textarea when share and download both fail', async () => {
    const { platform, session } = await booted();
    session.actions.addPatient(FORM_DOG);
    platform.downloadOk = false;
    await expect(session.actions.exportData()).resolves.toBe('textarea');
    expect(session.exportText.value).toBe(platform.downloads[0]?.text);
    expect(JSON.parse(session.exportText.value ?? '')).toMatchObject({ schemaVersion: 1 });
    expect(session.state.value.settings.lastExportAt).toBeUndefined();
    expect(session.toast.value).toBeUndefined();
    expect(session.banners.transient.value).toBeUndefined();
    session.dismissTransfer();
    expect(session.exportText.value).toBeUndefined();
  });

  it('nudges weekly once there is a patient, until exported or dismissed for the session', async () => {
    const { platform, session } = await booted();
    expect(session.exportNudge.value).toBe(false);
    session.actions.addPatient(FORM_DOG);
    expect(session.exportNudge.value).toBe(true);
    await session.actions.exportData();
    expect(session.exportNudge.value).toBe(false);
    platform.clock.set(FIXED_NOW_MS + EXPORT_NUDGE_MS);
    platform.visible();
    expect(session.exportNudge.value).toBe(false);
    platform.clock.set(FIXED_NOW_MS + EXPORT_NUDGE_MS + 1);
    platform.visible();
    expect(session.exportNudge.value).toBe(true);
    session.dismissNudge();
    expect(session.exportNudge.value).toBe(false);
  });

  it('imports a valid file and rejects an invalid one whole', async () => {
    const { platform, session } = await booted();
    session.actions.addPatient(FORM_DOG);
    await session.actions.exportData();
    const text = platform.downloads[0]?.text ?? '';
    session.actions.reset();
    expect(session.state.value.patients).toEqual({});
    session.actions.importText('not json');
    expect(session.importError.value).toBe(`${IMPORT_REJECTED}: File is not valid JSON`);
    expect(session.state.value.patients).toEqual({});
    session.actions.importText(text);
    expect(Object.keys(session.state.value.patients)).toHaveLength(1);
    expect(session.toast.value?.message).toBe('Imported 1 patient');
    expect(session.importError.value).toBeUndefined();
    expect(session.banners.transient.value).toBeUndefined();
    const before = session.state.value;
    const broken = JSON.parse(text) as { patients: { name: unknown }[] };
    broken.patients[0] = { ...broken.patients[0], name: '' };
    session.actions.importText(JSON.stringify(broken));
    expect(session.importError.value).toBe(`${IMPORT_REJECTED}: 1 record failed validation`);
    expect(session.state.value).toBe(before);
    session.dismissTransfer();
    expect(session.importError.value).toBeUndefined();
    session.actions.importText(text);
    expect(session.toast.value?.message).toBe('Imported 1 patient');
  });

  it('purges stale discharged patients and resets everything', async () => {
    const repo = fakeRepo();
    const stale = { ...patientDischarged(), dischargedAt: isoPlus(FIXED_NOW_ISO, -60 * 24 * 40) };
    repo.loadResult = { ...emptyLoad(), patients: [stale, patientFresh()] };
    const { session } = await booted({ repo, startMs: FIXED_NOW_MS - 20 * 24 * 60 * 60_000 });
    expect(Object.keys(session.state.value.patients).sort()).toEqual(['p-discharged', 'p-fresh']);
    session.actions.purgeDischarged();
    expect(session.toast.value?.message).toBe('Nothing to purge');
    session.actions.setSettings({ purgeDays: 1 });
    session.actions.purgeDischarged();
    expect(Object.keys(session.state.value.patients)).toEqual(['p-fresh']);
    expect(session.toast.value?.message).toBe('Purged 1 discharged patient');
    session.actions.reset();
    expect(session.state.value.patients).toEqual({});
    await session.flush();
    expect(repo.calls.map((c) => c.op)).toEqual(['saveSettings', 'deletePatient', 'clearAll']);
  });

  it('reports nothing to purge once the wall clock has moved since the last action', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientDischarged(), patientFresh()] };
    const { platform, session } = await booted({ repo });
    platform.clock.advance(1);
    session.actions.purgeDischarged();
    expect(session.toast.value?.message).toBe('Nothing to purge');
    platform.clock.advance(60_000);
    session.actions.purgeDischarged();
    expect(session.toast.value?.message).toBe('Nothing to purge');
    expect(Object.keys(session.state.value.patients).sort()).toEqual(['p-discharged', 'p-fresh']);
    await session.flush();
    expect(repo.calls).toEqual([]);
  });

  it('keeps the undo toast when the clock moved but there was nothing to undo', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { platform, session } = await booted({ repo });
    session.actions.complete('p-fresh', templateTaskId('p-fresh', 'handover_admit'));
    const shown = session.toast.value;
    expect(shown?.undoPatientId).toBe('p-fresh');
    platform.clock.advance(1);
    session.actions.undo('p-missing');
    expect(session.toast.value).toBe(shown);
    session.actions.undo('p-fresh');
    expect(session.toast.value).toBeUndefined();
  });

  it('shows a notification for due checks only when the setting is on and permission granted', async () => {
    const showNotification = vi.fn(() => Promise.resolve());
    const getRegistration = vi.fn(() => Promise.resolve({ showNotification }));
    const vibrate = vi.fn(() => true);
    const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
    const notification = { permission: 'granted' as NotificationPermission, requestPermission };
    const repo = fakeRepo();
    const recovery = patientRecovery();
    repo.loadResult = { ...emptyLoad(), patients: [recovery] };
    const { platform, session } = await booted({
      repo,
      startMs: FIXED_NOW_MS - 6 * 60_000,
      notifyDeps: { vibrate, getRegistration, notification },
    });
    expect(session.notificationState.value).toBe('granted');
    expect(vibrate).not.toHaveBeenCalled();
    platform.clock.advance(60_000);
    expect(vibrate).toHaveBeenCalledWith([...DUE_VIBRATION]);
    await flushMicrotasks();
    expect(getRegistration).not.toHaveBeenCalled();
    session.actions.setSettings({ notifications: true });
    session.actions.undo(recovery.id);
    session.actions.setTheatreReturn(recovery.id, isoPlus(FIXED_NOW_ISO, -30));
    platform.clock.advance(60_000);
    await flushMicrotasks();
    expect(getRegistration).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledTimes(1);
    session.actions.requestNotifications();
    await flushMicrotasks();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(session.stats().patientsAdmitted).toBe(0);
  });

  it('sweeps on visibility and refreshes the permission state', async () => {
    let permission: NotificationPermission = 'default';
    const requestPermission = vi.fn(() => {
      permission = 'granted';
      return Promise.resolve(permission);
    });
    const notification = {
      get permission() {
        return permission;
      },
      requestPermission,
    };
    const { platform, session } = await booted({ notifyDeps: { notification } });
    expect(session.notificationState.value).toBe('default');
    session.actions.requestNotifications();
    await flushMicrotasks();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(session.notificationState.value).toBe('granted');
    const before = session.state.value.now;
    platform.clock.set(before + 5000);
    platform.visible();
    expect(session.state.value.now).toBe(before + 5000);
    expect(session.updateReady.value).toBe(false);
    platform.sw.options()?.onNeedRefresh?.();
    expect(session.updateReady.value).toBe(true);
    session.reloadForUpdate();
    expect(platform.sw.update).toHaveBeenCalledWith(true);
    expect(session.version).toBe('test');
  });
});
