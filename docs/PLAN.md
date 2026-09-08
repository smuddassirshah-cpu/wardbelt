# Wardbelt Blueprint

One-shot autonomous build. Every decision Phase 2 needs is made here. Where this document is silent, the orchestrator picks the simplest option that passes the tests named in §11 and logs it in STATE.md.

## 1. Scope and purpose

Wardbelt is an installable Android web app (PWA) for a single Registered Veterinary Nurse running a surgical ward/theatre shift. Each admitted animal gets a row on a board; the row is a horizontal belt of the standard surgical-day task sequence plus any ad-hoc tasks. The nurse adds an animal from a template in under 20 seconds, taps to complete the current step, gets a vibration when a 15-minute post-op check falls due, and sees at a glance which animal needs attention next. It runs entirely on the phone, offline, with no account and no server. The pressure point it exists for is 10:00 to 11:00, when the 10:00 intake overlaps with the 08:00 cohort returning from theatre.

### Non-goals

- No multi-user, sync, sharing, or cloud storage of any kind.
- No integration with the practice management system, invoicing, or pharmacy.
- No clinical decision support: no dosing, no pain-score interpretation, no alerts about the animal's condition.
- No editable template builder in-app (one fixed template, steps skippable, ad-hoc tasks addable).
- No iOS support work beyond what a standards-compliant PWA gets for free.
- No badges, XP, levels, leaderboards, confetti, or timed challenges.

## 2. Signal

Portfolio value is secondary; this is a tool for a real user. What it still demonstrates: an offline-first PWA with a pure, fully tested domain core, IndexedDB persistence with migrations, a deterministic scheduler under test, and an accessibility-checked mobile UI shipped by CI. Draft CV line: "Built and shipped an offline-first PWA clinical task tracker (TypeScript, Preact, IndexedDB), 100% test coverage on the domain core, deployed via GitHub Actions."

## 3. Component tree

```
wardbelt
├── src/
│   ├── domain/            [TS]   pure, no I/O, no DOM; 100% unit-tested
│   │   ├── template.ts           the 17-step template, phases, step keys, default timing
│   │   ├── types.ts              Patient, Task, Event, Shift, Settings
│   │   ├── patient.ts            create from template, add/skip/complete/undo task, discharge; O(n) over a patient's tasks
│   │   ├── recovery.ts           4 x 15-min check scheduling from theatre-return time
│   │   ├── urgency.ts            board sort: overdue > due-soon > intake tag > created; O(n log n)
│   │   ├── stats.ts              per-shift stats and streaks derived from events; O(n) over events
│   │   └── reducer.ts            single (state, action) -> state reducer wrapping the above
│   ├── store/             [TS]   persistence boundary
│   │   ├── db.ts                 idb schema, versioned migrations, open/close
│   │   ├── repo.ts               load all / save patient / append event / delete; every write awaited and surfaced
│   │   └── transfer.ts           JSON export and import with validation
│   ├── scheduler/         [TS]   time boundary
│   │   ├── clock.ts              injectable clock (real and fake)
│   │   ├── timers.ts             next-due computation, single setTimeout, resume-on-visibility
│   │   └── notify.ts             permission, vibration, SW showNotification; graceful no-op if denied
│   ├── ui/                [TSX]  Preact components; no business logic
│   │   ├── App.tsx               state wiring: reducer + store + scheduler via signals
│   │   ├── Board.tsx             rows sorted by urgency; empty state; discharged filter
│   │   ├── PatientRow.tsx        header + Belt + timer chip; tap current cell to complete
│   │   ├── Belt.tsx              horizontal segmented progress track
│   │   ├── PatientSheet.tsx      full task list, add task, skip, notes, discharge, delete
│   │   ├── AddPatientSheet.tsx   template form, validated at boundary
│   │   ├── ShiftSummary.tsx      end-of-shift stats screen
│   │   ├── Settings.tsx          notifications toggle, sound toggle, theme, export/import, purge
│   │   ├── feedback.ts           haptic + animation + optional click on completion
│   │   └── tokens.css            design tokens; the only place colours/spacing/type are defined
│   ├── sw.ts              [TS]   service worker: precache app shell (vite-plugin-pwa), notification click handling
│   └── main.tsx                  mount, SW registration
├── tests/
│   ├── unit/              [Vitest]     domain, store (fake-indexeddb), scheduler (fake clock)
│   └── e2e/               [Playwright] mobile viewport flows, offline reload, install manifest
└── .github/workflows/     [YAML]       ci.yml (lint, typecheck, unit, e2e), pages.yml (build, deploy)
```

