---
description: Compute the verdict of each rung of a gate unit from the evidence, by script, and write VERIFICATION.md
argument-hint: <system> <gate-unit>
arguments: system gate_unit
---

Load the `rig-method` skill and read `references/proof.md` first. Run in a fresh session where possible. Never trust
notes a build left behind: recompute everything from `evidence/`, `oracles/` and `obligations/`.

## 1 — Comparator trust

For every normalizer and delta the runs used:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts normalizer --ws . --system $system --file <NORM-*.json>
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts delta --ws . --system $system --file <DELTA-*.json> \
  --legacy-surface <legacy surface file> --modern-surface <modern surface file>
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts canary --ws . --system $system --gate-unit $gate_unit \
  --samples <a few legacy observation files with at least two different records per store> [--comparator <cmd>] \
  [--correlated '[{"store":"STMT","detail":"amount","total":"total_due"}]']
```

If a class fails because the reference environment behaves unlike production (you can cite the difference, as in
`PREFLIGHT.md` check 4), never change the port or the oracle to make it pass. Write an unsigned
`oracles/$system/caps/CAP-*.json` (format in `references/proof.md`) and list it for a person to sign with
`/rig:review $system caps`.

An illegal normalizer, a delta that is not total or leaves an obligation unmapped, or a comparator that misses a
canary, makes every rung that used it NOT_PROVEN.

## 2 — Requirements per rung

Write `evidence/$system/requirements/<gate-unit>-<rung>.json`:

- `observables`: every observable id on the gate unit's surface (Rule B: each must have been compared).
- `classes`: `{class: minimum inputs}` from the set.
- `fresh_classes` (V4): every required class.
- `hazards`: every hazard in `hazards.json` within the gate unit's programs.
- `capped`: each difference between the reference environment and production from `PREFLIGHT.md`, as
  `{hazard, observables}`.
- `calendar_events` (V10 only): run `rig_proof.ts calendar --gate-unit $gate_unit --derived <events from scheduler
  definitions, PARMs and control cards>` and use its `required`.

## 3 — Verdict

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts verdict --ws . --system $system --gate-unit $gate_unit --rung <R> \
  --key <current key> --requirements <file> --write-obligations
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts obligations --ws . --system $system
```

Recompute the key first, with the same command `/rig:judge` used. If code or configuration changed since the runs,
the key differs and there is no evidence, so the verdict is NOT_PROVEN. That is correct. `--write-obligations` creates an
open obligation for each gap. A person accepts one with `/rig:review $system obligations`, which makes PROVISIONAL
reachable. Never set `accepted_by` yourself.

For a restructure unit, also run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts check --ws . --system $system
--root <modern source root>` and report its result word for word beside the verdict. A failing architecture check
does not change the verdict the script prints, but the unit cannot merge.

## 4 — Report

Append to `analysis/$system/VERIFICATION.md`: per rung, the script's verdict word for word, its reasons, its gaps,
the key, the runs counted, and the obligations (open or discharged). Never write a verdict the script did not print.
End with what a person must do next.
