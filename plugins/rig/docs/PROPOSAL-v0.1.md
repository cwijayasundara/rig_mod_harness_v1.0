# RIG — A Technology‑Agnostic Modernization Harness

**Proposal v0.1 · 2026‑11‑04**

> **One‑line pitch:** A harness that turns *any* legacy system into a verified modern one by keeping
> three things strictly apart: **understanding** (a code knowledge graph plus a business‑rule spec),
> **change** (small, typed, owned work units run by a planner/worker/reviewer agent tree), and
> **proof** (an independent ladder of equivalence oracles that produces a verdict a script computes,
> not one the model asserts).

---

## 0. Executive summary

1. **The three reference systems are all "like‑for‑like" engines.** Anthropic's `code-modernization`
   plugin, Bun's Zig→Rust port, and Cursor's SQLite swarm all win for the same reason: a fixed
   behavioural target (legacy code, a language‑independent test suite, a held‑out conformance
   suite) that agents can be graded against. They differ mainly in scale and how they coordinate.
2. **Restructuring (COBOL → modular monolith → microservices) breaks that assumption.** Once you
   change the architecture, outputs are *intentionally* different. Batch becomes events and screens
   become APIs, so byte‑for‑byte comparison stops working. The central design move in this proposal is
   **never change language and architecture in the same step**, plus a **Delta Register**:
   every intended behaviour change is declared, approved, and turned into a comparator rule.
   The rest of the system is then still checked by strict equivalence.
3. **Recommended path for "transform" programmes:**
   `Understand → Target‑shape design → Translate into a modular monolith shaped like the target
   (proven equivalent) → Restructure inside the target language (proven equivalent mod declared
   deltas) → Extract services selectively via strangler fig (proven in shadow/parallel run)`.
   Translating into a modular monolith first moves the hard work into a language with good
   refactoring tools, a compiler, and cheap tests. The service boundaries are then just module
   boundaries enforced by architecture tests.
4. **Verification is the product.** The proposal defines a 10‑rung **Verification Ladder**, from
   static checks through differential, generated‑input, mutation, data reconciliation, contract,
   non‑functional, and shadow/parallel‑run tests. It also enforces **held‑out oracles** that worker
   agents never see, **decorrelated reviewers**, and **anti‑cheat detection** (stubs,
   skipped tests, weakened assertions).
5. **Technology independence comes from "Packs".** The core knows nothing about COBOL, Java, or
   Spring. Each source/target technology plugs in through a *Pack* interface: parser → graph, build,
   run‑in‑isolation, type mapping, idiom guide, deterministic recipes, and output normalizers.
   Deterministic tools (OpenRewrite, compilers, codemods) run first. LLMs handle what's left.
6. **Economics follow Cursor's finding.** Frontier models plan, review, and judge. Cheaper models do
   the bulk of the work. Churn and conflict monitors stop runaway spirals.

---

## 1. What the reference systems teach us

### 1.1 Anthropic `code-modernization` plugin

| Aspect | What it does | Keep / Adapt |
|---|---|---|
| Lifecycle | `modernize` → `preflight` → `assess` → `map` → `extract-rules` → `review` → `brief` → `uplift`/`transform`/`reimagine` → `verify` → `harden` | **Keep** the staged, resumable, file‑based lifecycle. **Adapt**: add a *Restructure* stage and a *Cutover* stage. |
| State | Artifacts on disk (`INTENT.md`, `ASSESSMENT.md`, `topology.json`, `BUSINESS_RULES.md`, `MODERNIZATION_BRIEF.md`, `VERIFICATION.md`) | **Keep** "files over chat". **Adapt**: add a queryable knowledge graph and an evidence ledger. |
| Business rules | Given/When/Then cards with `file:line` citations, each re‑checked by a second agent, then human review | **Keep.** These cards become the traceability spine from rule to test to verdict. |
| Verification | Fresh‑session verifier; clean re‑run; byte‑for‑byte differential; ≥10 unseen inputs; canaries; rule coverage; source integrity; verdict computed by `proof_pack.py` (PROVEN / PARTLY / NOT PROVEN) | **Keep everything.** Extend with mutation testing, data reconciliation, contracts, non‑functional checks, and production shadowing. |
| Safety | Legacy is read‑only (deny `Edit(/legacy/**)`), analyzed code treated as untrusted data, secrets masked, never commits | **Keep** as non‑negotiables. |
| Human gates | Preflight answers, wrong rules, brief approval, accepting diffs, signing verification, security patch | **Keep.** Add gates for target architecture ADRs and the Delta Register. |
| Gap for us | `reimagine` jumps from spec to scaffolded services. Nothing proves the *new architecture* preserves behaviour end‑to‑end beyond acceptance tests. | **This is the gap the proposal fills.** |

### 1.2 Bun: Zig → Rust (535k LOC, 11 days, ~$165k)

- **The oracle made it possible.** Bun's ~60,600 tests are written in TypeScript and don't depend on
  the implementation language. That is the ideal oracle. *Lesson: before any build, invest in an
  implementation‑independent oracle* (black‑box tests, recorded I/O, golden datasets).
- **Plan artifacts first.** About 3 hours went into `PORTING.md` (pattern mapping) and `LIFETIMES.tsv`
  (annotations), both reviewed adversarially. *Lesson: a reviewed **mapping guide** per language pair is
  the most valuable thing in the run.* It becomes our Pack "idiom guide".
- **Unit loop: implementer → 2 adversarial reviewers (diff only, separate contexts) → fixer.**
  This caught real use‑after‑free and double‑free bugs before merge.
- **Pilot on 3 files, then 1,448.** Batch compile checks (`cargo check` once per batch) to save build
  cost.
- **Failure modes to design against:** agents running `git stash` / `reset --hard` on each other,
  disk/IOPS exhaustion, **stubbing functions to get green and adding long justifying comments**,
  heavy tests crashing the host. *Rule adopted: "a paragraph‑long justification means the code is
  wrong."*
