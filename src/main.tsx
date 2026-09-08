// Decision notes: the mount point. The #/dev gallery stays a dynamic import so fixtures never
// sit in the main bundle. Everything else builds one Session over the browser platform
// (real clock, IndexedDB repo, BroadcastChannel lock, vite-plugin-pwa registration, download
// anchor) and renders the App before boot finishes so the shell paints at once; start() then
// decides the tab role, hydrates and arms the scheduler. A boot failure that escapes the
// session's own fallbacks is rendered as an alert, never swallowed.
import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { realClock } from '@scheduler/clock';
import { browserNotifyDeps } from '@scheduler/notify';
import { openRepo } from '@store/repo';
import { App } from './ui/App';
import { downloadText } from './ui/app/download';
import { describeError } from './ui/app/errors';
import { createIdSource } from './ui/app/ids';
import { acquireTabLock, browserChannel } from './ui/app/lock';
import { createRouter } from './ui/app/router';
import { createSession } from './ui/app/session';
import { prefersReducedMotion } from './ui/feedback';
import './ui/tokens.css';
import './ui/ui.css';
import './ui/app/app.css';

function mountPoint(): HTMLElement {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('Mount point #app is missing');
  }
  return root;
}

const root = mountPoint();

function renderFailure(message: string): void {
  render(
    <main class="shell">
      <p role="alert">{message}</p>
    </main>,
    root,
  );
}

if (location.hash.startsWith('#/dev')) {
  import('./ui/DevGallery')
    .then(({ DevGallery }) => {
      render(<DevGallery />, root);
    })
    .catch(() => {
      renderFailure('The gallery could not be loaded.');
    });
} else {
  const ids = createIdSource(realClock);
  const session = createSession({
    clock: realClock,
    openRepo,
    acquireLock: (onReleased) =>
      acquireTabLock({
        channel: browserChannel,
        id: ids.id(),
        onReleased,
        onPageHide: (fn) => {
          window.addEventListener('pagehide', fn);
        },
      }),
    notifyDeps: browserNotifyDeps(),
    registerSw: registerSW,
    swSupported: 'serviceWorker' in navigator,
    onVisible: (fn) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          fn();
        }
      });
    },
    download: downloadText,
    reducedMotion: prefersReducedMotion,
    version: __APP_VERSION__,
    ids,
  });
  const router = createRouter(window);
  render(<App session={session} router={router} />, root);
  session.start().catch((e: unknown) => {
    renderFailure(`Wardbelt could not start. ${describeError(e)}`);
  });
}
