// Decision notes: everything platform-specific arrives through `NotifyDeps`, and
// `browserNotifyDeps` is the single place that reads globals, with feature detection so the
// module never throws where an API is missing (jsdom, desktop browsers without vibration).
// `state` reads the live permission each time so a change made in browser settings shows up
// without a reload. The prompt is only ever raised from the `default` state; a denial is final
// until the user changes it in the browser. Notification display is asynchronous and every
// failure is routed to `onError` as plain English; nothing about a patient beyond the name and
// task label ever reaches the platform, and nothing is logged.
import type { DueTask, Notifier } from './timers';

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotifyDeps {
  vibrate?: ((pattern: number | number[]) => boolean) | undefined;
  notification?:
    | { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> }
    | undefined;
  getRegistration?: () => Promise<
    { showNotification(title: string, options?: NotificationOptions): Promise<void> } | undefined
  >;
  onError?: (reason: string) => void;
}

export interface NotifierApi extends Notifier {
  state(): PermissionState;
  requestPermission(): Promise<PermissionState>;
  vibrate(pattern: number | number[]): void;
}

/** Chrome honours `renotify`; the DOM lib omits it, so it is added here rather than dropped. */
interface DueNotificationOptions extends NotificationOptions {
  renotify: boolean;
}

export const DUE_VIBRATION: readonly number[] = Object.freeze([200, 100, 200]);
export const DUE_TAG = 'wardbelt-due';
export const DUE_BODY_LINES = 5;

export function dueTitle(count: number): string {
  return `${count} check${count === 1 ? '' : 's'} due`;
}

export function dueBody(tasks: readonly DueTask[]): string {
  const lines = tasks.slice(0, DUE_BODY_LINES).map((t) => `${t.patientName}: ${t.label}`);
  const more = tasks.length - lines.length;
  if (more > 0) {
    lines.push(`and ${more} more`);
  }
  return lines.join('\n');
}

function describe(err: unknown): string {
  return err instanceof Error && err.message !== '' ? `: ${err.message}` : '';
}

export function createNotifier(deps: NotifyDeps = {}): NotifierApi {
  const onError = deps.onError ?? ((): void => undefined);

  const state = (): PermissionState =>
    deps.notification === undefined ? 'unsupported' : deps.notification.permission;

  const vibrate = (pattern: number | number[]): void => {
    if (deps.vibrate !== undefined) {
      deps.vibrate(pattern);
    }
  };

  const show = async (tasks: readonly DueTask[]): Promise<void> => {
    const registration =
      deps.getRegistration === undefined ? undefined : await deps.getRegistration();
    if (registration === undefined) {
      onError('Notification not shown: the service worker is not ready');
      return;
    }
    const options: DueNotificationOptions = {
      body: dueBody(tasks),
      tag: DUE_TAG,
      renotify: true,
    };
    await registration.showNotification(dueTitle(tasks.length), options);
  };

  return {
    state,
    vibrate,
    requestPermission: async () => {
      const current = state();
      if (current !== 'default' || deps.notification === undefined) {
        return current;
      }
      try {
        return await deps.notification.requestPermission();
      } catch (err: unknown) {
        onError(`Could not ask for notification permission${describe(err)}`);
        return state();
      }
    },
    due: (tasks) => {
      if (tasks.length === 0) {
        return;
      }
      vibrate([...DUE_VIBRATION]);
      if (state() !== 'granted') {
        return;
      }
      show(tasks).catch((err: unknown) => {
        onError(`Notification could not be shown${describe(err)}`);
      });
    },
  };
}

/** A partial view of the navigator so feature checks stay honest under the strict lint. */
interface DetectedNavigator {
  vibrate?: unknown;
  serviceWorker?: unknown;
}

export function browserNotifyDeps(): NotifyDeps {
  const deps: NotifyDeps = {};
  const nav: DetectedNavigator | undefined =
    typeof navigator === 'undefined' ? undefined : navigator;
  if (nav !== undefined && typeof nav.vibrate === 'function') {
    deps.vibrate = (pattern) => navigator.vibrate(pattern);
  }
  if (nav?.serviceWorker !== undefined) {
    deps.getRegistration = () => navigator.serviceWorker.getRegistration();
  }
  if (typeof Notification !== 'undefined') {
    deps.notification = {
      get permission() {
        return Notification.permission;
      },
      requestPermission: () => Notification.requestPermission(),
    };
  }
  return deps;
}
