---
description: Build the oracle for a gate unit — cases from recordings, characterization and generators, split into dev and sealed sets by script
argument-hint: <system> <gate-unit> [executable|recorded]
arguments: system gate_unit mode
---

Load the `rig-method` skill and read `references/artifacts.md` and `references/proof.md` first. Needs
`analysis/$system/surfaces/` and `hazards.json` (run `/rig:map` first). `$gate_unit` is `job:NAME` or `tx:NAME`.
Mode comes from `$mode`, else from `INTENT.md` and `PREFLIGHT.md`: executable only if preflight proved, by a smoke run,
that every construct in this gate unit can run here.

Dispatch the `oracle-engineer` agent for steps 1–3. It writes under `oracles/$system/` only. It never sees or writes
`modernized/`.

Harness scripts keep their scratch files under `work/$system/judge/obs/` or `work/$system/tmp/`, never under
`evidence/` (only `rig_proof.ts` writes there, and the guard refuses a command that names it).

## 1 — Classes

List the input classes this gate unit needs, each with a one-line description a worker may see:

- `random`: well-formed records drawn from the record layouts.
- `hazard:<id>` for every hazard in `hazards.json` that sits in this gate unit's programs, with a generator that
  reaches it (ROUNDED: exact results ending in 5 at the first dropped digit; invalid_packed: bad nibbles and signs;
  day_of_week: every weekday; century_window: years on both sides of the pivot; run_mode: every PARM or control-card
  value seen or tested).
- `rule:<BR-id>/negations` for each P0 rule card: every negation it lists.
- `structural`: empty input, one record, duplicate keys, unsorted input, maximum lengths.

Write them as `oracles/$system/sets/<name>.classes.json` (`{class: description}`) and the generator definitions as
`<name>.generators.json` (`{class: definition}`: the rule that produces inputs, never a seed).

## 2 — Cases

Each case is a canonical input with **every** input to the unit: `records` (per DD or file), `params` (PARM, control
cards, SYSIN), `clock` (ISO date-time the run sees), `stores` (snapshot of each store read, by content hash), and
`session` (CICS commarea, or null). Write each to a file and add it:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts case add --ws . --system $system \
  --input <file> --classes <c1,c2> --origin recorded|characterization|hazard|rule_negation|random [--expected <obs>]
```

Executable mode: run legacy on each input to get `expected` (observation format in `references/proof.md`). Recorded
mode: only recorded production I/O has `expected`, and generated inputs have none.

## 3 — Set

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts set build --ws . --system $system --set <name> \
  --gate-unit $gate_unit --mode <mode> --pool @<file of case ids> \
  --required oracles/$system/sets/<name>.classes.json --generators oracles/$system/sets/<name>.generators.json \
  [--exhaustive <classes whose whole input domain is in the pool>] \
  [--class-observables <JSON file: {class: [observable ids the class needs]}>]
```

Give `--class-observables` for a class that is only reached when a particular observable is compared: a start-up
hazard needs `<U>.timing` (runners record `elapsed_ms`), a second-run hazard needs `<U>.repeat` (its cases carry
`repeat`). A case of that class that did not compare it does not count toward the class.

A class is **exhaustive** when every possible input of it is already a case (the one empty file, the four values of a
one-byte flag). Name it with `--exhaustive` and say why in the class description. It is then exempt from the
fresh-input rules, and its cases re-run every time instead. A generator with a small finite domain (a handful of
possible inputs, such as the webjar paths of one page) is exhaustive too: add every input as a case and name the class,
or the fresh-input rule leaves a gap that can never close once the domain is used up.

The script picks the sealed cases by input hash (at least 20 or 25% in executable mode, 25% in recorded mode). Never
choose them, never move one, and never show a sealed case to anyone who works on `modernized/`.

## 4 — Report

Counts per class, dev and sealed sizes, the set hash, and for recorded mode every required class that no recorded
input covers. Those classes become obligations at `/rig:verify`. End with the next step: the build (a later
milestone) or `/rig:judge $system $gate_unit` when a modern implementation exists.
