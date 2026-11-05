---
description: Extract business rule cards with citations and full negation domains, each re-checked by a second agent
argument-hint: <system> [program-or-job]
arguments: system scope
---

Load the `rig-method` skill and read its `references/artifacts.md` first. Needs `analysis/$system/graph.json` and
`surfaces/`. If they are missing, say to run `/rig:map $system` and stop. Write only `analysis/$system/rules/`.

## 1 — Find the rule sites

In scope (`$scope`, or every program), list the decision sites a business person would care about: conditions
(`IF`, `EVALUATE`/`WHEN`) on fields of persistent records or of screens, arithmetic that produces a stored or
displayed amount, and validations that reject input. Skip plumbing (file status checks, loop counters) and say how
many you skipped.

## 2 — Extract (rule-extractor agent)

Dispatch the `rule-extractor` agent per program (in parallel for several) with the program path, its graph
neighbourhood and its surfaces. Each card: id `BR-<AREA>-NNN`, title, priority, Given/When/Then, citations
(`path:line-line`), the observables it affects (ids from the surfaces), and for arithmetic the rounding source.

**Negations cover the whole domain.** For every Given condition, list one negation per other value in the condition's
domain, plus one value outside the domain. The domain comes from the field's 88-levels (cite them) or the values the
code tests. A condition on a numeric threshold gets the boundary, one below and one above. Never a single falsifying
value.

Write each card with `status: extracted`.

## 3 — Verify (rule-verifier agent, a different model when available)

Dispatch `rule-verifier` per card, giving it only the card and the cited files, not the extractor's reasoning. It
re-reads the citations and returns, for each claim, *holds* or *does not hold* with a reason, plus anything the card
missed (a branch, a domain value, a rounding difference). Apply what it finds: a card whose claims all hold becomes
`verified`; any other card stays `extracted` with the verifier's findings in a `review_notes` list.

## 4 — Report

A table: card, priority, status, observables, citations. Counts per priority and per status. List cards a person must
look at first: every P0, and every card with `review_notes`. End with `/rig:review $system`.
