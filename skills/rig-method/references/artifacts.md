# RIG artifact formats

All paths are relative to the workspace. All `loc` values are `legacy-relative/path:line`. JSON files are written with
sorted keys and two-space indent so a re-run produces a reviewable diff.

## inventory.json

Every file under `legacy/<system>/`, no exceptions.

```json
{ "files": [
    { "path": "app/cbl/CBACT04C.cbl", "kind": "cobol-program", "lines": 652, "status": "understood" },
    { "path": "app/data/ASCII/acctdata.txt", "kind": "data-sample", "lines": 50, "status": "not-analyzed",
      "reason": "test data, not code" } ],
  "totals": { "files": 51, "understood": 47, "not-analyzed": 4 } }
```

`status` is `understood` (it is in the graph) or `not-analyzed` with a `reason`. A file with neither is a defect.

## graph.json

```json
{ "nodes": [ { "id": "program:CBACT04C", "kind": "program", "name": "CBACT04C",
               "loc": "app/cbl/CBACT04C.cbl:1", "attrs": { "language": "cobol", "runtime": "batch" } } ],
  "edges": [ { "from": "step:INTCALC/STEP15", "to": "program:CBACT04C", "kind": "runs",
               "loc": "app/jcl/INTCALC.jcl:3", "attrs": {} } ] }
```

Node ids are `<kind>:<name>`, with `/` for nesting (`step:JOB/STEP`, `map:MAPSET/MAP`).

Node kinds: `program`, `copybook`, `record`, `job`, `proc`, `step`, `dataset`, `sysout`, `control_card`,
`transaction`, `mapset`, `map`, `cics_file`, `td_queue`, `mq_queue`, `table`, `ims_db`, `psb`, `schedule`,
`external`, `unresolved`.

Edge kinds: `includes`, `calls` (static CALL), `transfers` (XCTL), `links` (LINK), `starts` (START TRANSID),
`runs` (step to program), `contains`, `expands` (step to PROC), `binds` (step to dataset through a DD, attrs `dd`,
`disp`), `reads`, `writes`, `accesses_unknown`, `defines`, `deletes`, `submits` (internal reader), `transmits`
(FTP and similar, to an `external` node), `sends`/`receives` (screens), `entry` (transaction to program), `maps_to`
(CICS file to dataset, PSB to IMS database), `schedules`, `triggers`, `has_record`, `declares`,
`reaches_unresolved`.

A node that is referenced but has no source in the tree gets `"attrs": { "source": "missing" }`. That is an unknown,
not an error, and it must also appear in `unresolved.json`.

## unresolved.json

Every edge whose target analysis cannot prove. One entry per site.

```json
{ "sweep": { "command": "grep -rn -E 'CALL|XCTL|LINK|...' legacy/carddemo", "hits": 41, "classified": 41 },
  "unresolved": [
    { "id": "U-0001", "kind": "dynamic_transfer", "from": "program:COMEN01C",
      "loc": "app/cbl/COMEN01C.cbl:184", "expression": "XCTL PROGRAM(CDEMO-MENU-OPT-PGMNAME(WS-OPTION))",
      "candidates": ["COACTVWC", "COACTUPC"], "candidate_source": "app/cpy/COMEN02Y.cpy:20-80 VALUE table",
      "reaches": "any program in the system until resolved", "status": "open" } ] }
```

`kind`: `dynamic_call`, `dynamic_transfer`, `dynamic_link`, `dynamic_file`, `dynamic_sql`, `dynamic_queue`,
`job_submission`, `missing_source`, `missing_copybook`, `missing_proc`, `unknown_access` (a DD whose use the program
does not show).

`candidates` are for review only. They never resolve a site. `status` becomes `resolved` only with a `resolved_by` of
`constant` (the operand is provably constant: a literal VALUE in working storage that no statement writes; cite the
VALUE line and say which writes you searched for), `trace` (a runtime trace, cited), or `attested` (a person, entry in
`attestations.yaml`).

## surfaces/&lt;gate-unit&gt;.json

The observation surface: everything the unit does that a consumer can observe. One file per job (`job-INTCALC.json`)
or transaction (`tx-CC00.json`).