- **Fix the generator, not the output.** When a class of bug appears, change the guide or prompt and
  regenerate. Don't hand‑patch.
- **The port was intentionally architecture‑preserving.** Idiomatic refactoring came *after*. This
  supports the "don't change language and architecture together" principle.

### 1.3 Cursor: agent‑swarm economics (SQLite in Rust from the manual)

- **Planner / worker tree.** Frontier planners decompose and decide. Cheap workers execute narrow
  leaves. Context separation matters more than raw parallelism.
- **Economics.** Workers burn 69–90%+ of tokens. Opus planner + Composer worker cost **$1,339** vs.
  **$10,565** for GPT‑5.5 doing both roles. *Lesson: tier models by role and track cost per role.*
- **Held‑out grading.** The swarm was **never told** sqllogictest existed. *Lesson: the oracle
  agents optimise against must differ from the oracle that grades them.*
- **Coordination mechanisms we should copy:**
  - Planners own design decisions, and no two subtrees decide the same question (prevents split‑brain).
  - Shared design docs with **compile‑checked references from code**, plus a reconciler agent.
  - **Neutral merge agent** (merge queue) for conflicts.
  - **Megafile detection**: block commits, and an outside agent splits the file.
  - **Intentional‑breakage protocol** to stop "ossification" of core code.
  - **Field Guide** (`index.md` injected at startup, curated under a line budget). Agents leave
    "surprises" for later agents (stigmergy).
- **Decorrelated review lenses** (transcript‑only, output‑only, codebase‑only; different models and
  personas) catch different bugs, and review costs much less than the work it audits.
- **Churn signals.** The old harness produced 68k commits and 70k conflicts in 2h, with 54 crates vs. 9.
  *Lesson: commit rate, conflict rate, hottest‑file conflicts, and package sprawl are spiral
  detectors that should trigger automatic pauses.*

### 1.4 What others are doing (landscape)

| Player | Approach | Notable idea for RIG |
|---|---|---|
| **AWS Transform for mainframe** (incl. Blu Age) | Agentic assess → business‑rule extraction → requirements → code gen; z/OS COBOL & PL/I; "reimagine" workflow GA June 2026; integrates with Kiro / MCP IDEs | End‑to‑end **traceability** from rule → requirement → code. Reverse‑engineering and forward‑engineering are separate phases. |
| **Google Cloud Mainframe Modernization** (MAT, Code Rewrite, **Dual Run**) | Gemini‑based assessment and rewrite; **Dual Run replays live mainframe production events into the cloud app and compares outputs**, with rollback | **Production replay/parallel run** as the top verification rung. |
| **IBM watsonx Code Assistant for Z** | Select a COBOL "business service", refactor it, then translate to object‑oriented Java that interoperates with the remaining COBOL/CICS/IMS/DB2. IBM Research: symbolic‑execution‑generated COBOL unit tests converted to JUnit for equivalence testing (arXiv 2504.10548) | **Incremental, interoperable extraction** (mixed estate). **Symbolic execution** as a test‑input generator. |
| **IBM Mono2Micro** | Static analysis + **runtime traces of business use cases** → partition recommendations ("business‑logic seams" vs. "natural/data seams") | **Decomposition needs runtime evidence**, not only static structure. Offer both partition types. |
| **vFunction** | Architectural observability: static + dynamic analysis → domain identification, drift governance after decomposition | **Keep architecture governance running** after the migration (boundary drift checks). |
| **Microsoft / GitHub Copilot modernization** | Copilot modernization agent GA (June 2026) for estate‑wide assessment and upgrades; open‑source `Azure-Samples/Legacy-Modernization-Agents` (COBOL → Java/Quarkus on Microsoft Agent Framework) | Portfolio‑level assessment; IDE/CLI/cloud entry points. |
| **Moderne / OpenRewrite** | Lossless Semantic Tree plus thousands of deterministic recipes; recipes exposed as tools for agents | **Deterministic first, LLM second.** Agents *call* recipes and don't regenerate what a recipe already does correctly. |
| **Thoughtworks CodeConcise** | AST‑derived knowledge graph (Neo4j) built *without* LLMs, then LLM enrichment by graph traversal; reported reverse‑engineering 6 weeks → 2 | **Build the graph deterministically**, then use LLMs to summarise along graph edges (bottom‑up context). |
| **Google internal migrations** (arXiv 2501.06972, 2504.09691) | 39 migrations; ~70–80% of edits AI‑authored; ~50% time saved; **review was the bottleneck** | Design for **reviewer throughput** (small diffs, evidence attached, auto‑approve when proofs pass). |
| **Airbnb Enzyme→RTL** | 3,500 files in 6 weeks; step‑wise state machine per file; "sample, tune, sweep"; breadth‑first; 75% → 97% after prompt tuning | **Per‑unit state machine** with retries and context enrichment; tune on samples before sweeping. |

**Overall pattern:** vendors converge on *assess → extract rules → generate → test*. They are weakest at
(a) **proving equivalence across an architecture change** and (b) **staying technology‑neutral**.
Those are RIG's two differentiators.

---

## 2. Scope: modernization *types* RIG must support

Treat modernization as a **composition of typed steps**, each with its own oracle. Don't treat it as
one monolithic "migrate" action.

