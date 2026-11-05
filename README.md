# RIG

A Claude Code plugin that modernizes a legacy system of any technology and proves, at every step, that the new system
behaves like the old one. It runs only inside Claude Code: Claude reads the code, builds the analysis and does the
work, and the plugin's commands, agents and skill say how. Claude writes or runs a script only where that makes a
result more reliable. The design is in [plugins/rig/docs/PROPOSAL.md](plugins/rig/docs/PROPOSAL.md). The plugin follows the shape of
Anthropic's [code-modernization](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization)
plugin.

## Install

```sh
claude --plugin-dir /path/to/rig_mod_harness_v1.0/plugins/rig
```

or add this repo as a marketplace (`/plugin marketplace add /path/to/rig_mod_harness_v1.0`) and `/plugin install rig@rig-local`. Then, in the folder you work in, type `/rig:start`.

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
| any | `/rig:status <system>` | Where you are, what is stale and open, and the next command. |

Later milestones add the work-unit loop (translate, review, merge), restructuring, data and cutover (`plugins/rig/docs/PROPOSAL.md` §13).

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
  commands/       start, preflight, map, rules, review, oracles, judge, verify, status
  agents/         legacy-analyst, rule-extractor, rule-verifier, oracle-engineer, judge
  scripts/rig_proof.py   the proof core: cases, sets, judge, keys, comparator checks, verdicts
  skills/rig-method/   the method and the artifact formats
  docs/           the proposal and the two interrogation rounds
tests/fixtures/carddemo-mini/              a 51-file slice of AWS CardDemo (code only)
tests/fixtures/carddemo-mini.EXPECTED.md   the M1 exit check, kept outside the code tree
tests/check_map.py                         scores a /rig:map run against EXPECTED.md
tests/proof/                               regression tests for rig_proof.py, one per interrogation root cause
tests/repros/                              the interrogation repro scripts (round 1 and round 2)
tests/runs/                                run workspaces and results (git-ignored; delete to clean up)
scripts/make-carddemo-mini.sh              rebuilds the fixture from a pinned CardDemo commit
```

The plugin sits in a subfolder because Claude Code protects a loaded plugin's own folder from edits, so a test run
workspace inside it could not write its results.

## Testing

```sh
python3 -m unittest discover -s tests/proof -v     # the proof core, no tokens spent
```


`tests/fixtures/carddemo-mini` is a small slice of AWS CardDemo (Apache-2.0). It covers batch, CICS, dynamic XCTL,
PROCs, SORT, the internal reader, FTP, DB2, IMS, MQ, Control-M and CA-7, at about 5k lines. To try a command without
spending much:

```sh
R=tests/runs/$(date +%F)-map && mkdir -p $R/legacy && ln -s ../../../fixtures/carddemo-mini $R/legacy/carddemo
cd $R && claude --plugin-dir ../../../plugins/rig
> /rig:map carddemo
cd ../../.. && python3 tests/check_map.py $R/analysis/carddemo
```

The check compares the run with [tests/fixtures/carddemo-mini.EXPECTED.md](tests/fixtures/carddemo-mini.EXPECTED.md),
the M1 exit check.
