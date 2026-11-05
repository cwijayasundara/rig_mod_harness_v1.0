# RIG, a technology-agnostic modernization harness

**Proposal v0.2 · 2026-11-05** · Supersedes [v0.1](PROPOSAL-v0.1.md). Revised after the [interrogation of v0.1](INTERROGATION.md).

RIG modernizes a legacy system of any technology and proves, at every step, that the new system behaves like the old one. It handles like-for-like ports (COBOL to Java, Java 8 to 21) and restructuring (COBOL into a modular monolith, then selected services).

The design keeps three concerns apart:

- **Understanding.** A code knowledge graph, business-rule cards, and an observation surface for every unit.
- **Change.** Small, owned work units, run by a tree of planner, worker, and reviewer agents.
- **Proof.** A verification ladder whose verdict a script computes from content-addressed evidence.

---

## 0. What v0.2 changes

Three adversarial reviewers built prototypes of the v0.1 mechanisms and found 21 ways to get a wrong system marked PROVEN. The reruns confirmed all 21. They reduce to nine defects, and most share one cause. v0.1 compared outputs, but nothing defined what "the output" of a unit is. Comparators, normalizers, data steps, and evidence keys each made their own guess about it.

v0.2 adds that missing definition as a foundational object, the **observation surface**. It is the complete, typed list of everything a unit does that something else can observe. Every proof mechanism is now defined against it.

| # | v0.1 defect (see INTERROGATION.md) | v0.2 change | Section |
|---|---|---|---|
| 1 | Delta comparators dropped fields outside the canonical model | Comparators must be total over the observation surface. A canary sweep runs per field. | §6.3 |
| 2 | Held-out oracle leaked through duplicate inputs and judge feedback. A lookup table passed. | Cases are content-addressed by canonical input. The judge draws fresh inputs and returns counts only. A generalisation check rejects memorised code. | §6.1, §5.3 |
| 3 | Tolerance and order normalizers erased real behaviour. Gates checked programs, not jobs. | Normalizers are typed, may not cover decimals with tolerance, and need graph proof that nothing reads what they erase. T gates run at the job level. | §6.2, §6.4 |
| 4 | Generators never hit ROUNDED ties. Rule coverage passed with a dropped condition. | A hazard catalog per Bridge Pack drives construct-aware generators. Each rule card generates tests that negate each condition. | §4.3, §6.1 |
| 5 | A data step changed key collation, and V7 could not see it | Store access semantics are part of the observation surface. Data steps rerun programs against the migrated store. | §3, §6.4 |
| 6 | TargetPack could not run code. DataPack could not load data or keep record context. | Packs become capability sets that any Pack can implement. Canonicalisation streams typed records with context. | §8 |
| 7 | Verdict policy deadlocked when legacy cannot run | A new PROVISIONAL verdict merges with recorded obligations that block cutover until discharged | §6.5 |
| 8 | Cutover passed with no month-end in the window | Cutover requires calendar events derived from the code, not a day count | §6.6 |
| 9 | Evidence key missed normalizer config and shared dependencies | Evidence is keyed by a hash over every input to the proof. Flaky results have an explicit rule. | §6.5 |

v0.2 also fixes an error in v0.1. The sample rule card said `round_half_even`. COBOL `ROUNDED` defaults to rounding half away from zero.

---

## 1. Background

Three systems shaped this design. The [v0.1 proposal](PROPOSAL-v0.1.md) covers them and the wider vendor landscape in detail.

- **Anthropic `code-modernization` plugin.** A staged, file-based lifecycle, from assessment through rule extraction, build, and verification. Rules are Given/When/Then cards with `file:line` citations. A fresh-session verifier computes PROVEN, PARTLY PROVEN, or NOT PROVEN by script. RIG keeps all of this. Its gap is restructuring. `reimagine` goes from a spec to new services without proving equivalence across the architecture change.
- **Bun, Zig to Rust.** 535k lines in 11 days for about $165k. A test suite written in TypeScript, independent of the implementation language, was the oracle. Each task ran an implementer, two adversarial reviewers who saw only the diff, and a fixer. The architecture stayed the same during the port. Agents that stubbed code to get green builds were the main failure.
- **Cursor, agent swarm economics.** Frontier planners and cheap workers cost $1,339, against $10,565 for one model in both roles. Grading used a suite the agents never saw. Shared design docs, a neutral merge agent, and churn signals kept the swarm from spiralling.

The vendors (AWS Transform, Google Dual Run, IBM watsonx for Z and Mono2Micro, vFunction, GitHub Copilot modernization, Moderne/OpenRewrite, Thoughtworks CodeConcise) converge on assess, extract rules, generate, test. They are weakest at proving equivalence across an architecture change and at staying technology-neutral. RIG targets those two gaps.

---

## 2. Step types

A programme is a graph of typed steps per module. Each step type has its own gate.