## 4. Language selection

| Component | Language | Justification |
|---|---|---|
| domain, store, scheduler | TypeScript (strict) | Static types catch state-machine errors at compile time; pure modules test in Node without a browser |
| ui | TypeScript + Preact 10 + @preact/signals | 4 kB runtime keeps the offline shell tiny; signals give fine-grained re-render without a store library; JSX is the lowest-friction UI syntax for subagents |
| styling | Plain CSS with custom properties | No preprocessor toolchain; tokens.css is the single source of the visual system; no utility framework so the aesthetic stays deliberate |
| service worker | TypeScript via vite-plugin-pwa (Workbox) | Generated precache manifest is the reliable path to offline; hand-rolled SWs are the most common PWA failure |
| tests | Vitest, @testing-library/preact, fake-indexeddb, Playwright | Vitest shares Vite config; fake-indexeddb tests the real store code path; Playwright on a Pixel 5 profile is the closest thing to the target device in CI |
| CI/CD | GitHub Actions | Free, native to Pages deploy |

## 5. Data

- Sourcing: all data is typed in by the nurse on the phone. No external sources.
- Storage: IndexedDB via `idb`, database `wardbelt`, three object stores: `patients` (keyPath `id`, index `status`), `events` (keyPath `id`, index `at`), `settings` (keyPath `key`). IndexedDB over localStorage for structured records, indexes, and headroom beyond 5 MB. Tasks are embedded in the patient record (one document per patient) because every read is per-patient and the list is at most ~40 items.
- Lifecycle: patient created (active) -> tasks completed/skipped -> discharged (status `discharged`, kept until the nurse deletes it or runs "purge discharged older than N days", default 30, configurable). Events are append-only and purged with their patient. Export writes a single JSON file (Web Share API or download); import validates against the schema in §7 and merges by id.
- Volume: ~12 patients/shift, ~20 tasks each, ~300 events/shift. A year of history is under 5 MB. Nothing here needs pagination.
- Repo holds no data. Test fixtures are synthetic (species and procedure names, no plausible real client or patient names).

## 6. Interfaces and data flow

```
UI event ──action──> reducer (domain) ──new state──> signals ──> UI re-render
                         │
                         ├──persist(state diff)──> repo (store) ──> IndexedDB
                         └──events──> stats (domain)
clock tick / visibility ──> timers (scheduler) ──action: TICK──> reducer
timers ──due──> notify (scheduler) ──> vibrate + SW notification
```

| Boundary | Crosses | Format | Direction |
|---|---|---|---|
| ui -> domain | `Action` union (ADD_PATIENT, COMPLETE_TASK, SKIP_TASK, UNDO, ADD_TASK, SET_THEATRE_RETURN, DISCHARGE, DELETE_PATIENT, TICK, IMPORT) | discriminated union, validated by the sheet that raises it | one way |
| domain -> ui | `State` (patients map, events, settings, now) | immutable objects via signals | one way |
| domain -> store | `Patient`, `Event`, `Settings` records | plain JSON-serialisable objects | write; read only at boot |
| scheduler -> domain | `TICK {now}` and `DUE {patientId, taskId}` actions | same union | one way |
| scheduler -> platform | `navigator.vibrate`, `Notification`, `registration.showNotification` | browser APIs, feature-detected | one way |
| store -> file | export/import JSON `{schemaVersion, exportedAt, patients[], events[], settings}` | JSON, schema-validated on import | both |

Task model: `{id, key, label, phase, order, status: todo|done|skipped, dueAt?, doneAt?, note?, custom: boolean}`. Template step keys, in order, with phase:

PRE-OP: `handover_admit`, `bloods`, `draw_meds`, `premed`, `to_theatre` (covers IV placement/prep help)
THEATRE: `in_theatre` (waiting state; completing it records theatre-return time and schedules recovery)
RECOVERY: `handover_theatre`, `check_1`, `check_2`, `check_3`, `check_4` (due +15/+30/+45/+60 min from `in_theatre` completion), `food_water`, `take_out`, `pain_score`
DISCHARGE PREP: `invoice`, `call_owner`, `pharmacy_collect` (meds, post-op sheet, collar etc.), `remove_iv`
DONE: `discharge`

