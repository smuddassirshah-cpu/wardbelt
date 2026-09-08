import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from '../../../src/ui/app/download';
import {
  createRouter,
  parseRoute,
  routeHash,
  sameRoute,
  type Route,
} from '../../../src/ui/app/router';

describe('routes', () => {
  it('parses every hash form and round-trips through routeHash', () => {
    const cases: [string, Route][] = [
      ['', { kind: 'board' }],
      ['#', { kind: 'board' }],
      ['#/', { kind: 'board' }],
      ['#/add', { kind: 'add' }],
      ['#/summary', { kind: 'summary' }],
      ['#/settings', { kind: 'settings' }],
      ['#/dev', { kind: 'dev' }],
      ['#/dev?theme=dark', { kind: 'dev' }],
      ['#/patient/abc', { kind: 'patient', id: 'abc' }],
      ['#/patient/a%20b', { kind: 'patient', id: 'a b' }],
      ['#/patient/', { kind: 'board' }],
      ['#/nonsense', { kind: 'board' }],
    ];
    for (const [hash, route] of cases) {
      expect(parseRoute(hash)).toEqual(route);
    }
    for (const route of cases.map(([, r]) => r)) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
    expect(routeHash({ kind: 'patient', id: 'a b' })).toBe('#/patient/a%20b');
    expect(sameRoute({ kind: 'patient', id: 'a' }, { kind: 'patient', id: 'b' })).toBe(false);
    expect(sameRoute({ kind: 'patient', id: 'a' }, { kind: 'patient', id: 'a' })).toBe(true);
    expect(sameRoute({ kind: 'add' }, { kind: 'summary' })).toBe(false);
  });

  it('navigates by pushing a hash and closes by replacing the entry', () => {
    const listeners: (() => void)[] = [];
    const replaceState = vi.fn();
    const win = {
      location: { hash: '#/patient/p1', pathname: '/wardbelt/', search: '?x=1' },
      history: { replaceState },
      addEventListener: (_type: string, fn: () => void) => {
        listeners.push(fn);
      },
    } as unknown as Window;
    const router = createRouter(win);
    expect(router.route.value).toEqual({ kind: 'patient', id: 'p1' });
    router.navigate({ kind: 'add' });
    expect(win.location.hash).toBe('#/add');
    expect(router.route.value).toEqual({ kind: 'add' });
    const same = router.route.value;
    for (const fn of listeners) {
      fn();
    }
    expect(router.route.value).toBe(same);
    win.location.hash = '#/settings';
    for (const fn of listeners) {
      fn();
    }
    expect(router.route.value).toEqual({ kind: 'settings' });
    router.close();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/wardbelt/?x=1');
    expect(router.route.value).toEqual({ kind: 'board' });
    win.location.hash = '';
    router.close();
    expect(replaceState).toHaveBeenCalledTimes(1);
    router.navigate({ kind: 'board' });
    expect(win.location.hash).toBe('');
  });

  it('works against the real jsdom window', () => {
    const router = createRouter(window);
    router.navigate({ kind: 'summary' });
    expect(location.hash).toBe('#/summary');
    router.close();
    expect(location.hash).toBe('');
    expect(router.route.value).toEqual({ kind: 'board' });
  });
});

describe('downloadText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns false when object URLs are unsupported', () => {
    const bare: unknown = Object.assign(Object.create(URL), {
      createObjectURL: undefined,
      revokeObjectURL: undefined,
    });
    vi.stubGlobal('URL', bare);
    expect(downloadText('a.json', '{}')).toBe(false);
  });

  it('clicks a hidden download anchor and revokes the URL later', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    expect(downloadText('a.json', '{"a":1}')).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('returns false when the anchor cannot be created', () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    const doc = {
      createElement: () => {
        throw new Error('no dom');
      },
    } as unknown as Document;
    expect(downloadText('a.json', '{}', doc)).toBe(false);
  });
});
