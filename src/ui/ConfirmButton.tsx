// Decision notes: the inline two-step confirm used for destructive actions (PLAN.md forbids
// window.confirm and modals). The first tap arms a "Confirm" button for `windowMs`; the
// timer is cleared on disarm and on unmount.
import { useEffect, useState } from 'preact/hooks';

export const CONFIRM_WINDOW_MS = 4000;

export interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  windowMs?: number;
  disabled?: boolean;
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  windowMs = CONFIRM_WINDOW_MS,
  disabled = false,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const id = setTimeout(() => {
      setArmed(false);
    }, windowMs);
    return () => {
      clearTimeout(id);
    };
  }, [armed, windowMs]);

  if (armed) {
    return (
      <div class="btn-row" role="group" aria-label={label}>
        <button
          type="button"
          class="btn btn--danger"
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            setArmed(false);
          }}
        >
          Keep
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      class="btn btn--danger"
      disabled={disabled}
      onClick={() => {
        setArmed(true);
      }}
    >
      {label}
    </button>
  );
}
