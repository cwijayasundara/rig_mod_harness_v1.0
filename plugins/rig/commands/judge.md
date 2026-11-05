---
description: Judge a modern implementation of a gate unit against its oracle — fresh inputs every run, counts per class only
argument-hint: <system> <gate-unit> <set>
arguments: system gate_unit set
---

Load the `rig-method` skill and read `references/proof.md` first. Dispatch the `judge` agent with these steps. It is
the only role that runs the sealed cases. Whatever it returns to a session that edits `modernized/` must be the
script's counts and class descriptions only.

1. **Fresh inputs.** For every required class of the set, draw new inputs with its generator (a new seed each run),
   and add them with `case add`. A class that failed in the last run must have fresh inputs, or the script refuses
   the run. Executable mode: run legacy on them for expected outputs.
2. **Run both sides** on every case of the set plus the fresh ones. Each side runs the whole gate unit, seeded from
   the case's store snapshots, never mixing legacy and modern in one run. Write one observation file per case,
   `<case-id>.json`, to `evidence/$system/.obs/<run>/legacy/` and `.../modern/`.
3. **Evidence key** for the rung (V3 differential, or V4 fresh inputs):
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts key --ws . --system $system --gate-unit $gate_unit --rung V3 \
     --legacy-root legacy/$system --modern <every modern file the job runs: source, the compiled output that actually ran (classes, jars), config, batch XML, migrations, the runner script> \
     --set $set --comparators <approved normalizer and delta files> --packs '{"cobol-zos":"<ver>"}' \
     --environment '{"collation":"EBCDIC","TRUNC":"STD","NUMPROC":"NOPFD","jdk":"21"}'
   ```
4. **Judge**:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rig_proof.ts judge --ws . --system $system --set $set --key <key> \
     --legacy-dir <legacy obs> --modern-dir <modern obs> --fresh <fresh case ids> --env <environment id> \
     [--comparator exact|"<cmd>"] [--normalizers <approved files>]
   ```
5. Delete the observation folders after the run. The run's results and coverage are kept by the script.

Return the script's JSON unchanged: counts per class with descriptions. Never an input, an expected output, a diff or
a case id. A failing sealed case stays sealed. The worker gets new dev cases from the failing class, generated in
executable mode, or the class description only in recorded mode.
