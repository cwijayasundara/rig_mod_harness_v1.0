# RIG, a technology-agnostic modernization harness

**Proposal v0.3 · 2026-11-05**

This version supersedes [v0.2](PROPOSAL-v0.2.md) and [v0.1](PROPOSAL-v0.1.md). It was revised after two adversarial rounds: [the interrogation of v0.1](INTERROGATION.md) and [the interrogation of v0.2](INTERROGATION-2.md).

RIG modernizes a legacy system of any technology and proves, at every step, that the new system behaves like the old one. It covers like-for-like ports, such as COBOL to Java or Java 8 to 21. It also covers restructuring, such as COBOL into a modular monolith and then selected services.

The design keeps three concerns apart:

- **Understanding.** A code knowledge graph, business-rule cards, and an observation surface for every unit.
- **Change.** Small, owned work units, run by a tree of planner, worker, and reviewer agents.
- **Proof.** A verification ladder whose verdict a script computes from evidence that records what it exercised.

---

## 0. What v0.3 changes

The second interrogation confirmed 27 findings against v0.2, which reduce to 11 root causes. Most of them come from two habits in the v0.2 design. v0.3 replaces both habits with rules that every mechanism follows.

> **Rule A. Unknown fails closed.** Anything the harness derives from analysis has three states: known present, known absent, and unknown. Known absent needs positive evidence, such as a resolved call graph or a human attestation. Every mechanism treats unknown as the worst case. An unknown consumer depends on everything. An unknown calendar gets the minimum window. An unproven capability is missing.

> **Rule B. Evidence records what it exercised.** Every run writes a coverage record. The record lists the observables it compared, the input classes it drew from, the hazards it hit, and the calendar events it spanned. Gates and obligations are coverage requirements. A run that did not reach the risk does not count, whatever the rung is called.

| # | v0.2 root cause (see INTERROGATION-2.md) | v0.3 change | Rule | Section |
|---|---|---|---|---|
| 1 | An empty consumer list counted as external, so erasing normalizers became legal | Consumers have a completeness flag. An incomplete list forbids erasure. External consumers are explicit, attested nodes. | A | §3, §6.2 |
| 2 | The gate-unit rule pulled most of the system into one unit | Persistent stores are gate boundaries. A gate unit is one job or one transaction. Consumer relationships still cross the boundary for normalizer checks. | | §6.4 |
| 3 | Single-value canaries missed structural and representation bugs | The canary set adds structural and representation classes. Cardinality is an observable kind. | | §6.3 |
| 4 | Per-run seeds in the key hid failures, and 5 passes cleared real bugs | Seeds leave the key. Every run stays on record. Reruns never clear a failure. | B | §6.5 |
| 5 | The evidence key missed job wiring and legacy JCL | The key covers the gate unit's runtime closure | | §6.5 |
| 6 | With legacy unable to run, the oracle had no supply | Recorded mode is a defined mode. Its waivers become named obligations. | A, B | §6.1, §6.7 |
| 7 | Revealed sealed cases were patched, and the sealed set drained | Sealed cases never move. The worker gets per-class counts and class descriptions. | | §5.3 |
| 8 | Obligations cleared without exercising their risk, or got lost | Obligations name observables and hazards, and only matching coverage discharges them. Deltas must map them. Every entry point gets a cutover step. | B | §6.7 |
| 9 | Calendar derivation missed scheduler-driven and weekday logic | A fixed minimum window applies to every gate unit. Derivation reads scheduler definitions and JCL parameters too. | A | §6.6 |
| 10 | Preflight trusted capability declarations that cannot run | Capabilities are declared per construct and proven by a smoke run | A | §8 |
| 11 | The generalisation check rejected honest code and added nothing | Deleted | | §5.3 |

Some v0.2 mechanisms are gone in v0.3, and the design is smaller for it:

- **The generalisation check.** It changed no verdict that the fresh-input rung would not already give.
- **The "5 consecutive passes" rule.** Reruns never clear a failure now.
- **Moving sealed cases into the dev set.** Sealed cases stay sealed.

---

## 1. Background

Three systems shaped this design. [The v0.1 proposal](PROPOSAL-v0.1.md) covers them and the vendor landscape in detail.

- **Anthropic `code-modernization` plugin.** Its lifecycle is staged and file-based, from assessment through rule extraction, build, and verification. It writes rules as Given/When/Then cards with `file:line` citations. A fresh-session verifier computes each verdict by script. RIG keeps all of this. The plugin's gap is restructuring. Its `reimagine` command goes from a spec to new services with no proof of equivalence across the change.
- **Bun, Zig to Rust.** The port covered 535k lines in 11 days for about $165k. A test suite written in TypeScript, independent of the implementation language, was the oracle. Each task ran an implementer, then two adversarial reviewers who saw only the diff, then a fixer. The architecture stayed fixed during the port.
- **Cursor, agent swarm economics.** Frontier planners with cheap workers cost $1,339, against $10,565 for one model in both roles. Grading used a test suite the agents never saw. Shared design docs, a neutral merge agent, and churn signals kept the swarm from spiralling.

Vendors converge on the same sequence: assess, extract rules, generate, test. They are weakest at proving equivalence across an architecture change and at staying technology-neutral.

The two interrogation rounds taught a third lesson. A proof mechanism is only as strong as the analysis that feeds it. Rules A and B exist because analysis has gaps.

---

## 2. Step types

A programme is a graph of typed steps for each module.

| Step | Example | Contract |
|---|---|---|
| U · Uplift | Java 8 to 21, Spring Boot 2 to 3 | The observation surface is preserved exactly |
| T · Translate | COBOL to Java, Perl to Python | The surface is preserved exactly, through lossless encoding normalizers only |
| R · Restructure | Spaghetti code to modules | The surface is preserved, except for declared deltas |
| X · Data | VSAM to Postgres | Data and store semantics are preserved, except for declared deltas |
| E · Cutover | Route an entry point to the modern system | The surface is preserved under production traffic |
| I · Reimagine | New UX, new capabilities | A new spec, traced to confirmed rules |

