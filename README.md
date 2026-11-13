# RIG

A Claude Code plugin that modernizes a legacy system of any technology and proves, at every step, that the new system
behaves like the old one. It runs only inside Claude Code: Claude reads the code, builds the analysis and does the
work, and the plugin's commands, agents and skill say how. Claude writes or runs a script only where that makes a
result more reliable. The design is in [plugins/rig/docs/PROPOSAL.md](plugins/rig/docs/PROPOSAL.md). The plugin follows the shape of
Anthropic's [code-modernization](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization)
plugin.

It covers like-for-like ports (COBOL to Java, Java 8 to 21, Spring Boot 2.7 to 3), restructuring into a modular
monolith, data re-platforming, and a staged cutover (shadow, canary, primary, decommission).

## Status

Plugin version 0.1.0, built to proposal v0.3. Milestones M0 to M7 are built and have been run end to end on the two
fixtures in this repo: CardDemo-mini (COBOL batch and CICS to Java and to Spring Boot / Spring Batch) and Spring
PetClinic 2.7 (uplift to Boot 3 and Java 21). The verdicts on those runs are honest about their gaps: rungs pass every
case but stay `NOT_PROVEN` where a hazard was not reached or an obligation is still open for a person to decide. This
is research software, not a supported product.

## Requirements