| Step | Example | Contract |
|---|---|---|
| U · Uplift | Java 8 to 21, Spring Boot 2 to 3 | The observation surface is preserved exactly. |
| T · Translate | COBOL to Java, Perl to Python | The surface is preserved exactly, through declared encoding normalizers only. |
| R · Restructure | Spaghetti to modules, batch steps to services | The surface is preserved, except for declared deltas. |
| X · Data | VSAM to Postgres, EBCDIC to UTF-8 | Data and store access semantics are preserved, except for declared deltas. |
| E · Extract | Strangler-fig service extraction, CDC sync | The surface is preserved under production traffic. |
| I · Reimagine | New UX, new capabilities | A new spec, traced to confirmed rules. |

Example programme for AWS CardDemo:

```
COBOL ─T─► Java modular monolith ─R─► bounded modules ─X─► Postgres ─E─► 3 services, 1 module kept in the monolith
```

### Rule 1, restated

v0.1 said that a step may change only one axis (language, architecture, data platform, or behaviour). The interrogation showed that a data step changes behaviour anyway. Moving VSAM to Postgres changes how `START KEY >=` and `READ NEXT` order keys.

v0.2 states the rule in terms that can be checked:

> **Rule 1.** A work unit changes one axis. Each change to the observation surface that the unit makes must match a declared delta. The gate computes "changes to the surface" by comparing the surface before and after. The worker's description of its change plays no part.

---

## 3. The observation surface

The observation surface of a unit is the typed list of everything the unit does that a consumer can observe. The `graph-builder` derives it from the code knowledge graph (§4.1), and Packs extend it. Comparators, normalizers, deltas, generators, and gates all refer to its entries by ID.

```python
class Observable(TypedDict):
    id: str                     # "INTJOB/STEP1/SORTOUT.order", "ACCTFILE.browse_order"
    kind: Literal[
        "field",                # an output field: a record field, report column, or JSON path
        "record_order",         # the order of records in an output file or stream
        "store_write",          # a create, update, or delete on a data store
        "store_semantics",      # key collation, range-read behaviour, uniqueness, null handling
        "return_code",          # a COBOL RETURN-CODE, JCL condition code, or HTTP status
        "message",              # a queue message or event
        "screen",               # a BMS map field or a UI state
        "timing",               # SLA-bound timing, only when declared
    ]
    type: str                   # "decimal(9,2)", "string[cp037]", "date", "bytes"
    consumers: list[str]        # graph node IDs that read this observable. Empty means external.
    source: str                 # file:line, or Pack-derived evidence
```

Three properties make the surface do work:

- **Consumers are explicit.** `INTJOB/STEP1/SORTOUT.record_order` lists `STEP2` as a consumer, because STEP2 does a match-merge. A normalizer can erase record order only when the graph shows no consumer reads it (§6.2). That rule rejects the EBCDIC sort bug from finding 3.
- **Stores have semantics, not only content.** A VSAM KSDS contributes a `store_semantics` entry: keys collate in EBCDIC, and `START KEY >=` followed by `READ NEXT` pages in that order. A data step that changes collation changes the surface, so it fails unless a delta declares the change (finding 5).
- **Types carry rules.** A `decimal` observable cannot take a tolerance normalizer. It compares exactly or not at all (finding 3).

The surface is computed for the legacy unit and for the modern unit. The two surfaces must match entry for entry, after declared deltas. An entry that is present on one side only is a failure in itself.

---

## 4. Understanding plane

### 4.1 Code knowledge graph

Pack parsers build the graph deterministically, without an LLM. Node types are technology-neutral: System, Component, Routine, DataStructure, DataStore, Field, EntryPoint, Job, Step, Screen, ExternalSystem, BusinessRule, Test, WorkUnit, Decision, and Observable. Edges include `calls`, `reads`, `writes`, `consumes`, `implements_rule`, `tested_by`, and `owned_by_module`.

An LLM then summarises the graph bottom-up, leaves first, so each summary cites the summaries of its children. Storage starts as SQLite with a JSON export.

The CRUD matrix (component by data store by operation) drives decomposition. Runtime traces of business scenarios supplement static analysis, because shared copybooks make static clustering unreliable for COBOL.

### 4.2 Business rule cards

```yaml
id: BR-ACCT-017
title: Interest accrues daily on active accounts with a positive balance
priority: P0
given:                       # a list of conditions, so tests can negate each one
  - account.status = ACTIVE
  - account.balance > 0
when: nightly batch INTCALC runs
then: accrued_interest += round(balance * apr / 365, 2, mode=HALF_AWAY_FROM_ZERO)
rounding_source: CBACT04C.cbl:231 COMPUTE ... ROUNDED     # the mode comes from code, not from prose
citations: [legacy/cbl/CBACT04C.cbl:212-248, legacy/cpy/CVACT01Y.cpy:14]
observables: [INTCALC/ACCTFILE.accrued_interest]
status: confirmed
```

`given` is now a list of conditions, so the harness can generate a test that negates each one (§6.1). The rounding mode cites the code that defines it. An extractor may not write a rounding mode in prose.

