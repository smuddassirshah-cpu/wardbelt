// No real timers: asynchronous paths are awaited through promises resolved by the fakes
// themselves (a trap resolves when the platform call or onError happens).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DUE_BODY_LINES,
  DUE_TAG,
  DUE_VIBRATION,
  browserNotifyDeps,
  createNotifier,
  dueBody,
  dueTitle,
  type NotifyDeps,
} from '../../../src/scheduler/notify';
import type { DueTask } from '../../../src/scheduler/timers';
import { FIXED_NOW_ISO, isoPlus } from '../../fixtures/synthetic';

function trap<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function task(n: number): DueTask {
  return {
    patientId: `p-${n}`,
    patientName: `Fixture Animal ${n}`,
    taskId: `p-${n}:check_1`,
    label: `Post-op check ${n}`,
    dueAt: isoPlus(FIXED_NOW_ISO, -n),
  };
}

function fakePermission(initial: NotificationPermission, answer: NotificationPermission = initial) {
  const state = { permission: initial, prompts: 0 };
  const notification: NonNullable<NotifyDeps['notification']> = {
    get permission() {
      return state.permission;
    },
    requestPermission: () => {
      state.prompts += 1;
      state.permission = answer;
      return Promise.resolve(answer);
    },
  };
  return { notification, state };
}

type Shown = [string, NotificationOptions | undefined];

function fakeRegistration() {
  const shown = trap<Shown>();
  const calls: Shown[] = [];
  const registration = {
    showNotification: (title: string, options?: NotificationOptions) => {
      calls.push([title, options]);
      shown.resolve([title, options]);
      return Promise.resolve();
    },
  };
  return { registration, shown, calls, getRegistration: () => Promise.resolve(registration) };
}

describe('dueTitle and dueBody', () => {
  it('pluralises the title and caps the body at five lines plus a count', () => {
    expect(dueTitle(1)).toBe('1 check due');
    expect(dueTitle(2)).toBe('2 checks due');
    expect(dueTitle(0)).toBe('0 checks due');
    expect(dueBody([task(1)])).toBe('Fixture Animal 1: Post-op check 1');
    expect(dueBody([task(1), task(2)])).toBe(
      'Fixture Animal 1: Post-op check 1\nFixture Animal 2: Post-op check 2',
    );
    const seven = [1, 2, 3, 4, 5, 6, 7].map(task);
    const lines = dueBody(seven).split('\n');
    expect(lines).toHaveLength(DUE_BODY_LINES + 1);
    expect(lines[4]).toBe('Fixture Animal 5: Post-op check 5');
    expect(lines[5]).toBe('and 2 more');
    expect(dueBody([1, 2, 3, 4, 5].map(task).slice(0, 5)).split('\n')).toHaveLength(5);
    expect(dueBody([1, 2, 3, 4, 5, 6].map(task)).split('\n')[5]).toBe('and 1 more');
  });
});

