---
name: java-restructure
description: The RIG bridge for restructuring a Java system into a modular monolith — the restructure contract (surface preserved except declared deltas), the reference side, moving code into modules, architecture tests by script (rig_arch.ts), deltas with obligation mapping, and restructure hazards. Load before designing, planning, implementing, reviewing or judging a restructure (R) unit on Java.
---

# Java restructure bridge

A restructure unit changes the **shape** of the code and nothing else: packages, module boundaries, visibility,
which module owns a store. It never translates, never upgrades a version, and never fixes a bug (Rule 1). Its
contract (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §2): **the observation surface is preserved, except for declared
deltas**. A delta is a change a person approved, written down before the judge runs. A difference no delta declares
is a defect.

Read [references/restructure.md](references/restructure.md) for the formats and the hazard catalog.

## The reference side

The legacy side of an R unit is the tree the restructure **started from**, frozen read-only at `legacy/<system>/`
(for a system that came out of a T step, a copy of the translated tree at its last merge). Every R unit of the step
is judged against that same reference, so the proof chains to it and never to an intermediate state. Both sides run
with the same case runner and the same entry point; only the classes differ. Executable mode always: the reference
runs here.

## The stages, for a restructure unit

1. **Design first.** `/rig:design` writes the options, the scorecard, `MODULES.json` and the ADR; a person signs them
   in `/rig:review <system> adrs`. Nothing is planned until `rig_arch.ts check` shows no `signoff` violation.
2. **Plan.** One unit per module, in dependency order (`shared` first, then the modules that depend on it, the entry
   module last), or one unit for the whole tree when it has fewer than about 30 files. Each unit lists every gate
   unit whose runtime closure contains a file it moves.
3. **Implement.** Move files into the module packages, add `public` only where `MODULES.json` puts the class in the
   module's `api`, and route every access to a store through its owning module. Keep every byte the system writes:
   messages, record layouts, exit codes, file names, environment variables. No other edit, however tempting.
4. **Architecture.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_arch.ts check --ws . --system <s> --root <modern src>
   --scope <the unit's target paths>`. A violation goes back to implement, like a failing dev case.
5. **Deltas.** If the signed ADR requires a visible change (a store renamed, a debug line removed), write it as
   `oracles/<system>/deltas/DELTA-*.json` before the judge runs, map every open obligation on its legacy observables
   (`obligations_map`), and have a person approve it in `/rig:review <system> normalizers`. The judge applies only
   approved deltas (`--deltas`).
6. **Judge** each gate unit, against the reference, with the approved deltas.

A unit merges only when every gate unit's verdict allows it **and** `rig_arch.ts check` passes for its scope.
