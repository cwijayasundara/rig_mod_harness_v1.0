# RIG proof formats and the proof script

`${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts` decides every proof question: which cases are sealed, whether a run
passed, what it covered, the evidence key, and the verdict. Claude writes the inputs to it and runs both sides, but
never writes a verdict, a pass or a coverage count by hand. Every command prints JSON and exits 0 (check passed),
1 (check failed) or 2 (bad input).

## Case (`oracles/<system>/cases/<sha256>.json`, written by `case add`)

```json
{ "id": "<sha256 of the canonical input>",
  "input": { "records": {"ACCTFILE": [{"ACCT-ID": "00000000001", "ACCT-CURR-BAL": "1250.00"}]},
             "params": {"PARM": "2022071800"}, "clock": "2026-11-30T23:00:00",
             "stores": {"DISCGRP": "sha256:9f2c…"}, "session": null },
  "expected": { "...observations..." }, "classes": ["hazard:truncation", "random"], "origin": "hazard" }
```

All five input keys are required. Use `{}` or `null` for none.

## Observations (one file per case per side)

```json
{ "stores": { "ACCTDATA": { "records": [ {"ACCT-ID": "00000000001", "ACCT-CURR-BAL": "1251.04"} ] } },
  "return_code": 0, "abend": null, "messages": ["..."], "screens": null }
```

Values are strings exactly as a consumer sees them. The built-in `exact` comparator compares `return_code`, `abend`,
`messages`, `screens`, and for each store: `store_write`, `cardinality`, `record_order`, and each `field:<name>`. A
custom comparator is a command `<cmd> legacy.json modern.json` that prints `{"equal": bool, "compared": [observable
ids]}`. It must name what it compared (Rule B).

## Set (`oracles/<system>/sets/<name>.json`, written by `set build` and `judge`)

`dev`, `sealed` (case ids, chosen by hash), `exhaustive_classes`, `required_classes` (`{class: description}`), `generators`
(`{class: definition}`), `failed_classes` (the last run's). The set hash covers ids and generator definitions, never
seeds.

## Normalizer (`oracles/<system>/normalizers/NORM-*.json`)

```json
{ "id": "NORM-012", "observable": "INTJOB/SORTOUT.record_order", "erases": "order", "store": "SORTOUT",
  "surface": "analysis/<system>/surfaces/job-INTJOB.json",
  "consumer_evidence": {"program:STEP2": "app/cbl/STEP2.cbl:88 sorts on read"},
  "justification": "The only consumer, STEP2, sorts on read.", "approved_by": null }
```

`erases`: `order`, `field` (with `field`), `tolerance` (floating-point only), `encoding` (with `encoding`: `cp037`,
`cp1047`, `cp500`). Legal only when the consumer list is complete, no consumer depends on what is erased, and every
internal consumer has cited evidence. A person fills `approved_by`.

## Delta (`oracles/<system>/deltas/DELTA-*.json`)

`map` (`{legacy observable: modern observable}`), `removed`, `added`, `comparator`, `obligations_map` (`{OBL-id:
[new units]}`), `approved_by`. It must be total, and it must map every open obligation on its legacy observables.

## Run (`evidence/<system>/<key>/<run-id>/run.json`, written by `judge`, append-only)

Per case: `classes`, `pass`, `compared`, `fresh`, `property_only` (recorded mode, generated input: no legacy output exists, so it passes unless the modern side crashed. An abend is behaviour, not a crash: write an unhandled failure of the modern code as `"crash": "<what>"` in its observation). Coverage:
`observables`, `classes`, `hazards`, `calendar_events` (derived from each case's clock and run-mode params),
`mismatches`. Never edit or delete a run.

## Obligation (`obligations/<system>/OBL-*.json`)

`observables`, `requirement` (`hazard:<id>`, `class:<name>`, `calendar:<event>`), `min_count`, `reason`, `created_by`,
`accepted_by` (a person, through `/rig:review`), `status`. Discharged only by runs that exercised the requirement on
those observables, at least `min_count` times with no mismatch, in any environment and any later gate unit.

## Oracle cap (`oracles/<system>/caps/CAP-*.json`)

```json
{ "id": "CAP-001", "gate_unit": "job:READCUST", "class": "abend:open_failure", "environment": "gnucobol-3.2-bdb",
  "observables": ["READCUST.message", "READCUST.abend", "READCUST.return_code"],
  "reason": "BDB returns status 30 for a non-indexed file; z/OS behaviour differs and is unverified",
  "evidence": "analysis/<system>/PREFLIGHT.md check 4, env:open_failure_semantics", "signed_by": null, "signed_on": null }
```

A person rules that the reference environment cannot be trusted for one input class (§6.8). Once signed, that class's
comparisons in that environment count as neither pass nor fail. The verdict lists them under `capped` and adds a gap
whose obligation (`exclude_environment`) only runs in **another** environment can discharge. Unsigned, a cap changes
nothing, and the verdict says it was ignored. A cap never covers another class, and never removes a sealed case.

## Infrastructure sign-off (`evidence/<system>/signoffs/*.json`)

`{"case": "<id>", "signed_by": "<person>", "reason": "..."}`. It clears a case that passes and fails under one key
only when it passed in one reference environment and failed in another. Reruns alone never clear a failure.

## Verdicts

`PROVEN` (every run passed, every requirement covered), `PROVISIONAL` (gaps covered by accepted obligations, or
recorded mode), `NOT_PROVEN` (a failure, zero cases, or an unaccepted gap), `FLAKY` (a case both passes and fails).
