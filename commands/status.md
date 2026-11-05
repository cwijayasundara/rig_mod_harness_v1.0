---
description: Where am I, what is stale, what is open, and the exact next command
argument-hint: <system>
arguments: system
---

Load the `rig-method` skill first. Read, never write, except `analysis/$system/STATUS.md`.

State comes only from the artifacts on disk. For each phase say done, stale or not started:

| Phase | Done when | Stale when |
|---|---|---|
| intent | `INTENT.md` exists | — |
| preflight | `PREFLIGHT.md` exists | a legacy file is newer than it |
| map | `inventory.json`, `graph.json`, `unresolved.json`, `surfaces/`, `hazards.json` exist | a legacy file is newer than `graph.json` |
| rules | `rules/BR-*.yaml` exist | `graph.json` is newer than the newest card |
| review | every P0 and P1 card is `confirmed` | a card changed after it was confirmed |

Then the open items, counted and listed by the person who must act:

- unresolved edges with `status: open`, by kind,
- surfaces with `complete: false`, and how many observables each,
- P0 and P1 cards not yet confirmed,
- capability gaps from `PREFLIGHT.md`,
- open items in `INTENT.md` and `PREFLIGHT.md`.

Check consistency and report any break as a defect: a file in `legacy/` missing from `inventory.json`; a `missing`
node in `graph.json` with no `unresolved.json` entry; a `resolved` entry with no `resolved_by`; an `attested` entry with
no matching line in `attestations.yaml`; a `complete: true` without all three conditions cited.

End with the single next command, filled in.
