// Decision notes: wraps vite-plugin-pwa's registerSW (registerType 'prompt', injectRegister
// null, so this is the only registration). The function is injected because the virtual module
// exists only inside the Vite build; main.tsx passes the real one and unit tests a fake.
// onNeedRefresh raises the update-ready signal for the in-app bar; the Reload button sends
// SKIP_WAITING through updateSW(true) and the plugin reloads once the new worker controls the
// page. Nothing reloads without that tap (PLAN.md section 8). A registration failure is a
// banner line, not an error: the app runs without an offline copy.
import { signal, type Signal } from '@preact/signals';

export const SW_INSTALL_FAILED = 'Offline copy could not be installed';
export const SW_UPDATE_FAILED = 'The update could not be applied';

export interface RegisterSwOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisterError?: (error: unknown) => void;
}

export type RegisterSw = (options: RegisterSwOptions) => (reloadPage?: boolean) => Promise<void>;

export interface SwHandle {
  readonly updateReady: Signal<boolean>;
  reload: () => void;
}

export function setupServiceWorker(
  register: RegisterSw | undefined,
  onError: (reason: string) => void,
  supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
): SwHandle {
  const updateReady = signal(false);
  if (register === undefined || !supported) {
    return { updateReady, reload: () => undefined };
  }
  const update = register({
    immediate: true,
    onNeedRefresh: () => {
      updateReady.value = true;
    },
    onRegisterError: () => {
      onError(SW_INSTALL_FAILED);
    },
  });
  return {
    updateReady,
    reload: () => {
      update(true).catch(() => {
        onError(SW_UPDATE_FAILED);
      });
    },
  };
}
