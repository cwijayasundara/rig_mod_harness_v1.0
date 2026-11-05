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
skill: cobol-to-java                              # the bridge for this language pair
depends_on: []                                    # units whose stores this one reads, when order matters for testing
budget: { attempts: 3, wallclock: 60m }
```

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