### 4.3 Hazard catalog

Each Bridge Pack ships a hazard catalog. It lists source-language constructs whose semantics differ from the target language's defaults, and gives a generator for each one. For COBOL to Java:

| Hazard | Trigger in code | Generator |
|---|---|---|
| ROUNDED ties | `ROUNDED` on a COMPUTE | Inputs whose exact result ends in 5 at the first dropped digit |
| Truncation without ROUNDED | A COMPUTE into a shorter PIC | Results with dropped digits of 1 to 9 |
| High-order truncation | A target PIC smaller than the result, with no `ON SIZE ERROR` | Results that overflow the PIC by one digit |
| SIZE ERROR | `ON SIZE ERROR` clause | Results at and past the limit |
| EBCDIC collation | SORT, KSDS keys, alphanumeric comparisons | Keys that mix digits, upper case, lower case, and spaces |
| REDEFINES | Overlapping views | Writes through one view and reads through the other |
| Packed data in CHAR | A COMP-3 value in an alphanumeric field | Invalid nibbles and signs |
| Month-length logic | Date arithmetic, `FUNCTION INTEGER-OF-DATE` | Days 28 to 31, 29 Feb, quarter and year ends |

When the graph finds a hazard trigger in a unit, the gate requires that hazard's generator to have run on that unit. A unit with a `ROUNDED` COMPUTE cannot pass without tie inputs. That closes finding 4, where 10,000 random inputs produced no ties.

Each surprise logged in the Field Guide (§5.4) that recurs becomes a new row in this catalog. That turns lessons into generators, not prose.

---

## 5. Change plane

### 5.1 Work unit contract

```yaml
id: WU-T-0142
type: translate
source_scope: [legacy/cbl/CBACT04C.cbl, legacy/cpy/CVACT01Y.cpy]
target_scope: [modernized/accounts/src/main/java/.../interest/**]   # the write allowlist, enforced
observables: [INTCALC/ACCTFILE.accrued_interest, INTCALC.return_code]
inputs:
  graph_slice: ckg://component/CBACT04C?depth=2
  rules: [BR-ACCT-017, BR-ACCT-018]
  guides: [packs/bridge/cobol-java/PORTING.md, field-guide/index.md]
  decisions: [ADR-004, ADR-009]
oracle:
  dev: oracles/sets/INTCALC-dev@sha256:91c4…        # visible to the worker
  sealed: oracles/sets/INTCALC-sealed@sha256:e02a…  # judge only. The worker sees the hash and nothing else.
  fresh: [hazard:rounded_ties, hazard:size_error, rule:BR-ACCT-017/negations, random:5000]
budget: {tokens: 2.5M, wallclock: 45m, attempts: 3}
gate_unit: job:INTJOB                                # the gate runs at the job level, see §6.4
```

### 5.2 Unit loop

```
queued → context_build → deterministic recipes → implement → self-check (build, dev oracle)
       → review A (diff only, hunts bugs)
       → review B (spec and outputs only)
       → review C (transcript, hunts cheating)
       → fix → judge → merged | provisional | retry | escalate
```

Deterministic tools run first: OpenRewrite for Java, Rector for PHP, structuring rewriters for COBOL. The agent handles what those tools leave. Reviewers see different inputs and run on different models, because decorrelated reviewers catch different bugs.

### 5.3 The judge contract

The interrogation showed the v0.1 judge leaking held-out cases through its feedback. The v0.2 judge follows four rules.

1. **The judge returns counts only.** For example, "sealed 41 of 44, fresh 4,988 of 5,000, generalisation PASS". It never returns inputs, expected outputs, or diffs.
2. **Diffs go to the dev set.** When a sealed case fails, the harness moves it into the dev set, shows it to the worker there, and replaces it with a new sealed case drawn from the same generator. A case the worker has seen is never used to grade again.
3. **The judge runs fresh inputs.** Each judge run draws new inputs from the unit's `fresh` generators, so memorising earlier cases cannot help.
4. **The judge checks generalisation.** A unit passes only when its pass rate on fresh inputs matches its pass rate on the dev set, within the declared bound, which defaults to 0. A lint flags lookup-shaped code: large literal tables keyed by input values, and functions with few branches but many literal returns. A flagged unit goes to review C.

Mutation score measures how strong the tests are. It is no longer treated as evidence that the code generalises. The interrogation showed a lookup table scoring 100% against honest code's 85.7%.

### 5.4 Planner tree and coordination

The planner tree is unchanged from v0.1:

- **Programme planner** (frontier model). Owns the programme graph and top-level ADRs.
- **Module planners** (frontier model). Each owns one bounded context. No two planners may own the same design question. A decision-owner index enforces this.
- **Workers** (cheaper models). Each implements one work unit.
- **Shared services.** A neutral merge agent, a megafile splitter, a doc reconciler, and a Field Guide curator.

The harness enforces these coordination rules:

1. Each unit runs in its own worktree. It may write only inside `target_scope`.
2. Agents may not run repo-wide VCS commands (`stash`, `reset --hard`, `checkout .`, `clean`). Commits go through the merge agent.
3. Legacy is read-only. Deny rules block writes, and V0 checks the legacy tree hash.
4. Full builds run once per batch. Units run targeted builds.
5. A file over N lines, or with more than K concurrent edits, blocks commits and spawns a split unit.
6. An out-of-scope change is allowed only as a separate `BREAK-*` unit with a stated reason.
7. The Field Guide (`field-guide/index.md`, at most 300 lines) goes to every agent. Recurring entries move into the Pack porting guide or the hazard catalog.
8. The anti-stub lint rejects new `TODO` and `FIXME` markers, `unimplemented!`, empty or log-only catch blocks, skipped or `assumeTrue(false)` tests, weakened assertions, and justification comments over three lines.

Spiral monitors pause work automatically when any of these signals crosses its threshold: commit rate, merge-conflict rate, conflicts on the hottest file, unplanned modules, retries on one unit, or cost burn against plan.

---

## 6. Proof plane

The proof plane runs in fresh sessions and recomputes its verdicts from evidence on disk. A script computes every verdict. Oracles, comparators, and normalizers are written by oracle-side agents. The agent that implements a unit never writes the oracles, comparators, or normalizers that judge it.

### 6.1 Oracles

An oracle case is content-addressed. Its ID is the hash of its canonicalised input. Two cases with the same input are the same case, so the same input cannot appear in both the dev and sealed sets (finding 2).

```python
class Case(TypedDict):
    id: str                     # sha256 of the canonical input
    input: CanonicalInput
    expected: Observations      # legacy observations, keyed by Observable.id
    origin: Literal["recorded", "characterization", "hazard", "rule_negation", "random", "symbolic"]
    seen_by_worker: bool        # once true, the case may never grade again
```

A unit has three kinds of oracle:

- **Dev.** Visible to the worker.
- **Sealed.** The harness splits it from the same pool by input hash. It must hold at least 20 cases, or 25% of the pool, whichever is larger. A pool too small for that minimum gets topped up from the generators before the unit starts. Under v0.1, 38 of 300 small units had an empty held-out set.
- **Fresh.** Drawn at judge time from the generators that the unit's hazard triggers and rule cards require (§4.3).

Rule cards generate cases mechanically. For each condition in `given`, the harness generates a case where that condition is false and the others hold. For BR-ACCT-017, that yields a CLOSED account with a positive balance, which is the exact case the dropped-condition port got wrong (finding 4).

### 6.2 Normalizers

A normalizer declares, in a typed record, what it erases, why, and on which observable:

```yaml
id: NORM-012
observable: INTJOB/STEP1/SORTOUT.record_order
erases: order
justification: "No consumer. Downstream reader REPT01 sorts on read."
consumers_checked: [REPT01]          # must equal the observable's consumers in the graph
approved_by: <human>
```

The harness enforces three rules:

- A normalizer that erases order or content is legal only when its observable has no consumer that depends on what it erases. The harness checks `consumers_checked` against the graph at every run.
- `decimal` observables accept no tolerance. Floating-point observables accept a tolerance only when the legacy type is floating point too.
- Encoding normalizers (EBCDIC to UTF-8, COMP-3 to decimal) are lossless by construction. A round-trip test proves this.

Adding or changing a normalizer is a human gate, the same as a delta. Its hash is part of the evidence key (§6.5), so a new normalizer invalidates earlier verdicts instead of quietly reversing them.

### 6.3 Deltas and total comparators

A delta declares an intended change to the observation surface. Its comparator must be total. That means every legacy observable in scope maps to a modern observable, or appears in the delta's `removed` list. Every modern observable maps back, or appears in `added`.

```yaml
id: DELTA-007
scope: module:statements
kind: interface
legacy: STMTFILE (133-column print file)
modern: GET /accounts/{id}/statements (JSON)
map:
  STMTFILE.account_no:        $.account
  STMTFILE.line[*].amount:    $.lines[*].amount
  STMTFILE.total_due:         $.totals.due
  STMTFILE.min_payment_due:   $.totals.minimumPaymentDue
  STMTFILE.payment_due_date:  $.totals.paymentDueDate
  STMTFILE.credit_marker:     $.totals.isCredit
removed: [STMTFILE.page_header, STMTFILE.carriage_control]
added: [$.links.self]
comparator: packs/comparators/print133_to_json.py
approved_by: <human>
```

Before the harness trusts a comparator, it runs a **canary sweep**. For each mapped observable, the sweep changes one value in the modern output and checks that the comparator fails. A comparator that misses any canary is rejected. In finding 1, the v0.1 comparator missed 15 of 15 changes to minimum payment and due date. The sweep catches that before the comparator is ever used.

### 6.4 Gates per step type

Gates now run at the **gate unit**, which is the smallest unit whose observation surface has only external consumers. Usually this is a job, a CICS transaction, or an API endpoint. A program that feeds another program has internal consumers, so its gate runs at the job level. Program-level tests still run during development, but they do not decide merge.

