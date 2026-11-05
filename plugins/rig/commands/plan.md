---
description: Plan the work units of a step — one per job or transaction, with scope, oracle, mode, budget and order
argument-hint: <system> <step: translate|uplift|restructure|data|cutover> [target-stack]
arguments: system step target
---

Load the `rig-method` skill first. You are the planner. Needs `analysis/$system/graph.json`, `surfaces/` and
`INTENT.md`. Write only `work/$system/WU-*.yaml` and `work/$system/PLAN.md`.

## 1 — Units

One work unit per gate unit (`job:NAME` or `tx:NAME`) in scope for `$step`. A unit changes **one axis** (Rule 1): a
translate unit translates and never restructures. For each one:

```yaml
id: WU-T-0001                 # T translate, U uplift, R restructure, X data, E cutover
type: translate
gate_unit: job:INTCALC
source_scope: [app/jcl/INTCALC.jcl, app/cbl/CBACT04C.cbl, app/cpy/CVACT01Y.cpy]   # the runtime closure, from the graph
target_scope: [modernized/intcalc/**]                                              # the only place the worker writes
observables: [<ids from surfaces/job-INTCALC.json>]
rules: [<BR-ids of cards citing the source scope>]
hazards: [<H-ids in the source scope>]
oracle: { set: INTCALC-exec, mode: executable }   # or recorded; from PREFLIGHT.md capabilities
skill: cobol-to-java                              # the bridge (java-uplift for a Java uplift)
depends_on: []                                    # units whose stores this one reads, when order matters for testing
budget: { attempts: 3, wallclock: 60m }
```

An **uplift** unit covers one deployable. It has `gate_units: [<every route or job it serves>]` in place of
`gate_unit`, `target_scope` is the whole module, and it needs `analysis/$system/DELTA_CATALOG.md` from the
`version-delta-analyst` agent first. Every catalog hit is listed under `hazards`. Each gate unit keeps its own surface
and is judged on its own.

A **restructure** unit (step `restructure`, skill `java-restructure`) needs the signed decomposition first:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts check --ws . --system $system --root <current source root>` must show
no `signoff` violation (the other violations are what the units will fix). If it does, stop and name
`/rig:review $system adrs`. Plan one unit per module of `MODULES.json`, in dependency order (`shared` first, the
entry module last), or one unit for the whole tree when it has fewer than about 30 source files. Each unit has
`gate_units` (every gate unit whose runtime closure holds a file it moves), `module`, `target_scope` (the module's
package folders under `modernized/`), `hazards` (the R-* hazards of `references/restructure.md` found in its files),
`deltas` (the DELTA ids its ADR declares, or `[]`), and `reference: legacy/$system` (the tree the step started from).

`source_scope` is the gate unit's runtime closure: the JCL, PROCs, control cards, programs and copybooks. Compute it
the way `rig_proof.ts key` does: follow the graph from the gate unit and stop at persistent stores. A unit whose closure
has an open `missing_source` entry cannot be translated: list it in `PLAN.md` as blocked, with the entry id.

## 2 — Order

Units that only read stores no other unit writes come first. Then follow `depends_on`. Recorded-mode units come after
the executable ones they share stores with.

## 3 — PLAN.md

A table of units (id, gate unit, mode, the strongest verdict PREFLIGHT allows, depends on, blocked by), the order,
and the design decisions this plan makes. Each decision gets one owner and one line. End with
`/rig:unit $system <first unit>`.
