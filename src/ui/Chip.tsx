import { type ComponentChildren } from 'preact';
import { classes } from './format';

export type ChipTone = 'neutral' | 'accent' | 'warning' | 'danger';

export interface ChipProps {
  tone?: ChipTone;
  mono?: boolean;
  children: ComponentChildren;
}

export function Chip({ tone = 'neutral', mono = false, children }: ChipProps) {
  return (
    <span class={classes('chip', tone !== 'neutral' && `chip--${tone}`, mono && 'mono')}>
      {children}
    </span>
  );
}
