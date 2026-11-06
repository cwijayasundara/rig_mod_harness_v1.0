---
description: Run one entry point in shadow — traffic through legacy and modern side by side, compared by script, with calendar, timing and obligations visible in CUTOVER.md
argument-hint: <system> <gate-unit> [stage: shadow|canary|primary]
arguments: system gate_unit stage
---

Load the `rig-method` skill and read `references/proof.md` first. This is V10 (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md`
§6.6, §7 Phase F). `$stage` defaults to `shadow`. Before anything, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts cutover --ws . --system $system --gate-unit $gate_unit --stage $stage
--key <V10 key> --requirements <V10 requirements>`. If it is not allowed for the go alone, stop: only a person moves an
entry point into a stage (`/rig:review $system cutover`). A stage the script refuses is never run.

## 1 — Traffic

Traffic is what the entry point would see in production, one `<name>.json` per run of the job or request
(`{input, classes?}`, the canonical input of `references/proof.md`) in `work/$system/shadow/<run>/traffic/`:

- **Recorded traffic** first: production inputs captured at the entry point, if `PREFLIGHT.md` lists a Record capability.
- **Replayed days** otherwise: one business day per item, drawn with the set's generators (class `random` and every
  hazard class), with the clock set to the day. Cover the **calendar minimum window** (`rig_proof.ts calendar
  --gate-unit $gate_unit --derived <events from scheduler, PARMs, control cards>` prints it) plus every derived event.
  Say in `CUTOVER.md` that the traffic is replayed, not production: a replay covers an event, it does not prove
  production will look like it.
- **Injected inputs** for hazards that never occur on their own (invalid packed data): add them as items with their
  `hazard:<id>` class, so the obligations that need them can be discharged.

## 2 — Both sides

Run every item on legacy and on modern with the runners the judge uses, each side seeded only from the item, and
write `<name>.json` observations to `work/$system/shadow/<run>/legacy/` and `.../modern/`. Each runner adds
`elapsed_ms` (wall clock of the job or request alone) to its observation when it can measure it; it is not compared.

## 3 — Record

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts key --ws . --system $system --gate-unit $gate_unit --rung V10 <same flags as /rig:judge>
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts shadow --ws . --system $system --gate-unit $gate_unit --key <key> \
  --traffic <traffic dir> --legacy-dir <legacy obs> --modern-dir <modern obs> --env <environment id> --stage $stage \
  --set <the gate unit's oracle set> [--comparator ...] [--normalizers ...] [--deltas ...]
```

A mismatch joins the oracle set's sealed cases. It is a failure, as in the judge: never rerun to make it go away.

## 4 — Verdict and the cutover view

Write `evidence/$system/requirements/<gate-unit>-V10.json` as `verify.md` does, with `calendar_events` from the
`calendar` command, and `timing_max_ratio` (V9) from the batch window or latency budget in `INTENT.md` (ask a person if
it is not there; never invent one). Run `verdict --rung V10 --write-obligations`, `obligations`, and `cutover` for the
next stage. Then write `CUTOVER.md` (one section per entry point, replacing its previous section):

- the stage, and the script's `cutover` answer for the next stage, word for word;
- per shadow run: date, stage, traffic kind (recorded, replayed, injected), counts per class, mismatches;
- calendar: required events, covered, missing (from `calendar`);
- timing: legacy and modern totals and the ratio, against the limit;
- obligations on this entry point: id, requirement, status, accepted by, what would discharge it;
- the V10 verdict word for word.

End with what a person must decide before the next stage, and the command for it.