- [Claude Code](https://claude.com/claude-code).
- Node 24 or later. The scripts are TypeScript run directly by `node`; there are no npm dependencies and nothing to
  build.
- The tools each side needs to build and run, for example GnuCOBOL (`cobc`), a JDK and Maven. RIG does not assume
  them: `/rig:preflight` proves each one with a smoke run and records what is missing.

## Install

```sh
git clone https://github.com/cwijayasundara/rig_mod_harness_v1.0.git
claude --plugin-dir /path/to/rig_mod_harness_v1.0/plugins/rig
```

or add this repo as a marketplace (`/plugin marketplace add /path/to/rig_mod_harness_v1.0`) and `/plugin install rig@rig-local`. Then, in the folder you work in, put the legacy code under `legacy/<system>/` (read-only to RIG) and type `/rig:start`.

## The path

| Step | Command | What you get |
|---|---|---|
| 0 | `/rig:start [system] [--source <path>]` | Goal, target, and whether the legacy system can run here. Writes `INTENT.md`. |
| 1 | `/rig:preflight <system>` | The constructs in the code, each capability proven by a smoke run (not declared), missing source, and the strongest verdict each job or transaction can reach. |
| 2 | `/rig:map <system>` | Inventory, knowledge graph, every unresolved edge, an observation surface per job and transaction with consumer completeness, and hazard sites. |
| 3 | `/rig:rules <system>` | Business rule cards with citations and full negation domains, each re-checked by a second agent. |
| 4 | `/rig:review <system>` | A person confirms cards, attests consumers, and resolves unresolved edges. |
| 5 | `/rig:oracles <system> <gate-unit>` | Input classes per hazard and rule, content-addressed cases, and dev and sealed sets split by script. |
| 6 | `/rig:judge <system> <gate-unit> <set>` | One judge run: fresh inputs, both sides, the evidence key, and counts per class only. |
| 7 | `/rig:verify <system> <gate-unit>` | Comparator trust (normalizers, deltas, canary sweep) and the verdict of each rung, computed by script. |
| 7b | `/rig:design <system>` | Restructure only: boundary evidence, two candidate partitions, a critic's scorecard, and a draft ADR and `MODULES.json` for a person to sign (`/rig:review <system> adrs`). |
| 8 | `/rig:plan <system> translate` | Work units: one per job or transaction, with scope, oracle, mode, budget and order. |
| 9 | `/rig:unit <system> <WU>` | The unit loop: brief, implement, self-check, reviews A, B and C, fix, judge, then merge, retry or escalate. |
| 10 | `/rig:shadow <system> <gate-unit> [stage]` | Traffic through both sides, compared by script (V10), with calendar coverage, timing (V9) and obligations in `CUTOVER.md`. |
| 11 | `/rig:cutover <system> <gate-unit> <stage>` | Whether the entry point may move to shadow, canary, primary or decommission; a person gives each go in `/rig:review <system> cutover`. |
| any | `/rig:status <system>` | Where you are, what is stale and open, and the next command. |

Data re-platforming (X units) uses the `store-replatform` skill (`plugins/rig/docs/PROPOSAL.md` §13).

## Models

Each agent names its model, following the model tiers in the proposal (§9). The session that runs a command uses
whatever model you chose.

| Agent | Model | Why |
|---|---|---|
| `legacy-analyst` | sonnet | reading and classifying sites at volume |
| `rule-extractor` | sonnet | volume work, and a different model from the verifier |
| `rule-verifier` | opus | an independent second opinion on another model |
| `oracle-engineer` | opus | the oracle decides what the proof can see, so it gets the strongest model |
| `worker`, `fixer` | sonnet | volume implementation; they never see the oracle |
| `reviewer-a`, `-b`, `-c` | opus | evaluators, each with different inputs (diff only, spec and outputs, transcript) |
| `merge` | sonnet | mechanical, and refuses anything outside the unit's scope |
| `version-delta-analyst` | sonnet | sweeps an uplift's breaking changes; the judge decides what they broke |
| `architecture-critic` | opus | an evaluator: scores two partitions it did not draw and drafts the ADR; never signs |
| `judge` | opus | an evaluator: it draws the fresh inputs and drives the comparison (`rig_proof.ts` computes the result) |

Evaluating roles run on Opus. Test runs in this repo run the session under test with `claude -p --model sonnet`.
The evaluation of a run is on Opus: `tests/check_map.ts` plus a review of the run's output by an Opus session.

## Two rules

- **Rule A, unknown fails closed.** A dynamic call, a consumer list nobody attested, or a capability nobody ran is
  recorded and treated as the worst case until a person or a trace resolves it.
- **Rule B, evidence records what it exercised.** A check counts for what it reached, not for its name.

Both are spelled out in [plugins/rig/skills/rig-method/SKILL.md](plugins/rig/skills/rig-method/SKILL.md). Every command loads that skill, and
every artifact format is in [plugins/rig/skills/rig-method/references/artifacts.md](plugins/rig/skills/rig-method/references/artifacts.md).

## Layout

```
.claude-plugin/marketplace.json      lists the plugin, so the repo can be added as a marketplace
plugins/rig/                         the plugin (everything Claude Code loads)
  .claude-plugin/plugin.json
  commands/       start, preflight, map, rules, review, oracles, judge, verify, design, plan, unit, shadow,
                  cutover, status
  agents/         legacy-analyst, rule-extractor, rule-verifier, oracle-engineer, judge,
                  worker, fixer, reviewer-a, reviewer-b, reviewer-c, merge, version-delta-analyst,
                  architecture-critic
  hooks/guard.ts  integrity guard: evidence by script only, workers never see oracles, subagents never sign
  scripts/rig_proof.ts   the proof core: cases, sets, judge, keys, comparator checks, verdicts
  scripts/rig_http.ts    the HTTP case runner for web gate units (same command on both sides)
  scripts/rig_arch.ts    architecture tests for a restructure: modules, dependencies, api, store owners, ADR sign-off
  skills/rig-method/   the method and the artifact formats
  skills/cobol-to-java/   the COBOL-to-Java bridge: porting guide, type map, hazard catalog
  skills/cobol-to-spring/   COBOL to Spring Boot / Spring Batch: layout, framework rules, Spring hazard catalog
  skills/java-uplift/     the Java uplift bridge: delta catalog, OpenRewrite recipes, observing web apps
  skills/java-restructure/   the restructure bridge: contract, reference side, MODULES.json and ADR formats, hazards
  skills/store-replatform/   the data bridge: store semantics, probe classes, V7 reconciliation, V8 business day
  docs/           the proposal and the two interrogation rounds
tests/fixtures/carddemo-mini/              a 51-file slice of AWS CardDemo (code only)
tests/fixtures/carddemo-mini.EXPECTED.md   the M1 exit check, kept outside the code tree
tests/fixtures/petclinic-2.7/              Spring PetClinic at its last Boot 2.x commit (the M4 fixture)
tests/check_map.ts                         scores a /rig:map run against EXPECTED.md
tests/proof/                               regression tests for rig_proof.ts, one per interrogation root cause
tests/repros/                              the interrogation repro scripts (round 1 and round 2, historical Python)
tests/runs/                                run workspaces and results (git-ignored; delete to clean up)
scripts/make-carddemo-mini.sh              rebuilds the fixture from a pinned CardDemo commit
scripts/make-petclinic-2.7.sh              rebuilds the PetClinic fixture from its pinned commit
```

The plugin sits in a subfolder because Claude Code protects a loaded plugin's own folder from edits, so a test run
workspace inside it could not write its results.

## Testing

```sh
node --test tests/proof/     # the proof core and the guard hook, 225 tests, no tokens spent
```

`tests/fixtures/carddemo-mini` is a small slice of AWS CardDemo (Apache-2.0). It covers batch, CICS, dynamic XCTL,
PROCs, SORT, the internal reader, FTP, DB2, IMS, MQ, Control-M and CA-7, at about 5k lines. To try a command without
spending much:

```sh
R=tests/runs/$(date +%F)-map && mkdir -p $R/legacy && ln -s ../../../fixtures/carddemo-mini $R/legacy/carddemo
cd $R && claude --plugin-dir ../../../plugins/rig
> /rig:map carddemo
cd ../../.. && node tests/check_map.ts $R/analysis/carddemo
```

The check compares the run with [tests/fixtures/carddemo-mini.EXPECTED.md](tests/fixtures/carddemo-mini.EXPECTED.md),
the M1 exit check.

## Documentation

- [plugins/rig/docs/PROPOSAL.md](plugins/rig/docs/PROPOSAL.md): the design (v0.3), the verification ladder V1 to V10,
  the milestones and their results.
- [INTERROGATION.md](plugins/rig/docs/INTERROGATION.md) and [INTERROGATION-2.md](plugins/rig/docs/INTERROGATION-2.md):
  the two adversarial reviews that shaped v0.2 and v0.3.
- [plugins/rig/skills/rig-method/](plugins/rig/skills/rig-method/): the method every command follows and every artifact format.

## Licences

The repo has no licence file of its own yet. The two fixtures keep their upstream licences: AWS CardDemo and Spring
PetClinic are both Apache-2.0 (see `tests/fixtures/*/LICENSE*` and `tests/fixtures/*.SOURCE.md`).