describe('createNotifier: permission state', () => {
  it('reports unsupported without a Notification API and never prompts', async () => {
    const n = createNotifier({});
    expect(n.state()).toBe('unsupported');
    await expect(n.requestPermission()).resolves.toBe('unsupported');
    const bare = createNotifier();
    expect(bare.state()).toBe('unsupported');
  });

  it('is a no-op when denied and never re-prompts', async () => {
    const perm = fakePermission('denied');
    const vibrations: (number | number[])[] = [];
    const reg = fakeRegistration();
    const errors: string[] = [];
    const n = createNotifier({
      notification: perm.notification,
      vibrate: (p) => {
        vibrations.push(p);
        return true;
      },
      getRegistration: reg.getRegistration,
      onError: (r) => errors.push(r),
    });
    expect(n.state()).toBe('denied');
    await expect(n.requestPermission()).resolves.toBe('denied');
    expect(perm.state.prompts).toBe(0);
    n.due([task(1)]);
    expect(vibrations).toEqual([[200, 100, 200]]);
    expect(reg.calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('prompts only from the default state and reflects the live answer', async () => {
    const perm = fakePermission('default', 'granted');
    const n = createNotifier({ notification: perm.notification });
    expect(n.state()).toBe('default');
    await expect(n.requestPermission()).resolves.toBe('granted');
    expect(perm.state.prompts).toBe(1);
    expect(n.state()).toBe('granted');
    await expect(n.requestPermission()).resolves.toBe('granted');
    expect(perm.state.prompts).toBe(1);
  });

  it('reports a prompt that fails and keeps the current state', async () => {
    const errors: string[] = [];
    const n = createNotifier({
      notification: {
        permission: 'default',
        requestPermission: () => Promise.reject(new Error('user gesture required')),
      },
      onError: (r) => errors.push(r),
    });
    await expect(n.requestPermission()).resolves.toBe('default');
    expect(errors).toEqual(['Could not ask for notification permission: user gesture required']);
  });

  it('does not show a notification from the default state', () => {
    const perm = fakePermission('default');
    const reg = fakeRegistration();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: reg.getRegistration,
    });
    n.due([task(1)]);
    expect(reg.calls).toEqual([]);
  });
});

describe('createNotifier: due', () => {
  it('vibrates then shows a notification with the exact title, body, tag and renotify', async () => {
    const perm = fakePermission('granted');
    const reg = fakeRegistration();
    const order: string[] = [];
    const n = createNotifier({
      notification: perm.notification,
      vibrate: (p) => {
        order.push(`vibrate:${JSON.stringify(p)}`);
        return true;
      },
      getRegistration: () => {
        order.push('registration');
        return reg.getRegistration();
      },
    });
    const tasks = [task(1), task(2)];
    n.due(tasks);
    const [title, options] = await reg.shown.promise;
    expect(title).toBe('2 checks due');
    expect(options).toEqual({
      body: 'Fixture Animal 1: Post-op check 1\nFixture Animal 2: Post-op check 2',
      tag: DUE_TAG,
      renotify: true,
    });
    expect(DUE_TAG).toBe('wardbelt-due');
    expect(order).toEqual([`vibrate:${JSON.stringify([...DUE_VIBRATION])}`, 'registration']);
    expect(reg.calls).toHaveLength(1);
  });

  it('shows one check due for a single task', async () => {
    const perm = fakePermission('granted');
    const reg = fakeRegistration();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: reg.getRegistration,
    });
    n.due([task(3)]);
    const [title, options] = await reg.shown.promise;
    expect(title).toBe('1 check due');
    expect(options?.body).toBe('Fixture Animal 3: Post-op check 3');
  });

  it('does nothing at all for an empty list', () => {
    const perm = fakePermission('granted');
    const reg = fakeRegistration();
    const vibrations: (number | number[])[] = [];
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: reg.getRegistration,
      vibrate: (p) => {
        vibrations.push(p);
        return true;
      },
    });
    n.due([]);
    expect(vibrations).toEqual([]);
    expect(reg.calls).toEqual([]);
  });

  it('routes a missing registration to onError', async () => {
    const perm = fakePermission('granted');
    const failed = trap<string>();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: () => Promise.resolve(undefined),
      onError: failed.resolve,
    });
    n.due([task(1)]);
    await expect(failed.promise).resolves.toBe(
      'Notification not shown: the service worker is not ready',
    );
  });

  it('routes an absent getRegistration to onError', async () => {
    const perm = fakePermission('granted');
    const failed = trap<string>();
    const n = createNotifier({ notification: perm.notification, onError: failed.resolve });
    n.due([task(1)]);
    await expect(failed.promise).resolves.toBe(
      'Notification not shown: the service worker is not ready',
    );
  });

  it('routes a rejecting showNotification to onError', async () => {
    const perm = fakePermission('granted');
    const failed = trap<string>();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: () =>
        Promise.resolve({
          showNotification: () => Promise.reject(new Error('no permission for this origin')),
        }),
      onError: failed.resolve,
    });
    n.due([task(1)]);
    await expect(failed.promise).resolves.toBe(
      'Notification could not be shown: no permission for this origin',
    );
  });

  it('routes a rejecting getRegistration and non-Error reasons to onError', async () => {
    const perm = fakePermission('granted');
    const failed = trap<string>();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: () => Promise.reject(new Error('')),
      onError: failed.resolve,
    });
    n.due([task(1)]);
    await expect(failed.promise).resolves.toBe('Notification could not be shown');
    const failedAgain = trap<string>();
    const m = createNotifier({
      notification: perm.notification,
      getRegistration: vi
        .fn<NonNullable<NotifyDeps['getRegistration']>>()
        .mockRejectedValue('plain string'),
      onError: failedAgain.resolve,
    });
    m.due([task(1)]);
    await expect(failedAgain.promise).resolves.toBe('Notification could not be shown');
  });

  it('swallows nothing but stays quiet without an onError handler', async () => {
    const perm = fakePermission('granted');
    const asked = trap<undefined>();
    const n = createNotifier({
      notification: perm.notification,
      getRegistration: () => {
        asked.resolve(undefined);
        return Promise.resolve(undefined);
      },
    });
    expect(() => {
      n.due([task(1)]);
    }).not.toThrow();
    await asked.promise;
  });
});

