---
description: A person confirms rule cards, attests consumers and resolves unresolved edges — the human gates of the Understand phase
argument-hint: <system> [rules|consumers|unresolved]
arguments: system what
---

Load the `rig-method` skill first. You record decisions; you never make them. Write only
`analysis/$system/rules/*.yaml` (status and review fields), `analysis/$system/attestations.yaml`, and the matching
`status` fields in `unresolved.json` and `surfaces/`.

Ask with AskUserQuestion, one item per question and at most four per pop-up, and show the evidence in each question:
the card or site, its citations, and the cited lines. Every question has a *Not now* option. Record answers verbatim
with the person's name (ask once per session) and today's date.

## Rules (`rules`, or when `$what` is empty)

P0 cards first, then P1, then cards with `review_notes`. Options: *Confirm*, *Correct it* (they type the correction:
apply it, keep the old text under `review_notes`, and set `status: verified` so it goes round again), *Not a rule*,
*Not now*. Confirm sets `status: confirmed`, `confirmed_by`, `confirmed_on`.

## Consumers (`consumers`)

For each store whose surface has `complete: false`: show the internal consumers, any FTP, print, SYSOUT or
internal-reader edges, and the open unresolved entries that could reach it. Ask: *Who else reads this outside the
system?* (they type names and what each depends on: order, fields, layout) and *Is that the complete list?*. Write
them to `attestations.yaml`. Set `complete: true` on the store's observables only when the person said yes **and**
conditions 1 and 2 (`references/artifacts.md`) are cited as met. Otherwise record the attestation and leave
`complete: false`, naming what is still open.

## Unresolved (`unresolved`)

For each open entry: show the site, the expression, and the candidates with where they came from. Ask *What can this
really reach?* with the candidates as options (multi-select) plus *Other* and *Don't know*. An answer becomes a
`resolutions` entry in `attestations.yaml`, and the site becomes `status: resolved`, `resolved_by: attested`. Don't
know leaves it open.

End with the counts still open and `/rig:status $system`.
