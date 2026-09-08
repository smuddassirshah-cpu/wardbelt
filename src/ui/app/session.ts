// Decision notes: the composition root for one tab (PLAN.md sections 6 and 8). Everything
// platform-specific arrives through `Platform` so the whole session runs under jsdom with fakes.
// The store is created at once with a promise of the repo, so the app can render before boot
// and any write waits for the repo; boot resolves the lock and the repo together, hydrates,
// and only a primary tab starts the scheduler (a read-only tab must never dispatch DUE or
// vibrate). Flows (complete, skip, discharge) own feedback and the undo toast so the views stay
// presentational. The scheduler's notifier honours the notifications setting: off means
// vibration only. The transient banner carries platform errors (notifier, feedback, service
// worker, a rejected write chain) and clears itself after a few seconds.
import { isBeltComplete } from '@domain/patient';
import { shiftStats, type ShiftStats } from '@domain/stats';
import type { Action, Patient, PatientForm, Settings, State } from '@domain/types';
import type { CustomTaskInput } from '@domain/validate';
import type { Clock } from '@scheduler/clock';
import {
  createNotifier,
  DUE_VIBRATION,
  type NotifierApi,
  type NotifyDeps,
} from '@scheduler/notify';
import { createTimers, type Notifier } from '@scheduler/timers';
import type { Repo, RepoOptions, StorageNotice } from '@store/repo';
import { buildExport, exportRawStore, parseImport, serialiseExport } from '@store/transfer';
import { computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { beltCompleteFeedback, completionFeedback } from '../feedback';
import type { NotificationState, StorageMode } from '../Settings';
import { applyTheme } from '../theme';
import { createActionFactory, dischargeIsUndoable } from './actions';
import { bootRepo } from './boot';
import { describeError } from './errors';
import { createIdSource, type IdSource } from './ids';
import type { TabLock } from './lock';
import { nextStorageBanner, type StorageBanner } from './notices';
import { setupServiceWorker, type RegisterSw } from './sw';
import { createStore } from './store';

export const LOCK_HELD_MESSAGE = 'Wardbelt is open in another tab';
export const LOCK_RELEASED_MESSAGE = 'The other tab has closed. Reload to take over.';
export const TRANSIENT_MS = 8000;
export const EXPORT_FAILED = 'Export failed: the file could not be saved';
export const RAW_EXPORT_FILENAME = 'wardbelt-unreadable-records.json';

export interface Platform {
  clock: Clock;
  openRepo: (options?: RepoOptions) => Promise<Repo>;
  acquireLock: (onReleased: () => void) => Promise<TabLock>;
  notifyDeps: NotifyDeps;
  registerSw: RegisterSw | undefined;
  swSupported: boolean;
  onVisible: (fn: () => void) => void;
  download: (filename: string, text: string) => boolean;
  reducedMotion: () => boolean;
  version: string;
  bootTimeoutMs?: number | undefined;
  ids?: IdSource | undefined;
}

export interface ToastItem {
  id: number;
  message: string;
  undoPatientId?: string;
}

export interface Banners {
  readonly storage: Signal<StorageBanner | undefined>;
  readonly corrupt: Signal<number>;
  readonly transient: Signal<string | undefined>;
  readonly lock: Signal<string | undefined>;
}

export interface SessionActions {
  addPatient: (form: PatientForm) => string;
  complete: (patientId: string, taskId: string) => void;
  skip: (patientId: string, taskId: string) => void;
  undo: (patientId: string) => void;
  addTask: (patientId: string, input: CustomTaskInput, afterTaskId?: string) => void;
  setNote: (patientId: string, taskId: string | undefined, note: string) => void;
  setTheatreReturn: (patientId: string, returnedAt: string) => void;
  discharge: (patientId: string) => void;
  deletePatient: (patientId: string) => void;
  setSettings: (settings: Partial<Settings>) => void;
  requestNotifications: () => void;
  exportData: () => void;
  importText: (text: string) => void;
  purgeDischarged: () => void;
  reset: () => void;
}

export interface Session {
  readonly state: Signal<State>;
  readonly ready: Signal<boolean>;
  readonly readOnly: Signal<boolean>;
  readonly storageMode: Signal<StorageMode>;
  readonly notificationState: Signal<NotificationState>;
  readonly banners: Banners;
  readonly updateReady: ReadonlySignal<boolean>;
  readonly toast: Signal<ToastItem | undefined>;
  readonly notifier: NotifierApi;
  readonly version: string;
  readonly actions: SessionActions;
  stats: () => ShiftStats;
  dismissToast: () => void;
  dismissCorrupt: () => void;
  dismissTransient: () => void;
  exportRawCorrupt: () => void;
  reloadForUpdate: () => void;
  /** Resolves when the lock is decided and the store is hydrated. */
  start: () => Promise<void>;
  /** Resolves when every write queued so far has been submitted. */
  flush: () => Promise<void>;
}

export function createSession(platform: Platform): Session {
  const { clock } = platform;
  const ids = platform.ids ?? createIdSource(clock);
  const factory = createActionFactory(ids);

  const ready = signal(false);
  const readOnly = signal(false);
  const storageMode = signal<StorageMode>('idb');
  const toast = signal<ToastItem | undefined>(undefined);
  const banners: Banners = {
    storage: signal<StorageBanner | undefined>(undefined),
    corrupt: signal(0),
    transient: signal<string | undefined>(undefined),
    lock: signal<string | undefined>(undefined),
  };
  let rawCorrupt: readonly unknown[] = [];
  let toastSeq = 0;
  let transientTimer: number | undefined;

  const transient = (message: string): void => {
    banners.transient.value = message;
    if (transientTimer !== undefined) {
      clock.clearTimeout(transientTimer);
    }
    transientTimer = clock.setTimeout(() => {
      transientTimer = undefined;
      banners.transient.value = undefined;
    }, TRANSIENT_MS);
  };

  let resolveRepo: (repo: Repo) => void = () => undefined;
  const repoPromise = new Promise<Repo>((resolve) => {
    resolveRepo = resolve;
  });
  const store = createStore({ repo: repoPromise, clock, onError: transient });
  const { state } = store;

  const notifier = createNotifier({ ...platform.notifyDeps, onError: transient });
  const notificationState = signal<NotificationState>(notifier.state());
  const gated: Notifier = {
    due: (tasks) => {
      if (state.value.settings.notifications) {
        notifier.due(tasks);
      } else if (tasks.length > 0) {
        notifier.vibrate([...DUE_VIBRATION]);
      }
    },
  };
  const timers = createTimers({
    clock,
    getPatients: () => Object.values(state.value.patients),
    dispatch: store.dispatch,
    notifier: gated,
  });
  store.subscribe(() => {
    timers.reschedule();
  });
  effect(() => {
    applyTheme(state.value.settings.theme);
  });

  const sw = setupServiceWorker(platform.registerSw, transient, platform.swSupported);

  const applyNotice = (notice: StorageNotice): void => {
    banners.storage.value = nextStorageBanner(banners.storage.value, notice);
    if (notice.kind === 'corrupt') {
      banners.corrupt.value = notice.count;
    }
  };

  const showToast = (message: string, undoPatientId?: string): void => {
    toastSeq += 1;
    const item: ToastItem = { id: toastSeq, message };
    if (undoPatientId !== undefined) {
      item.undoPatientId = undoPatientId;
    }
    toast.value = item;
  };

  const dispatch = (action: Action): boolean => {
    if (readOnly.value) {
      return false;
    }
    const before = state.value;
    store.dispatch(action);
    return state.value !== before;
  };

  /** Completion feedback: the three-pulse pattern once nothing is left on the belt. */
  const completed = (patient: Patient): void => {
    const opts = {
      sound: state.value.settings.sound,
      reducedMotion: platform.reducedMotion(),
      onError: (e: unknown) => {
        transient(describeError(e));
      },
    };
    if (isBeltComplete(patient)) {
      beltCompleteFeedback(opts);
    } else {
      completionFeedback(opts);
    }
  };

  const settle = (patientId: string, taskId: string, complete: boolean): void => {
    const before = state.value.patients[patientId];
    const action = complete
      ? factory.completeTask(patientId, taskId)
      : factory.skipTask(patientId, taskId);
    if (before === undefined || !dispatch(action)) {
      return;
    }
    const after = state.value.patients[patientId];
    if (after === undefined || after === before) {
      return;
    }
    const label = after.tasks.find((t) => t.id === taskId)?.label ?? 'Task';
    if (complete) {
      completed(after);
    }
    showToast(`${label} ${complete ? 'completed' : 'skipped'}`, patientId);
  };

  const refreshPermission = (): void => {
    notificationState.value = notifier.state();
  };

  const actions: SessionActions = {
    addPatient: (form) => {
      const { action, patientId } = factory.addPatient(form);
      dispatch(action);
      return patientId;
    },
    complete: (patientId, taskId) => {
      settle(patientId, taskId, true);
    },
    skip: (patientId, taskId) => {
      settle(patientId, taskId, false);
    },
    undo: (patientId) => {
      if (dispatch(factory.undo(patientId))) {
        toast.value = undefined;
      }
    },
    addTask: (patientId, input, afterTaskId) => {
      dispatch(factory.addTask(patientId, input, afterTaskId));
    },
    setNote: (patientId, taskId, note) => {
      dispatch(factory.setNote(patientId, taskId, note));
    },
    setTheatreReturn: (patientId, returnedAt) => {
      dispatch(factory.setTheatreReturn(patientId, returnedAt));
    },
    discharge: (patientId) => {
      const patient = state.value.patients[patientId];
      if (patient === undefined || patient.status === 'discharged') {
        return;
      }
      const undoable = dischargeIsUndoable(patient);
      if (!dispatch(factory.discharge(patient))) {
        return;
      }
      const after = state.value.patients[patientId];
      if (undoable && after !== undefined) {
        completed(after);
        showToast(`${patient.name} discharged`, patientId);
      } else {
        showToast(`${patient.name} discharged`);
      }
    },
    deletePatient: (patientId) => {
      if (dispatch(factory.deletePatient(patientId))) {
        toast.value = undefined;
      }
    },
    setSettings: (settings) => {
      dispatch(factory.setSettings(settings));
    },
    requestNotifications: () => {
      notifier.requestPermission().then(refreshPermission, (e: unknown) => {
        transient(describeError(e));
      });
    },
    exportData: () => {
      const s = state.value;
      const exportedAt = new Date(clock.now()).toISOString();
      const file = buildExport(Object.values(s.patients), s.events, s.settings, exportedAt);
      const name = `wardbelt-export-${exportedAt.slice(0, 10)}.json`;
      if (!platform.download(name, serialiseExport(file))) {
        transient(EXPORT_FAILED);
        return;
      }
      dispatch(factory.setSettings({ lastExportAt: exportedAt }));
      showToast('Exported');
    },
    importText: (text) => {
      const result = parseImport(text);
      if (!result.ok) {
        const count =
          result.failingRecords > 0 ? ` (${result.failingRecords} invalid records)` : '';
        transient(`Import rejected: ${result.message}${count}`);
        return;
      }
      if (dispatch(factory.importData(result.value))) {
        showToast(`Imported ${result.value.patients.length} patients`);
      }
    },
    purgeDischarged: () => {
      dispatch(factory.purgeDischarged());
    },
    reset: () => {
      if (dispatch(factory.reset())) {
        toast.value = undefined;
      }
    },
  };

  let lock: TabLock | undefined;

  return {
    state,
    ready,
    readOnly,
    storageMode,
    notificationState,
    banners,
    updateReady: computed(() => sw.updateReady.value),
    toast,
    notifier,
    version: platform.version,
    actions,
    stats: () => shiftStats(state.value, state.value.now),
    dismissToast: () => {
      toast.value = undefined;
    },
    dismissCorrupt: () => {
      banners.corrupt.value = 0;
    },
    dismissTransient: () => {
      banners.transient.value = undefined;
    },
    exportRawCorrupt: () => {
      if (!platform.download(RAW_EXPORT_FILENAME, exportRawStore(rawCorrupt))) {
        transient(EXPORT_FAILED);
      }
    },
    reloadForUpdate: () => {
      sw.reload();
    },
    start: async () => {
      if (lock !== undefined) {
        return;
      }
      const [acquired, booted] = await Promise.all([
        platform.acquireLock(() => {
          banners.lock.value = LOCK_RELEASED_MESSAGE;
        }),
        bootRepo({
          openRepo: platform.openRepo,
          onNotice: applyNotice,
          timeoutMs: platform.bootTimeoutMs,
        }),
      ]);
      lock = acquired;
      storageMode.value = booted.repo.mode;
      rawCorrupt = booted.load.rawCorrupt;
      resolveRepo(booted.repo);
      store.hydrate(booted.load);
      refreshPermission();
      if (acquired.role === 'readonly') {
        readOnly.value = true;
        banners.lock.value = LOCK_HELD_MESSAGE;
      } else {
        timers.start();
        timers.onVisible();
        platform.onVisible(() => {
          refreshPermission();
          timers.onVisible();
        });
      }
      ready.value = true;
    },
    flush: () => store.flush(),
  };
}
