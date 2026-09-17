# Post field test change set (September 2026)

Binding for this change set, in the same sense PLAN.md is binding for the original build. Where this
file and PLAN.md disagree, this file wins; PLAN.md is updated by the orchestrator at merge time.
Everything not mentioned here keeps its PLAN.md definition. CLAUDE.md rules (coding standard,
security floor, no new dependencies, no em-dashes, British English) apply unchanged.

## 0. Field test findings and decisions

| # | Finding | Decision |
|---|---------|----------|
| 1 | Note fields cap out at 500 characters | Cap is 1000 in every note field (patient notes, task note, add-patient notes) and in the validator. Height unchanged. |
| 2 | No at-a-glance ward status per patient | A small neutral chip after the name: `Waiting`, `In theatre`, `Recovery`. None once discharged. |
| 3 | Alerts appear silently, late, with the screen off (Pixel 9 Pro, Chrome, installed) | Notification carries `vibrate` and `silent: false`; an audible tone plays when the app is in the foreground and Sound is on; the alert repeats every 5 minutes while a check stays overdue; an opt-in "Keep screen on" setting holds a screen wake lock because Android freezes the page's timers when the screen is off and there is no server for push. |
| 4 | `To theatre` step is not used | Removed from the template. Existing records and import files drop it silently. |
| 5 | Two-letter cell codes are hard to read | Inline SVG line icons per template step. Custom tasks keep two letters. Timer chip shows the full task label. |
| 6 | "Discharge" is really two moments | `Book discharge` records an agreed collection time and the patient stays active. `Discharge` (existing behaviour) completes the discharge cell and moves the patient to the Discharged tab. |
| 7 | Theatre-return time is recorded too early | Completing `handover_theatre` (not `in_theatre`) records `theatreReturnAt` and schedules the four checks. |
| 8 | Intake is limited to three slots | Any `HH:MM` local time, or none. Editable after admission. Board sort unchanged. |

## 1. Work packages and ownership

| WP | Owner directory | Branch | Depends on |
|----|-----------------|--------|------------|
| A | `src/domain`, `src/store`, `tests/unit/domain`, `tests/unit/store`, `tests/fixtures` | `change/a-domain-store` | none |
| B | `src/scheduler`, `tests/unit/scheduler` | `change/b-scheduler` | none |
| C | `src/ui`, `src/sw.ts`, `tests/unit/ui`, `tests/unit/app`, `tests/unit/hardening`, `tests/e2e`, `README.md` | `change/c-ui` | A and B merged |

A and B run concurrently. C starts once A and B are merged onto the integration branch. Each WP ends
with the full gate `npm run lint && npm run typecheck && npm test && npm run build` green (C also
runs `npm run test:e2e`), and a report section in STATE.md. A verifier who has not seen the
implementation then runs the gate independently and tries to break the WP.

Interfaces below are exact. A WP that needs a different interface stops and reports.

## 2. Contract: `src/domain/types.ts` (WP A applies these edits verbatim)

```ts
// Intake is 'none' or a 24-hour local time HH:MM. INTAKES (the fixed slot list) is removed.
export const INTAKE_NONE = 'none';
export type Intake = string;
/** 08:00, 09:00, 10:00 offered as quick picks in the UI; any HH:MM is valid. */
export const INTAKE_PRESETS: readonly string[] = Object.freeze(['08:00', '09:00', '10:00']);

// StepKey: 'to_theatre' removed. RETIRED_STEP_KEYS lists keys that may still appear in stored
// records and import files; they are dropped from patients and tolerated on events.
export const RETIRED_STEP_KEYS = ['to_theatre'] as const;
export type RetiredStepKey = (typeof RETIRED_STEP_KEYS)[number];

export interface Patient extends PatientForm {
  // ...existing fields...
  /** Collection time agreed with the owner. Set by BOOK_DISCHARGE; cleared by BOOK_DISCHARGE with no time. */
  dischargeBookedAt?: Iso;
}

export type EventType = /* existing */ | 'DISCHARGE_BOOKED';
// Event.taskKey?: TaskKey | RetiredStepKey   (events keep history for retired steps)

export interface Settings {
  // ...existing fields...
  /** Hold a screen wake lock while the app is visible so timers keep running. Default false. */
  keepScreenOn: boolean;
}
// DEFAULT_SETTINGS gains keepScreenOn: false.

export type Action =
  // ...existing members...
  | ({ type: 'BOOK_DISCHARGE'; patientId: string; bookedAt?: Iso } & Stamp)
  | { type: 'SET_INTAKE'; patientId: string; intake: Intake };
```

