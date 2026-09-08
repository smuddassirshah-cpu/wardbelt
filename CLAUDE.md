# Wardbelt build protocol (autonomous one-shot variant)

This repo is built in a single autonomous run by an orchestrator that delegates to subagents. Read docs/PLAN.md and STATE.md before any work, every session. PLAN.md is binding; where it is silent, choose the simplest option that passes the stage's definition of done and log the choice in STATE.md under Decisions.

## Coding standard
- Efficient, non-verbose, best practice. O(n) or O(n log n) where achievable; justify anything worse in a comment at the site.
- No per-line explanatory annotation. A short decision-notes block at the top of non-trivial files only.
- British English in comments, docs, UI copy, and identifiers where language-neutral. No em-dashes anywhere, including UI strings.
- TypeScript strict, no `any`, no non-null assertions without a comment.
- Every stage ships with its tests. Untested code does not pass a gate.

## Security floor (non-negotiable, all stages)
- No secret in code, config, or any commit. There are none in this project; if one appears, stop and report.
- External input (patient form, custom task form, import file) is validated at the boundary per PLAN.md §7 before use. Nothing else validates.
- No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`. ESLint enforces; do not disable rules.
- Errors are handled or propagated, never swallowed. No empty catch blocks. No floating promises. A TODO in an error path fails the gate.
- No logging of patient records in any build. Test fixtures are synthetic only (tests/fixtures/synthetic.ts).
- No new dependency beyond the PLAN.md §10 list. If a stage cannot be completed without one, prefer writing the code; if still impossible, add it with a one-line note in STATE.md (maintained? last release? licence?) and continue.

## Orchestration protocol
1. Stage 0 is done by the orchestrator alone. Commit "stage 0: scaffold".
2. Stages 1, 2, 3, 4 run as four concurrent subagents, each on its own branch (`stage/1-domain` etc.), each given: this file, docs/PLAN.md, the relevant §3/§6/§7/§8/§11 rows, and the scaffold. Subagents touch only their own directory under src/ plus their tests. Interfaces between stages are exactly PLAN.md §6; a subagent that needs to change an interface stops and reports instead.
3. Each subagent ends by running its DoD commands and writing a stage report to `STATE.md` (its own section): built, DoD evidence (paste actual command output summaries), deviations, open questions.
4. Before merging any stage, the orchestrator spawns a verifier subagent that has not seen the implementation. It receives only PLAN.md, the stage's DoD, and the branch, and must independently run the DoD and try to break the stage (malformed input, out-of-order actions, storage failure, clock jumps). It returns PASS or a list of concrete failures. FAIL means the implementing subagent fixes and the verifier re-runs. Two consecutive FAILs on the same point escalate to the orchestrator, which fixes it directly.
5. Merge in order 1, 2, 3, 4 onto main; run the full suite after each merge; commit "stage N: <deliverable>".
6. Stages 5, 6, 7, 8 run sequentially, each with a fresh implementing subagent and a fresh verifier, same rule.
7. STATE.md is updated at every stage transition. If the run dies, a new session reconstructs state only from STATE.md and git log.
8. The run is complete when stage 8's pre-push gate is green and STATE.md "Next action" reads "none: deployed".

## Stop conditions (the only reasons to halt and ask a human)
- A PLAN.md instruction is impossible on the actual platform (state which and why).
- A dependency in §10 is unavailable or has a critical unfixable audit finding.
- Deploy requires a credential or repository setting the run cannot set (GitHub Pages source, Actions permissions); complete everything else, then report exactly which setting to flip.

## Permissions
Do not: restructure the tree in §10, delete tests, force-push, weaken lint or TS config, or change the visual system in §10 to make a test pass. Report and log instead.
