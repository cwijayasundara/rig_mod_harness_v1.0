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
`external`, `unresolved`, and for Java and web applications `endpoint`, `class`, `template`, `config`.

Edge kinds: `includes`, `calls` (static CALL), `transfers` (XCTL), `links` (LINK), `starts` (START TRANSID),
`runs` (step to program), `contains`, `expands` (step to PROC), `binds` (step to dataset through a DD, attrs `dd`,
`disp`), `reads`, `writes`, `accesses_unknown`, `defines`, `deletes`, `submits` (internal reader), `transmits`
(FTP and similar, to an `external` node), `sends`/`receives` (screens), `entry` (transaction to program), `maps_to`
(CICS file to dataset, PSB to IMS database; Java batch job to its entry class), `uses` (a Java class referencing another as a type;
`calls` and `uses` carry the method-level pairs in `attrs.methods`), `schedules`, `triggers`, `has_record`, `declares`,
`reaches_unresolved`.

A node that is referenced but has no source in the tree gets `"attrs": { "source": "missing" }`. That is an unknown,
not an error, and it must also appear in `unresolved.json`.

A system **program** or vendor **routine** whose behaviour is documented (SORT, IDCAMS, IEBGENER, FTP, IKJEFT01,
DFSRRC00, `CEE3ABD`) may instead get `"attrs": { "source": "vendor", "semantics": "<what it does to the surface>",
"doc": "<manual or reference>" }`. Its documented effect is used (SORT reads SORTIN and writes SORTOUT; CEE3ABD abends
the run). A vendor routine with no documented behaviour, or one whose effect on the surface you are not sure of, is
`missing`.

This never applies to **copybooks** or other included source. A copybook that is not in the tree is always a
`missing_copybook` entry in `unresolved.json`, even when it is IBM-supplied (`DFHAID`, `SQLCA`, `CMQ*`): its exact
layout, initial values and version are unknown, and the program's data depends on them. Mark the node
`"source": "missing", "supplier": "IBM"` so a reader can tell product copybooks from lost application ones.

## unresolved.json

Every site whose target is not a literal, one entry per site, **including the ones you resolve**. A site resolved as
a constant keeps its entry with `status: resolved`, so a reader can audit the proof. Also one entry for every
reference to something with no source in the tree (`missing_*`).

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
`constant` (the operand is provably constant: a literal VALUE in working storage that no statement writes. Cite the
VALUE line in `evidence`, and list in `writes_searched` the write forms you searched for and how many hits each had), `trace` (a runtime trace, cited), or `attested` (a person, entry in
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
`message`, `screen`, `timing`, `repeat`. Every output store gets at least `store_write`, `record_order`, `cardinality` and one
`field` per elementary field of its record. Every gate unit gets `return_code` and `abend`.

**Observable ids** are exactly the ids the comparator records, so that a verdict can tell what was compared. `<U>` is
the gate unit without its prefix (`job:INTCALC` → `INTCALC`, `http:GET /owners` → `GET /owners`):

| Level | Id | Kinds |
|---|---|---|
| unit | `<U>.<kind>` | `return_code`, `abend`, `message`, `screen`, `timing` (elapsed_ms on both sides, V9), `repeat` (runs 2..N of a `repeat` case) |
| store | `<U>/<store>.<kind>` | `store_write`, `cardinality`, `record_order`, `store_semantics` |
| field | `<U>/<store>.field:<name>` | one per field |

Nothing else goes in an id. A scenario (which page, which status, which error) is a label in `"scenarios"` on the
observable, never a suffix: `{ "id": "GET /owners.screen", "kind": "screen", "scenarios": ["200-html-list",
"302-single-match", "500-bad-page"] }`. For an HTTP route, `<store>` is the table name. Check every surface with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts surface check --ws . --system <s> --file surfaces/<file>.json`; it lists
each id the comparator would never record. The M4 exit run wrote `http:GET /owners.screen:200-html-list`, and every
route came out NOT_PROVEN with "never compared" although every case passed.

The gate unit's graph node is `job:<name>`, `transaction:<name>` for `tx:<name>`, and `endpoint:<METHOD> <path>` for
`http:<METHOD> <path>`. `rig_proof.ts key` refuses a gate unit whose node is not in `graph.json`.

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
(`ACCEPT FROM DATE` without YYYYMMDD, two-digit years), `run_mode` (a PARM or control card that selects a branch),
`file_status` (a status the program tests or prints), `abend` (`CEE3ABD`, return codes), `display_bytes` (DISPLAY of
groups, zoned and edited fields). The bridge skill for the language pair has each one's generator (for COBOL to
Java, `cobol-to-java/references/hazards.md`).

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