Rules: any task can be skipped or completed in any order (the ward does not run in order); the "current" cell is the first `todo` in order; a patient's belt is complete when every task is done or skipped; `discharge` completing sets status `discharged`. Custom tasks insert after any chosen task with optional `dueAt`. Undo reverts the last completion/skip for that patient (event-sourced, so unbounded undo depth per patient).

Stats definitions (binding on `stats.ts`): a shift is all events between 04:00 local and the next 04:00; a timed task is on-time if `doneAt <= dueAt + 3 min`; the streak is the longest run of consecutive on-time timed tasks in the shift; shift stats are tasks completed (template and custom), tasks skipped, checks on-time %, best streak, patients admitted, patients discharged, median admit-to-discharge time.

## 7. Security and threat surface

Class A (offline: no network calls, no secrets, no external users). The data-protection block is adopted voluntarily because the device holds identifiable patient and client data; the authn/authz and rate-limiting blocks are skipped because there is no endpoint and no second user.

- Secrets: none. No API keys, no tokens. `.gitignore` still excludes `.env*`, `node_modules`, `dist`, `playwright-report`, `test-results`.
- Entry points and validation (at the sheet boundary, once):
  - Add patient form: `name` 1-40 chars trimmed; `species` from allow-list {dog, cat, rabbit, other}; `breed` 0-40; `sex` from {M, MN, F, FN, unknown}; `weightKg` optional number 0.05-150 with 2 dp; `procedure` 1-80; `kennel` 0-10; `intake` from {08:00, 09:00, 10:00, none}; `ownerPhone` optional, digits/+/space only, 6-20 chars (enables tap-to-call); `notes` 0-500.
  - Add custom task: `label` 1-60; `dueAt` optional ISO timestamp not more than 24 h in the past or 48 h ahead.
  - Import JSON: size cap 10 MB; `schemaVersion` must equal current; every record validated field by field with the same rules; unknown fields dropped; invalid file rejected whole with a count of failing records, never partially applied.
  - All rendering through Preact text nodes. No `dangerouslySetInnerHTML` anywhere; its presence fails lint.
- Data held: patient name, species, breed, sex, weight, procedure, kennel, intake time, task timestamps, free-text notes, optional owner phone. Rests in IndexedDB on the handset under the app's origin. Encryption at rest is whatever the handset's storage encryption provides; the app adds none (no key could be held that the same device could not read). Retention: discharged patients purged by the nurse or by the configurable auto-purge; "Delete everything" in Settings clears all stores. The README states plainly that the phone should be locked and that the app holds client-identifiable data.
- Logging: none in production builds. Dev-only console logging never prints a patient record; it prints ids and action types.
- Hosting: GitHub Pages serves static files only. Public repo contains code and synthetic fixtures. Content-Security-Policy meta tag: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'`.

## 8. Failure modes and operations

| Interaction | Failure | Behaviour |
|---|---|---|
| IndexedDB open | blocked, version error, quota, private mode | App boots in memory-only mode with a persistent banner "Not saving: storage unavailable"; every action still works; no retry loop |
| IndexedDB write | rejection | Action already applied in memory; write retried once after 250 ms; on second failure the banner above appears and the failed write is queued for retry on next successful write; nothing silently lost without the banner |
| IndexedDB read at boot | corrupt record | Record skipped, count shown in a dismissible banner, offer export of raw store for recovery |
| Notification permission | denied or unsupported | Vibration still attempted (`navigator.vibrate` is permission-free on Android Chrome); Settings shows the state and a one-line explanation; no repeated prompting |
| Page backgrounded / screen off | JS timers throttled or page killed | On `visibilitychange` and on boot, `timers.ts` recomputes all due tasks and fires one combined vibration plus a notification listing overdue checks. Stated in §9 as a limitation |
| Service worker update | new build deployed | Skip-waiting with an in-app "Update ready, reload" bar; never a silent reload mid-shift |
| Export | Share API unavailable | Fall back to `<a download>` blob; if that also fails, show the JSON in a copyable textarea |
| Import | invalid file | Rejected whole with a message; existing data untouched |
| Clock | device time jumps | All due computations are relative to stored ISO timestamps; a backwards jump shows overdue chips rather than crashing; no monotonic assumptions |

