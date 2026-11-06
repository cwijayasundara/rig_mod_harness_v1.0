---
description: Judge a modern implementation of a gate unit against its oracle — fresh inputs every run, counts per class only
argument-hint: <system> <gate-unit> <set>
arguments: system gate_unit set
---

Load the `rig-method` skill and read `references/proof.md` first. Run these steps in the `judge` agent, or in a main
session that will not change `modernized/` afterwards (a driver session; the owner's decision, 2026-11-06). The guard
enforces the order: once a session or agent has run `rig_proof.ts judge` or read the judge's observations or
`evidence/`, it may no longer write `modernized/`. Whatever reaches a session that edits `modernized/` must be the
script's counts and class descriptions only.

1. **Fresh inputs.** For every required class of the set, draw new inputs with its generator (a new seed each run),
   and add them with `case add`. A class that failed in the last run must have fresh inputs, or the script refuses
   the run. Executable mode: run legacy on them for expected outputs.
2. **Run both sides** on every case. The modern runner is the unit's own (`worker.md`: input JSON in, observation
   JSON out), called the same way for every case; the legacy runner is the oracle harness's. Field values are
   strings and return codes integers in every observation (the script refuses others). A case a runner cannot run here
   (for example `rig_http.ts` exit 4 for a clock it cannot apply) has the observation `{"not_run": "<reason>"}`. Keep
   it, never delete the case or the file: the script needs the same reason on both sides, counts the case as
   `not_run`, and the verdict lists it as a gap. Run both sides of the set plus the fresh ones. Each side runs the whole gate unit, seeded from
   the case's store snapshots, never mixing legacy and modern in one run. Write one observation file per case,
   `<case-id>.json`, to `work/$system/judge/obs/<run>/legacy/` and `.../modern/`. `<run>` is unique to this judge run
   and lower case: `<gate-unit slug>-<rung>-<UTC yyyymmddThhmmss>-<6 random hex>`, for example
   `get-owners-ownerid-v3-20261106t081200-a3f9c1`. Never reuse a name or one that differs only in case: macOS folders are
   case-insensitive, and two judges in one folder overwrite each other's observations. This is the judge's scratch folder: the
   guard hides it from the worker and the fixer. Never write under `evidence/`; only the script writes there.
   For an HTTP gate unit, run each side with the plugin's `${CLAUDE_PLUGIN_ROOT}/scripts/rig_http.ts` (see
   `references/proof.md`, "HTTP runner"), never a copy of it: the key names it as `plugin:scripts/rig_http.ts`.
   **Load.** Run one judge at a time on a machine, with at most two application processes (JVMs) running at once; more
   in parallel overloads the host and makes runs time out. A command may run at most 10 minutes: split a side into
   batches of cases, each its own foreground command, rather than backgrounding it.
3. **Evidence key** for the rung (V3 differential, or V4 fresh inputs). `--modern` and `--comparators` are
   comma-separated lists; a directory (`target/classes`) counts as every file under it, and a path that does not exist
   is refused. `--harness` lists the oracle harness files that produced the legacy observations besides the legacy
   code (the legacy runner, loaders, unloaders, probe programs); it is required at V7 and recommended at every rung.
   Paths are relative to the workspace; `plugin:<path>` names a file of the plugin (hashed under that name,
   so the key is the same in every workspace); an absolute path is refused. `--comparators` lists every file that decides equality in this run, and nothing else: the custom
   comparator's script that `--comparator` runs and each local file it imports (the `.ts` that ran, not a twin in
   another language), every approved normalizer and every approved delta passed to the judge. With `--comparator exact`
   and no normalizer or delta it is empty. `--packs` is the "Pack versions" JSON from `PREFLIGHT.md`, copied as it is.
   If `PREFLIGHT.md` has none, stop and say so: never write `unrecorded` or a guess, since such a key compares with nothing.
   Write the exact command next to the key in the unit's log, so `verify` can recompute it:
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
     [--comparator exact|"<cmd>"] [--normalizers <approved files>] [--deltas <approved DELTA files>]
   ```
   A TypeScript comparator is run as a command, and its file goes in the key: the judge gets
   `--comparator "node oracles/$system/comparators/<name>.ts"`, and the key's `--comparators` lists
   `oracles/$system/comparators/<name>.ts` (and each local file it imports).
   It exits 0 when every case was compared and passed, and 1 when a case failed **or** was not run: read `passed`,
   `total` and `not_run` in its JSON, never the exit code alone.
   A restructure unit passes every approved delta its ADR declares (`--deltas`), the same files as in the key's
   `--comparators`. The script refuses a delta nobody approved.
5. Delete `work/$system/judge/obs/<run>/` after the run. The run's results and coverage are kept by the script.

Return the script's JSON unchanged: counts per class with descriptions. Never an input, an expected output, a diff or
a case id. A failing sealed case stays sealed. The worker gets new dev cases from the failing class, generated in
executable mode, or the class description only in recorded mode.
