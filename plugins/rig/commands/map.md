---
description: Build the knowledge graph — inventory, graph, unresolved edges, observation surfaces with consumer completeness, hazard sites
argument-hint: <system>
arguments: system
---

Load the `rig-method` skill and read its `references/artifacts.md` first. Read `analysis/$system/PREFLIGHT.md` if it
exists. Write only under `analysis/$system/`. Five outputs, in this order, each checked before the next.

## 1 — Inventory

List every file under `legacy/$system/` (`find -type f`, following the symlink) into `inventory.json` with a kind
and a status. Nothing is left out: data samples, docs and scripts are `not-analyzed` with a reason.

## 2 — The sweep (mechanical, complete, re-runnable)

Before reading for meaning, sweep every source file for every site that creates an edge, and keep the command and the
hit count. For COBOL, JCL and CICS at least: `COPY`, `EXEC SQL INCLUDE`, `CALL`, `EXEC CICS` (XCTL, LINK, START,
READ/WRITE/REWRITE/DELETE/STARTBR, SEND/RECEIVE MAP, WRITEQ/READQ), `EXEC SQL`, `EXEC DLI`, `SELECT ... ASSIGN`,
`OPEN`, `EXEC PGM=` and `EXEC PROC=`, `DD` with `DSN=` or `SYSOUT=`, in-stream `SYSIN`/`SYSTSIN` control statements, and
scheduler job entries. COBOL source is fixed format: columns 1-6 are sequence numbers, column 7 `*` or `/` is a comment,
`-` continues the line, and text after column 72 is ignored. JCL text after column 71 is ignored. A grep that counts
comment lines must be filtered. For a large tree, write a small TypeScript script under `analysis/$system/tools/` (run with `node`, no
dependencies) that does the sweep and prints the counts, and run it. That way the sweep can be re-run and its count checked.

For Java and Spring at least: `@Controller`/`@RestController`, `@RequestMapping`/`@GetMapping`/`@PostMapping`/…
(each route is a gate unit, `http:<METHOD> <path>`), `@Entity`, `@Table`, `@Id`/`@GeneratedValue`, repository
interfaces and `@Query`, `@Transactional`, `@Cacheable`, validators and constraint annotations, templates (`th:*`
expressions, fragments), `application*.properties`/`.yml`, `schema*.sql`/`data*.sql`, `pom.xml` or `build.gradle`
dependencies, and reflection or `Class.forName` (unresolved when the class name is not a literal).

Every hit is then classified by reading it: a static edge, an unresolved site, or not an edge (say why). The totals go
in `unresolved.json` under `sweep`, and `classified` must equal `hits`.

## 3 — Graph

Build `graph.json` from the classified sites, reading the code around each one:

- **Programs and copybooks**: `includes` edges; runtime (batch, CICS, IMS, DB2) from what the program uses.
- **Batch**: job → step (`contains`), step → program (`runs`), and PROCs expanded with overrides and symbolic
  parameters applied (`expands`). A program's file `SELECT ... ASSIGN TO <dd>` plus its `OPEN` mode, joined with the
  step's DD, gives `reads` or `writes` on the dataset (GDG base name, with the generation in attrs). A DD the program
  does not visibly use, or a step whose program has no source, gets `accesses_unknown`.
- **Utilities**: SORT (SORTIN → SORTOUT, keys from SYSIN), IDCAMS (REPRO INFILE/OUTFILE, DEFINE, DELETE), IEBGENER
  (SYSUT1 → SYSUT2; SYSUT2 to `INTRDR` is a `submits` edge to the job in SYSUT1), FTP (`transmits` to an `external`
  node for the host), IKJEFT01 (`RUN PROGRAM()` in SYSTSIN gives the program run), DFSRRC00 (`PARM='DLI,prog,psb'`).
