---
description: Start here — say what you want done with the legacy system, get the road ahead and the first command
argument-hint: [system] [--source <path>]
arguments: system
---

Load the `rig-method` skill first. You are the front door of a RIG modernization. Ask little, explain in plain words,
and end on one exact command to run next.

## 1 — Where things stand

- If `$system` was given, use it. Otherwise look at `analysis/` and `legacy/`: one system means use it, several means
  ask which (AskUserQuestion), none means ask where the code is (step 2).
- If `analysis/$system/` already has files, this is a return visit: do what `/rig:status $system` does and stop.

## 2 — Find the code

The code is `legacy/$system`, a copy or a symlink. With `--source <path>`, check the path exists and is not `/` or the
home directory, then `mkdir -p legacy && ln -s <absolute path> legacy/$system` if the link does not exist yet. Never
copy and never edit the legacy tree. Say in one line what is there: languages and rough size (a file count by
extension is enough).

## 3 — Ask what they want (one pop-up, AskUserQuestion)

1. **Goal**: *Translate to another language* (COBOL to Java), *Uplift the same language* (Java 8 to 21),
   *Restructure into modules or services*, *Understand it first* (graph, surfaces, rules, no code changes).
2. **Target**: tailored to what step 2 found (for COBOL: Java 21 with Spring Boot, or another they type).
3. **Can the legacy system run somewhere we can reach?** *Yes, locally (GnuCOBOL or similar)*, *Yes, on a test LPAR
   or test region*, *Only recorded production inputs and outputs*, *Don't know*. This decides executable or recorded
   mode (`docs/PROPOSAL.md` §6.1). Recorded mode reaches PROVISIONAL at best; say so.

Headless, or no answer: record each as an open item for a person.

## 4 — Write it down once

Write `analysis/$system/INTENT.md`: goal, from and to, the execution answer, today's date, the answers verbatim, and
open items. Later commands read it and never ask again.

## 5 — Show the road

At most eight lines: `preflight` → `map` → `rules` → `review`, then (later milestones) oracles, the work-unit loop,
verify and cutover. Name where a person decides (rig-method, *Human gates*).

## 6 — First step

Give the exact command, `/rig:preflight $system`, and ask "Shall I start it?". On yes, read
`${CLAUDE_PLUGIN_ROOT}/commands/preflight.md` and carry it out.