| Rung | Checks | U | T | R | X | E | I |
|---|---|---|---|---|---|---|---|
| V0 Integrity | Legacy tree hash, clean build, zero tests fails | ● | ● | ● | ● | ● | ● |
| V1 Static | Compile, lint, anti-stub, lookup-shape lint, architecture tests | ● | ● | ● | ● | ● | ● |
| V2 Characterization | Golden masters from legacy, at the gate unit | ● | ● | ● | ● | | |
| V3 Differential | Surface-level comparison at the gate unit, through approved normalizers and deltas | ● | ● | ● | ● | | |
| V4 Fresh inputs | Hazard, rule-negation, random, and symbolic generators, plus the generalisation check | ● | ● | ● | ● | | |
| V5 Test strength | Mutation score, canaries, comparator canary sweep | ● | ● | ● | ● | ● | ● |
| V6 Rule coverage | Each P0 rule has passing tests for every negated condition | | ● | ● | | | ● |
| V7 Data reconciliation | Counts, aggregates, record hashes, and store-semantics probes (collation, range reads) | | | | ● | | |
| V8 End-state | Run a full business day of batch and online work, then compare the final data state | | ● | ● | ● | ● | |
| V9 Non-functional | Batch window, latency, locking semantics, security scans | ● | ● | ● | ● | ● | ● |
| V10 Production | Shadow traffic, parallel run with business reconciliation, canary, rollback | | | | | ● | |

Changes from v0.1, by rung:

- **V2, V3, and V4 now apply to X steps.** Each program that reads a migrated store is rerun against that store, which catches collation and browse-order changes.
- **V8 now applies to T steps.** A translated job must produce the same end state as the legacy job.
- **V5 now includes the comparator canary sweep.**
- **V7 adds store-semantics probes.** Range reads at collation boundaries, uniqueness, and null handling.

### 6.5 Evidence and verdicts

**Evidence key.** Every evidence record is keyed by a hash of every input to the proof:

```python
class EvidenceKey(TypedDict):
    module: str
    rung: str
    dependency_closure: str     # hash of every source file in the module's build closure, from the Build capability
    legacy_tree: str            # hash of the legacy files in source_scope
    oracle_set: str             # hash of the dev and sealed sets, and generator versions and seeds
    comparators: str            # hash of the normalizer, delta, and comparator files in scope
    packs: str                  # Pack versions
    environment: str            # runtime fingerprint: JDK, GnuCOBOL version, collation settings
```

A change to a shared `common/` file changes `dependency_closure`, so earlier evidence goes stale. A doc edit outside the closure changes nothing, so earlier evidence stays valid. Adding a tolerance normalizer changes `comparators`, so a rerun cannot flip FAIL to PROVEN under the old key (finding 9).

**Verdicts.**

```python
class Verdict(TypedDict):
    state: Literal["PROVEN", "PROVISIONAL", "NOT_PROVEN", "FLAKY", "NOT_APPLICABLE"]
    key: EvidenceKey
    obligations: list[Obligation]   # non-empty only when state is PROVISIONAL
    reasons: list[str]

class Obligation(TypedDict):
    id: str                     # "OBL-INTCALC-V10"
    requires: str               # "V10 PROVEN on job:INTJOB"
    reason: str                 # "legacy cannot execute; rungs V2-V6 used recorded production I/O only"
    blocks: Literal["cutover"]
    accepted_by: str            # the human who accepted the provisional merge
```

The verdict engine follows these rules:

- **Verdicts are a pure function of current evidence.** The engine recomputes each verdict from the evidence whose key matches the current tree. Evidence under any other key is stale and ignored.
- **A flake is a separate state.** When runs under the same key disagree, the verdict is `FLAKY`. A FLAKY verdict blocks merge until a human quarantines the flaky test with a reason, or until 5 consecutive reruns pass. Under v0.1, one infrastructure flake could make a correct unit permanently NOT_PROVEN.
- **PROVISIONAL is a real path to cutover.** When legacy cannot execute, rungs V2 to V6 can run only on recorded I/O. Then the unit can reach `PROVISIONAL`, not `PROVEN`. A human accepts the merge, and the harness records an obligation that travels with the module. Cutover is blocked until V10 discharges every obligation. This removes the v0.1 deadlock, where the T gate needed PROVEN but only V10 could grant it (finding 7).

**Reference fidelity.** Every execution environment declares how it differs from production. For example, GnuCOBOL defaults to ASCII collation and handles `TRUNC`, `NUMPROC`, and invalid packed data differently from z/OS. When the Pack cannot configure the reference to match production on a declared difference, evidence from that environment caps the affected observables at PROVISIONAL, with an obligation to verify them on a mainframe test LPAR or in V10.