**Every entry point ends with an E step.** That includes entry points served by modules that stay in the monolith. In v0.2, a module kept in the monolith never got an E step, so its obligations could never be discharged. In v0.3, E means "route this entry point to the modern system". The destination can be a service or the monolith.

```
COBOL ─T─► Java modular monolith ─R─► bounded modules ─X─► Postgres ─E─► 3 services and 1 monolith module, each entry point cut over
```

**Rule 1.** A work unit changes one axis. Each change it makes to the observation surface must match a declared delta. The gate finds those changes by comparing surfaces, not by trusting the worker's description.

---

## 3. The observation surface

The observation surface of a unit is the typed list of everything the unit does that a consumer can observe. The `graph-builder` derives it from the knowledge graph, and Packs extend it.

```python
class Observable(TypedDict):
    id: str                       # "INTJOB/STEP1/SORTOUT.record_order"
    kind: Literal["field", "record_order", "cardinality", "store_write", "store_semantics",
                  "return_code", "abend", "message", "screen", "timing"]
    type: str                     # "decimal(9,2)", "string[cp037]", "zoned(11)", "date"
    representation: str | None    # padding, scale, sign convention, when the bytes matter
    consumers: Consumers
    source: str

class Consumers(TypedDict):
    internal: list[str]           # graph nodes that read this observable
    external: list[ExternalConsumer]
    complete: bool                # False unless every access path is resolved and attested

class ExternalConsumer(TypedDict):
    name: str                     # "GL bureau", "ACH bank file"
    depends_on: list[str]         # e.g. ["record_order", "field:*"]. Empty is not allowed.
    attested_by: str              # a human, or an interface contract file
```

### Consumers fail closed (Rule A)

`complete` starts as `False`. The graph-builder sets it to `True` only when three conditions hold:

1. Every program that can read the dataset is resolved. A dynamic `CALL` whose target is not resolved anywhere in the module keeps the list incomplete.
2. The dataset is not transmitted, exported, or catalogued for any job outside the graph. The graph-builder checks JCL `DISP`, `SYSOUT`, and FTP or Connect:Direct steps.
3. A human attests that the external list is complete.

While `complete` is `False`, every mechanism assumes an unknown consumer that depends on everything about the observable. v0.2 read an empty list as "no consumers". That allowed an order normalizer on files read by a bank, a GL bureau, a print vendor, and a program reached through `CALL WS-NEXT-PGM`.

### Kinds added in v0.3

- **`cardinality`.** The number of records or array elements in an output. A comparator must map it, so a dropped or duplicated statement line cannot pass silently.
- **`abend`.** An abnormal end and its code, such as S0C7. A port that returns 0 where legacy abends has changed the surface.
- **`representation`.** Byte-level form, such as zero padding on an account number or the scale of a decimal. A consumer that reads a field as text depends on it.

---

## 4. Understanding plane

### 4.1 Code knowledge graph

Pack parsers build the graph deterministically, without an LLM. Its node types are technology-neutral, and edges include `calls`, `reads`, `writes`, `consumes`, `implements_rule`, and `owned_by_module`.

In v0.3 the graph also ingests **scheduler definitions** (Control-M, CA-7, or TWS exports), **JCL PROCs**, **control cards**, and **run-mode parameters** such as `PARM='ME'`. These decide when code runs and in which mode, so the graph needs them to derive calendar events (§6.6).

The graph records **unresolved edges** explicitly. Each dynamic `CALL`, dynamic SQL statement, and indirect file access becomes an `unresolved` node. Rule A treats it as reaching everything in its module until a human or a trace resolves it.

### 4.2 Business rule cards

```yaml
id: BR-ACCT-017
title: Interest accrues daily on active accounts with a positive balance
priority: P0
given:
  - account.status = ACTIVE       # domain from the 88-levels: ACTIVE, CLOSED, FROZEN, PENDING
  - account.balance > 0
when: nightly batch INTCALC runs
then: accrued_interest += round(balance * apr / 365, 2, mode=HALF_AWAY_FROM_ZERO)
rounding_source: CBACT04C.cbl:231 COMPUTE ... ROUNDED
citations: [legacy/cbl/CBACT04C.cbl:212-248, legacy/cpy/CVACT01Y.cpy:14]
observables: [INTCALC/ACCTFILE.accrued_interest]
status: confirmed
```

The harness negates each condition with every value in its domain, not with one falsifying value. For `status = ACTIVE`, it generates cases for CLOSED, FROZEN, and PENDING, plus a status outside the 88-level domain.

### 4.3 Hazard catalog

Each Bridge Pack ships a hazard catalog. Each entry lists a construct whose semantics differ between the source and target languages, the code pattern that triggers it, and a generator that produces inputs for it. These rows are new in v0.3:

| Hazard | Trigger | Generator |
|---|---|---|
| ROUNDED in any arithmetic verb | `ROUNDED` on COMPUTE, ADD, SUBTRACT, MULTIPLY, or DIVIDE | Exact results ending in 5 at the first dropped digit |
| Day of week | `ACCEPT ... FROM DAY-OF-WEEK`, day-name tables | Every weekday. COBOL numbers Monday as 1, Java `Calendar` numbers Sunday as 1. |
| Century window | `ACCEPT ... FROM DATE` (YYMMDD), two-digit years | Years on both sides of the window pivot |
| Run mode | A `PARM` or control-card field that selects a branch | Every value seen in recordings, plus every value the branch tests |
| Invalid packed data | COMP-3 fields read from input | Invalid nibbles and signs. z/OS abends with S0C7. A lenient decoder does not. |
| Group MOVE and FILLER | Group-level MOVE, FILLER in output records | Non-space FILLER bytes, and partial group overlap |

