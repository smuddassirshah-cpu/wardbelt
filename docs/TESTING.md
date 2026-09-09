# Testing and evidence

Stage 7 of the build (PLAN.md section 11). Every number below was produced by a run in this
repository on the date stated; nothing is typed in from memory. The trimmed machine-readable
summaries live in `docs/evidence/` and each carries its own timestamp and commit.

- Date of the runs: 2026-09-09. The stage 7 runs (UTC 01:43 to 01:58) were made at commit
  `dd6b370`; stage 8 re-ran every evidence script (UTC 02:20 to 02:21) at commit `3aa07b1`
  (main after the stage 7 merge, which holds every measured source and test), so each file in
  `docs/evidence/` now names that commit. Every count below was identical on the re-run except
  the Lighthouse performance metrics noted in that section, which are quoted from the re-run.
- Sources measured: commit `3aa07b1`. Nothing under `src/` changed between `dd6b370` and this
  commit, so `npm run build` produces the same artefacts: `assets/index-ClAHynj2.js`,
  `assets/index-BgkVBKBj.css`, `assets/DevGallery-CT-gv7vt.js`,
  `assets/workbox-window.prod.es5-BBnX5xw4.js`, `sw.js` with 13 precache entries.
- Machine: macOS (Darwin 25.6.0, arm64), Node v22.16.0, npm 10.9.2, Google Chrome 152
  (HeadlessChrome/152.0.0.0), Playwright 1.63.0 with the Pixel 5 profile, Vitest 4.1.11,
  axe-core 4.13.0 via @axe-core/playwright 4.13.0.

## Gate

`npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` exit 0
(log kept for the stage report):

| Step             | Result                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| `npm run lint`   | eslint 0 problems (`--max-warnings 0`); prettier "All matched files use Prettier code style!" |
| `npm run typecheck` | `tsc -p tsconfig.json` and `tsc -p tsconfig.sw.json` clean                     |
| `npm test`       | Test Files 42 passed (42), Tests 483 passed (483), 14.7 s; thresholds met         |
| `npm run build`  | see Bundle size                                                                  |
| `npm run test:e2e` | 33 passed (52.7 s, 54.4 s on the earlier run) on android-chromium (Pixel 5) against the production build |
| `node scripts/bundle-size.mjs --no-build` | OK: 40.76 kB gzipped, 19.24 kB under the limit           |
| `node scripts/hardening.mjs --no-build` | all 8 checks passed                                        |
| `actionlint`     | no findings on `.github/workflows/ci.yml` after adding the two evidence steps    |

## Coverage

From `npm test` (`vitest run --coverage`, v8 provider). The enforced gate is 100% on every
metric for `src/domain/**` (vitest.config.ts); the other directories have no threshold. Table
produced by `node scripts/coverage-table.mjs` from `coverage/coverage-summary.json` of that run
(`docs/evidence/coverage.json`).

| scope                  | statements         | branches           | functions         | lines              |
| ---------------------- | ------------------ | ------------------ | ----------------- | ------------------ |
| src/domain/patient.ts  | 100.00% (70/70)    | 100.00% (55/55)    | 100.00% (19/19)   | 100.00% (64/64)    |
| src/domain/recovery.ts | 100.00% (9/9)      | 100.00% (6/6)      | 100.00% (5/5)     | 100.00% (9/9)      |
| src/domain/reducer.ts  | 100.00% (124/124)  | 100.00% (98/98)    | 100.00% (29/29)   | 100.00% (119/119)  |
| src/domain/stats.ts    | 100.00% (58/58)    | 100.00% (32/32)    | 100.00% (6/6)     | 100.00% (56/56)    |
| src/domain/template.ts | 100.00% (7/7)      | 100% (0/0)         | 100.00% (2/2)     | 100.00% (7/7)      |
| src/domain/time.ts     | 100.00% (5/5)      | 100% (0/0)         | 100.00% (3/3)     | 100.00% (5/5)      |
| src/domain/types.ts    | 100.00% (10/10)    | 100% (0/0)         | 100.00% (1/1)     | 100.00% (10/10)    |
| src/domain/urgency.ts  | 100.00% (41/41)    | 100.00% (35/35)    | 100.00% (11/11)   | 100.00% (38/38)    |
| src/domain/validate.ts | 100.00% (224/224)  | 100.00% (180/180)  | 100.00% (32/32)   | 100.00% (224/224)  |
| src/domain (total)     | 100.00% (548/548)  | 100.00% (406/406)  | 100.00% (108/108) | 100.00% (532/532)  |
| src/store (total)      | 100.00% (213/213)  | 96.30% (78/81)     | 100.00% (66/66)   | 100.00% (202/202)  |
| src/scheduler (total)  | 100.00% (164/164)  | 100.00% (89/89)    | 100.00% (45/45)   | 100.00% (155/155)  |
| src/ui/app (total)     | 98.38% (486/494)   | 94.81% (292/308)   | 97.04% (131/135)  | 98.76% (479/485)   |
| src/ui (total)         | 98.35% (416/423)   | 95.25% (341/358)   | 97.35% (147/151)  | 98.56% (410/416)   |
| all files              | 99.19% (1827/1842) | 97.10% (1206/1242) | 98.42% (497/505)  | 99.33% (1778/1790) |

