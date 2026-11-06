---
description: A person confirms rule cards, attests consumers and resolves unresolved edges — the human gates of the Understand phase
argument-hint: <system> [rules|consumers|unresolved|normalizers|caps|obligations|adrs|cutover]
arguments: system what
---

Load the `rig-method` skill first. You record decisions; you never make them. Write only
`analysis/$system/rules/*.yaml` (status and review fields), `analysis/$system/attestations.yaml`, and the matching
`status` fields in `unresolved.json` and `surfaces/`, `analysis/$system/decomposition/signoffs.json`, the
`Status:` line of an ADR, and `cutover/$system/*.json`.

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

## Normalizers and deltas (`normalizers`)

For each file in `oracles/$system/normalizers/` and `deltas/` with an empty `approved_by`, first run
`rig_proof.ts normalizer` (or `delta`) and show its result. An illegal one cannot be approved: say why and move on.
For a legal one, show what it erases or maps and its justification, then ask *Approve* or *Reject*. Approve writes
the person's name to `approved_by`.

## Oracle caps (`caps`)

For each draft `work/$system/caps/CAP-*.draft.json` (agents write only drafts) and each `oracles/$system/caps/CAP-*.json`
with an empty `signed_by`: show the class, the environment, the reason and its evidence (the PREFLIGHT row), how many
cases it would take out of pass and fail, and the obligation it creates. Ask *Sign: the oracle cannot be trusted for
this class here*, *Reject*, or *Not now*. Sign writes the person's name and the date, and moves a draft to
`oracles/$system/caps/CAP-*.json`. Rejecting deletes nothing: write `"rejected_by"` and leave it unsigned.

## ADRs (`adrs`)

For each `analysis/$system/ADR-*.md` with `Status: proposed`: first run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts
check --ws . --system $system --root <current source root>` and show its `module` and `store_owner` violations (the
others are what the restructure will fix). Then show the decision, the scorecard
(`decomposition/SCORECARD.md`), the modules with what each owns, every store conflict, and the deltas it declares.
Ask *Sign this ADR and MODULES.json*, *Correct it* (they type the correction: apply it to the ADR or `MODULES.json`,
note it in the ADR under `## Review` with their name, rerun the check, and ask again), *Choose the other option* (the critic redrafts; nothing is signed), *Reject*,
or *Not now*. Sign: set `Status: accepted` in the ADR first, then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts
hash --ws . --system $system` and append `{adr, adr_sha256, modules_sha256, signed_by, signed_on}` to
`decomposition/signoffs.json` with the hashes it printed. Any later edit to the ADR or `MODULES.json` voids the
signature. Reject writes `Status: rejected` and signs nothing.

## Cutover (`cutover`)

For each entry point named in `CUTOVER.md`: run `rig_proof.ts cutover` for its next stage (see
`${CLAUDE_PLUGIN_ROOT}/commands/cutover.md`) and show the answer, the calendar and timing lines, and the open
obligations. Ask *Go: move to <stage>*, *No-go* (they say why), or *Not now*. Go appends `{stage, go_by, go_on}` to
`stages` in `cutover/$system/<gate-unit>.json` (the gate unit with every character outside `[A-Za-z0-9_.-]`
replaced by `_`). Ask for a go only when the script allows the stage apart from the go itself; otherwise show what
blocks it and ask nothing. No-go appends `{stage, no_go_by, reason, on}`.

## Obligations (`obligations`)

For each obligation with an empty `accepted_by`: show the requirement, the observables, the reason, and what would
discharge it. Ask *Accept: merge provisionally and discharge later* or *Reject: the gap must be covered first*.
Accept writes the person's name to `accepted_by`. Reject writes `decision: rejected`, `decided_by` and the date, and leaves `accepted_by` empty.

End with the counts still open and `/rig:status $system`.
