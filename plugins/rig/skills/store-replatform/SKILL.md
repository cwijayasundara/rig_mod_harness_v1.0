---
name: store-replatform
description: The RIG bridge for re-platforming a store (VSAM, sequential files, IMS, DB2 to a relational target such as Postgres or H2) — the data (X) contract, declaring store semantics, probe classes that test them, migration reconciliation (V7), end-state comparison over a business day (V8), and rerunning every reader against the migrated store. Load before planning, implementing, reviewing or judging a data (X) unit.
---

# Store re-platform bridge

A data unit moves **one store** to a new platform and changes nothing else: the programs keep their logic, the
module that owns the store (`MODULES.json`) gets a new adapter. Its contract (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md`
§2): **data and store semantics are preserved, except for declared deltas**. Phase E gate: V2 to V4, V7 with
store-semantics probes, and V8.

## 1 — Declare the store's semantics (`analysis/<system>/stores/<STORE>.semantics.json`)

From the code and the catalog (LISTCAT, DDL, DBD), cited `path:line`, one entry per property the programs can observe:

| property | legacy example | what to declare on the target |
|---|---|---|
| `key_order` | KSDS key order, EBCDIC collation | the target collation; a collation that does not match is a delta or an obligation, never silent |
| `duplicates` | unique primary key, non-unique alternate index | constraint and which duplicate a read returns |
| `record_format` | fixed 500 bytes, trailing spaces kept | column types; padding, trimming, empty versus NULL |
| `numbers` | zoned or packed decimal, sign, scale | `NUMERIC(p,s)`, never float; negative zero |
| `status` | file status 00/10/23/35 on each verb | what the adapter returns for each, and on an absent table |
| `access` | sequential, random, browse from a key, rewrite | the query each one becomes, with its order |
| `commit` | CICS SYNCPOINT scope, close-on-abend | transaction boundaries; what survives an abend |

Each property the target cannot match exactly is written as an unsigned `DELTA-*.json` with its obligation mapping,
or listed for an oracle cap. A person decides which.

## 2 — Probe classes

Each declared property gets an input class `store:<property>` with a generator that reaches it: keys whose EBCDIC and
ASCII orders differ, duplicate alternate keys, all-space and trailing-space fields, the maximum and minimum of each
numeric field, an absent or empty store, an abend between two rewrites. Both runners write what a probe found as the store's
`semantics` in the observation (`stores.<STORE>.semantics`, for example `{"key_order": ["A01", "B01", "101"],
"duplicates": "rejected"}`; format in `rig-method` `references/proof.md`), so the surface's
`<U>/<STORE>.store_semantics` is compared. A surface that lists it while no runner writes it is never covered. Add them to the gate units of every program
that reads or writes the store (`graph.json` `reads`/`writes`), not only the one that is being moved.

## 3 — Migrate and reconcile (V7)

The migration (unload, convert, load) is a script under the owning module, run on a copy. Reconcile by judge: one
case per migrated dataset whose legacy observation is the unload and whose modern observation is the target table read
back in key order, both as `stores.<STORE>.records`. The comparator's `cardinality`, `record_order` and `field:*`
observables are the counts, the order and the values; compare exactly. Build its set with `set build --mode reconcile`
(any number of datasets, all sealed, legacy run live; such a set proves V7 only and can reach PROVEN), and record it
under the **V7** key, whose `--harness` lists the unload and probe programs and the legacy runner that produced the
legacy side. A key for V7 without `--harness` is refused. Relative paths outside the workspace (a jar in `~/.m2`)
work in `--modern`; they are hashed under the path as written.

## 4 — Readers and the business day (V8)

Rerun every reading job and transaction against the migrated store (V2 to V4, their own sets, the store-probe classes
added). For V8, one case is a whole business day: the stores as they were at the start, the jobs in schedule order
(`graph.json` `schedules` and `triggers`), and the final state of every store, compared exactly.

## 5 — Then cutover

A data unit's entry points go through `/rig:shadow` and `/rig:cutover` like any other: V10 runs the real traffic on the
migrated store.
