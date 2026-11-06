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

All five input keys are required. Use `{}` or `null` for none. One optional key: `"repeat": N` (an integer of at least 2)
runs the unit N times in one environment without resetting it between runs, for hazards that only show on a second run
(Spring Batch's "job instance already complete", S-RESTART). Leave it out for one run. The same canonical input is the same case: `case add`
then adds the classes to the existing case and prints `"merged": true` with `previous_classes` (a relabel, not a new
input). A generator that meant a new input must draw again.

## Observations (one file per case per side)

```json
{ "stores": { "ACCTDATA": { "records": [ {"ACCT-ID": "00000000001", "ACCT-CURR-BAL": "1251.04"} ] } },
  "return_code": 0, "abend": null, "messages": ["..."], "screens": null }
```

A case with `repeat` N has runs 2..N in `"repeats": [<observation>, ...]`, each in this same format; the judge refuses an
observation whose run count is not N, and a comparator that does not report `<U>.repeat`. Every runner should also write
`"input_digest"`: the sha256 of what it actually gave the program (each file's bytes and organization, the environment
variables, the arguments). It is never compared. The judge groups a run's cases by the modern digest, and cases with one
modern digest but different legacy digests are `coverage.ambiguous_inputs`: the modern input form lost a distinction
(an empty indexed file and an empty plain file written as the same bytes), and the verdict lists it as a gap. Values are strings exactly as a consumer sees them. The built-in `exact` comparator compares `return_code`, `abend`,
`messages`, `screens`, and for each store: `store_write`, `cardinality`, `record_order`, each `field:<name>`, and
`store_semantics` when either side has a `semantics` object. A store's `semantics` is what a probe of the store found
(`{"collation": "EBCDIC", "range_read": ["A01", "B01", "101"], "duplicate_key": "rejected"}`; values are strings or lists
of strings). A surface that lists `<U>/<store>.store_semantics` needs runners that write it on both sides, or that id is
never compared. A
custom comparator is a command `<cmd> legacy.json modern.json` that prints `{"equal": bool, "compared": [observable
ids]}`. It must name what it compared (Rule B).

The ids it records are the grammar in `artifacts.md` ("Observable ids"): `<U>.screen`, `<U>/<store>.field:<name>`,
and so on. A surface whose ids differ is never covered, whatever the runs show.

### HTTP runner

For an HTTP gate unit, run each case on each side with the shipped runner instead of writing one:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_http.ts run --case <case.json> --out <dir>/<case-id>.json \
  --start 'JAVA_HOME=<jdk> "$JAVA_HOME/bin/java" -jar <app.jar> --server.port={port} --spring.datasource.url=jdbc:h2:file:{workdir}/db/app' \
  --stores-cmd '<command that prints {"<table>": {"records": [...]}} after shutdown>' --message-class help-inline
```

Run it from the plugin, never a copy; in the key's `--modern` it is `plugin:scripts/rig_http.ts`. Only `--start` differs between legacy and modern. The header of `rig_http.ts` gives every step. It fixes the
environment, `Host` and the order of requests. It records a request that hangs as `{status: null, timeout: true}`,
an app that does not start as `abend`, and the exit code as `return_code`. Exit 3 (nothing written) means the run
could not be trusted: rerun it. Clock: with `clock` set, pass `--clock-wrap` (for example `faketime '{clock}'`).
Otherwise the case runs only on that UTC day; on any other day the runner exits 4 and writes `{"not_run": "<reason>"}`
as the observation. Keep that file on both sides: the judge records the case as not run, and the verdict shows it as a
gap ("N case(s) never ran on both sides") until a run compares it or a person accepts the obligation. Write the stores command for the application's database (for H2, the H2 jar's
`RunScript` with `CSVWRITE` per table, ordered by primary key). A surface that lists `<U>/<table>.store_semantics` needs
the stores command to print each table's `semantics` too (probe results as strings, for example the order a query by
name returns, or whether a duplicate key is rejected), the same on both sides. The runner records `elapsed_ms`, the time
the requests took (not start-up), which the judge counts as `<U>.timing` (V9; see `timing_max_ratio` in `verify.md`).

## Set (`oracles/<system>/sets/<name>.json`, written by `set build` and `judge`)

`dev`, `sealed` (case ids, chosen by hash), `exhaustive_classes`, `required_classes` (`{class: description}`), `generators`
(`{class: definition}`), `class_observables` (`{class: [observable ids]}`: a case counts toward that class or hazard
only when its comparison covered every listed id, for example `{"hazard:S-STARTUP": ["<U>.timing"], "hazard:S-RESTART":
["<U>.repeat"]}`; an unreached one is counted in `coverage.class_unreached`), `failed_classes` (the last run's), `failure_sealed` (cases a judge or shadow run sealed because
they failed). The set hash covers ids and generator definitions, never seeds, and leaves out `failure_sealed`: a run's
own failure never moves its key. `set build` seals at least one case of every class (the lowest hash of its new cases,
while the class keeps a dev case). After the split it prints `unsealed_classes` (no sealed case) and `classes_without_dev` (no dev case, so the worker sees only the description); give each such class new inputs and build again. An exhaustive class with no dev case is listed as `exhaustive_without_dev` instead: it has no other input, so that is reported, not fixed.

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

## Shadow run (V10, written by `shadow`)

The same `run.json` with `mode: "shadow"`, `stage` (shadow, canary, primary), every traffic item as a case with
origin `shadow` and class `shadow:traffic`, and `coverage.timing` (`cases`, `legacy_ms`, `modern_ms`: the sum of each
side's `elapsed_ms` where both recorded one). Calendar events come only from items whose two observations both carry
`clock_applied` equal to the input clock; the others are counted in `coverage.clock_not_applied`. Verdict, calendar and obligations read it like any run. V9 is the gap
`timing_max_ratio` in the requirements adds when modern exceeds that multiple of legacy, or when no run timed both sides.

## Verdicts

`PROVEN` (every run passed, every requirement covered), `PROVISIONAL` (gaps covered by accepted obligations, or
recorded mode), `NOT_PROVEN` (a failure, zero cases, or an unaccepted gap), `FLAKY` (a case both passes and fails).
A run of a `reconcile` set counts at V7 only; at any other rung the verdict is NOT_PROVEN.