| Environment | Strongest verdict |
|---|---|
| GnuCOBOL, configured to match production on every declared difference | PROVEN |
| GnuCOBOL with declared differences that remain | PROVISIONAL for the affected observables |
| Mainframe test LPAR | PROVEN |
| Recorded production I/O only | PROVISIONAL, discharged by V10 |
| Nothing recorded | PROVISIONAL, from rule-card tests only, discharged by V10 |

### 6.6 Cutover windows

v0.1 accepted "10 consecutive business days" of parallel run. That passed mid-month, before a month-end bug could show (finding 8).

v0.2 derives the required calendar events from the code. The hazard catalog's month-length row finds date logic in the graph. The window then requires each event that the logic branches on: each month length it distinguishes, quarter end, year end, leap day, and any business calendar the code reads, such as holiday tables. A gate unit passes V10 only after every required event has occurred in the parallel run with zero unexplained mismatches.

Waiting for some events in production can be impractical. Year end, for example, may be eleven months away. Then the harness replays those events in a shadow environment with a clock override. The verdict stays PROVISIONAL until either the replay or the real event has passed.

---

## 7. The transform path

### Phase A · Understand

- Build the graph, the CRUD matrix, and the observation surfaces.
- Collect runtime traces of business scenarios.
- Extract rule cards. A second agent verifies each one, then a human reviews it.
- Start harvesting oracles here, while legacy is still the reference. Capture input decks, file snapshots, transaction recordings, and report outputs.
- Configure the reference environment and declare its differences from production (§6.5).

### Phase B · Design the target shape

- **Candidate boundaries.** Derive bounded contexts from three weighted signals: data affinity (writes count most), runtime co-occurrence, and the domain terms on rule cards.
- **Two options.** Present a partition along business seams and one along data seams.
- **Critique.** An architecture critic scores each option. A human signs the ADRs.
- **Default to a modular monolith.** A module becomes a microservice only with a named reason recorded in its ADR: independent scaling, release cadence, team ownership, or regulatory isolation.

**Gate:** a human approves the ADRs.

### Phase C · Translate into the target shape

- Translate program by program into packages laid out by module. Code inside each package stays close to the legacy structure.
- Put file I/O behind repository interfaces with an adapter for the legacy format. The differential then compares the same files.
- The Bridge Pack porting guide and hazard catalog drive the mapping. For example, `PIC S9(7)V99 COMP-3` maps to `BigDecimal` with scale 2. Each COMPUTE gets a `RoundingMode` taken from its ROUNDED clause: `HALF_UP` for `ROUNDED`, and `DOWN` for no ROUNDED.

**Gate:** V0 to V6 and V8 at the job level, each PROVEN or PROVISIONAL with obligations.

### Phase D · Restructure inside the target

- Enforce module boundaries with architecture tests.
- Move cross-module data access behind module APIs. Give each table one owning module.
- Each intentional change goes through a delta with a total comparator.

**Gate:** V0 to V6 and V8, at each gate unit.

### Phase E · Re-platform data

- Design schemas by module ownership.
- Declare store semantics on the target. For key ordering, use a collation that matches EBCDIC, or declare a delta. Do not leave ordering to the database default.
- Rerun every reading program against the migrated store.

**Gate:** V2 to V4, V7 with store-semantics probes, and V8.

### Phase F · Extract and cut over

- Put a routing facade in front of each legacy entry point.
- Per entry point, move through shadow (legacy authoritative), then canary, then primary, then legacy decommission.
- Write consumer contracts from the in-process module API before extraction.
- Before cutover, discharge every obligation and cover every required calendar event.

**Gate:** V7 to V10, plus a human go/no-go per entry point.

---

## 8. Packs as capabilities

v0.1 tied abilities to Pack roles, so `TargetPack` could not run code and a Java-to-Java uplift had no runner on either side. v0.2 defines capabilities. Any Pack implements the ones it can. A Java 21 Pack that implements `Execute` serves as the legacy side of an R step and as the modern side of a T step.

```python
class Parse(Protocol):
    def parse(self, root: Path) -> GraphFragment: ...                 # nodes, edges, observables
    def observables(self, unit: UnitRef, g: Graph) -> list[Observable]: ...

class Build(Protocol):
    def build(self, ws: Workspace) -> BuildResult: ...                # may report "unbuildable"
    def dependency_closure(self, ws: Workspace, module: str) -> list[Path]: ...

class Execute(Protocol):
    def open_session(self, unit: UnitRef, env: EnvSpec) -> Session: ...   # Session holds pseudo-conversational CICS state
    def run(self, s: Session, inputs: CanonicalInput) -> Observations: ...
    def environment(self) -> EnvFingerprint: ...                       # includes declared differences from production

class Record(Protocol):
    def recorder(self, entry: EntryPoint) -> Recorder: ...            # capture production or test I/O

class Generate(Protocol):
    def hazards(self, unit: UnitRef, g: Graph) -> list[HazardTrigger]: ...
    def generator(self, trigger: HazardTrigger) -> Generator: ...

class Test(Protocol):
    def test(self, ws: Workspace, selector: str) -> TestResults: ...  # parses runner result files
    def mutation(self, ws: Workspace, scope: str) -> MutationReport: ...
    def arch_rules(self, adrs: list[ADR]) -> ArchTestSuite: ...

class Transform(Protocol):
    def recipes(self) -> list[Recipe]: ...
    def antistub_patterns(self) -> list[Pattern]: ...

class Store(Protocol):
    def extract(self, ref: DataStoreRef) -> Iterable[RawRecord]: ...
    def load(self, ref: DataStoreRef, rows: Iterable[TypedRecord]) -> LoadReport: ...
    def canonicalize(self, records: Iterable[RawRecord], layout: Layout) -> Iterable[TypedRecord]: ...  # a stream, so a header can set the REDEFINES view of later records
    def semantics(self, ref: DataStoreRef) -> StoreSemantics: ...    # collation, range-read order, uniqueness, nulls
```