describe('createNotifier: vibrate', () => {
  it('is a no-op without navigator.vibrate and forwards the pattern when present', () => {
    const silent = createNotifier({});
    expect(() => {
      silent.vibrate(30);
      silent.vibrate([30, 40, 30]);
    }).not.toThrow();
    const patterns: (number | number[])[] = [];
    const n = createNotifier({
      vibrate: (p) => {
        patterns.push(p);
        return true;
      },
    });
    n.vibrate(30);
    n.vibrate([30, 40, 30]);
    expect(patterns).toEqual([30, [30, 40, 30]]);
  });
});

describe('browserNotifyDeps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'vibrate');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('feature-detects without throwing in jsdom', () => {
    const deps = browserNotifyDeps();
    expect(deps.onError).toBeUndefined();
    const n = createNotifier(deps);
    expect(['granted', 'denied', 'default', 'unsupported']).toContain(n.state());
    expect(() => {
      n.vibrate(30);
      n.due([task(1)]);
    }).not.toThrow();
  });

  it('copes with no navigator at all', () => {
    vi.stubGlobal('navigator', undefined);
    const deps = browserNotifyDeps();
    expect(deps.vibrate).toBeUndefined();
    expect(deps.getRegistration).toBeUndefined();
    expect(createNotifier(deps).state()).toBe('unsupported');
  });

  it('reports unsupported and no vibration when the APIs are absent', () => {
    const deps = browserNotifyDeps();
    expect(deps.notification).toBeUndefined();
    expect(deps.vibrate).toBeUndefined();
    expect(deps.getRegistration).toBeUndefined();
    expect(createNotifier(deps).state()).toBe('unsupported');
  });

  it('wires the platform APIs when they exist and reads permission live', async () => {
    const vibrated: (number | number[])[] = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p: number | number[]) => {
        vibrated.push(p);
        return true;
      },
    });
    const registration = fakeRegistration().registration;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.resolve(registration) },
    });
    const fakeNotification = { permission: 'default' as NotificationPermission, prompts: 0 };
    vi.stubGlobal('Notification', {
      get permission() {
        return fakeNotification.permission;
      },
      requestPermission: () => {
        fakeNotification.prompts += 1;
        fakeNotification.permission = 'granted';
        return Promise.resolve('granted' as const);
      },
    });
    const deps = browserNotifyDeps();
    const n = createNotifier(deps);
    expect(n.state()).toBe('default');
    n.vibrate(30);
    expect(vibrated).toEqual([30]);
    await expect(n.requestPermission()).resolves.toBe('granted');
    expect(fakeNotification.prompts).toBe(1);
    expect(n.state()).toBe('granted');
    await expect(deps.getRegistration?.()).resolves.toBe(registration);
  });
});
