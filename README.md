# RIG

A Claude Code plugin that modernizes a legacy system of any technology and proves, at every step, that the new system
behaves like the old one. It runs only inside Claude Code: Claude reads the code, builds the analysis and does the
work, and the plugin's commands, agents and skill say how. Claude writes or runs a script only where that makes a
result more reliable. The design is in [docs/PROPOSAL.md](docs/PROPOSAL.md). The plugin follows the shape of
Anthropic's [code-modernization](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization)
plugin.

## Install

```sh
claude --plugin-dir /path/to/rig_mod_harness_v1.0
```

Then, in the folder you work in, type `/rig:start`.

## The path

| Step | Command | What you get |
|---|---|---|
| 0 | `/rig:start [system] [--source <path>]` | Goal, target, and whether the legacy system can run here. Writes `INTENT.md`. |
| 1 | `/rig:preflight <system>` | The constructs in the code, each capability proven by a smoke run (not declared), missing source, and the strongest verdict each job or transaction can reach. |
| 2 | `/rig:map <system>` | Inventory, knowledge graph, every unresolved edge, an observation surface per job and transaction with consumer completeness, and hazard sites. |
| 3 | `/rig:rules <system>` | Business rule cards with citations and full negation domains, each re-checked by a second agent. |
| 4 | `/rig:review <system>` | A person confirms cards, attests consumers, and resolves unresolved edges. |
| any | `/rig:status <system>` | Where you are, what is stale and open, and the next command. |

Later milestones add oracles, the work-unit loop, the judge, verification and cutover (`docs/PROPOSAL.md` §13).

## Two rules

- **Rule A, unknown fails closed.** A dynamic call, a consumer list nobody attested, or a capability nobody ran is
  recorded and treated as the worst case until a person or a trace resolves it.
- **Rule B, evidence records what it exercised.** A check counts for what it reached, not for its name.

Both are spelled out in [skills/rig-method/SKILL.md](skills/rig-method/SKILL.md). Every command loads that skill, and
every artifact format is in [skills/rig-method/references/artifacts.md](skills/rig-method/references/artifacts.md).

## Layout

```
.claude-plugin/plugin.json
commands/        start, preflight, map, rules, review, status
agents/          legacy-analyst, rule-extractor, rule-verifier
skills/rig-method/   the method and the artifact formats
docs/            the proposal and the two interrogation rounds
tests/fixtures/carddemo-mini/   a 52-file slice of AWS CardDemo, with EXPECTED.md
scripts/make-carddemo-mini.sh   rebuilds the fixture from a pinned CardDemo commit
```

## Testing

`tests/fixtures/carddemo-mini` is a small slice of AWS CardDemo (Apache-2.0). It covers batch, CICS, dynamic XCTL,
PROCs, SORT, the internal reader, FTP, DB2, IMS, MQ, Control-M and CA-7, at about 5k lines. To try a command without
spending much:

```sh
mkdir /tmp/rig-try && cd /tmp/rig-try
claude --plugin-dir /path/to/rig_mod_harness_v1.0
> /rig:start carddemo --source /path/to/rig_mod_harness_v1.0/tests/fixtures/carddemo-mini
```

Then compare `analysis/carddemo/` with [tests/fixtures/carddemo-mini/EXPECTED.md](tests/fixtures/carddemo-mini/EXPECTED.md).
That file is the M1 exit check.