**Capability check at preflight.** Each rung needs certain capabilities on each side of each step. V3 for a T step needs `Execute` on both the legacy and modern Packs. V7 needs `Store` on both. At preflight, the harness checks every step in the programme against the capabilities its Packs declare, and reports each gap before any build starts. A missing capability then fails in preflight, not halfway through translation. It also lowers the strongest reachable verdict for that step, which preflight shows up front.

**Pack backlog.**

| Pack | Capabilities | Tools |
|---|---|---|
| `cobol-zos` | Parse, Build, Execute (GnuCOBOL, plus a remote LPAR runner), Record, Generate, Store (VSAM, sequential) | ProLeap or tree-sitter-cobol, GnuCOBOL |
| `java` (8 to 21) | Parse, Build, Execute, Record, Test, Transform | JavaParser, Maven or Gradle, JUnit, PIT, ArchUnit, OpenRewrite |
| `cobol-to-java` bridge | Porting guide, type map, hazard catalog, encoding normalizers | Authored and adversarially reviewed |
| `db2`, `postgres` | Store | JDBC or psycopg, collation probes |
| Later | PHP, .NET, PL/I, RPG, Perl, Python | Rector, .NET Upgrade Assistant, pyupgrade |

A Pack is certified when it passes a reference pilot and survives an interrogation round like the one that shaped v0.2.

---

## 9. Agent roles

| Role | Model tier | Writes | Notes |
|---|---|---|---|
| intake | frontier | `INTENT.md`, `PREFLIGHT.md` | Includes the capability check |
| graph-builder | none | Graph, observation surfaces | Deterministic, from Packs only |
| legacy-analyst | mid | Node summaries | Bottom-up |
| rule-extractor | mid, fan-out | Rule cards | Conditions as lists, rounding cited from code |
| rule-verifier | frontier, a different model | Verdict per card | Adversarial |
| oracle-engineer | frontier | Oracle sets, generators, normalizers, comparators | Never implements the units it judges |
| architecture-critic | frontier | Options, scores, draft ADRs | A human signs |
| programme planner, module planner | frontier | Work units, design decisions | Owns its decisions exclusively |
| worker | mid or cheap | Its `target_scope` only | Runs recipes first |
| reviewers A, B, C | mixed vendors | Findings | Hunt bugs only |
| fixer | mid | Its `target_scope` | |
| judge | frontier, plus scripts | Counts and a verdict | No code. No inputs or diffs in its output. |
| merge agent | mid | Merge commits | Neutral |
| verifier | script, plus frontier for the narrative | `VERIFICATION.md` | Runs in a fresh session |
| security-auditor | frontier | Findings and a patch | A human applies the patch |

---

## 10. Workspace layout

```
<programme>/
├── INTENT.md · PREFLIGHT.md · PROGRAMME.yaml
├── legacy/<system>/                 symlink, read-only
├── analysis/
│   ├── ckg.sqlite · ckg.json
│   ├── surfaces/<unit>.json          observation surfaces, legacy and modern
│   ├── crud-matrix.csv · traces/
│   ├── rules/BR-*.yaml
│   └── decomposition/ · ADR-*.md
├── oracles/
│   ├── cases/<sha256>.json           content-addressed cases
│   ├── sets/<name>@<sha256>.json     dev and sealed sets, as lists of case IDs
│   ├── sealed/                       judge-only permissions
│   ├── generators/ · normalizers/NORM-*.yaml · deltas/DELTA-*.yaml · comparators/
├── obligations/OBL-*.yaml
├── work/WU-*.yaml
├── field-guide/index.md
├── modernized/<target>/
├── evidence/<evidence-key-hash>/      raw runner output, immutable
├── VERIFICATION.md · CUTOVER.md
└── .rig/  costs.jsonl · events.jsonl
```

---

## 11. Human gates

1. Intent, preflight, and the capability report.
2. Confirmation of P0 and P1 rule cards.
3. Target architecture ADRs.
4. Each delta, together with its comparator's canary sweep result.
5. Each normalizer.
6. Each provisional merge, which accepts the obligations it creates.
7. Each flaky-test quarantine.
8. The porting guide and hazard catalog, per language pair.
9. Signing verification per module, and go/no-go per entry point.
10. Applying the security patch.

