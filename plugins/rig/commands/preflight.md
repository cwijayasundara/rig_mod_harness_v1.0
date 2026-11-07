---
description: Check what this environment can prove — constructs in the code, capabilities proven by a smoke run, missing source
argument-hint: <system>
arguments: system
---

Load the `rig-method` skill first. Produce one complete readiness report for `legacy/$system`. Run every check even
when an early one fails. Write only `analysis/$system/PREFLIGHT.md`.

## Check 1 — Constructs in the code (a sweep, not a sample)

List every construct that execution would need, with a count and up to three `path:line` examples each. Sweep with
`grep -rn` over the whole tree, then confirm by reading. For a mainframe system look at least for: batch COBOL, CICS
commands (and which: `XCTL`, `LINK`, `READ`, `SEND MAP`, `WRITEQ TD`, `START`), BMS maps, DB2 `EXEC SQL` (static and
dynamic: `PREPARE`, `EXECUTE IMMEDIATE`), IMS DL/I (`EXEC DLI`, `CALL 'CBLTDLI'`), MQ (`CALL 'MQ*'`), VSAM
organizations, JCL utilities by `PGM=` (SORT, IDCAMS, IEBGENER, IEFBR14, FTP, IKJEFT01, DFSRRC00, others), GDGs, the
internal reader (`SYSOUT=(*,INTRDR)` and CICS extrapartition queues to it), and scheduler definitions (Control-M,
CA-7, TWS).

## Check 2 — Capabilities, proven by running them (Rule A)

For each construct, say which environment could execute it here and **prove it with a smoke run**: compile and run one
small real unit that uses it (for example `cobc -x` on one batch program with a sequential file). Record the exact
command, its output, and the tool versions. A construct whose smoke run did not pass, or that nothing here can run
(CICS, BMS, IMS, DB2 and MQ without a test region), is a **gap**: write it as a gap, never as supported. A declared
capability that did not run is a gap.

Then write a **Pack versions** block: one JSON object that every evidence key of this system uses as `--packs`. It names
the RIG plugin version (`.claude-plugin/plugin.json`), each bridge skill the system will use, and each toolchain a smoke
run used, with the version that smoke run printed, for example
`{"rig": "0.1.0", "cobol-to-java": "rig 0.1.0", "gnucobol": "3.2.0", "openjdk": "21.0.13", "maven": "3.9.9"}`. Rerun
preflight when a version changes: the keys change with it.

Every tool that builds or runs either side, or produces what is compared, belongs in the block, not only compilers:
build tools (`maven`, `gradle`), the runtime that runs the runners and RIG's scripts (`node`), and anything that wraps
a run (`libfaketime` for a held clock). A version change in any of them can change an observation, so a key that
leaves one out can carry evidence over a change nobody checked. Leave out tools that touch neither side's output, such
as an editor or `git`. If a tool is first used after preflight (a later unit adds Maven, say), rerun this check: never
add a version to the block that no smoke run printed.

From the gaps, state per gate unit (each job, each transaction) the strongest verdict it can reach: executable mode
(PROVEN possible) or recorded mode (PROVISIONAL at best), and why.

## Check 3 — Source completeness

Referenced but missing: copybooks (split IBM-supplied ones such as `DFHAID`, `DFHBMSCA`, `SQLCA`, `CMQ*` from
application ones), programs run by JCL or called but absent, PROCs, control-card members, DCLGEN members. Count them
and list each with the `path:line` that references it. Each one becomes a `missing_*` entry in `unresolved.json` when
`/rig:map` runs.

## Check 4 — The reference environment's differences from production

For a COBOL system: compiler options that change results (`TRUNC`, `NUMPROC`, `ARITH`), collation (EBCDIC versus
ASCII), the code page, and how invalid packed data behaves (z/OS abends S0C7; GnuCOBOL may not). Each difference caps
the affected observables at PROVISIONAL and becomes an obligation later (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §6.8). Say "unknown" where
you cannot find out, and list who could answer.

## Check 5 — Is the legacy tree protected?

Read-only: look in `.claude/settings.json`, `.claude/settings.local.json` and the user settings for an `Edit` deny rule
covering `legacy/**` (and the real target of a symlink). Report ✅ or ⚠️ with the snippet
`{ "permissions": { "deny": ["Edit(/legacy/**)"] } }`. Never edit a settings file.

## Report

`PREFLIGHT.md`: a table of checks (✅ / ⚠️ / ❌, what was found, the fix), the construct-by-capability matrix with smoke
results, the per-gate-unit strongest verdict, and the open items for a person. Print the table and end with the next
step: `/rig:map $system`.
