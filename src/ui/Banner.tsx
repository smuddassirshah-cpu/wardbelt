// Decision notes: the persistent or dismissible message bar used for storage state, corrupt
// record counts and the update-ready prompt (PLAN.md section 8). Tone changes the hairline
// colour only; the text stays in ink so contrast never depends on the tone colour.
import { classes } from './format';

export type BannerTone = 'info' | 'warning' | 'danger';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface BannerProps {
  message: string;
  tone?: BannerTone | undefined;
  action?: BannerAction | undefined;
  onDismiss?: (() => void) | undefined;
}

export function Banner({ message, tone = 'info', action, onDismiss }: BannerProps) {
  return (
    <div class={classes('banner', tone !== 'info' && `banner--${tone}`)} role="status">
      <span class="banner__message">{message}</span>
      {action !== undefined && (
        <button type="button" class="btn btn--primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss !== undefined && (
        <button type="button" class="btn btn--quiet" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