`sound` in Settings keeps its name; its meaning widens to "click on completion and tone when a check
falls due". The Settings copy changes in WP C.

## 3. WP A: domain and store

### Template (`src/domain/template.ts`)
- Remove the `to_theatre` step. Eighteen steps remain in the same order and phases. Codes unchanged
  for the remaining steps (the UI stops rendering them in cells but the code stays for custom tasks
  and tests).
- `PLAN.md section 6` text is updated by the orchestrator; do not edit PLAN.md.

### Theatre return (`src/domain/patient.ts`)
- `settle`: `status === 'done' && task.key === 'handover_theatre'` records `theatreReturnAt = at`
  and schedules checks. Completing `in_theatre` records nothing timed.
- `revertTask`: reverting a done `handover_theatre` clears `theatreReturnAt` and the check
  `dueAt`s, same shape as the current `in_theatre` branch. Reverting a skip does not.
- `SET_THEATRE_RETURN` action is unchanged (manual override stays).

### Ward status (`src/domain/status.ts`, new)
```ts
export type WardStatus = 'waiting' | 'theatre' | 'recovery';
/** Undefined once discharged. Settled means done or skipped. Follows the furthest-along cell. */
export function wardStatus(p: Patient): WardStatus | undefined;
```
Rules, evaluated in this order:
1. `p.status === 'discharged'`: undefined.
2. `handover_theatre` settled: `'recovery'` if any task with `phase === 'RECOVERY'` is `todo`, else
   `'waiting'`.
3. `in_theatre` settled: `'theatre'`.
4. Otherwise `'waiting'`.
Custom tasks count by their phase. O(n) over tasks.

### Discharge booking (`src/domain/patient.ts`, `src/domain/reducer.ts`)
- `bookDischarge(p, bookedAt: Iso | undefined): Patient`: sets or deletes `dischargeBookedAt`.
  Same reference when nothing changes. Works only on active patients (no-op when discharged).
- Reducer `BOOK_DISCHARGE`: applies `bookDischarge`; appends `{ type: 'DISCHARGE_BOOKED',
  patientId, dueAt: bookedAt }` (no `dueAt` when clearing). Unparseable `bookedAt` returns the same
  state. UNDO does not touch bookings (UNDO reverts completions and skips only, per PLAN.md).
- Discharging keeps `dischargeBookedAt` as recorded.
- `shiftStats` ignores `DISCHARGE_BOOKED`.

### Intake (`src/domain/reducer.ts`, `src/domain/validate.ts`)
- Validator: `intake` is `'none'` or matches `/^([01]\d|2[0-3]):[0-5]\d$/`. Error message
  `Enter a time as HH:MM, or none`. Applies to the add-patient form, stored records and imports.
- Reducer `SET_INTAKE`: validates with the same rule (invalid returns the same state), replaces
  `intake`; no event. Same reference when unchanged.
- `urgency.ts` unchanged: rank 2 for any intake other than `'none'`, tiebreak by string compare
  (HH:MM sorts correctly as a string).

### Notes cap (`src/domain/validate.ts`)
- `notes` 0 to 1000; task `note` 0 to 1000.

### Retired steps (`src/domain/validate.ts`)
- `validatePatientRecord` and the import path drop any task whose `key` is in
  `RETIRED_STEP_KEYS` before validating the rest, then renumber `order` to 0..n-1 in the original
  order. A dropped task is not an error.
- `validateEvent` accepts `taskKey` in `RETIRED_STEP_KEYS` (history stays readable; stats already
  count by event, not by template).
- `isTaskKey` uses `Object.hasOwn` (fixes the prototype-chain hole noted in STATE.md stage 2).
- `dischargeBookedAt` is an optional ISO field on patient records and imports.
- Settings validation gains `keepScreenOn` (boolean, default false when missing).

### Store (`src/store`)
- No schema change (`DB_VERSION` stays 1): dropping retired tasks happens in validation at load, and
  the next `savePatient` writes the trimmed record.
- `TRANSFER_SCHEMA_VERSION` stays 1: old files still import (retired task dropped, missing
  `keepScreenOn` defaults).

### Tests
- Update fixtures (`tests/fixtures/synthetic.ts`) to eighteen steps.
- Cover: every rule above, the property suites still green, a stored patient with `to_theatre` at
  order 4 loads as eighteen tasks with contiguous orders and its completion event still counts in
  stats, an import file with `to_theatre` imports cleanly, `wardStatus` for every transition
  including out-of-order completion, `BOOK_DISCHARGE` set/clear/invalid/discharged, `SET_INTAKE`
  valid/invalid/unchanged, intake boundary values (`00:00`, `23:59`, `24:00` rejected, `9:00`
  rejected), note at 1000 and 1001.