The three uncovered store branches are the ones the stage 2 verifier noted (`db.ts:70`
`newVersion ?? version`, `repo.ts:259` equal-id sort tie); the uncovered ui lines are
defensive branches listed in the stage 4 and 5 reports.

## Lighthouse

Production build served by `vite preview` on http://localhost:4173/, mobile profile (default:
emulated Moto G Power, simulated throttling, 4x CPU slowdown), `--chrome-flags=--headless=new`,
`CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Lighthouse 12
removed the PWA category, so two versions run: the current release for performance,
accessibility and best practices, and 11.7.1 (the last release with the category) for PWA.
Reproducible through `node scripts/lighthouse.mjs --write` (summary in
`docs/evidence/lighthouse.json`). Exact commands the script issues:

```
npx --yes lighthouse@13.4.1 http://localhost:4173/ --only-categories=performance,accessibility,best-practices --chrome-flags=--headless=new --output=json --output-path=<tmp>/current.json --quiet
npx --yes lighthouse@11.7.1 http://localhost:4173/ --only-categories=pwa --chrome-flags=--headless=new --output=json --output-path=<tmp>/pwa.json --quiet
```

| Category       | Score | Target | Lighthouse | Audits                                                   |
| -------------- | ----- | ------ | ---------- | -------------------------------------------------------- |
| PWA            | 100   | >= 95  | 11.7.1     | 9: 6 passed (installable-manifest, splash-screen, themed-omnibox, content-width, viewport, maskable-icon), 3 manual |
| Performance    | 100   | >= 95  | 13.4.1     | 49: 28 passed, 5 not applicable, 12 informative, 4 below 1 (see note) |
| Accessibility  | 100   | >= 95  | 13.4.1     | 76: 15 passed, 51 not applicable, 10 manual, 0 failed    |
| Best practices | 100   | none   | 13.4.1     | 21: 13 passed, 1 not applicable, 7 informative, 0 failed |

Metrics (13.4.1, simulated mobile, stage 8 re-run at `3aa07b1`): first contentful paint 1.2 s,
largest contentful paint 1.5 s (1.4 s on the stage 7 runs), total blocking time 10 ms (0 to
10 ms across runs), cumulative layout shift 0, speed index 1.2 s.

Audits scored below 1 on the performance category, none of which lowers the score:
`first-contentful-paint` 0.99 (1.2 s, weight 10, within the "good" band);
`max-potential-fid` 0.99 (80 ms, weight 0, scored 1 on the stage 7 runs);
`network-dependency-tree-insight` and `render-blocking-insight` score 0 but carry weight 0 (the
"insights" group). The render-blocking item is the 3.1 kB stylesheet
(`assets/index-BgkVBKBj.css`, estimated 150 ms). Removing it would mean inlining the CSS, which
needs a Vite plugin or an `index.html` change; both files are frozen for this stage and the
score is already 100, so it is recorded rather than changed. Cache headers cannot be
controlled on `vite preview` or GitHub Pages and no audit penalised them.

Lighthouse 13.4.1 declares `node >= 22.19` and printed an `EBADENGINE` warning on Node 22.16.0;
it ran to completion and produced a complete report. Four runs (three in stage 7, one in stage
8) gave the same four scores.

## axe

`tests/e2e/a11y.spec.ts` (Pixel 5, production build, `@axe-core/playwright` 4.13.0, axe-core
4.13.0, tags `wcag2a`, `wcag2aa`, `wcag21aa`). The board holds two patients added through the
real Add sheet: one with a 10:00 intake chip, one taken through theatre under the Playwright
clock and moved 16 minutes on so its first post-op check is overdue (danger chip, pulsing
cell). The second scene is that patient's sheet with the four due times, a note on check 2 and
an enabled Undo. Both scenes run in light and in dark (`prefers-color-scheme: dark`, body
background asserted `rgb(18, 18, 18)`). Every visible target is also measured at 48 px or
more. Results from `WARDBELT_EVIDENCE=1 npm run test:e2e` (`docs/evidence/axe.json`):

| Theme | Scene                                          | Violations | Rules passed | Incomplete | Not applicable | Rules run |
| ----- | ---------------------------------------------- | ---------- | ------------ | ---------- | -------------- | --------- |
| light | board with an intake chip and an overdue check | 0          | 18           | 0          | 44             | 62        |
| light | patient sheet with due times, a note and undo  | 0          | 25           | 1          | 37             | 63        |
| dark  | board with an intake chip and an overdue check | 0          | 18           | 0          | 44             | 62        |
| dark  | patient sheet with due times, a note and undo  | 0          | 25           | 1          | 37             | 63        |

The one incomplete rule is `color-contrast` on 2 nodes of the open sheet ("Element's background color
could not be determined because it's partially obscured by another element"): the task row
that straddles the bottom edge of the sheet's scrolling body. axe cannot sample a background
for a partly clipped element and asks for manual review; the same text passes the rule when it
is fully in view (the 25 passed rules include `color-contrast` for every other node), and the
palette itself is checked arithmetically in `tests/unit/ui/contrast.test.ts` (4.5:1 for ink,
muted ink, accent, danger and warning text on both surfaces in both themes).

The stage 4 and 5 axe passes still run in the same suite: dev gallery in light, `?theme=dark`
and `prefers-color-scheme: dark` (`tests/e2e/dev-gallery.spec.ts`), and the empty board,
board with a row, Add sheet and patient sheet (`tests/e2e/flows.spec.ts`), all with zero
violations.

## Bundle size

`node scripts/bundle-size.mjs --no-build` after `npm run build` (gzip through `node:zlib` at
the default level, decimal kilobytes as Vite reports them; `docs/evidence/bundle-size.json`):

| file                                       | raw       | gzip     |
| ------------------------------------------ | --------- | -------- |
| assets/DevGallery-CT-gv7vt.js              | 8.15 kB   | 2.87 kB  |
| assets/index-BgkVBKBj.css                  | 14.93 kB  | 3.13 kB  |
| assets/index-ClAHynj2.js                   | 93.67 kB  | 32.40 kB |
| assets/workbox-window.prod.es5-BBnX5xw4.js | 5.75 kB   | 2.36 kB  |
| total (limit 60.00 kB)                     | 122.50 kB | 40.76 kB |

Result: OK, 40.76 kB gzipped, 19.24 kB under the 60 kB limit; the script exits 1 above it.
The DevGallery chunk (dev route only) and workbox-window (loaded by the service worker
registration) are lazy chunks counted anyway, so the figure is the worst case; the shell's
first paint loads 35.53 kB. Not counted: `sw.js` (17.97 kB raw, 6.05 kB gzip, a worker rather
than shell code) and `index.html` (1.35 kB, 0.59 kB gzip). CI runs the same script after the
build step.

## Audit

`npm audit --audit-level=low` on 2026-09-09:

```
found 0 vulnerabilities
```

(`npm audit --json`: info 0, low 0, moderate 0, high 0, critical 0 across 568 packages, 5 of
them production dependencies.)

## Hardening checklist

Each line says how it was verified. Static checks over `dist/` are `node scripts/hardening.mjs
--no-build` (`docs/evidence/hardening.json`); tests are named with their file.

| Item | How verified | Result |
| ---- | ------------ | ------ |
| CSP meta present in `dist/index.html` | hardening.mjs matches the meta tag against the PLAN.md section 7 policy verbatim | PASS: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'` |
| No inline script in dist | hardening.mjs: `<script>` without `src`, `on*=` attributes, `javascript:` URLs | PASS: 0, 0, 0 (the only script tag is the module entry with `src`) |
| No `console` in dist JS | hardening.mjs greps `console.` in `dist/assets/*` and `dist/sw.js` | PASS: 0 matches across the 4 app assets. `sw.js` contains exactly one `console.warn`, Workbox's own guard for precache entries without revision info; a second check parses the injected manifest and confirms all 13 entries carry a `revision` key, so that branch cannot execute. Stripping it would need a minifier option in the frozen `vite.config.ts`. |
| No `eval` or `Function` constructor in dist | hardening.mjs | PASS: 0 matches |
| No patient data in any log path | `grep -rn "console\." src/` returns nothing and ESLint `no-console` is an error, so there is no log path; every user-facing reason is built from error `name`/`message` only (`src/ui/app/errors.ts`, `src/store/repo.ts`); `tests/unit/hardening/storage-unavailable.test.tsx` asserts the write-failure banner names the DOMException and not the patient | PASS |
| `dist/sw.js` precaches `index.html` and all assets | hardening.mjs parses the injected manifest | PASS: 13 entries (9 unique URLs): `index.html`, `manifest.webmanifest`, all four `assets/*`, three icons; nothing missing |
| Manifest installable | hardening.mjs plus Lighthouse 11.7.1 `installable-manifest` and `maskable-icon` | PASS: standalone, 192 and 512 icons, maskable |
| Offline reload | `tests/e2e/flows.spec.ts` "reloads offline from the service worker with data intact" (`context.setOffline(true)` then reload, row and belt state intact) | passed (1.5 s) |
| Second-tab lock | `tests/e2e/flows.spec.ts` "a second tab is read-only until the first closes" (banner, Add and belt disabled in tab two, primary regained after the first closes) | passed (1.2 s) |
| Storage-unavailable banner | `tests/unit/hardening/storage-unavailable.test.tsx` through the real `openRepo` and rendered `App`: no IndexedDB boots in memory with the permanent banner and every action works; an open that throws does the same; four failed puts (genuine fake-indexeddb request errors) show the banner with the DOMException name while the action stays applied, and the next successful write clears it. Also `tests/unit/app/session.test.ts` (boot stall to memory) and `tests/unit/app/app.test.tsx` (banner rendering) | 3 passed |
| Clock backwards jump | `tests/unit/hardening/clock-jump.test.tsx`: session on the fake clock with an overdue check; clock set 60 min back then swept: no throw, `state.now` follows, chip reads `C1 in 55:00`, stored `dueAt` unchanged, one timer armed, urgency returns to due-soon then overdue as time advances; forward jump of 60 min: `C1 overdue 65:00`, row first; shift window and stats coherent either side. Also `tests/unit/scheduler/timers.test.ts` "neither throws nor notifies on a backwards clock jump" | 3 passed |
| Reduced motion | `tests/e2e/dev-gallery.spec.ts` "reduced motion zeroes animation and transition durations" (`emulateMedia reducedMotion`, done cell, overdue cell and progress fill all `0s`) | passed |
| Touch targets 48 px | `tests/e2e/dev-gallery.spec.ts` "every visible interactive element is at least 48 by 48" (more than 200 measured), `tests/e2e/flows.spec.ts` "board and add sheet are axe clean with 48 px targets", `tests/e2e/a11y.spec.ts` (board with data and open sheet, both themes) | passed |
| No secret in the tree | `.gitignore` covers `.env*`; `gitleaks detect --source . --no-banner` over the full history is a step of `scripts/pre-push.sh` | PASS: 21 commits scanned, no leaks found (stage 8 gate below) |