- **Online**: transaction → program (`entry`, from the CSD), `transfers`/`links`/`starts`, CICS file → dataset
  (`maps_to`, from the CSD `DSNAME`), screens (`sends`/`receives` to `map:MAPSET/MAP`), TD queues (an extrapartition
  queue whose DD can reach the internal reader is a possible job submission: unresolved `job_submission`).
- **Data**: `table` nodes from DDL, with `reads`/`writes` from `EXEC SQL` verbs; `ims_db`/`psb` from DBD/PSB macros and
  DL/I calls (GU/GN/GNP read; ISRT/REPL/DLET write); `mq_queue` from MQOPEN object names.
- **Java web**: an `endpoint` node per route (`endpoint:GET /owners/{ownerId}`) with `entry` to its handler
  `class`/method, `sends` to each `template` it renders, `reads`/`writes` to each `table` its repositories touch (through
  `@Entity` mappings), and `config` nodes for the properties that change behaviour. A route's gate unit is the endpoint.
- **Java code (any Java system, batch or web)**: one `class` node per top-level type (`class:carddemo.Cbact04c`,
  `loc` its file), a `calls` edge for each class whose method it calls and a `uses` edge for each class it only
  references as a type (field, parameter, `new`, `catch`). Each edge lists the method-level pairs in
  `attrs.methods` (`["run -> Zoned.decode", ...]`), each with its `path:line`. A Java **batch** entry point gets a
  `job` node per job it runs (`job:INTCALC`, from the dispatch on `args` or the main class), an `entry` edge to the
  class it starts, and `reads`/`writes` to a `dataset` node for each file it opens, named by the environment
  variable or DD (`DD_ACCTFILE` gives `dataset:ACCTFILE`), with the open mode cited.
- **Schedules**: one `schedule` node per scheduler entry, `schedules` → job, `triggers` between entries (Control-M
  IN/OUT conditions, CA-7 triggered jobs), with calendar, days and run-mode parameters in attrs.

A target that is a literal is static. A target in a variable is **unresolved** unless provably constant: the variable
has a literal `VALUE`, is in working storage, is not redefined, and no statement writes it or a group containing it
(search for `MOVE ... TO`, `INTO`, `ACCEPT`, `INITIALIZE`, `SET`, `STRING ... INTO`, `CALL ... USING`, CICS `INTO()` and
`SET()`). Then it is resolved by `constant`, citing the VALUE line. List candidate targets you find (VALUE tables,
literal MOVEs), but candidates never resolve a site.

## 4 — Observation surfaces

One `surfaces/<gate-unit>.json` per job and per transaction. Gate unit boundary: its persistent stores. For each store
it writes: `store_write`, `store_semantics`, `record_order`, `cardinality`, and one `field` per elementary field of the
record layout. Give the field's type (`decimal(p,s)`, `zoned(n)`, `packed(p,s)`, `string[cp037](n)`, `binary(n)`) and a
representation when the bytes matter (sign convention, padding, scale). Also add screens and messages it produces,
`return_code` and `abend`. Then fill `consumers` for every observable by Rule A: internal consumers from the graph,
`complete: false` with `incomplete_because` naming each failing condition. Never set `complete: true` unless
`attestations.yaml` holds the person's attestation for that store and conditions 1 and 2 are cited.

Ids follow the grammar in `references/artifacts.md` (the ids the comparator records; scenario labels go in
`scenarios`). Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts surface check --ws . --system $system --file <surface>`
on every surface and fix each id it lists before you finish.

## 5 — Hazards

Sweep for every catalog entry in `references/artifacts.md` (`hazards.json`) and record each site with the observables
it can affect.

## Checks before you finish

- every inventory file classified; every sweep hit classified (`classified == hits`);
- every `source: missing` node has a `missing_*` entry in `unresolved.json`;
- every dynamic `CALL`/`XCTL`/`LINK` target, dynamic file name, dynamic SQL and dynamic queue name is in
  `unresolved.json`;
- no surface has `complete: true` without an attestation.

Print a summary (nodes and edges by kind, unresolved by kind, surfaces, hazards by kind). End with
`/rig:rules $system`.