- Coverage thresholds for `src/domain` stay at 100%.

## 4. WP B: scheduler

### Repeat while overdue (`src/scheduler/timers.ts`)
- `REPEAT_MS = 5 * 60_000`, exported.
- The announcement map becomes `taskId -> { dueAt, announcedAt }`. A task that is still `todo`,
  still overdue, and was last announced at least `REPEAT_MS` ago is announced again (included in the
  next `notifier.due` batch and its `announcedAt` refreshed). The map is still rebuilt from the board
  on every sweep so completed, skipped, removed and rescheduled tasks drop out or restart as today.
- The armed delay is `clamp(min(earliest unannounced dueAt, earliest announcedAt + REPEAT_MS) - now,
  0, max)`, or `max` when nothing is pending.
- `DUE` is dispatched only on the first announcement of a `dueAt` (it is a tick), not on repeats.
- `onVisible` behaviour unchanged.

### Notification options (`src/scheduler/notify.ts`)
- `showNotification` options gain `vibrate: [...DUE_VIBRATION]` and `silent: false` (the DOM lib
  omits `vibrate` on `NotificationOptions`; extend `DueNotificationOptions` as done for `renotify`).
- `NotifyDeps` gains `sound?: () => void`. `due` calls `deps.sound?.()` after the vibration and
  before the permission check, so the tone plays whether or not notifications are granted. Errors
  from `sound` are caught and routed to `onError`.
- `browserNotifyDeps` does not set `sound`; WP C wires it from the app because the tone is gated by
  the Sound setting.

### Wake lock (`src/scheduler/wakelock.ts`, new)
```ts
export interface WakeLockDeps {
  request?: () => Promise<{ release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void }>;
  onVisibilityChange?: (cb: () => void) => () => void;  // subscribe, returns unsubscribe
  isVisible?: () => boolean;
  onError?: (reason: string) => void;
}
export interface WakeLock {
  enable(): void;    // acquire now if visible; re-acquire whenever the page becomes visible again
  disable(): void;   // release and stop re-acquiring
  held(): boolean;
}
export function createWakeLock(deps?: WakeLockDeps): WakeLock;
export function browserWakeLockDeps(): WakeLockDeps;  // feature-detects navigator.wakeLock
```
- Never throws; a rejected `request` (permission, low battery, unsupported) goes to `onError` once
  per attempt as plain English and the lock stays wanted so the next visibility change retries.
- `enable`/`disable` idempotent. `disable` while a request is in flight releases it on arrival.
- No patient data touches this module.

### Tests
- Fake clock only. Cover: repeat at exactly `+REPEAT_MS` and not before, a task completed between
  repeats stops repeating, a task whose `dueAt` moves restarts as a first announcement (with `DUE`),
  delay arithmetic with mixed unannounced and repeating tasks, `DUE` not re-dispatched on repeats,
  notification options carry `vibrate` and `silent: false`, `sound` called in every permission
  state and its throw routed to `onError`, wake lock acquire/release/re-acquire/reject/in-flight
  disable, `browserWakeLockDeps` without `navigator.wakeLock`.

## 5. WP C: UI, service worker, e2e, README

### Status chip (`src/ui/PatientRow.tsx`)
- After the name and species, `<Chip>` (neutral) with `Waiting`, `In theatre` or `Recovery` from
  `wardStatus(patient)`. Nothing when undefined. Visually-hidden prefix `Status ` for screen
  readers. The chip must not push the row above 88 px; place it on the title line.

### Task icons (`src/ui/icons.tsx`, new; `src/ui/Belt.tsx`; `src/ui/format.ts`)
- One inline SVG per template step, 16 x 16 viewBox, `stroke="currentColor"`, `fill="none"`,
  stroke width 1.5, `aria-hidden="true"`, no external assets (CSP `img-src 'self' data:` is not
  needed; inline SVG elements are markup, not images).
- Mapping: `handover_admit` clipboard; `bloods` drop; `draw_meds` pill; `premed` syringe;
  `in_theatre` scalpel; `handover_theatre` arrow leaving a door; `check_1..4` stethoscope with a
  small digit 1 to 4 at bottom right; `food_water` bowl; `take_out` grass; `pain_score` face with a
  scale; `invoice` receipt; `call_owner` phone; `pharmacy_collect` bag with a cross; `remove_iv`
  cannula with a cross; `discharge` house. If the stethoscope plus digit is illegible at 24 px in
  the Playwright screenshot, use a bold digit inside a circle and record the choice in STATE.md.
