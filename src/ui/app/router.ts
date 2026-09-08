// Decision notes: routes live in the URL hash (STATE.md decision) so the SW navigation
// fallback and the Pages sub-path need nothing special. Opening a sheet pushes a hash entry so
// the Android back button closes it; the Close button replaces the current entry instead of
// pushing another so back never reopens a sheet the nurse just closed. Unknown hashes render
// the board; `#/dev` is served by main.tsx before the app mounts.
import { signal, type Signal } from '@preact/signals';

export type Route =
  | { kind: 'board' }
  | { kind: 'patient'; id: string }
  | { kind: 'add' }
  | { kind: 'summary' }
  | { kind: 'settings' }
  | { kind: 'dev' };

const BOARD: Route = { kind: 'board' };
const PATIENT_PREFIX = '/patient/';

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  if (path === '/add') {
    return { kind: 'add' };
  }
  if (path === '/summary') {
    return { kind: 'summary' };
  }
  if (path === '/settings') {
    return { kind: 'settings' };
  }
  if (path.startsWith('/dev')) {
    return { kind: 'dev' };
  }
  if (path.startsWith(PATIENT_PREFIX)) {
    const id = decodeURIComponent(path.slice(PATIENT_PREFIX.length));
    if (id !== '') {
      return { kind: 'patient', id };
    }
  }
  return BOARD;
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'board':
      return '';
    case 'patient':
      return `#${PATIENT_PREFIX}${encodeURIComponent(route.id)}`;
    case 'add':
    case 'summary':
    case 'settings':
    case 'dev':
      return `#/${route.kind}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.kind === b.kind && (a.kind !== 'patient' || b.kind !== 'patient' || a.id === b.id);
}

export interface Router {
  readonly route: Signal<Route>;
  navigate: (route: Route) => void;
  /** Returns to the board without adding a history entry. */
  close: () => void;
}

export type RouterWindow = Pick<Window, 'location' | 'history' | 'addEventListener'>;

export function createRouter(win: RouterWindow): Router {
  const route = signal<Route>(parseRoute(win.location.hash));
  const set = (next: Route): void => {
    if (!sameRoute(route.value, next)) {
      route.value = next;
    }
  };
  win.addEventListener('hashchange', () => {
    set(parseRoute(win.location.hash));
  });
  return {
    route,
    navigate: (next) => {
      const hash = routeHash(next);
      if (win.location.hash !== hash) {
        win.location.hash = hash;
      }
      set(next);
    },
    close: () => {
      if (win.location.hash !== '') {
        win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
      }
      set(BOARD);
    },
  };
}
