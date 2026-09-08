// Decision notes: the single overlay pattern in the app (PLAN.md section 10: no modals beyond
// the bottom sheet). Escape is handled on the sheet element so it only fires while focus is
// inside. On open, focus moves to `initialFocus` or the panel; on close it returns to whatever
// had it before. `inline` renders the sheet as a static block with no scrim and no focus
// management, which is how the dev gallery shows every sheet at once.
import { type ComponentChildren, type RefObject } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { classes } from './format';

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  inline?: boolean | undefined;
  initialFocus?: RefObject<HTMLElement> | undefined;
}

export function Sheet({ title, onClose, children, inline = false, initialFocus }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inline) {
      return undefined;
    }
    const previous = document.activeElement;
    (initialFocus?.current ?? panel.current)?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [inline, initialFocus]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      {!inline && <div class="sheet-scrim" aria-hidden="true" onClick={onClose} />}
      <div
        class={classes('sheet', inline && 'sheet--inline')}
        role="dialog"
        aria-modal={inline ? undefined : 'true'}
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <div class="sheet__header">
          <h2 class="sheet__title" id={titleId}>
            {title}
          </h2>
          <button type="button" class="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="sheet__body">{children}</div>
      </div>
    </>
  );
}
