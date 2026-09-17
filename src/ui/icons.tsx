// Decision notes: one inline SVG line icon per template step (CHANGES-2026-09.md section 5).
// Inline markup rather than sprites or image files: the CSP allows no external image source and
// a 16 px glyph inherits `currentColor`, so the done cell keeps a white glyph on the accent fill
// without a second asset. Every icon is drawn on the same 16 x 16 grid at stroke 1.5 with round
// joins so the set reads as one family at the 24 px cell size. The four post-op checks share a
// stethoscope and are told apart by a bold digit at the bottom right, which is the only filled
// mark in the set. Cells are aria-hidden (the belt carries the accessible name), so no icon
// needs a title.
import { type StepKey, type Task } from '@domain/types';
import { type JSX } from 'preact';
import { taskCode } from './format';

function check(digit: string): JSX.Element {
  return (
    <>
      <path d="M3 1.5v4a3 3 0 0 0 6 0v-4" />
      <path d="M6 8.5v1.2" />
      <circle cx="6" cy="11.6" r="1.9" />
      <text
        x="12.4"
        y="15"
        font-size="8"
        font-weight="600"
        text-anchor="middle"
        fill="currentColor"
        stroke="none"
      >
        {digit}
      </text>
    </>
  );
}

const GLYPHS: Readonly<Record<StepKey, JSX.Element>> = {
  handover_admit: (
    <>
      <path d="M5.5 2.5h-2v11h9v-11h-2" />
      <path d="M6 1.5h4v2.5H6z" />
      <path d="M6 7.5h4M6 10.5h4" />
    </>
  ),
  bloods: <path d="M8 1.8c3 3.7 4.5 6 4.5 7.7a4.5 4.5 0 0 1-9 0C3.5 7.8 5 5.5 8 1.8Z" />,
  draw_meds: (
    <>
      <rect x="1.5" y="5.75" width="13" height="4.5" rx="2.25" transform="rotate(-45 8 8)" />
      <path d="M6.4 6.4 9.6 9.6" />
    </>
  ),
  premed: (
    <>
      <path d="M1.5 8h2" />
      <path d="M3.5 5.5h7v5h-7z" />
      <path d="M6 5.5v1.5M8 5.5v1.5" />
      <path d="M10.5 8h3M13 5.5v5" />
    </>
  ),
  in_theatre: (
    <>
      <path d="M2.2 13.8 6.8 9.2" />
      <path d="M6.8 9.2 12 2.8l2 2-5.2 5.6z" />
    </>
  ),
  handover_theatre: (
    <>
      <path d="M6.5 2.5h-3v11h3" />
      <path d="M7 8h6.5" />
      <path d="M11 5.5 13.5 8 11 10.5" />
    </>
  ),
  check_1: check('1'),
  check_2: check('2'),
  check_3: check('3'),
  check_4: check('4'),
  food_water: (
    <>
      <path d="M2 7h12c0 3.6-2.7 6-6 6s-6-2.4-6-6Z" />
      <path d="M6 4.5c0-1 1-1.5 1-2.5M9 4.5c0-1 1-1.5 1-2.5" />
    </>
  ),
  take_out: (
    <>
      <path d="M2 13.5h12" />
      <path d="M6.2 13.5C5.4 10 4.2 7.6 2.6 5.8" />
      <path d="M8 13.5C8 10 8 7.2 8 4.2" />
      <path d="M9.8 13.5c.8-3.5 2-5.9 3.6-7.7" />
    </>
  ),
  pain_score: (
    <>
      <circle cx="8" cy="5.5" r="4" />
      <path d="M6.6 4.6v.7M9.4 4.6v.7" />
      <path d="M6.3 7.4h3.4" />
      <path d="M1.5 12.5h13" />
      <path d="M3.5 11.4v2.2M8 11.4v2.2M12.5 11.4v2.2" />
    </>
  ),
  invoice: (
    <>
      <path d="M3.5 1.5h9v13l-1.5-1.2-1.5 1.2L8 13.3l-1.5 1.2L5 13.3l-1.5 1.2Z" />
      <path d="M6 5h4M6 8h4" />
    </>
  ),
  call_owner: (
    <path d="M5.4 2.2 3 4.6c0 4.6 3.8 8.4 8.4 8.4l2.4-2.4-2.7-2-1.5 1.5a9.4 9.4 0 0 1-3.7-3.7l1.5-1.5Z" />
  ),
  pharmacy_collect: (
    <>
      <path d="M3.5 5.5h9v8h-9z" />
      <path d="M6 5.5V4a2 2 0 0 1 4 0v1.5" />
      <path d="M8 7.8v3.4M6.3 9.5h3.4" />
    </>
  ),
  remove_iv: (
    <>
      <path d="M1.5 8h6" />
      <path d="M4 6.2 5.5 8 4 9.8M7.5 5.8h2v4.4h-2z" />
      <path d="M11 5.8 14 9.8M14 5.8 11 9.8" />
    </>
  ),
  discharge: (
    <>
      <path d="M1.8 7.8 8 2.2l6.2 5.6" />
      <path d="M3.8 7.5v6.3h8.4V7.5" />
    </>
  ),
};

export interface TaskIconProps {
  taskKey: StepKey;
}

/** The step's line icon. Decorative: the belt and the task row carry the accessible name. */
export function TaskIcon({ taskKey }: TaskIconProps) {
  return (
    <svg
      class="icon"
      data-icon={taskKey}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {GLYPHS[taskKey]}
    </svg>
  );
}

export interface TaskGlyphProps {
  task: Pick<Task, 'key' | 'label'>;
}

/** What goes inside a cell: the step's icon, or the two-letter code for a custom task. */
export function TaskGlyph({ task }: TaskGlyphProps) {
  return task.key === 'custom' ? <>{taskCode(task)}</> : <TaskIcon taskKey={task.key} />;
}