| Step type | Example | Behaviour contract | Primary oracle |
|---|---|---|---|
| **U · Uplift** | Java 8→21, Spring Boot 2→3, .NET Fx→.NET 8, Python 2→3 | Strict equivalence | Existing tests on both versions, plus differential |
| **T · Translate** | COBOL→Java, PL/I→Java, Perl→Python, VB6→C# | Strict equivalence (modulo normalizers: encoding, numeric repr) | Differential on recorded/generated inputs |
| **R · Restructure** | Spaghetti → modules; batch steps → services; extract bounded contexts; GOTO → structured | Equivalence **modulo declared deltas** | Differential at module boundaries + end‑state equivalence |
| **X · Re‑platform data** | VSAM/IMS → RDBMS; EBCDIC → UTF‑8; COMP‑3 → DECIMAL | Data equivalence | Reconciliation (counts, checksums, field‑level hashes) |
| **E · Extract / Cutover** | Strangler‑fig extraction of a service, ACL facade, CDC sync | Observable equivalence in production | Shadow traffic, parallel run, business reconciliation |
| **I · Reimagine** | New UX, new product capabilities | New spec (from mined rules + new requirements) | Executable acceptance tests (BDD) traced to rules |

A **programme** is a DAG of these steps per module, for example:

```
COBOL CardDemo ──T──► Java modular monolith ──R──► bounded modules ──X──► Postgres ──E──► 3 services + 1 module stays in monolith
```

> **Rule 1 (the "one axis at a time" rule):** a work unit may change *language*, *architecture*,
> *data platform*, or *behaviour*, but **only one** of them. This keeps an equivalence oracle
> available at every step.

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                               CONTROL PLANE                                   │
│  Programme DAG · Work‑unit scheduler · Budgets · Spiral monitors · Gates UI   │
└──────────────┬──────────────────────────┬─────────────────────────┬───────────┘
               │                          │                         │
┌──────────────▼──────────┐  ┌────────────▼────────────┐  ┌─────────▼───────────┐
│   UNDERSTANDING PLANE    │  │      CHANGE PLANE        │  │    PROOF PLANE      │
│ Code Knowledge Graph     │  │ Planner → Worker →       │  │ Verification Ladder │
│ Business Rule Spec       │  │ Reviewers → Fixer        │  │ Held‑out oracles    │
│ Data Dictionary          │  │ Deterministic recipes    │  │ Evidence Ledger     │
│ Runtime Traces           │  │ Merge agent · Field Guide│  │ Verdict engine      │
│ Decision Log (ADRs)      │  │ Delta Register           │  │ (script, not LLM)   │
└──────────────┬───────────┘  └────────────┬────────────┘  └─────────┬───────────┘
               │                           │                         │
┌──────────────▼───────────────────────────▼─────────────────────────▼───────────┐
│                                 PACK LAYER                                     │
│ Source packs (COBOL+JCL+CICS, Java 8, PHP 5 …) · Target packs (Java 21/Spring, │
│ .NET 8, Python/FastAPI …) · Bridge packs (COBOL→Java mapping guide, PIC→type)  │
│ Data packs (VSAM, IMS, DB2, Oracle) · Runtime packs (GnuCOBOL, JVM, containers)│
└────────────────────────────────────────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────────────────────────┐
│ AGENT RUNTIME ADAPTER  (Claude Agent SDK / Claude Code first; model‑agnostic)  │
│ Sandboxes · worktrees · per‑unit FS permissions · secrets masking · telemetry  │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Understanding plane

**Code Knowledge Graph (CKG).** Built **deterministically** by Pack parsers, CodeConcise‑style.
Node types are technology‑neutral:

```
System · Component(program/class/module) · Routine(paragraph/method) · DataStructure(copybook/DTO)
DataStore(VSAM file/DB2 table/queue) · Field · EntryPoint(CICS txn/JCL job/HTTP route/CLI)
Job/Step · Screen · ExternalSystem · BusinessRule · Test · WorkUnit · Decision(ADR)
```

Edge types: `calls`, `includes`, `reads`, `writes`, `updates`, `deletes`, `maps_to`,
`implements_rule`, `tested_by`, `translated_to`, `owned_by_module`, `observed_in_trace`.

- Storage: start with **SQLite + JSON export** (portable, diffable). Neo4j / Kuzu are optional backends.
- LLM enrichment runs **bottom‑up along edges**: leaves are summarised first, and parent summaries
  cite child summaries. This keeps context small.
- **CRUD matrix** (Component × DataStore × op) is a first‑class view. It drives decomposition and is
  the single most important input for COBOL restructuring.

**Business Rule Spec.** Anthropic‑style Given/When/Then cards, extended:

```yaml
id: BR-ACCT-017
title: Interest accrues daily on positive balances only
priority: P0            # P0 must be test‑proven before cutover
given: account.status = ACTIVE and balance > 0
when: nightly batch INTCALC runs
then: interest = round_half_even(balance * apr / 365, 2) is added to accrued_interest
citations: [legacy/cbl/CBACT04C.cbl:212-248, legacy/cpy/CVACT01Y.cpy:14]
confidence: 0.86        # extractor score; second‑agent verified: yes
status: confirmed       # proposed | verified | confirmed (human) | disputed | retired
tests: [DT-INTCALC-001..040, PBT-INTCALC-ROUNDING]
target_owner: module:accounts
```

**Runtime traces (optional but strongly recommended).** Mono2Micro‑style: run representative
business use cases (or ingest SMF/CICS monitoring/APM logs) to get *which entry points touch which
routines and data stores together*. Static analysis alone mis‑clusters COBOL because of shared
copybooks and utility programs.

