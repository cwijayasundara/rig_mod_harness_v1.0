# Round 3: attacks on the running code

One Opus adversary, 2026-11-06, against commit `9ce6b89` (`rig_proof.ts`, `rig_arch.ts`, `hooks/guard.ts`,
`rig_http.ts`). Each finding is a test that asserts the correct behaviour, so it failed when written. All 12 (16
tests) were rerun by the orchestrator and failed for the stated reason. The tests now live in `tests/proof/round3/` and pass since the fixes; run them with `node --test tests/proof/`.

| id | severity | finding |
|---|---|---|
| R3-01 | high | In executable mode, a missing legacy observation counts as a property-only pass (`rig_proof.ts:489-495`; the set's mode is never checked). 23 of 24 cases uncompared, verdict PROVEN. |
| R3-02 | high | `judge --normalizers` applies normalizers nobody approved or checked (`:1213`; no `approved_by`, no `checkNormalizer`). BAL 100.00 vs 999.99 passes. |
| R3-03 | high | The judge counts calendar events from clocks no runner applied (`:512`); M6 fixed only `shadow()`. `rig_http.ts` never writes `clock_applied`. |
| R3-04 | high | A calendar obligation is discharged by a different case of the same run: `exercises()` (`:1006`) reads run-level `calendar_events`. That discharge unblocks canary. |
| R3-05 | high | The evidence key does not change when `--modern` is a directory or a missing path (`hashFiles` `:626` hashes `<absent>`); `judge.md` invites `--modern target/classes`. Same for a wrong `--legacy-root`. |
| R3-06 | high | Cutover to primary is allowed without the calendar minimum window: `cutover()` passes the caller's `req` to `verdict()`, which checks only the events `req` lists. Empty `observables` makes the obligation check vacuous. |
| R3-07 | medium | A custom comparator printing `"equal": "false"`, or exiting non-zero, passes (`Boolean(r.equal)` at `:425`; exit status ignored). |
| R3-08 | medium | Numbers lose scale and precision before comparison: `load()` parses JSON numbers to doubles, so `1.10` = `1.1` and `9007199254740993` = `9007199254740992`. Canaries cannot see it. |
| R3-09 | high | Guard: absolute paths in Bash pass both the read ban and the write ban (`bashMentions`, `shellWrites`/`isWs` need the name after whitespace, a quote or an operator). |
| R3-10 | high | Guard: a worker's Grep with no path, or at the root, searches `oracles/` and `evidence/` (`pathsOf` gives `[]` or `''`; `glob` never read). |
| R3-11 | high | Guard: `mv` out of `evidence/` (only the destination counts as written) and `rm -rf <protected dir>` (`isWs` needs a `/` after the name) are allowed. |
| R3-12 | medium | `rig_arch --scope` passes when the scope matches no file; prefixes match without a path boundary. |

## Fixes the adversary proposed

- R3-01: a missing legacy file in executable mode is `Bad`; property-only only for recorded mode with no `expected`.
- R3-02: judge and shadow run `checkNormalizer` and refuse unapproved ones; record normalizer ids and hashes in `run.json`.
- R3-03: the shadow rule (`clock_applied` on both sides) in judge; `rig_http.ts` writes `clock_applied` when it wraps the clock.
- R3-04: calendar events per result; test the result's own.
- R3-05: a missing path is `Bad`; a directory expands to every file under it (path and content), sorted; an empty list is `Bad`.
- R3-06: `cutover()` adds `MINIMUM_WINDOW` itself for primary and later; refuses empty `req.observables`.
- R3-07: require exit status 0, a boolean `equal`, and `compared` as a string array.
- R3-08: refuse non-string field values and non-integer return codes.
- R3-09: resolve path-like tokens against `cwd`, then test the workspace-relative path.
- R3-10: for worker and fixer, deny a missing path or a path above a hidden directory; check `glob` joined to `path`.
- R3-11: count `mv` sources as written; match names with `(?:\/|$)`.
- R3-12: a prefix that matches no file is `Bad`; match on a `/` boundary.

## Considered and left out

- Discharge by runs under stale keys: `proof.md` allows "any environment and any later gate unit".
- A worker running `grep -r … .` in Bash: the guard's header admits pattern matching can be evaded.
- Store markers in XML or SQL files: `rig_arch` checks only `.java` (worth a look for Spring Batch XML).
