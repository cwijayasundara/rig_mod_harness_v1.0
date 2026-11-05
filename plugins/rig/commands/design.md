---
description: Design the target shape of a restructure — evidence for module boundaries, two candidate partitions, a critic's scorecard, and a draft ADR and MODULES.json for a person to sign
argument-hint: <system>
arguments: system
---

Load the `rig-method` and `java-restructure` skills first, and read the skill's `references/restructure.md`. Needs
`analysis/$system/graph.json`, `surfaces/`, `hazards.json` and `INTENT.md` (rule cards if they exist). Write only
under `analysis/$system/decomposition/` and `analysis/$system/ADR-*.md`. This is Phase B of
`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §7; its gate is a person signing the ADR.

## 1 — Affinity evidence

Write `analysis/$system/decomposition/affinity.json`: for every program or class node in the graph,

```json
{ "node": "class:carddemo.Cbact04c", "file": "src/carddemo/Cbact04c.java",
  "stores": {"reads": ["XREFFILE"], "writes": ["ACCTFILE", "TRANSACT"]},
  "gate_units": ["job:INTCALC"],
  "terms": ["interest", "account"],
  "edges": ["calls class:carddemo.Zoned", "uses class:carddemo.FixedFiles"] }
```

Every entry comes from `graph.json` edges or a cited `path:line`; terms come from rule cards, or from identifiers and
comments when there are no cards (say which). A node with no stores, no gate unit and no edges is listed under
`orphans`, not dropped.

## 2 — Two partitions

Draw two, each in the MODULES.json format of `references/restructure.md` plus `assign` (`{current file: module}`,
every source file exactly once) and `rationale` (one line per module):

- `option-business.json`: along business seams: rule-card domains and the gate units that serve them.
- `option-data.json`: along data seams: each store with the code that writes it.

Shared code that more than one module needs goes in a `shared` module with no store. A partition that leaves a store
written by two modules says so in `rationale`; it does not hide the conflict.

## 3 — Critic

Dispatch the `architecture-critic` agent with the paths above. Wait for it. It writes `SCORECARD.md`, the recommended
`MODULES.json` and a draft `ADR-0001.md`.

## 4 — Check what it wrote

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts hash --ws . --system $system`. It must print a hash for every
ADR named in `MODULES.json`. Check that every store in the surfaces has exactly one owner and a marker that occurs in
the code (`grep -rn`). Report any gap as a defect in the critic's output; do not fix the decision yourself.

End with the scorecard in brief, the open questions for a person, and `/rig:review $system adrs`.