## Stage 8 gate

`scripts/pre-push.sh` run on 2026-09-09 at commit `5ca912e` (the stage 8 implementation
commit; this section was added in the commit that follows it, and the gate was re-run there
with the same result, recorded in the stage 8 report in STATE.md), exit 0. Every step calls
the commands above; the summary the script printed:

```
==== pre-push summary (stage-8-release, HEAD 5ca912e) ====
PASS  preview port 4173 is free (0 s)
PASS  npm run lint (8 s)
PASS  npm run typecheck (3 s)
PASS  npm test (11 s)
PASS  npm run build (2 s)
PASS  bundle size (scripts/bundle-size.mjs) (0 s)
PASS  hardening checks (scripts/hardening.mjs) (0 s)
PASS  Pages base path (scripts/check-base-path.mjs) (1 s)
PASS  npm run test:e2e (57 s)
PASS  gitleaks detect (full history) (1 s)
PASS  clean clone: npm ci, build, test (18 s)
total 101 s

pre-push gate GREEN
```

What the stage 8 steps add to the stage 7 gate:

| Step | Result |
| ---- | ------ |
| `npm run test:e2e` | 37 passed (57.0 s): the 33 stage 7 tests plus `tests/e2e/install.spec.ts` (3: manifest installable with name, short_name, standalone, start_url and scope equal to the app base, theme_color, 192/512/maskable-512 icons fetched as PNGs; manifest link and apple-touch-icon present and fetched; `navigator.serviceWorker.ready` resolves with the app scope and the controller is `sw.js` after a reload) and `tests/e2e/screenshots.spec.ts` (1: the README scene on Pixel 5 under the Playwright clock, six PNGs each asserted under 300 kB) |
| `node scripts/check-base-path.mjs` | `VITE_BASE_PATH=/wardbelt/ vite build` into a temporary directory: start_url `/wardbelt/`, scope `/wardbelt/`, 2 of 2 asset references start with `/wardbelt/assets/`, manifest linked at `/wardbelt/manifest.webmanifest`, no absolute reference outside the base, `/wardbelt/sw.js` referenced by the bundle, sw.js emitted; 7 of 7 checks passed, `dist/` untouched |
| `gitleaks detect --source . --no-banner` | 21 commits scanned, about 1.34 MB in 263 ms, no leaks found |
| clean clone | `git clone` of HEAD `5ca912e` into a temporary directory, `npm ci` (518 packages), `npm run build`, `npm test`: 42 files, 483 tests passed, coverage 99.18% statements, 97.1% branches, 98.41% functions, 99.32% lines, domain thresholds met |
| `actionlint` | no findings on `ci.yml` and `pages.yml` (neither changed in stage 8) |