The v0.2 rows still apply: ROUNDED ties, truncation, high-order truncation, SIZE ERROR, EBCDIC collation, REDEFINES, packed data in CHAR fields, and month-length logic.

---

## 5. Change plane

### 5.1 Work unit contract

```yaml
id: WU-T-0142
type: translate
source_scope: [legacy/cbl/CBACT04C.cbl, legacy/cpy/CVACT01Y.cpy]
target_scope: [modernized/accounts/src/main/java/.../interest/**]
gate_unit: job:INTJOB                 # one job. Its persistent stores are the boundary (§6.4).
observables: [INTJOB/ACCTFILE.store_write, INTJOB/ACCTFILE.store_semantics, INTJOB.return_code]
oracle:
  dev: oracles/sets/INTJOB-dev@sha256:91c4…
  sealed: oracles/sets/INTJOB-sealed@sha256:e02a…
  generators: [hazard:rounded, hazard:size_error, hazard:invalid_packed, rule:BR-ACCT-017/negations, random]
mode: executable                      # executable | recorded (§6.1)
budget: {tokens: 2.5M, wallclock: 45m, attempts: 3}
```

### 5.2 Unit loop

```
queued → context_build → deterministic recipes → implement → self-check (build, dev oracle)
       → review A (diff only) → review B (spec and outputs) → review C (transcript)
       → fix → judge → merged | provisional | retry | escalate
```

The harness runs deterministic tools first: OpenRewrite for Java, Rector for PHP, and structuring rewriters for COBOL. The agent handles what those tools leave. Reviewers see different inputs and run on different models.

### 5.3 The judge contract

1. **The judge returns counts per input class.** A class is a generator, a hazard, or a negated rule condition. The judge attaches the class description to each count, for example "`hazard:rounded`, ties at the first dropped digit: 37 of 40". It never returns an input, an expected output, or a diff.
2. **Sealed cases never move.** When a class fails, the harness generates new dev cases from that class and gives them to the worker. That requires an executable legacy. In recorded mode, the harness shows the worker only the class description. The failing sealed case stays sealed and keeps grading. v0.2 moved failing sealed cases into the dev set. A worker could then hard-code those inputs, and three attempts drained 58 of 60 recorded cases.
3. **Each judge run draws fresh inputs from every required class.** A failed class must reappear in the next run with new inputs. A patch for one input therefore cannot pass.
4. **Failing fresh inputs join the sealed set permanently.** A failure found once keeps grading every later attempt.

v0.3 deletes the generalisation check from v0.2. It rejected an honest port over one bad dev recording. It never changed a verdict when the dev set was green.

The lookup-shape lint stays, but only as advice. It sends units to review C and does not gate them, because honest `EVALUATE` tables look like lookups.

### 5.4 Planner tree and coordination

These are unchanged from v0.2. Frontier planners own design decisions, and no two planners own the same decision. Workers write only inside their `target_scope`, in their own worktree. A neutral merge agent makes every commit.

The harness enforces three further rules:

- Agents may not run repo-wide VCS commands.
- Megafiles are split before work continues.
- The Field Guide is capped at 300 lines.

The anti-stub lint and the spiral monitors apply as in v0.2.

---

## 6. Proof plane

### 6.1 Oracles and modes

A case is content-addressed. Its ID hashes the canonical input, and the canonical input includes every input to the unit: records, parameters, the clock, store snapshots, and session state. Two recordings that differ only in the date or in store state are therefore different cases.

```python
class Case(TypedDict):
    id: str
    input: CanonicalInput          # includes clock, parameters, store snapshot hash, session state
    expected: Observations | None  # None for generated inputs in recorded mode
    classes: list[str]             # the input classes this case belongs to
    origin: Literal["recorded", "characterization", "hazard", "rule_negation", "random", "symbolic", "fresh_failure"]
```

A unit runs in one of two modes.

**Executable mode.** Legacy runs in a reference environment, so every generated input gets an expected output. Dev and sealed sets come from the same pool, split by input hash. The sealed set holds at least 20 cases, or 25% of the pool, whichever is larger. Each judge run draws fresh inputs from every required class.

**Recorded mode.** Legacy cannot run, so only recorded inputs have expected outputs. The mode changes the rules in three ways:

- The sealed set is 25% of the recorded pool, with no minimum.
- The harness checks generated inputs only for properties that need no legacy output. These include crashes, invariant violations, and differences between the old modern build and the new one.
- For each required class that no recorded input covers, the harness creates an obligation (§6.7). The class name goes into the obligation.

Recorded mode reaches PROVISIONAL, never PROVEN. v0.2 promised PROVISIONAL for this case, but its rules made it unreachable.

### 6.2 Normalizers

```yaml
id: NORM-012
observable: INTJOB/STEP1/SORTOUT.record_order
erases: order
justification: "The only consumer, STEP2, sorts on read."
```

The harness enforces four rules:

1. An erasing normalizer is legal only when the observable's consumers are complete (§3). No internal consumer and no external consumer may depend on what the normalizer erases.
2. `decimal` observables take no tolerance. Floating-point observables take a tolerance only when the legacy type is floating point too.
3. Encoding normalizers must pass a round-trip test, which proves they are lossless.
4. A human approves each normalizer. Its hash is part of the evidence key, along with the hash of the observable's consumer list. A newly discovered consumer therefore invalidates the normalizer's earlier verdicts.

The sample NORM-012 now matches §3. In v0.2 it named a different consumer than the surface did, so it failed its own rule.

### 6.3 Deltas, total comparators, and canaries

A delta's comparator must be total. Every legacy observable in scope maps to a modern observable or appears in `removed`. Every modern observable maps back or appears in `added`. That includes the `record_order` and `cardinality` observables, which the v0.2 sample missed.

