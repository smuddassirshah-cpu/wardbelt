// Decision notes: PLAN.md section 6 lists nineteen step keys and nineteen two-letter codes
// although section 1 says "17-step"; the enumerated list is binding. Order is the array index.
// Timed steps (check_1..4) get dueAt when in_theatre completes; nothing else is timed by default.
import { type Phase, type StepKey } from './types';

export interface TemplateStep {
  key: StepKey;
  code: string;
  label: string;
  phase: Phase;
}

export const TEMPLATE: readonly TemplateStep[] = Object.freeze([
  { key: 'handover_admit', code: 'HA', label: 'Handover and admit', phase: 'PRE_OP' },
  { key: 'bloods', code: 'BL', label: 'Bloods', phase: 'PRE_OP' },
  { key: 'draw_meds', code: 'DM', label: 'Draw up meds', phase: 'PRE_OP' },
  { key: 'premed', code: 'PM', label: 'Premed', phase: 'PRE_OP' },
  { key: 'to_theatre', code: 'TH', label: 'To theatre', phase: 'PRE_OP' },
  { key: 'in_theatre', code: 'IT', label: 'In theatre', phase: 'THEATRE' },
  { key: 'handover_theatre', code: 'HT', label: 'Handover from theatre', phase: 'RECOVERY' },
  { key: 'check_1', code: 'C1', label: 'Post-op check 1', phase: 'RECOVERY' },
  { key: 'check_2', code: 'C2', label: 'Post-op check 2', phase: 'RECOVERY' },
  { key: 'check_3', code: 'C3', label: 'Post-op check 3', phase: 'RECOVERY' },
  { key: 'check_4', code: 'C4', label: 'Post-op check 4', phase: 'RECOVERY' },
  { key: 'food_water', code: 'FW', label: 'Food and water', phase: 'RECOVERY' },
  { key: 'take_out', code: 'TO', label: 'Take out', phase: 'RECOVERY' },
  { key: 'pain_score', code: 'PS', label: 'Pain score', phase: 'RECOVERY' },
  { key: 'invoice', code: 'IN', label: 'Invoice', phase: 'DISCHARGE_PREP' },
  { key: 'call_owner', code: 'CO', label: 'Call owner', phase: 'DISCHARGE_PREP' },
  { key: 'pharmacy_collect', code: 'PH', label: 'Pharmacy collect', phase: 'DISCHARGE_PREP' },
  { key: 'remove_iv', code: 'IV', label: 'Remove IV', phase: 'DISCHARGE_PREP' },
  { key: 'discharge', code: 'DC', label: 'Discharge', phase: 'DONE' },
]);

export const TEMPLATE_BY_KEY: Readonly<Record<StepKey, TemplateStep>> = Object.freeze(
  Object.fromEntries(TEMPLATE.map((s) => [s.key, s])) as Record<StepKey, TemplateStep>,
);

export const CHECK_KEYS: readonly StepKey[] = Object.freeze([
  'check_1',
  'check_2',
  'check_3',
  'check_4',
]);

export const PHASE_LABELS: Readonly<Record<Phase, string>> = Object.freeze({
  PRE_OP: 'Pre-op',
  THEATRE: 'Theatre',
  RECOVERY: 'Recovery',
  DISCHARGE_PREP: 'Discharge prep',
  DONE: 'Done',
});

/** Two-letter code for a custom task: first two letters of its label, upper-cased. */
export function customCode(label: string): string {
  const letters = label
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 2)
    .toUpperCase();
  return letters.padEnd(2, '+');
}