**Decision Log.** ADRs with stable IDs. Code carries `@Decision("ADR-012")` references (or comments
in languages without annotations), and a check fails if a referenced ADR is missing or superseded
(Cursor's compile‑checked doc references).

### 3.2 Change plane

#### Work Unit: the atomic contract

```yaml
id: WU-T-0142
type: translate            # uplift | translate | restructure | data | extract | reimagine
source_scope: [legacy/cbl/CBACT04C.cbl, legacy/cpy/CVACT01Y.cpy]
target_scope: [modernized/accounts/src/main/java/.../interest/**]   # write‑allowlist (enforced)
inputs:
  graph_slice: ckg://component/CBACT04C?depth=2
  rules: [BR-ACCT-017, BR-ACCT-018]
  guides: [packs/bridge/cobol-java/PORTING.md, field-guide/index.md]
  decisions: [ADR-004 BigDecimal-everywhere, ADR-009 module-layout]
oracle:
  dev:      [DT-INTCALC-001..030]           # visible to worker
  heldout:  [DT-INTCALC-031..040, PBT-*]    # visible to judge only
budget: {tokens: 2.5M, wallclock: 45m, attempts: 3}
models: {planner: frontier, worker: mid, reviewers: [frontier, mid‑different‑vendor]}
depends_on: [WU-T-0139]
state: queued
```

#### The unit loop (Bun loop + Airbnb state machine)

```
queued → context_build → [deterministic recipes] → implement → self_check (build+dev oracle)
      → review_A (diff only, bug‑hunter) ┐
      → review_B (spec + output only)    ├→ fix → judge (held‑out oracle + anti‑cheat) → merged
      → review_C (transcript, cheating?) ┘                    │
                                                              └→ fail → retry w/ enriched context
                                                                      → escalate to planner
                                                                      → escalate to human
```

- **Deterministic first.** If a Pack offers a recipe (OpenRewrite for Java/Spring uplift, Rector for
  PHP, `2to3`/`pyupgrade`, .NET Upgrade Assistant, COBOL structuring rewriters), the agent *invokes*
  it and works only on the remainder.
- **Reviewers are decorrelated:** different inputs (diff / spec+output / transcript), different
  models, different personas. Their only job is to find defects.
- **Judge** is a separate role with access to the held‑out oracle. It returns *pass/fail with
  evidence*, never code.

#### Planner tree (Cursor model)

- **Programme planner** (frontier): owns the programme DAG and top‑level ADRs.
- **Module planners** (frontier): own a bounded context. They decompose it into work units and
  decide module‑local design questions. **No two planners may own the same design question.** The
  control plane enforces this through a `decision_owner` index.
- **Workers** (cheaper models): implement single work units.
- **Shared services:** merge agent (neutral conflict resolver / merge queue), megafile splitter,
  reconciler for conflicting docs, Field Guide curator.

#### Coordination rules (lessons from Bun and Cursor, enforced, not just suggested)

1. Each unit runs in its **own worktree/sandbox**, with **write access only to `target_scope`**. A
   hook rejects other writes.
2. **No repo‑wide VCS commands** for agents (`stash`, `reset --hard`, `checkout .`, `clean`). Commits
   go through the merge agent only.
3. **Legacy is read‑only**, enforced by permissions (deny rules) and checked by source integrity hashes.
4. **Batching builds:** a full build/compile check runs once per batch. Per‑unit checks run
   incremental/targeted builds.
5. **Megafile guard:** a file over N lines or with more than K concurrent edits blocks commits and
   spawns a split unit.
6. **Intentional breakage protocol:** a worker may make a focused out‑of‑scope change only as a
   separate `BREAK-*` unit with an explanation. Downstream failures are routed to affected owners.
7. **Field Guide:** `field-guide/index.md` (≤ 300 lines) is injected into every agent. Agents append
   "surprises" (for example, "REDEFINES over COMP‑3 in CVTRA05Y means a union, not a cast") and the
   curator keeps it within budget. Recurrent surprises get promoted into the Pack's idiom guide.
   This is the "fix the generator" loop.
8. **Anti‑stub rules:** reject diffs with new `TODO`, `unimplemented!`, `throw new
   UnsupportedOperationException`, empty catch blocks, or tests marked skip/ignore. Also reject
   assertions weakened compared with the dev oracle, and justification comments over 3 lines.

#### Spiral monitors (automatic pause)

| Signal | Threshold example | Action |
|---|---|---|
| Commit rate per module | > 5× baseline for 10 min | Pause module, planner review |
| Merge conflicts / hour | rising 3 windows in a row | Pause, merge agent re‑plans ownership |
| Hottest file conflicts | > 25 | Megafile split |
| Package/module count | grows outside planned ADR | Block, architecture critic |
| Retry loops on one unit | > 3 | Escalate to human |
| Cost burn vs. plan | > 120% | Pause, rebudget |

### 3.3 Proof plane: the Verification Ladder

This plane is independent of the Change plane by construction. It runs in **fresh sessions**,
**recomputes from current evidence**, and its verdict comes from a **script** reading result files.
Model opinion doesn't count.

| Rung | Name | What it proves | Technique | Applies to |
|---|---|---|---|---|
| **V0** | Integrity | Legacy untouched; build reproducible | Hashes of legacy tree; clean build from scratch; zero‑test run = fail | all |
| **V1** | Static & architecture | Code is real and respects boundaries | Compile, lint, type‑check; anti‑stub scan; **architecture tests** (ArchUnit / Spring Modulith / import‑linter / NetArchTest) for module boundaries | all |
| **V2** | Characterization | New code reproduces legacy on known cases | Golden‑master tests pinned on legacy, executed on new | T, R, U |
| **V3** | Differential | Same input → same output | Run legacy and new side by side; compare with **declared normalizers** (EBCDIC↔UTF‑8, COMP‑3↔BigDecimal, timestamps/IDs masked, float tolerance, record order) | T, U, R |
| **V4** | Unseen inputs | Not overfit to chosen cases | Property‑based testing, coverage‑guided fuzzing, **symbolic‑execution‑derived inputs** (IBM approach), boundary generators from PIC clauses / schemas; **held‑out set** | T, R, U |
| **V5** | Test adequacy | Tests actually detect defects | **Mutation testing** (PIT, Stryker, mutmut) with a minimum kill score on P0 paths; canaries (1‑line break → red; 1‑byte output change → detected) | all |
| **V6** | Rule coverage | Every P0 business rule is executed and passes | Rule ↔ test traceability from the CKG; "named but not run" = fail | T, R, I |
| **V7** | Data reconciliation | Migrated data is equivalent | Row counts, column aggregates (sum/min/max per numeric), per‑record hashes after canonicalisation, referential checks, sampled field‑by‑field diffs; COMP‑3/zoned/REDEFINES/CHAR‑stored‑packed special cases | X |
| **V8** | Contracts & integration | Services agree with each other and with remaining legacy | Consumer‑driven contracts (Pact), schema compatibility, end‑to‑end flows replayed from legacy business scenarios; **end‑state equivalence** (after running a full business day of batch + online, the final data state matches) | R, E |
| **V9** | Non‑functional | Fit for production | Batch window / throughput / latency vs. legacy baseline, concurrency & locking semantics (CICS/DB2 vs. new transactions), security scan (SAST, deps, secrets), resilience tests | all before cutover |
| **V10** | Production equivalence | Behaves the same with real traffic | **Shadow traffic / record‑replay** (Google Dual Run style), **parallel run** with daily business reconciliation (e.g. GL totals, statement outputs), canary routing, automatic rollback | E |

**Verdicts per module, per rung:** `PROVEN` · `PARTLY_PROVEN(reason)` · `NOT_PROVEN(reason)` ·
`NOT_APPLICABLE`. A module's **cutover readiness** is a policy over rungs, for example:
*"T‑steps require V0–V6 PROVEN; E‑steps require V7–V10 PROVEN for 10 consecutive business days."*

#### Oracle segregation

- **Dev oracle** (visible to workers) and **held‑out oracle** (judge and verifier only). They are
  split deterministically (hash of case ID) at oracle‑creation time.
- **Verifier never reuses the builder's notes.** It reads artifacts from disk only, in a new session.
- **Oracle creators ≠ code creators.** The agent/session that writes characterization or property
  tests for a module may not implement that module (prevents "teaching to the test").

#### When legacy can't run locally (the COBOL reality)

| Situation | Strategy | Max verdict |
|---|---|---|
| Batch programs runnable on GnuCOBOL (or equivalent) | Full differential locally, with CICS/DB2 calls stubbed via recorded I/O | PROVEN |
| Runs only on a mainframe test LPAR | Harness ships input decks, runs jobs remotely through an approved channel, pulls outputs | PROVEN |
| No execution access; only production logs/extracts | Replay from recorded inputs/outputs (SMF, CICS journals, file snapshots) | PARTLY_PROVEN → PROVEN after V10 |
| Nothing recorded | Spec‑based acceptance tests from confirmed rules only | PARTLY_PROVEN (must reach V10 before cutover) |

#### Equivalence modulo declared deltas (how R/E steps stay checkable)

**Delta Register** entries are first‑class, human‑approved objects:

```yaml
id: DELTA-007
scope: module:statements
kind: format              # format | ordering | timing | semantics | interface | removal
description: Statement output becomes JSON via API instead of 133‑col print file
legacy_view:  "STMTFILE fixed‑width records"
modern_view:  "GET /accounts/{id}/statements → JSON"
comparator:   packs/comparators/print133_to_json.py   # projects both to a canonical model
approved_by:  <human>   approved_at: 2026‑…
rules_affected: [BR-STMT-002]
```

The comparator projects both outputs into a **canonical business model** (for example, `Statement{account,
lines[], totals}`) and compares those. *Undeclared* differences are always failures. This keeps
architecture changes reviewable and keeps "it's different because we modernized it" from hiding bugs.

---

## 4. The Transform path in detail (COBOL → modular monolith → services)

### Phase A · Understand
- Pack parsers build the CKG: programs, copybooks, JCL jobs/steps, CICS transactions, BMS maps,
  VSAM/DB2/IMS stores, the CRUD matrix.
- Runtime traces from representative scenarios (or production monitoring extracts).
- Business rule extraction fan‑out (Anthropic pattern), adversarial second check, human review.
- **Oracle harvesting starts here**, not after the build: capture input decks, file snapshots,
  transaction recordings, and report outputs while the legacy system is still the reference.

### Phase B · Target‑shape design (human‑gated)
- **Candidate bounded contexts** from clustering on three signals, weighted:
  1. *Data affinity*: programs sharing data stores (CRUD matrix), weighted by write operations.
  2. *Runtime co‑occurrence*: entry points and routines that fire together per business use case.
  3. *Semantic labels*: LLM‑assigned domain terms from rule cards and summaries.
- Present **two alternatives** like Mono2Micro: *business seams* (ideal encapsulation, needs data
  splitting) vs. *data seams* (respects current data ownership, cheaper to start).
- `architecture-critic` agent scores cohesion and coupling, shared‑table hotspots, distributed‑transaction
  risk, and chattiness. A human signs an ADR set: module list, data ownership per table, and
  integration style.
- **Default recommendation: modular monolith.** Promote to a microservice only with a named driver
  (independent scaling, release cadence, team ownership, or regulatory isolation), recorded in the ADR.

### Phase C · Translate into the target shape (T‑steps, strict equivalence)
- Translate program‑by‑program into **target‑language packages already laid out by module**. Package
  layout follows the Phase B decision, but code inside stays close to legacy structure (Bun approach:
  same architecture, new language).
- Bridge Pack supplies the mapping guide, for example:
  - `PIC S9(7)V99 COMP-3` → `BigDecimal(scale 2)` with an explicit `RoundingMode` per `ROUNDED` usage
  - `REDEFINES` → sealed type / union with explicit view accessors
  - `PERFORM … THRU`, `GO TO` → structured methods (via deterministic restructurer where possible)
  - Copybooks → records/DTOs; `OCCURS DEPENDING ON` → bounded lists
  - File I/O → repository interfaces with a legacy‑format adapter (so V3 compares the same files)
  - JCL steps → job definitions (Spring Batch / equivalent) with identical step ordering and condition codes
  - CICS `EXEC CICS` → service interfaces; BMS → API DTOs (UI handled separately)
- Gate: V0–V6 PROVEN per program.

### Phase D · Restructure inside the target (R‑steps, equivalence modulo deltas)
- Now refactoring is cheap and safe: IDE refactors, OpenRewrite recipes, a compiler, and the
  differential harness all available.
- Enforce module boundaries with architecture tests (V1). Remove cross‑module data access by
  introducing module APIs. Tables get one owning module.
- Idiomatic rewrites (dead code removal, duplicated paragraph consolidation, pattern adoption) in
  small units, each re‑proven by V3/V4 at the *module boundary*.
- Any intentional behaviour change goes through the Delta Register.

### Phase E · Data re‑platforming (X‑steps)
- Schema design per module ownership. Migration jobs come from Data Pack mappings (copybook → DDL).
- V7 reconciliation must pass on full production‑sized extracts, not samples.
- Optional dual‑write / CDC during transition.

### Phase F · Extract & cutover (E‑steps)
- **Strangler fig** with a routing facade / anti‑corruption layer in front of legacy entry points.
- Per entry point: `shadow` (new runs, results compared, legacy authoritative) → `canary`
  (a share of traffic authoritative on new) → `primary` → legacy decommission.
- V10 parallel run with **business reconciliation** (balances, GL postings, statement totals) for N
  consecutive business cycles, including month‑end and year‑end runs.
- Extract a module into its own service only when its ADR driver applies. Contracts (V8) are created
  *before* extraction from the in‑process module API.

---

## 5. Technology independence: the Pack interface

The core depends only on these interfaces. A new technology is a Pack, not a core change.

```python
class SourcePack(Protocol):
    id: str                                        # "cobol-zos", "java8", "php5"
    def detect(self, root: Path) -> Confidence: ...
    def parse(self, root: Path) -> GraphFragment: ...          # deterministic → CKG nodes/edges
    def entry_points(self, g: Graph) -> list[EntryPoint]: ...
    def build(self, ws: Workspace) -> BuildResult: ...         # may be "unbuildable" (honest)
    def run_unit(self, unit: UnitRef, inputs: InputSet) -> Outputs: ...  # isolated execution
    def record_io(self, entry: EntryPoint) -> Recorder: ...    # capture for oracles
    def input_generators(self, unit: UnitRef) -> list[Generator]: ...   # PIC/schema‑aware

class TargetPack(Protocol):
    id: str                                        # "java21-spring3", "dotnet8", "py312-fastapi"
    def scaffold(self, layout: ModuleLayout) -> Patch: ...
    def build(self, ws: Workspace) -> BuildResult: ...
    def test(self, ws: Workspace, selector: str) -> TestResults: ...    # parses runner result files
    def arch_rules(self, adrs: list[ADR]) -> ArchTestSuite: ...
    def mutation(self, ws: Workspace, scope: str) -> MutationReport: ...
    def recipes(self) -> list[Recipe]: ...                     # deterministic transforms
    def antistub_patterns(self) -> list[Pattern]: ...

class BridgePack(Protocol):
    source: str; target: str
    porting_guide: Path                            # reviewed idiom/mapping guide (Bun's PORTING.md)
    type_map: TypeMap                              # e.g. PIC → BigDecimal with rounding
    normalizers: list[Normalizer]                  # for differential comparison
    deterministic_translators: list[Recipe]        # optional (e.g. structuring passes)

class DataPack(Protocol):
    def extract(self, store: DataStoreRef) -> Dataset: ...
    def canonicalize(self, record: bytes, layout: Layout) -> dict: ...  # EBCDIC, COMP‑3, REDEFINES
    def reconcile(self, a: Dataset, b: Dataset, policy: ReconPolicy) -> ReconReport: ...
```

**Initial Pack backlog (priority order):**

| Pack | Purpose | Underlying tools (examples) |
|---|---|---|
| `cobol-zos` (source) | COBOL + copybooks + JCL + CICS/BMS parsing; GnuCOBOL execution | ProLeap / Koopa / tree‑sitter‑cobol, GnuCOBOL |
| `java-legacy` (source) | Java 6–11, EJB, Struts | JavaParser / tree‑sitter, Maven/Gradle |
| `java21-spring3` (target) | Spring Boot 3, Spring Modulith, Spring Batch | OpenRewrite, ArchUnit, PIT, JUnit |
| `cobol→java` (bridge) | Porting guide, type map, normalizers | Pack‑authored and reviewed |
| `java8→21` (bridge) | Uplift delta catalog | OpenRewrite recipes |
| `vsam-db2` (data) | Copybook‑driven decoding, DB2 extracts, reconciliation | custom + Python decimal |
| `postgres` (data) | Target load/compare | psycopg, checksums |
| later | `php`, `dotnet`, `pli`, `rpg`, `perl`, `python2→3`, `angularjs→react` | Rector, .NET Upgrade Assistant, pyupgrade, … |

> **Pack quality gate:** a Pack is "certified" only after it passes a **reference pilot** (see §9)
> with V0–V6 PROVEN. Its porting guide must also be adversarially reviewed.

---

## 6. Agent roles

| Role | Model tier | Reads | Writes | Notes |
|---|---|---|---|---|
| `intake` | frontier | user answers | `INTENT.md`, `PREFLIGHT.md` | Five preflight questions, Anthropic style |
| `graph-builder` | none (deterministic) | source | CKG | Packs only |
| `legacy-analyst` | mid | CKG slices | summaries on graph nodes | Bottom‑up enrichment |
| `rule-extractor` | mid (fan‑out) | CKG slices | rule cards | 50–200 parallel on large estates |
| `rule-verifier` | frontier, different from extractor | rule card + citations | verdict | Adversarial |
| `oracle-engineer` | frontier | rules, legacy, recorders | characterization / property / fuzz suites, dev/held‑out split | **Never implements code** |
| `architecture-critic` | frontier | CKG, traces, clusters | options + scores, draft ADRs | Human signs |
| `programme-planner` / `module-planner` | frontier | ADRs, CKG | work units, design decisions | Owns decisions exclusively |
| `worker` (translator / restructurer / migrator / scaffolder) | mid / cheap | work unit bundle | only `target_scope` | Calls recipes first |
| `reviewer-A/B/C` | mixed vendors/tiers | diff / spec+output / transcript | findings | Bug‑hunting only |
| `fixer` | mid | findings | `target_scope` | |
| `judge` | frontier | held‑out oracle results | pass/fail | No code writes |
| `merge-agent` | mid | conflicting branches | merge commits | Neutral |
| `field-guide-curator` | cheap | surprises | `field-guide/index.md` | Line budget |
| `verifier` | script + frontier for narrative | evidence ledger | `VERIFICATION.md`, verdicts | Fresh session |
| `security-auditor` | frontier | modernized code | findings + patch | Human applies |

---

## 7. Artifacts & workspace layout

```
<programme>/
├── INTENT.md · PREFLIGHT.md · PROGRAMME.yaml          # scope, DAG, policies, budgets
├── legacy/<system>/            → symlink, read‑only
├── analysis/
│   ├── ckg.sqlite · ckg.json   # knowledge graph (+ HTML explorer)
│   ├── crud-matrix.csv · traces/
│   ├── rules/BR-*.yaml · BUSINESS_RULES.md
│   ├── decomposition/options.md · ADR-*.md
│   └── ASSESSMENT.md · REPORT.html
├── oracles/
│   ├── recorded/ · characterization/ · generated/ · heldout/   # heldout: judge‑only perms
│   └── normalizers/ · comparators/ · deltas/DELTA-*.yaml
├── work/WU-*.yaml              # unit contracts + state + cost
├── field-guide/index.md
├── modernized/<target>/        # the new system
├── evidence/<module>/<rung>/…  # raw runner outputs, recon reports, diffs (immutable, hashed)
├── VERIFICATION.md · CUTOVER.md
└── .rig/ (costs.jsonl, events.jsonl, telemetry)
```

**Evidence ledger:** each evidence file is content‑hashed and linked to `(module, rung, commit,
oracle version)`. The verdict engine recomputes from the ledger only. A verdict citing a stale
commit is invalid.

---

## 8. Human gates

1. **Intent & preflight** (scope, off‑limits areas, execution environments, data handling).
2. **Rule confirmation** for P0/P1 rules (disputed rules block dependent units).
3. **Target architecture ADRs** (module list, data ownership, which modules become services, and why).
4. **Delta Register** approvals (every intended behaviour change).
5. **Pack porting guide** approval (one‑off per language pair, revisited when the Field Guide promotes items).
6. **Accepting any residual difference** found by the proof plane.
7. **Signing verification** per module and **cutover go/no‑go** per entry point.
8. **Security patch application**.

Design the UI around **reviewer throughput** (Google's finding that review is the bottleneck): small
diffs, evidence attached, rule links, and "auto‑approve when policy satisfied" for low‑risk units.

---

## 9. Economics & observability

- **Model tiering per role** (§6). Track `$ / work unit`, `$ / KLOC migrated`, `$ / rule proven`, and the
  split between planner, worker, and reviewer spend. Cursor's data says workers dominate tokens and
  planners dominate cost per token. Optimise both.
- **Budgets** per unit, module, and programme, enforced by the control plane. Exceeding a budget
  escalates instead of continuing to spend.
- **Caching:** stable prefixes (Pack guide, Field Guide, ADRs) at the start of prompts, so prompt
  caching applies. Bun's 72B cached‑read tokens show how much this matters.
- **Dashboards:** programme burn‑down by rung; verdict heat map (module × rung); spiral monitors;
  review queue latency; Field Guide growth; cost per role.

---

## 10. Security & safety (non‑negotiable)

- Legacy source is **untrusted data**. Instructions found in code, comments, or READMEs are listed and never obeyed.
- Legacy is **read‑only** and integrity‑hashed.
- Sandboxed execution. **Production systems and real data are off‑limits** unless the approved plan
  names them. Recorded production data is masked or tokenised before entering `oracles/`.
- Secrets discovered are masked in artifacts and stored in a gitignored local file.
- The harness never commits or pushes on the user's behalf outside the programme's own branch policy.
- Resource isolation for heavy tests (cgroups/containers with disk and IOPS quotas). Bun crashed hosts
  without this.

---

## 11. Implementation plan

**Harness technology:** Python 3.12+ core (matches this repo), packaged as a CLI (`rig`) plus a
**Claude Code plugin** front end (slash commands mirroring the lifecycle). Agent execution goes
through an **Agent Runtime Adapter**, with Claude Agent SDK first and others pluggable. State lives in files
plus SQLite. No server is needed for v1.

| Milestone | Scope | Exit criterion |
|---|---|---|
| **M0 · Skeleton** (2 wks) | CLI, workspace layout, work‑unit state machine, agent adapter, budgets, events log | Run a no‑op programme end‑to‑end; resumable |
| **M1 · Understand** (3 wks) | `cobol-zos` + `java-legacy` source packs → CKG, CRUD matrix, rule extraction + verifier, HTML report | AWS CardDemo fully graphed; ≥ 90% of human‑sampled rule cards judged correct |
| **M2 · Proof core** (3 wks) | V0–V6 rungs, evidence ledger, verdict engine, dev/held‑out split, normalizers, GnuCOBOL runner | Differential harness proves a hand‑ported CardDemo batch program; canaries detected |
| **M3 · Translate** (4 wks) | Change plane loop (implement / 3 reviewers / fixer / judge), merge agent, Field Guide, anti‑stub, spiral monitors; `cobol→java` bridge pack | CardDemo batch programs translated, V0–V6 PROVEN |
| **M4 · Uplift** (2 wks) | `java8→21` bridge with OpenRewrite | Spring PetClinic 2.x→3.x and a Java 8 app PROVEN (comparable to plugin results) |
| **M5 · Restructure** (4 wks) | Decomposition analysis (clustering + options + critic), ADR flow, arch tests, Delta Register + comparators | CardDemo as a modular monolith with enforced boundaries; deltas proven |
| **M6 · Data & cutover** (4 wks) | V7 reconciliation (VSAM → Postgres), V8 contracts, V9 perf baseline, V10 shadow/replay facade | One CardDemo entry point running in shadow mode with daily reconciliation |
| **M7 · Hardening** | Portfolio assessment, more packs (PHP, .NET, PL/I), dashboard | Second technology pair certified without core changes (**technology‑independence test**) |

**Reference pilots** (public, comparable with Anthropic's published runs):
AWS CardDemo (COBOL/CICS/VSAM → Java), Spring PetClinic (uplift), JPetStore (Java → REST + modules),
osCommerce (PHP → Python) for the independence test.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Legacy can't be executed, so weak oracles | Harvest recordings early (Phase A); PARTLY_PROVEN status is explicit; V10 is mandatory before cutover |
| Agents overfit or cheat (stubs, skipped tests) | Held‑out oracles, mutation testing, anti‑stub scanner, transcript reviewer, manual sampling |
| Decomposition is wrong | Two alternatives + critic + human ADR; modular monolith first so boundaries can move cheaply |
| Numeric/encoding subtleties (COMP‑3, rounding, collation, sort order) | Bridge‑pack type map, PIC‑aware generators, dedicated normalizers, Field Guide promotion |
| Swarm spirals / cost blowout | Spiral monitors, budgets, ownership index, merge agent, megafile guard |
| Review bottleneck | Small units, evidence‑first review UI, policy auto‑approval |
| Vendor/model lock‑in | Agent Runtime Adapter; model tier config per role |
| Untrusted legacy content (prompt injection) | Data‑not‑instructions handling, sandboxing, planted‑instruction listing |

---

## 13. Decisions needed from you

1. **First target pair:** COBOL→Java/Spring (higher value, harder oracle) or Java 8→21 (faster win)?
   *Recommendation: build M2's proof core against COBOL CardDemo first, because it forces the hardest
   oracle problems early. Use the Java uplift as a quick secondary validation.*
2. **Delivery shape:** standalone `rig` CLI + Claude Code plugin (recommended) vs. plugin‑only.
3. **Do you want to build on top of the Anthropic plugin** (reuse its artifacts and commands for
   Understand/Verify and add RIG's Restructure, Delta, and Cutover layers) or build independently but
   compatible with its artifact formats? *Recommendation: compatible formats, independent core.* Its
   commands are Claude Code‑specific, and RIG's core should not be.
4. **Execution environments available:** GnuCOBOL only, or access to a mainframe test LPAR /
   recorded production data? This sets the realistic maximum verdict for COBOL modules.

---

## Sources

- Anthropic, *code-modernization plugin README* — https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-modernization/README.md
- Bun, *Rewriting Bun in Rust* — https://bun.com/blog/bun-in-rust
- Cursor, *Agent swarm model economics* — https://cursor.com/blog/agent-swarm-model-economics
- AWS, *Reimagine your mainframe applications with agentic AI and AWS Transform* — https://aws.amazon.com/blogs/migration-and-modernization/reimagine-your-mainframe-applications-with-agentic-ai-and-aws-transform
- AWS, *AWS Transform generally available* — https://aws.amazon.com/blogs/migration-and-modernization/aws-transform-generally-available
- Google Cloud, *Mainframe Modernization (MAT, Code Rewrite, Dual Run)* — https://cloud.google.com/solutions/mainframe-modernization · https://docs.cloud.google.com/mainframe-assessment-tool/docs/mainframe-modernization-overview
- IBM Research, *Automated Testing of COBOL to Java Transformation* (arXiv 2504.10548) — https://arxiv.org/abs/2504.10548v1
- IBM, *watsonx Code Assistant for Z* — https://futurumgroup.com/insights/watsonx-code-assistant-for-z-the-next-evolution-in-cobol-modernization
- IBM, *Mono2Micro* (arXiv 2107.09698) — https://ar5iv.labs.arxiv.org/html/2107.09698 · https://developer.ibm.com/learningpaths/intro-ibm-mono2micro/introducing-mono2micro
- vFunction — https://devops.com/vfunction-adds-real-time-observability-and-genai-tool-to-migration-platform/
- Microsoft, *GitHub Copilot modernization* — https://github.blog/ai-and-ml/github-copilot/how-github-copilot-and-ai-agents-are-saving-legacy-systems/ · https://mc.merill.net/message/AZ564431
- Moderne / OpenRewrite — https://sdtimes.com/?p=59035
- Thoughtworks / Martin Fowler, *Legacy Modernization meets GenAI* (CodeConcise) — https://martinfowler.com/articles/legacy-modernization-gen-ai.html
- Google, *How is Google using AI for internal code migrations?* (arXiv 2501.06972) — https://arxiv.org/pdf/2501.06972 · *Migrating Code At Scale With LLMs At Google* (arXiv 2504.09691) — https://arxiv.org/pdf/2504.09691
- Airbnb, *Accelerating Large-Scale Test Migration with LLMs* — https://www.infoq.com/news/2025/03/airbnb-llm-test-migration/
- AWS Prescriptive Guidance, *EBCDIC/packed data conversion* — https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/convert-and-unpack-data-from-ebcdic-to-ascii.html
- Microsoft, *Modernize mainframe and midrange data* — https://learn.microsoft.com/en-us/azure/architecture/example-scenario/mainframe/modernize-mainframe-data-to-azure

*Caveat: several vendor figures (AWS accuracy claims, vFunction speed‑ups, CodeConcise 6→2 weeks)
come from secondary or vendor sources and have not been independently verified.*