```yaml
id: DELTA-007
scope: module:statements
kind: interface
legacy: STMTFILE (133-column print file)
modern: GET /accounts/{id}/statements (JSON)
map:
  STMTFILE.account_no:          $.account                 # representation: zero-padded to 11
  STMTFILE.line.cardinality:    $.lines.length
  STMTFILE.line.record_order:   $.lines[*] order
  STMTFILE.line[*].date:        $.lines[*].date
  STMTFILE.line[*].amount:      $.lines[*].amount
  STMTFILE.total_due:           $.totals.due
  STMTFILE.min_payment_due:     $.totals.minimumPaymentDue
  STMTFILE.payment_due_date:    $.totals.paymentDueDate
  STMTFILE.credit_marker:       $.totals.isCredit
removed: [STMTFILE.page_header, STMTFILE.carriage_control]
added: [$.links.self]
comparator: packs/comparators/print133_to_json.py
```

Before the harness trusts a comparator, it runs the canary sweep. The sweep applies every canary class that fits each mapped observable's kind and type. The comparator must fail on every canary.

| Canary class | Applies to | Mutations |
|---|---|---|
| Value | fields | Change by the smallest unit, double, change to a boundary value |
| Representation | fields with a `representation` | Strip padding, change scale, flip sign convention |
| Sign and zero | numeric fields | Negate, set to zero, set to null |
| Structural | arrays, files, streams | Insert, delete, or duplicate a record. Reorder records. Swap a value between two records. Empty the collection. |
| Correlated | groups of fields that a rule links | Change one field and recompute the dependent total, so the output stays internally consistent but differs from legacy |

v0.2 changed one value at a time. Comparators that zipped arrays, compared columns, or parsed numbers passed that sweep. They still missed dropped lines, duplicated lines, swapped values, sign flips, and lost leading zeros.

### 6.4 Gate units and gates

A **gate unit** is one job or one CICS transaction. Its persistent stores form its boundary. Files that pass between steps of the same job stay inside it.

Two separate questions apply at the boundary:

- **What the gate compares.** The gate compares what the unit writes to each persistent store, and the store's semantics, at the store itself. It does not run the readers of that store. v0.2 included every reader of every store the unit wrote. That rule pulled 12 of 18 CardDemo entry points into the first work unit.
- **What consumers protect.** Readers in other jobs still appear in the observable's `consumers` list. They still forbid normalizers that erase what they depend on (§6.2). v0.2 had no way to separate these two questions, so treating stores as external would have brought back the sort-order bug.

A gate unit runs entirely on one side, legacy or modern. The harness seeds its input stores from a snapshot. No session mixes legacy and modern code.

| Rung | Checks | U | T | R | X | E | I |
|---|---|---|---|---|---|---|---|
| V0 Integrity | Legacy tree hash, clean build. A run with zero tests fails. | ● | ● | ● | ● | ● | ● |
| V1 Static | Compile, lint, anti-stub, architecture tests | ● | ● | ● | ● | ● | ● |
| V2 Characterization | Golden masters at the gate unit | ● | ● | ● | ● | | |
| V3 Differential | Surface comparison at the gate unit through approved normalizers and deltas | ● | ● | ● | ● | | |
| V4 Fresh inputs | Every required class, drawn fresh each judge run | ● | ● | ● | ● | | |
| V5 Test strength | Mutation score, canaries, the comparator canary sweep | ● | ● | ● | ● | ● | ● |
| V6 Rule coverage | Each P0 rule, with every condition negated over its full domain | | ● | ● | | | ● |
| V7 Data reconciliation | Counts, aggregates, record hashes, store-semantics probes | | | | ● | | |
| V8 End state | A full business day, then a comparison of final store state | | ● | ● | ● | ● | |
| V9 Non-functional | Batch window, latency, locking, security scans | ● | ● | ● | ● | ● | ● |
| V10 Production | Shadow, parallel run, canary, rollback | | | | | ● | |

Each rung passes on its coverage record (§6.5), not on the fact that it ran.

### 6.5 Evidence, coverage, and verdicts

**Evidence key.** Each rung keys its evidence on the inputs that can change its result, and on nothing else.

```python
class EvidenceKey(TypedDict):
    gate_unit: str
    rung: str
    runtime_closure: str      # every step of the gate unit, job wiring and configuration
                              # (application.yml, Flyway migrations, batch XML), legacy JCL,
                              # PROCs, control cards, and scheduler definitions
    oracle: str | None        # hash of the dev and sealed case IDs and the generator definitions,
                              # never per-run seeds. Only V2 to V4 and V6 use this field.
    comparators: str | None   # normalizers, deltas, comparators, and the consumer lists they rely on
    packs: str                # versions of the Pack components that this rung uses
    environment: str          # semantic settings only: collation, TRUNC, NUMPROC, JDK major version
```

Changes from v0.2:

- The key covers the **runtime closure** of the gate unit, not the module's build closure. An edit to another step's class, the batch XML, or the legacy JCL now makes evidence stale.
- **Per-run seeds are out of the key.** v0.2 put them in, so two runs that disagreed got different keys and the newest run won. A deterministic bug on 1 in 4,000 inputs reached PROVEN in 64% of simulated units.
- **Rungs use only the fields that affect them.** Changing the sealed set no longer makes V0, V1, V5, or V9 evidence stale.
- **The environment field holds only declared semantic settings.** A JDK patch release no longer invalidates every verdict.

**Runs and coverage.** Every run is appended under its key. Nothing overwrites or ages out a run. Each run writes a coverage record:

```python
class Coverage(TypedDict):
    observables: dict[str, int]     # observable ID: number of comparisons made
    classes: dict[str, int]         # input class: number of inputs drawn
    hazards: dict[str, int]         # hazard ID: number of times the run reached the hazard
    calendar_events: list[str]      # e.g. "month_end_31", "weekday_fri", "run_mode_ME"
    mismatches: list[str]           # case IDs that failed
```

**Verdicts.** The engine computes each verdict from every run under the current key. The verdict states are:

- **PROVEN.** Every run passed, and the combined coverage meets the rung's requirements.
- **PROVISIONAL.** Every run passed, and each unmet coverage requirement is recorded as an obligation (§6.7) that a human has accepted.
- **NOT_PROVEN.** Some run under the current key failed, or coverage falls short and nobody has accepted an obligation for the gap.
- **FLAKY.** Runs under the current key disagree on the same case.
- **NOT_APPLICABLE.** The rung does not apply to this step type.

A failure clears in only two ways:

1. **A code change makes it pass.** The change produces a new key, and the failing case runs again under it, because failing fresh inputs join the sealed set.
2. **Proof of an infrastructure fault.** The same case passes and fails in two reference environments under the same key, and a human signs that the cause is infrastructure.

Reruns alone never clear a failure. In v0.2, five consecutive passes cleared FLAKY. A bug that failed 25% of runs reached PROVEN in all 2,000 simulated units.

### 6.6 Calendar coverage

Every gate unit that reaches V10 must cover a **fixed minimum window**, whatever the analysis finds:

- every weekday
- one month-end of each length: 30 days, 31 days, and February
- one quarter end

Derivation adds events on top of the minimum, from four sources:

- **Code.** Date arithmetic, day-of-week logic, and century windows, from the hazard catalog.
- **Scheduler definitions.** Calendars, cycle dates, and holiday tables.
- **JCL parameters and control cards.** Each distinct run-mode value becomes a required event. For example, `PARM-CYCLE = 'ME'` requires a month-end run.
- **Recordings.** Each run-mode value seen in recorded production I/O.

In v0.2, derivation alone decided the window. A month-end selected by a scheduler parameter, and a weekday numbering difference, produced no triggers, so V10 passed after a single day.

A clock-override replay in a shadow environment can cover an event that production will not reach soon, such as year end or a leap day. The verdict stays PROVISIONAL until either the replay or the real event passes. The obligation then names that event.

### 6.7 Obligations

```python
class Obligation(TypedDict):
    id: str
    observables: list[str]          # what must be exercised
    requirement: str                # a hazard, input class, or calendar event, e.g. "hazard:invalid_packed"
    min_count: int                  # how many exercising inputs discharge it
    reason: str
    created_by: str                 # gate unit and rung
    accepted_by: str                # the human who accepted the provisional merge
```

The harness enforces three rules on obligations:

- **Only coverage discharges an obligation.** The evidence must exercise the obligation's requirement on its observables at least `min_count` times, with zero mismatches. The evidence can come from any rung, in any environment, and from any later gate unit that covers those observables. A test-LPAR run, a parallel batch run, a V10 run, or a shadow run with injected inputs all qualify. In v0.2, a V10 run with no invalid packed data discharged the obligation covering that case. The S0C7 difference then appeared after cutover.
- **Some hazards never occur on their own.** Invalid packed data is one. For these, the harness injects synthetic inputs in shadow, or a human converts the difference into a declared delta. An example delta: "modern rejects invalid packed data with error RIG-E017 instead of abending S0C7".
- **Deltas map obligations explicitly.** An R or E delta must map every open obligation on its old units to the new units, the same way a total comparator maps observables. A delta that leaves an obligation unmapped fails its gate. v0.2 lost obligations when an R step split a module.

**Cutover** for an entry point requires every obligation on its observables to be discharged.

### 6.8 Reference fidelity

Every execution environment declares how it differs from production, for example collation, `TRUNC`, `NUMPROC`, and invalid packed data handling. The Pack configures the environment to match where it can. Each difference that remains caps the affected observables at PROVISIONAL, and the harness creates an obligation that names the hazard. Only coverage of that hazard, on a matching environment or in production, discharges it.

When a difference makes the oracle itself untrustworthy for an input class, a person signs an **oracle cap** for that
class and that environment. The class's comparisons there count as neither pass nor fail. The gap becomes an
obligation that only evidence from another environment can discharge. This was added after the M2 exit run: GnuCOBOL's
Berkeley DB handler returns status 30 for a non-indexed file where z/OS behaves differently, so those sealed cases
could neither pass nor be removed.

---

## 7. The transform path

### Phase A · Understand

- Build the graph from code, scheduler definitions, JCL, PROCs, and control cards.
- Record unresolved edges.
- Derive observation surfaces, with consumer completeness.
- Extract rule cards. A second agent verifies each card, and a human confirms it.
- Harvest oracles while legacy is still the reference.
- Run the capability smoke tests (§8) and record the reference environment's differences from production.

### Phase B · Design the target shape

- Derive candidate boundaries from data affinity, runtime co-occurrence, and rule-card domain terms.
- Present one partition along business seams and one along data seams. A critic scores both, and a human signs the ADRs.
- Default to a modular monolith. A module becomes a service only for a reason the ADR names.

**Gate:** a human approves the ADRs.

### Phase C · Translate into the target shape

- Translate each job or transaction into packages laid out by module.
- Put file I/O behind repositories with an adapter for the legacy format.
- Take each `RoundingMode` from its COBOL clause. `ROUNDED` becomes `HALF_UP`, which is half away from zero for `BigDecimal`. A COMPUTE without ROUNDED becomes `DOWN`. The porting guide requires `BigDecimal` for every decimal observable, and the anti-stub lint flags `Math.round` on decimal fields.

**Gate:** V0 to V6 and V8 at each job or transaction. Each verdict must be PROVEN, or PROVISIONAL with accepted obligations.

### Phase D · Restructure inside the target

- Enforce module boundaries with architecture tests.
- Give each table one owning module.
- Write each intentional change as a delta with a total comparator. Deltas map obligations.

**Gate:** V0 to V6 and V8.

### Phase E · Re-platform data

- Declare store semantics on the target. Choose a collation that matches EBCDIC, or declare a delta.
- Rerun each reading job against the migrated store.

**Gate:** V2 to V4, V7 with store-semantics probes, and V8.

### Phase F · Cut over

