---
name: cobol-to-java
description: The RIG COBOL-to-Java bridge — porting guide, PIC/USAGE type map, rounding and truncation rules, file-status and DISPLAY semantics, and the hazard catalog with its generators. Load before a worker, fixer or reviewer touches a translate (T) unit from COBOL to Java, and before an oracle-engineer writes hazard generators for COBOL.
---

# COBOL to Java bridge

A translate unit preserves the observation surface exactly (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §2). This means
the behaviour a consumer sees: bytes, order, counts, return codes, abends, messages. Quirks are preserved, and bugs too.
Fixing a bug is a declared delta, never a translation.

Read [references/type-map.md](references/type-map.md) before mapping any data item, and
[references/hazards.md](references/hazards.md) before writing arithmetic, dates, comparisons, sorts, or file handling.

## Rules a worker follows

1. **One job or transaction per unit, laid out by module.** Package `<module>.<program>`. Put each file behind a
   repository interface with an adapter for the legacy format (fixed records, `RECFM`, `LRECL`), so a later data step
   (X) swaps the adapter, not the logic.
2. **Every decimal observable is `BigDecimal`** with the scale of its PIC. Never `double`, `float`, or `Math.round`.
   Construct from strings or unscaled longs, never from a double.
3. **Rounding comes from the COBOL clause.** `ROUNDED` → `RoundingMode.HALF_UP` (half away from zero for `BigDecimal`).
   No `ROUNDED` → `RoundingMode.DOWN` (truncation toward zero). Apply it once, when storing into the target, at the
   target's scale. Intermediate results follow the compiler's rules (`ARITH`). When in doubt, keep more digits in the
   intermediate and say so.
4. **High-order truncation.** A result with more integer digits than the target keeps only the low-order digits, unless
   `ON SIZE ERROR` is coded. Then the target is left unchanged and the SIZE ERROR branch runs. Model both, with tests.
5. **Display data is bytes.** A group item is its bytes, in order, including FILLER. `DISPLAY` of a group prints those
   bytes. Zoned decimals carry the sign in the last byte's zone (`{`..`I`, `}`..`R` in EBCDIC form). Packed (COMP-3)
   stores two digits a byte with the sign in the last nibble (C/F positive, D negative). COMP is big-endian binary of
   the PIC's size class, and `TRUNC(STD)` truncates to the PIC digits, not the binary capacity.
6. **File status is behaviour.** Map every operation to the two-byte status the legacy program would see (00, 02, 04,
   10, 21, 22, 23, 30, 35, 37, 39, 41–49, 9x), and keep the program's handling of each, including abends.
7. **Abends are observable.** `CALL 'CEE3ABD' USING code, timing` is a user abend `U<code>`. The job gets no return
   code, `TIMING 0` skips cleanup, and files are not closed. Represent it as the abend observable the oracle uses, never
   as an exception that escapes to the JVM's default handler.
8. **Collation is EBCDIC** wherever order is observable: KSDS key order, `SORT`, `<` and `>` on alphanumerics,
   `START`/`READ NEXT`. In EBCDIC, lower case < upper case < digits, and space (`0x40`) sorts below every letter.
9. **Dates and days.** `ACCEPT FROM DATE` is YYMMDD with a century window. `DAY-OF-WEEK` is 1 = Monday. Java's
   `Calendar` has 1 = Sunday; use `java.time.DayOfWeek.getValue()`, which is 1 = Monday. `FUNCTION CURRENT-DATE` is
   21 characters, with a GMT offset.
10. **REDEFINES are views of the same bytes.** Keep one byte array per redefined area and decode each view from it.
    Never copy one view into a separate field: a write through one view must show through the others.
11. **Cite the legacy line** for every behaviour, in a comment, as `CBACT04C.cbl:464`. A reviewer checks each one.
12. **No stubs.** No method that returns a constant, no empty catch, no `TODO` on an observable path. The anti-stub
    lint and reviewer A look for them.

## What a worker never does

Read `oracles/`, `evidence/`, `obligations/`, or the judge's and reviewers' folders under `work/` (the guard hook
blocks it). Write outside the unit's `target_scope`. Weaken, skip, or delete a test. Change the legacy tree.
