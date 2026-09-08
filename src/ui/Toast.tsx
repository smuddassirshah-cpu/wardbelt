// Decision notes: the only transient message surface (PLAN.md section 10: no toast longer
// than 4 s, undo lives in the toast). The component owns one setTimeout for the auto-hide,
// clamped to TOAST_MAX_MS, armed on mount and cleared on unmount; the caller removes the toast
// in onExpire. The latest onExpire is read through a ref so a parent that re-renders every
// tick with a fresh callback cannot re-arm the timer and keep the toast alive. A new toast
// should be mounted fresh (key it by id) so it gets its own countdown.
import { useEffect, useRef } from 'preact/hooks';
import { classes } from './format';

export const TOAST_MAX_MS = 4000;

export interface ToastProps {
  message: string;
  durationMs: number;
  onExpire: () => void;
  onUndo?: (() => void) | undefined;
  inline?: boolean | undefined;
}

export function Toast({ message, durationMs, onExpire, onUndo, inline = false }: ToastProps) {
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    const id = setTimeout(
      () => {
        expire.current();
      },
      Math.min(Math.max(0, durationMs), TOAST_MAX_MS),
    );
    return () => {
      clearTimeout(id);
    };
  }, [durationMs]);

  return (
    <div class={classes('toast', inline && 'toast--inline')} role="status">
      <span class="toast__message">{message}</span>
      {onUndo !== undefined && (
        <button type="button" class="btn" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