- Give every entry point an E step, whether it routes to a service or to the monolith.
- Move each entry point through shadow, then canary, then primary, then decommission.
- Canary routing needs every obligation that covers the canary's traffic to be discharged first, because canary traffic is real.

**Gate:** V7 to V10, calendar coverage, every obligation discharged, and a human go/no-go for each entry point.

---

## 8. Packs as capabilities

Packs implement capabilities: Parse, Build, Execute, Record, Generate, Test, Transform, Store, and Shadow. Any Pack can implement any of them. v0.3 changes how capabilities are declared and checked.

**Capabilities are declared per construct.** An `Execute` capability lists the constructs it can run in a given environment.

```python
class Execute(Protocol):
    def supports(self, env: EnvSpec) -> set[Construct]: ...   # e.g. {"cobol_batch", "vsam_ksds", "dfsort"}
    def open_session(self, unit: UnitRef, env: EnvSpec, stores: StoreSnapshot) -> Session: ...
    def run(self, s: Session, inputs: CanonicalInput) -> tuple[Observations, Coverage]: ...
    def environment(self) -> EnvFingerprint: ...

class Shadow(Protocol):                     # new in v0.3. Provides V10.
    def route(self, entry: EntryPoint, mode: Literal["shadow", "canary", "primary"]) -> None: ...
    def inject(self, entry: EntryPoint, inputs: Iterable[CanonicalInput]) -> None: ...
    def clock_override(self, env: EnvSpec, at: datetime) -> None: ...
```

`run` now returns coverage alongside observations, because Rule B needs it from every run.

**Preflight proves capabilities by running them.** For each gate unit, the harness lists the constructs the graph finds in it, such as CICS, BMS, IDCAMS, DFSORT, DB2 SQL, and JCL condition codes. It then checks that some Pack supports each construct in a configured environment. For every supported construct, preflight runs a smoke unit and records the result and `Execute.environment()` in `PREFLIGHT.md`.

A construct with no proven capability is a gap (Rule A). Preflight reports the strongest verdict each gate unit can reach. In v0.2, a COBOL Pack that declared `Execute` passed preflight on a machine without `cobc`. It also passed CICS transactions that GnuCOBOL cannot run.

| Pack | Capabilities and constructs |
|---|---|
| `cobol-zos` | Parse. Build. Execute on GnuCOBOL (batch COBOL, sequential files, VSAM through a file handler). Execute on a remote LPAR (CICS, BMS, IDCAMS, DFSORT, DB2). Record. Generate. Store. |
| `java` (8 to 21) | Parse. Build. Execute. Record. Generate. Test. Transform. `Generate` is new in v0.3. Without it, the M4 exit check was unreachable. |
| `cobol-to-java` bridge | Porting guide, type map, hazard catalog, encoding normalizers |
| `db2`, `postgres` | Store, with collation probes |
| `shadow-http`, `shadow-batch` | Shadow |

---

## 9. Agent roles

Roles are unchanged from v0.2, with two changes to what the oracle-engineer and the judge do:

- **oracle-engineer.** Writes oracle sets, generators, normalizers, comparators, and canary sets. It never implements the units it judges.
- **judge.** Returns counts and class descriptions per class. It never returns inputs, expected outputs, or diffs.

| Role | Model tier | Writes |
|---|---|---|
| intake | frontier | `INTENT.md`, `PREFLIGHT.md`, the capability smoke results |
| graph-builder | none | The graph, observation surfaces, unresolved edges |
| legacy-analyst | mid | Node summaries |
| rule-extractor, rule-verifier | mid, then a different frontier model | Rule cards |
| oracle-engineer | frontier | Oracles, generators, normalizers, comparators, canaries |
| architecture-critic | frontier | Options and draft ADRs |
| planners | frontier | Work units and design decisions |
| worker, fixer | mid or cheap | Its `target_scope` only |
| reviewers A, B, C | mixed vendors | Findings |
| judge | frontier, plus scripts | Counts per class |
| merge agent | mid | Merge commits |
| verifier | script, plus frontier for the narrative | `VERIFICATION.md` |
| security-auditor | frontier | Findings and a patch |

---

## 10. Workspace layout

```
<programme>/
├── INTENT.md · PREFLIGHT.md · PROGRAMME.yaml
├── legacy/<system>/                  symlink, read-only
├── analysis/
│   ├── ckg.sqlite · ckg.json
│   ├── surfaces/<gate-unit>.json
│   ├── unresolved.json                dynamic CALLs and other unresolved edges
│   ├── scheduler/ · jcl/              ingested scheduler and job-control definitions
│   └── rules/ · decomposition/ · ADR-*.md
├── oracles/
│   ├── cases/<sha256>.json
│   ├── sets/<name>@<sha256>.json
│   ├── sealed/                        judge-only permissions
│   ├── generators/ · canaries/ · normalizers/ · deltas/ · comparators/
├── obligations/OBL-*.yaml
├── work/WU-*.yaml
├── modernized/<target>/
├── evidence/<key-hash>/<run-id>/       output and coverage.json for each run. Append-only.
├── VERIFICATION.md · CUTOVER.md
└── .rig/
```

---

## 11. Human gates

1. Intent, preflight, and capability smoke results.
2. Attestation of external consumers, and of consumer completeness.
3. Confirmation of P0 and P1 rule cards.
4. Target architecture ADRs.
5. Each delta, with its canary sweep result and its obligation mapping.
6. Each normalizer.
7. Each provisional merge, which accepts its obligations.
8. Each infrastructure-fault sign-off that clears a failure.
9. The porting guide and the hazard catalog for each language pair.
10. Signing verification, and go/no-go for each entry point.
11. Applying the security patch.

---

## 12. Cost, observability, and safety

These carry over from v0.2:

