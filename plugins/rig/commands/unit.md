---
description: Run the work-unit loop for one unit — brief, implement, self-check, three independent reviews, fix, judge, then merge, retry or escalate. Resumes where it stopped.
argument-hint: <system> <WU-id>
arguments: system unit
---

Load the `rig-method` skill and the unit's bridge skill (`skill:` in the unit file) first. Read
`work/$system/$unit.yaml`. You are the orchestrator. You never write the unit's code yourself, and you never show a
worker or fixer anything from `oracles/`, `evidence/` or `obligations/`. The guard hook blocks it, and so must you.

The loop (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §5.2):

```
brief → recipes → implement → self-check → review A (diff) → review B (spec and outputs) → review C (transcript)
      → fix → judge → merged | provisional | retry | escalate
```

## State and resume

Append one line per finished stage to `work/$system/$unit/log.jsonl`:
`{"ts", "attempt", "stage", "outcome", "notes"}`. On start, read the log and continue at the first stage the current
attempt has not finished. Before each stage, check the budget. If `attempts` is used up or `wallclock` (from the
first line's `ts`) has passed, go to **escalate**.

## Stages

1. **brief** — write `work/$system/$unit/brief.md`. It is everything the worker may know:
   - the contract (scope, target, observables with types and representations, the runtime contract of the job: inputs, DDs, PARM, outputs)
   - the rule cards in scope, the hazards in scope with their catalog rows
   - the description of every required input class
   - on a retry, the judge's counts per class from the last run, and nothing else about the failures

   Copy the **dev** cases (`oracles/$system/sets/<set>.json` → `dev`), as `{input, expected, classes}`, to
   `work/$system/$unit/dev/`. Executable mode: on a retry, also add new dev cases that you generate from each failing
   class, with legacy expected outputs. Sealed cases never leave `oracles/`.

   **Never teach the reference environment's quirks.** Match mechanically: list every class of the set, and every
   hazard id and observable, against each row of `PREFLIGHT.md` check 4 and each cap. For every class or observable that `PREFLIGHT.md` check 4 lists
   under an environment difference, or that a cap names, do **not** copy its dev cases. The expected outputs come from
   a reference that is not production. In the brief, list each such class with its environment difference and say:
   *production behaviour unknown: implement what the legacy code and the documented target-platform behaviour say,
   cite both, and flag it in your report*. Self-check never covers those classes. (M3 exit run 1: two dev cases taught
   the worker Berkeley DB's status 30, and no reviewer caught it.)
2. **recipes** — run any deterministic rewrite tool the bridge names (OpenRewrite for Java uplift, Rector for PHP).
   COBOL to Java has none: log `skipped`. A restructure has none either; the worker moves the code.
3. **implement** — dispatch the `worker` agent with the brief path and the unit file. It writes only in `target_scope`.
4. **self-check** — build it, then run every dev case through the worker's runner into `work/$system/$unit/self/<id>.json`
   and run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts compare --ws . --system $system --gate-unit <gu>
   --legacy-dir work/$system/$unit/dev --modern-dir work/$system/$unit/self`. A build failure or a failing dev case goes
   back to **implement** with the counts per class (this is not a new attempt). After three tries, **retry**.
   A **restructure** unit also runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts check --ws . --system $system
   --root <modern source root> --scope <target_scope paths>`, and passes any draft deltas to `compare --deltas`. Each
   violation goes back to **implement** with its rule, file and line (it is shape, not oracle, so the worker may see it).
5. **review A** — write `work/$system/$unit/review-a/diff.patch` (the change in `target_scope` since the last merge, or
   the whole tree on a first attempt). Dispatch `reviewer-a` with only that path.
6. **review B** — write `work/$system/$unit/review-b/`, holding `spec.md` (the rule cards, the surface, the brief's
   contract, and `PREFLIGHT.md` check 4; for a restructure also `MODULES.json` and the signed ADR), plus the dev outputs of both sides (`legacy/` and `modern/`, one file per case). Dispatch `reviewer-b`.
7. **review C** — write `work/$system/$unit/review-c/` with the worker's final report, the log, and the self-check
   output. Dispatch `reviewer-c`.
   On attempt 2 and later the packets are `review-a<n>/`, `review-b<n>/`, `review-c<n>/` (`review-a2/`), so earlier
   packets stay as they were. The guard lets each reviewer read only these names; any other folder name locks it out.
8. **fix** — if any review has a `must` finding, dispatch the `fixer` with the findings' text (never the packets), then
   repeat **self-check**. Log each finding as fixed or disputed. A finding the fixer disputes goes into the escalation
   note if it is not fixed.
9. **judge** — carry out `${CLAUDE_PLUGIN_ROOT}/commands/judge.md` for the unit's gate unit and set (for an uplift
   unit, for **each** gate unit in `gate_units`, and the outcome is the worst of them), with the unit's
   modern files in the key, then `${CLAUDE_PLUGIN_ROOT}/commands/verify.md`. Read the verdict the script prints.
10. **outcome**:
    - **merged** — the verdict is PROVEN for every required rung (and, for a restructure, `rig_arch.ts check`
      passes for the unit's scope). Dispatch the `merge` agent.
    - **provisional** — the verdict is PROVISIONAL, and every obligation it names has `accepted_by`. Dispatch `merge`
      with the obligation ids. If an obligation is not accepted, stop and ask a person (`/rig:review $system obligations`).
    - **retry** — a class failed. Start a new attempt at **brief**, with the counts per class.
    - **escalate** — the budget is used up, a failure has an environment cause (draft an oracle cap, see
      `verify.md`), or a dispute is unresolved. Write `work/$system/$unit/ESCALATION.md`: what was tried, the
      counts per class, the reviewers' open findings, and the decision a person must make.

Guard denials are recorded by the hook in `.rig/guard.jsonl`. Copy them into the unit's report; never report "no
denials" without reading that file.

End every run of this command with the unit's state, the stage reached, and the next command.