- Belt cells render the icon for template tasks; custom tasks keep the two-letter code.
  The done state keeps the white glyph on the accent fill (icon inherits `currentColor`).
- Timer chip shows the full task label instead of the code (`Post-op check 1 in 04:30`); drop the
  visually-hidden duplicate.
- `taskCode` stays for custom cells and the shift summary.

### Book discharge (`src/ui/PatientSheet.tsx`, `src/ui/app/actions.ts`, `src/ui/App.tsx`)
- Section "Discharge": a `Book discharge` button opens an inline `type="time"` field (today, local)
  with `Save booking` and, when a booking exists, `Clear booking`. Text `Booked for 15:30` when
  set. Dispatches `BOOK_DISCHARGE` with the ISO of today at that time (a time earlier than now is
  allowed: the owner may already be late).
- The existing `Discharge` button and its `Discharged 14:32` disabled state are unchanged.
- Row: when booked and active, a mono chip `Home 15:30` (neutral; `warning` tone once now is past
  the booked time). Place it in `row__side` after the intake chip.
- Toast on booking: `Discharge booked for 15:30`; no undo (booking is not a completion).

### Intake (`src/ui/AddPatientSheet.tsx`, `src/ui/PatientSheet.tsx`)
- Add-patient form: `type="time"` input with the three `INTAKE_PRESETS` as tappable quick picks
  and an explicit `No set time` control that submits `'none'`. Empty input submits `'none'`.
- Patient sheet: an "Intake" field with the same control and a `Save intake` button dispatching
  `SET_INTAKE`. Validation message from the validator shown inline.

### Notes (`src/ui/AddPatientSheet.tsx`, `src/ui/PatientSheet.tsx`)
- `maxLength` 1000 on all three textareas.

### Alerts (`src/ui/app/session.ts`, `src/ui/feedback.ts`, `src/ui/Settings.tsx`)
- `feedback.ts` gains `dueTone(opts)`: two short tones (roughly 880 Hz 150 ms, 660 Hz 150 ms,
  gap 80 ms) through the existing lazy AudioContext; silent when `opts.sound` is false; a suspended
  context is resumed first and any failure goes to `onError`.
- `session.ts` passes `sound: () => dueTone({...})` into `createNotifier` deps, reading the live
  setting. The `gated` wrapper keeps vibrating when notifications are off.
- `session.ts` creates the wake lock from `createWakeLock(browserWakeLockDeps())` with errors to the
  transient banner, and an `effect` enables or disables it from `settings.keepScreenOn`.
- Settings: Sound toggle label `Sound`, hint `A click on completion and a tone when a check falls
  due, while the app is open.`; new toggle `Keep screen on`, hint `Android pauses the app's timers
  when the screen is off, so alerts arrive late. This keeps the screen on while Wardbelt is open.
  Uses more battery.`; Notifications hint adds `Alerts repeat every 5 minutes while a check is
  overdue.`

### Service worker (`src/sw.ts`)
- No change required. Check `notificationclick` still focuses the app.

### Copy
- Belt summary and any list of steps no longer mention `To theatre`.

### Tests
- Unit: chip for every status, icons render for every step and letters for custom, timer chip label,
  booking flow (set, clear, past time warning tone, discharged patient hides the chip), intake
  presets and none, `SET_INTAKE` wiring, maxLength 1000, `dueTone` gating, wake lock effect on
  setting change, Settings toggles.
- e2e (`tests/e2e`): update `helpers.ts` step list; add a flow that books a discharge then
  discharges; a flow that completes `in_theatre` then `handover_theatre` and asserts the checks
  appear only after handover; a11y spec still green with the icons (each cell keeps its accessible
  name via the belt summary).
- README: eighteen steps, icons instead of codes in the cell description, Book discharge, intake,
  Keep screen on, alert repeat.

## 6. Orchestrator tasks at merge

- PLAN.md: section 6 template list and theatre-return rule; section 7 intake and notes rules;
  section 10 belt line (icons, custom cells keep letters); section 1 "17-step" left as is.
- DECISIONS.md: one row per decision in section 0 above plus any implementer decision from the
  STATE.md reports.
- STATE.md: "Post field test change set" section with the three WP reports, verifier results and
  the merge record; "Next action" updated.