- Model tiers per role, with cost tracked by role.
- Budgets that escalate when exceeded, so the harness never keeps spending.
- Stable prompt prefixes, so prompt caching applies.
- Legacy content treated as untrusted data.
- Sandboxed execution, with recordings masked before they enter `oracles/`.
- Resource quotas for heavy tests.

v0.3 adds three dashboard views:

- **Coverage per gate unit.** Observables, classes, hazards, and calendar events, each shown against its requirement.
- **Unknowns.** Unresolved edges and incomplete consumer lists.
- **Open obligations.** Each one, with the coverage that would discharge it.

---

## 13. Roadmap

v0.3 is the last paper revision. The next step is the plugin, and the 48 repro scripts from both interrogation rounds become the M2 regression suite.

| Milestone | Scope | Exit check |
|---|---|---|
| M0 · Plugin skeleton | Claude Code plugin manifest, the `rig-method` skill (Rules A and B, workspace, artifact formats), `start`, `preflight`, `status` | `/rig:start` and `/rig:preflight` run on CardDemo-mini and write `INTENT.md` and `PREFLIGHT.md` |
| M1 · Understand | `map`, `rules`, `review` commands; `legacy-analyst`, `rule-extractor`, `rule-verifier` agents. Claude builds the graph, unresolved edges, surfaces with consumer completeness, hazards and rule cards, over a mechanical sweep it can re-run. | `/rig:map` on CardDemo-mini matches `tests/fixtures/carddemo-mini.EXPECTED.md`: every dynamic site in `unresolved.json`, no consumer list complete |
| M2 · Proof core | `scripts/rig_proof.ts` (content-addressed cases, both modes, judge contract, normalizer rules, total comparators and the full canary set, per-rung evidence keys, coverage records, verdict engine, obligations, calendar minimum window); `oracles`, `judge`, `verify` commands; `oracle-engineer` and `judge` agents | **Every interrogation root cause the proof core owns has a regression test in `tests/proof/` that the attack fails** (38 tests, replaying the repros in `tests/repros/`). One CardDemo-mini job PROVEN in executable mode (GnuCOBOL). One job PROVISIONAL in recorded mode. **Status 2026-11-05:** the script and its 47 tests are done. On CardDemo-mini, every READCUST class passes except `abend:open_failure`, whose oracle GnuCOBOL cannot provide (Berkeley DB status 30). The owner rejected all eight environment obligations, so PROVEN and PROVISIONAL now wait for z/OS or test-LPAR evidence. No mechanism removes any of the eight here: GnuCOBOL 3.2 cannot collate indexed keys in EBCDIC order (`FILE COLLATING SEQUENCE is not implemented`), the spool record length is a production fact that someone must attest, and the CEE3ABD argument needs a person to confirm it. |
| M3 · Translate | `plan` and `unit` commands; `worker`, `fixer`, `reviewer-a`/`-b`/`-c` and `merge` agents; the `cobol-to-java` bridge skill (porting guide, type map, hazard catalog); `hooks/guard.ts` (evidence written only by `rig_proof.ts`, workers never see oracles, reviewers see only their packet, subagents never sign or accept) | The CardDemo-mini batch jobs that preflight can run (READCUST, INTCALC) go through `/rig:unit` end to end. Every class without a signed oracle cap passes, the guard denies every forbidden access in the logs, and each outcome (merged, provisional, retry, escalate) is the one the script's verdict calls for. **Status 2026-11-05:** both jobs went through the loop end to end and both escalated, as their verdicts required. READCUST ($3.30) passed every class but cannot be proven here (H-0012 and the owner-rejected environment obligations). INTCALC ($11.99, after an aborted $2.42 start) passed 20 of 21 classes; `structural:xref_alt_duplicates` fails because z/OS behaviour for duplicate alternate keys is unknown, and a cap is drafted for a person. The runs found and fixed six harness defects: dev cases teaching reference-environment quirks, guard false positives (shell writes, packet folders, Glob patterns), unlogged denials (now written by the guard to `.rig/guard.jsonl`), fixers applying reviewers' undocumented suggestions, and orchestrators ending a turn while an agent runs. **Closed 2026-11-05 with open items for the owner:** the INTCALC duplicate-key cap, 12 new environment differences, S0C7 reporting, two map errors (dead code at `CBACT04C.cbl:220`, missing hazards), and clean re-runs of both units under the fixed loop. |
| M4 · Uplift | The `java-uplift` bridge skill (delta catalog of Boot 2.7→3 and Java 8→21 breaking changes with triggers and generators, the OpenRewrite recipes stage, observing a web app: HTTP routes as gate units); the `version-delta-analyst` agent; Java and web support in `map` and `plan` | Spring PetClinic at its last Boot 2.x commit (`tests/fixtures/petclinic-2.7`), with legacy on Java 8, uplifted to Boot 3 on Java 21 through `/rig:unit`: every route PROVEN, or each gap named. **Status 2026-11-05:** exit run 1 ($52.95: Opus $44.38, Sonnet $8.57; 4h43m) escalated. OpenRewrite `UpgradeSpringBoot_3_0` plus a worker produced Boot 3.0.13 on Java 21. In attempt 2 every case of all 17 routes passed, after attempt 1 found a real difference (page numbers near 2^30: legacy 200, modern 500) that the dev cases had missed. All 17 verdicts are NOT_PROVEN, for three reasons. Two are harness defects, now fixed: surface ids carried scenario suffixes the comparator never records (now a fixed grammar, `rig_proof.ts surface check`), and keys hashed no legacy file because `http:` gate units had no `endpoint:` node lookup (now mapped, and a missing node fails closed). The third is the owner's to decide: the production environment, and 190 open obligations. The same run also fixed four guard and agent gaps (attempt-numbered reviewer packets, judge scratch folder outside `evidence/`, Claude Code's saved tool output, the delta analyst's toolchains and output) and replaced the run-written Python runner with `scripts/rig_http.ts`. Open for the owner: the 14 decisions in the run's `M4-EXIT.md`, including a legacy hang on wrapped page offsets. A clean re-run under the fixes is needed before the exit check can pass. **Closed 2026-11-05 with open items for the owner:** the production environment (JVM, OS, locale, timezone, database) and the 190 open obligations; the legacy hang on wrapped page offsets and the open reviewer items; the empty-telephone message order, clock-bound visit cases, `/oups` and timestamped error bodies (normalizer or accepted gap); whether implicit routes (`/actuator/**`, `/error`, static) and the Gradle build stay in scope; exhaustive classes for `GET /vets`; and a clean re-run of `WU-U-0001` and `/rig:verify` under the fixed harness. The full list is in the run's `M4-EXIT.md` §10. |
| M5 · Restructure | `/rig:design` (affinity evidence, a business-seam and a data-seam partition, scorecard, draft ADR and `MODULES.json`); the `architecture-critic` agent; ADR sign-off in `/rig:review adrs` (hashes of the ADR and `MODULES.json`, written only by a person); `scripts/rig_arch.ts` architecture tests (every file in one module, declared dependencies and api, no cycles, one owner per store); approved deltas applied by `judge` and `compare` (store and field renames, removed and added observables); restructure units in `plan` and `unit`; the `java-restructure` bridge (contract, reference side, hazards R-STATIC to R-REFLECT) | CardDemo-mini (`tests/fixtures/carddemo-mini`) designed as a modular monolith by `/rig:design`, the ADR signed by a person, and the M3 Java of READCUST and INTCALC restructured into its modules through `/rig:unit`, judged against the COBOL: no new failing class, and `rig_arch.ts check` passing. **Status 2026-11-05:** the plugin pieces and 17 regression tests are done (93 in all, passing). A first trial on a separate Java fixture ($2.85) found two harness gaps, now fixed: surface store names that MODULES.json did not name (now a `store_owner` violation, resolved by `surface_names`), and a critic that compiled and ran both options (now graph and `rig_arch.ts` only). The fixture was dropped: M5 tests on CardDemo-mini, reusing the M3 run's map, oracles and Java. Exit run on CardDemo-mini ($10.20: session 1 design $3.71, session 2 unit $6.49; plus $2.85 for the trial and $0.25 for two starts blocked by workspace trust): the critic recommended the data partition (nine modules, `ledger` owning every money store), signed by the owner. WU-R-0001 moved the M3 Java into five modules; `rig_arch.ts check` passes for the unit (`"pass":true`, 18 files). Against the COBOL, READCUST passed 67 of 67 cases in both runs and INTCALC 162 and 161 of 166; the only failing class is `structural:xref_alt_duplicates`, which failed in M3 too (its cap is unsigned). No class fails that did not fail before, so the restructure kept the behaviour the oracle reaches. All four verdicts are NOT_PROVEN, and the unit escalated. Two causes are harness defects, now fixed: the M3 comparators recorded pre-grammar ids, so the surface observables were "never compared" while the judge printed 67/67 (the judge now refuses a comparator whose ids are outside the grammar); and the brief sent the worker to oracle runners it cannot see, so it wrote its own check outside its scope (the brief now names only the build and the entry class). A guard gap is fixed too: reviewer-b may grep its own saved tool output. **Open for the owner:** comparators that emit grammar ids (an oracle change), CAP-INTCALC-001, 19 open obligations, SelfCheck's by-name launch of the entry class, and the pre-restructure trees. Then rerun the judge for WU-R-0001. **Closed 2026-11-06 with open items for the owner:** the five above (comparator ids, CAP-INTCALC-001, the 19 obligations, SelfCheck, the old trees), the 13 design questions in the run's `M5-S1.md` (missing source for eight jobs, unresolved edges, unattested consumers), and a rerun of the judge and `/rig:verify` for WU-R-0001 once the comparators are fixed. |
| M6 · Data and cutover (4 weeks) | Store, Shadow, V7 to V10, calendar coverage | One entry point in shadow, with coverage and obligations visible |
| M7 · Hardening | More Packs, a third interrogation round against the running code | A second technology pair certified with no core changes |