- Error policy: every promise awaited or `.catch`-ed to the banner mechanism; no empty catch; ESLint `no-empty` and `@typescript-eslint/no-floating-promises` are errors. User-facing messages are plain English, no stack traces.
- Config: `VITE_BASE_PATH` for the Pages sub-path, `VITE_APP_VERSION` from the git SHA at build. No other tunables in code; user-facing tunables (purge days, sound, theme, notification) live in the `settings` store with defaults in `domain/types.ts`.
- Concurrency: single-threaded UI plus one service worker. The only shared state is IndexedDB; the SW never writes to it. Multiple open tabs are not supported: a `BroadcastChannel` lock makes the second tab show "Wardbelt is open in another tab" and stay read-only. One `setTimeout` at a time in `timers.ts`, re-armed after each tick, capped at the next due time or 60 s, whichever is sooner.

## 9. Limitations and trade-offs

- Android may suspend the page when the screen is off for a long period; a due vibration can then arrive late, on wake. The Notification Triggers API that would fix this is not shipped in Chrome. A 15-minute check cadence with the phone in a pocket is therefore "reliable while the screen has been on in the last few minutes, best-effort otherwise". The board makes overdue state unmissable on wake.
- No cloud backup: a lost or reset phone loses history unless exported. Export is one tap and the app nudges weekly.
- One fixed template. Procedure-specific presets were considered and rejected for this version: the nurse's stated workflow is one list with skips, and presets add an admit-time decision at the worst moment of the day.
- Owner phone number on a personal device is a deliberate convenience with a stated privacy cost; it is optional and off by default in the form (a "show owner phone field" setting).
- Preact plus signals rather than vanilla DOM: ~4 kB and one dependency in exchange for far fewer state-sync bugs during an autonomous build.
- No iOS testing. iOS Safari PWAs cannot vibrate and background notifications differ; not a target.

## 10. Repository structure

```
wardbelt/
├── .github/workflows/ci.yml, pages.yml
├── .gitignore                 .env*, node_modules, dist, playwright-report, test-results, coverage
├── CLAUDE.md                  build protocol (autonomous variant)
├── STATE.md                   stage tracker
├── LICENSE                    MIT
├── README.md                  Phase 3
├── docs/PLAN.md, DECISIONS.md, TESTING.md (evidence: coverage, Lighthouse, axe)
├── index.html                 CSP meta, viewport, theme-color, manifest link
├── package.json, package-lock.json, tsconfig.json, vite.config.ts, vitest.config.ts,
│   playwright.config.ts, eslint.config.js, .prettierrc
├── public/icons/              192, 512, maskable; monochrome glyph, square, no gradient
├── src/                       per §3
└── tests/unit/, tests/e2e/, tests/fixtures/synthetic.ts
```

Pinned dependencies (exact versions resolved at scaffold time and locked): runtime `preact`, `@preact/signals`, `idb`. Dev: `vite`, `typescript`, `vite-plugin-pwa`, `vitest`, `@testing-library/preact`, `jsdom`, `fake-indexeddb`, `@playwright/test`, `eslint`, `typescript-eslint`, `eslint-plugin-preact` (or the maintained equivalent), `prettier`, `@axe-core/playwright`. Nothing else without a STATE.md decision line.

### Visual system (binding on stage 4)

- Corners: 0 px everywhere except 2 px on the belt cells. Borders: 1 px hairlines in ink at 15% opacity. No shadows heavier than a 1 px hairline; no gradients; no glow.
- Palette, light: background #FAFAF9, surface #FFFFFF, ink #111111, ink-muted #6B6B6B, hairline rgba(17,17,17,.15), accent (single) #0F6E56 clinical green, warning #B7791F, danger #B42318, done fill #0F6E56 at 100% on belt cells with white glyph. Dark (theatre mode): background #121212, surface #1A1A1A, ink #F2F2F2, muted #9A9A9A, same accent/warning/danger lightened to pass 4.5:1.
- Type: system sans (`system-ui, -apple-system, Roboto`), sizes 12/14/16/20/28, weight 400 and 600 only; timers and kennel numbers in `ui-monospace, Roboto Mono` tabular figures.
- Spacing scale 4/8/12/16/24/32. Touch targets 48 px minimum. Row height 88 px collapsed.
- Belt: a strip of square cells, one per task, 24 px, 4 px gap; todo = hairline outline, current = 2 px accent outline, done = accent fill with a 1-frame 120 ms scale-in, skipped = hatched diagonal at 30%, overdue timed = danger outline pulsing once per 2 s (no continuous animation). Phase groups separated by 8 px. Two-letter uppercase code inside each cell (HA, BL, DM, PM, TH, IT, HT, C1..C4, FW, TO, PS, IN, CO, PH, IV, DC).
- Completion feedback: `navigator.vibrate(30)`, cell fill animation, row progress bar advance over 200 ms, optional 40 ms click sample (off by default). Belt complete: `vibrate([30,40,30])` and a 400 ms sweep of the row's progress bar. No modals, no toasts longer than 4 s, undo lives in the toast.
- Motion: every animation under 400 ms, all disabled under `prefers-reduced-motion`.