The review UI shows each gate with its evidence attached. Policy can approve low-risk units automatically when every rung is PROVEN and no gate above applies. Google's migration papers found review to be the bottleneck, so this matters for throughput.

---

## 12. Cost, observability, and safety

These are unchanged from v0.1:

- **Model tiers per role.** Track cost per work unit, per thousand lines, and per rule proven, split by role.
- **Budgets.** Set per unit, module, and programme. Exceeding a budget escalates. The harness does not keep spending.
- **Prompt caching.** Stable prompt prefixes (Pack guide, Field Guide, ADRs) keep caching effective.
- **Legacy content is untrusted data.** Instructions inside code and docs are listed, never followed.
- **Sandboxed execution.** Production systems and real data are off-limits unless the approved plan names them. Recordings are masked before they enter `oracles/`.
- **Resource quotas.** Heavy tests run with disk and IOPS quotas.

The dashboard adds two views:

- Open obligations per module, with the event or rung that will discharge each one.
- Calendar-event coverage for each gate unit in parallel run.

---

## 13. Roadmap

The proof core now comes before the change plane, and each milestone ends with a check you can rerun.

| Milestone | Scope | Exit check |
|---|---|---|
| M0 · Skeleton (2 weeks) | CLI, workspace layout, work-unit state machine, agent adapter, budgets, event log | A no-op programme runs end to end and resumes after a kill |
| M1 · Understand (3 weeks) | `cobol-zos` Parse, graph, CRUD matrix, observation surfaces, rule cards, hazard detection | CardDemo fully graphed. Every SORT, KSDS, and ROUNDED site appears as a surface entry or hazard trigger. |
| M2 · Proof core (4 weeks) | Content-addressed oracles, sealed and fresh sets, judge contract, normalizer rules, total comparators with canary sweep, evidence key, verdict engine with PROVISIONAL and FLAKY | **All 21 v0.1 repro scripts, ported to the M2 code, must now fail to fool the harness.** One hand-ported CardDemo job PROVEN. |
| M3 · Translate (4 weeks) | Unit loop, reviewers, merge agent, Field Guide, anti-stub and lookup-shape lints, spiral monitors, `cobol-to-java` bridge | CardDemo batch jobs PROVEN or PROVISIONAL at the job level |
| M4 · Uplift (2 weeks) | `java` Pack with `Execute` and OpenRewrite | Spring PetClinic 2.x to 3.x PROVEN, using the same Pack on both sides |
| M5 · Restructure (4 weeks) | Decomposition, ADR flow, architecture tests, delta workflow | CardDemo as a modular monolith, with every delta's comparator passing its canary sweep |
| M6 · Data and cutover (4 weeks) | `Store` for VSAM and Postgres, store-semantics probes, V8, V9, V10 shadow facade, calendar coverage | One CardDemo entry point in shadow mode, with obligations and calendar coverage visible |
| M7 · Hardening | Portfolio assessment, more Packs, a second interrogation round | A second technology pair certified with no core changes |

The M2 exit check reuses the interrogation as a regression suite. The 21 scripts that broke v0.1 become tests that v0.2 must pass.

---

## 14. Open risks

The interrogation raised these without proving them. v0.2 does not yet address them, and each one deserves a probe before the milestone it affects.

| Risk | Affects | Planned probe |
|---|---|---|
| CICS SYNCPOINT scope split across two services loses atomicity, and shadow runs never exercise partial failure | M6, E steps | Fault injection in the shadow facade between the two services |
| Module-boundary comparison after R steps has no shared interface to compare once module APIs change | M5 | Prototype a surface diff across one extracted API |
| REDEFINES mapped to a sealed type cannot express writing through one view and reading through the other | M3 | The hazard generator for REDEFINES, run against the porting guide's mapping |
| Phase C lays code out by module, and that may already change architecture when shared WORKING-STORAGE is split | M3 | Compare surfaces before and after the layout move, on a program with shared state |
| The anti-stub lint misses patterns the interrogation listed but did not run | M3 | Seed known bypasses and require the lint to catch each one |

---

## 15. Decisions needed

1. **First technology pair.** Recommended: COBOL to Java first, against CardDemo, because it exercises the hardest proofs (collation, rounding, unrunnable legacy). Java 8 to 21 follows in M4.
2. **Delivery shape.** Recommended: a standalone `rig` CLI with a Claude Code plugin front end.
3. **Relationship to the Anthropic plugin.** Recommended: read and write its artifact formats, but keep an independent core, because its commands are specific to Claude Code.
4. **Execution environments.** GnuCOBOL only, a mainframe test LPAR, or recorded production data. This choice now decides how many obligations a COBOL programme carries into cutover.

---

## Sources

The sources from v0.1 still apply. See [v0.1, Sources](PROPOSAL-v0.1.md#sources). The repro scripts behind §0 are listed in [INTERROGATION.md](INTERROGATION.md).