---

## 14. Open risks

Nobody has proven these by a run yet. Each needs a probe before the milestone named.

| Risk | Milestone |
|---|---|
| CICS SYNCPOINT scope split across two services loses atomicity, and shadow runs do not exercise partial failure | M6 |
| A REDEFINES mapping to a sealed type cannot express writing through one view and reading through another | M3 |
| Consumer completeness may stay `False` for most datasets in a real estate. Then normalizers are rarely usable, and V3 must compare exactly almost everywhere. That is safe, but it may produce many differences for humans to review. | M1 |
| The fixed calendar minimum lengthens every parallel run to at least a quarter end | M6 |
| Near-duplicate recordings that differ only in masked fields could defeat deduplication | M2 |

The third and fourth risks are costs that Rule A imposes on purpose. M1 and M6 should measure them on CardDemo before anyone tunes them.

---

## 15. Decisions needed

1. **First technology pair.** Recommended: COBOL to Java on CardDemo first, then Java 8 to 21.
2. **Delivery shape.** Decided 2026-11-05: a Claude Code plugin only, shaped like Anthropic's `code-modernization` plugin. Claude does the analysis and the work, guided by commands, agents and the `rig-method` skill, and uses scripts only where they make a result more reliable. There is no standalone application.
3. **Relationship to the Anthropic plugin.** Recommended: compatible artifact formats with an independent core.
4. **Execution environments.** The choice is between GnuCOBOL only, a mainframe test LPAR, or recorded production data. It decides which constructs preflight can prove, and how many obligations reach cutover. Without an LPAR, CardDemo's CICS transactions run in recorded mode.

---

## Sources

The sources listed in [v0.1](PROPOSAL-v0.1.md#sources) still apply. The repro scripts behind §0 are listed in [INTERROGATION.md](INTERROGATION.md) and [INTERROGATION-2.md](INTERROGATION-2.md).