## 11. Execution stages

Dependencies are explicit so the orchestrator can run stages in parallel. "DoD" = definition of done; every DoD includes lint clean, typecheck clean, and its tests green.

| # | Stage | Depends on | Deliverable | DoD |
|---|---|---|---|---|
| 0 | Scaffold | none | Vite + Preact + TS strict; ESLint/Prettier; Vitest + jsdom + fake-indexeddb; Playwright with Pixel 5 profile; vite-plugin-pwa manifest and SW; `index.html` with CSP; icons; `ci.yml` and `pages.yml`; MIT LICENSE; `.gitignore`; `tests/fixtures/synthetic.ts` | `npm run lint && npm run typecheck && npm test && npm run build` pass on an empty app that renders "Wardbelt"; Playwright smoke opens the page; CI file validated with `actionlint` |
| 1 | Domain core | 0 | `src/domain/*` per §3 and §6 | 100% line and branch coverage on `src/domain`; property-style tests: any sequence of valid actions leaves every patient with exactly one current task or a complete belt; undo of N actions restores the prior state byte-for-byte; recovery due times exactly +15/30/45/60 min; urgency sort stable and total |
| 2 | Store | 0 | `src/store/*`, migrations v1, export/import with validation per §7 | Round-trip tests on fake-indexeddb; every §8 storage failure simulated and asserted to surface the banner action; import of a fuzzed file (10 malformed variants) rejects whole; quota-exceeded path tested |
| 3 | Scheduler | 0 | `src/scheduler/*` with injectable clock; notify feature-detected | Fake-clock tests: single timer armed, re-armed after tick, cap at 60 s; visibility resume fires combined DUE; permission denied path is a no-op with state exposed; no real timers in unit tests |
| 4 | Visual system and components | 0 | `tokens.css`, Belt, PatientRow, sheets, ShiftSummary, Settings as presentational components with fixtures; `feedback.ts` | Storybook-free: a `/dev` route renders every component in every state from fixtures; axe passes on that route; contrast checked programmatically for both themes; reduced-motion respected; all targets >= 48 px asserted in a Playwright test |
| 5 | Integration: App wiring and flows | 1, 2, 3, 4 | `App.tsx`, `Board.tsx`, `main.tsx`, SW registration, tab lock, update bar | Playwright e2e: add patient in <= 8 taps from board; complete steps; theatre return schedules checks; check goes overdue under fake clock and row sorts to top; add custom task; skip; undo; discharge; reload offline (SW) and data persists; second tab is read-only |
| 6 | Shift stats, summary, settings, transfer | 5 | ShiftSummary wired to `stats.ts`; export/import UI; purge; theme; notification toggle | e2e: a scripted shift produces the expected on-time %, streak, discharged count; export then wipe then import restores identical state; auto-purge respects the setting |
| 7 | Hardening and evidence | 5, 6 | Lighthouse PWA + performance + a11y >= 95 on mobile profile; bundle < 60 kB gzipped; `docs/TESTING.md` with coverage table, Lighthouse and axe output; `npm audit` clean | All numbers recorded from actual runs, not typed in |
| 8 | Phase 3: README, DECISIONS, pre-push gate, deploy | 7 | `README.md` (dual register, Getting started, install-to-home-screen steps with screenshots from Playwright, data and privacy section), `docs/DECISIONS.md`, gitleaks scan, clean-clone test, Pages deploy green, install verified via Playwright manifest check | Every README claim traceable to `docs/`; deployed URL returns the manifest and SW; secrets scan clean over full history |

Parallel plan for the orchestrator: stage 0 alone; then 1, 2, 3, 4 as four concurrent subagents on separate branches merged by the orchestrator; then 5; then 6; then 7; then 8. A verifier subagent that has not seen the implementation runs each stage's DoD before merge.