```json
{ "gate_unit": "job:INTCALC",
  "stores": ["dataset:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS"],
  "observables": [
    { "id": "INTCALC/ACCTDATA.store_write", "kind": "store_write", "type": "record(300)",
      "representation": null, "source": "app/cbl/CBACT04C.cbl:350",
      "consumers": { "internal": ["job:POSTTRAN"], "external": [], "complete": false,
                     "incomplete_because": ["U-0001 may reach any program", "no human attestation"] } },
    { "id": "INTCALC/ACCTDATA.field:ACCT-CURR-BAL", "kind": "field", "type": "decimal(12,2)",
      "representation": "zoned, signed trailing", "source": "app/cpy/CVACT01Y.cpy:9",
      "consumers": { "internal": [], "external": [], "complete": false, "incomplete_because": ["no human attestation"] } }
  ] }
```

Observable kinds: `field`, `record_order`, `cardinality`, `store_write`, `store_semantics`, `return_code`, `abend`,
`message`, `screen`, `timing`. Every output store gets at least `store_write`, `record_order`, `cardinality` and one
`field` per elementary field of its record. Every gate unit gets `return_code` and `abend`.

`complete` starts `false` and becomes `true` only when all three hold, each cited:

1. every program that can read the store is resolved (no open `unresolved` entry in the system can reach it),
2. the store is not transmitted, exported, printed or submitted outside the graph (FTP, SYSOUT, internal reader,
   Connect:Direct),
3. a person attested the external list in `attestations.yaml`.

External consumers are explicit: `{ "name": "GL bureau", "depends_on": ["record_order", "field:*"],
"attested_by": "<person or interface contract file>" }`. `depends_on` is never empty.

## hazards.json

Constructs whose meaning differs between source and target languages. One entry per site.

```json
{ "hazards": [ { "id": "H-0001", "hazard": "truncation", "loc": "app/cbl/CBACT04C.cbl:464",
                 "text": "COMPUTE WS-MONTHLY-INT = (TRAN-CAT-BAL * DIS-INT-RATE) / 1200",
                 "why": "no ROUNDED: COBOL truncates to the target's scale", "observables": ["INTCALC/TRANSACT.field:TRAN-AMT"] } ] }
```

The catalog (`hazard` values): `rounded` (ROUNDED on any arithmetic verb), `truncation` (arithmetic into a decimal
target without ROUNDED), `high_order_truncation` (a result that can exceed the target's digits with no SIZE ERROR),
`size_error`, `ebcdic_collation` (sort keys, alphanumeric comparisons with `<` `>`, START or READ NEXT on character
keys), `redefines`, `packed_in_char`, `invalid_packed` (COMP-3 fields read from input), `group_move_filler`,
`month_length`, `day_of_week` (`ACCEPT FROM DAY-OF-WEEK`: COBOL Monday=1, Java `Calendar` Sunday=1), `century_window`
(`ACCEPT FROM DATE` without YYYYMMDD, two-digit years), `run_mode` (a PARM or control card that selects a branch).

## rules/BR-*.yaml

```yaml
id: BR-ACCT-017
title: Interest accrues monthly on each transaction-category balance
priority: P0                 # P0 money, compliance or data loss; P1 visible behaviour; P2 the rest
given:
  - account.status = ACTIVE  # domain from the 88-levels: ACTIVE, CLOSED, FROZEN, PENDING
when: nightly batch INTCALC runs
then: monthly_interest = trunc(balance * rate / 1200, 2)
rounding_source: app/cbl/CBACT04C.cbl:464 COMPUTE without ROUNDED
citations: [app/cbl/CBACT04C.cbl:462-470, app/cpy/CVTRA01Y.cpy:4]
observables: [INTCALC/TRANSACT.field:TRAN-AMT]
negations:                   # every value of each condition's domain, plus one outside it
  - account.status = CLOSED
  - account.status = FROZEN
  - account.status = PENDING
  - account.status = <outside domain>
status: extracted            # extracted → verified (second agent) → confirmed (a person)
```

## attestations.yaml

Written by a person, or by a command only with the person's words verbatim.

```yaml
consumers:
  - store: dataset:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS
    external: [{ name: "GL bureau", depends_on: ["record_order"], attested_by: "J. Smith" }]
    complete: true
    attested_by: "J. Smith"
    date: 2026-11-05
resolutions:
  - unresolved: U-0001
    targets: [COACTVWC, COACTUPC]
    attested_by: "J. Smith"
    date: 2026-11-05
```