Screenshots in `docs/screenshots/` (board-light 128,635 bytes, board-dark 127,161,
patient-sheet 149,174, add-patient 74,914, summary 84,469, settings 120,852) were written by
`WARDBELT_EVIDENCE=1 npx playwright test tests/e2e/screenshots.spec.ts`; an ordinary e2e run
writes them to the Playwright output directory instead.

## How to reproduce

All commands from the repository root with dependencies installed (`npm ci`). Node 22.

1. Gate: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.
   The e2e step builds and serves the production bundle itself on port 4173.
2. Coverage table: after `npm test`, `node scripts/coverage-table.mjs --write` prints the table
   above and refreshes `docs/evidence/coverage.json`.
3. Bundle size: `node scripts/bundle-size.mjs --write` (builds first; add `--no-build` to
   measure an existing `dist/`). Exit code 1 over 60 kB gzipped.
4. Hardening checks: `node scripts/hardening.mjs --write` (same flags). Exit code 1 on any
   failed check.
5. Lighthouse: `node scripts/lighthouse.mjs --write` (same flags). Reuses a preview already on
   4173 or starts and stops its own; picks `CHROME_PATH`, then Google Chrome, then Playwright's
   Chromium under `~/Library/Caches/ms-playwright`. Runs `lighthouse@13.4.1` and
   `lighthouse@11.7.1` through `npx --yes` (a tool invocation; neither is a dependency). Exit
   code 1 if PWA, performance or accessibility scores below 95. Full reports go to a temp
   directory the script prints; only the trimmed summary is written under `docs/evidence/`.
6. axe evidence: `WARDBELT_EVIDENCE=1 npm run test:e2e` (or `... npx playwright test
   tests/e2e/a11y.spec.ts`) writes `docs/evidence/axe.json`; without the variable the same
   counts are attached to the Playwright report only.
7. Audit: `npm audit --audit-level=low`.
8. CI: `.github/workflows/ci.yml` runs the bundle-size and hardening scripts after `npm run
   build` with `--no-build`; validate edits with `actionlint`. Lighthouse is not in CI because
   performance scores on shared runners vary run to run and would make the gate flaky; the
   script and the evidence file are the record.
9. Pre-push gate: `scripts/pre-push.sh` (see README for installing it as a git hook). It
   refuses to start while port 4173 is in use, so stop any preview server first. Set
   `WARDBELT_TMP` to choose where the clean clone is made.
10. Pages base path: `node scripts/check-base-path.mjs` (add `--keep` to inspect the temporary
    build it makes).
11. README screenshots: `WARDBELT_EVIDENCE=1 npx playwright test tests/e2e/screenshots.spec.ts`
    rewrites `docs/screenshots/*.png`.
