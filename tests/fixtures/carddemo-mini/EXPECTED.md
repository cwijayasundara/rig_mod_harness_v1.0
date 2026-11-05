# What `/rig:map` must find in carddemo-mini

This is the M1 exit check. Run the plugin on this fixture, then compare `analysis/<system>/` with this list. Every
line is verified against the source (paths are relative to this folder). A miss on any item marked **must** means the
map is wrong, whatever else it got right.

## Unresolved (Rule A): every one must appear in `unresolved.json` with `status: open`

| Site | Kind | Why it stays open |
|---|---|---|
| `app/cbl/COMEN01C.cbl:156` `XCTL PROGRAM(CDEMO-MENU-OPT-PGMNAME(WS-OPTION))` | dynamic_transfer | subscripted table entry chosen at run time. Candidates (review only): the 11 program names in the REDEFINES table, `app/cpy/COMEN02Y.cpy` |
| `app/cbl/COMEN01C.cbl:185` same expression | dynamic_transfer | same |
| `app/cbl/COMEN01C.cbl:202` `XCTL PROGRAM(CDEMO-TO-PROGRAM)` | dynamic_transfer | commarea field, written at `:97` and `:199` and by callers. Candidate `COSGN00C` |
| `app/app-vsam-mq/cbl/CODATE01.cbl:182`, `:216`, `:251` `CALL 'MQOPEN'` | dynamic_queue | object name moved from variables (`:176`, `:210`, `:245`). `INPUT-QUEUE-NAME` comes from the trigger message, `MQOD-OBJECTNAME` is in the missing copybook `CMQODV`. Candidates `CARD.DEMO.REPLY.DATE` (`:147`), `CARD.DEMO.ERROR` (`:243`) |
| `CBTRN03C`, run by `app/proc/REPROC.prc` step `STEP10R` through `app/jcl/TRANREPT.jcl` | missing_source | no source in the tree, so every DD of that step is `accesses_unknown` |
| `MVSWAIT` (`app/cbl/COBSWAIT.cbl:38`), `CEE3ABD` (`app/cbl/CBACT04C.cbl:632`, `app/cbl/CBCUS01C.cbl:158`) | missing_source | system or assembler routines with no source here. Static calls, but the target is unknown |
| copybooks `DFHAID`, `DFHBMSCA` (COSGN00C, COMEN01C), `SQLCA` (COBTUPDT), `CMQGMOV` `CMQPMOV` `CMQMDV` `CMQODV` `CMQV` `CMQTML` (CODATE01) | missing_copybook | IBM-supplied, not in the tree |
| CSD `TDQUEUE(JOBS)`, `TYPE(EXTRA) DDNAME(INREADER)`, `app/csd/CARDDEMO.CSD` | job_submission | an extrapartition queue described as "SUBMIT JOBS FROM CICS". No writer in this fixture, but what it submits is unknown |

## Resolved: must **not** be left open

| Site | Resolution |
|---|---|
| `app/cbl/COSGN00C.cbl:212` `READ DATASET(WS-USRSEC-FILE)` | `constant`: `VALUE 'USRSEC  '` at `:39`, never written → CICS file `USRSEC` → `AWS.M2.CARDDEMO.USRSEC.VSAM.KSDS` (CSD) |
| `app/cbl/COSGN00C.cbl:99` `RETURN TRANSID(WS-TRANID)` | `constant`: `'CC00'` at `:37` (it is only read at `:183`, `:224`) |
| `app/cbl/COMEN01C.cbl:108` `RETURN TRANSID(WS-TRANID)` | `constant`: `'CM00'` at `:37` |
| `app/cbl/COSGN00C.cbl:231`, `:236` `XCTL PROGRAM('COADM01C')`, `('COMEN01C')` | static literals. `COADM01C` is `source: missing` |
| `app/app-authorization-ims-db2-mq/cbl/PAUDBUNL.CBL:213`, `:257` `CALL 'CBLTDLI' USING FUNC-GN` / `FUNC-GNP` | static call. Functions GN and GNP are constants from `IMSFUNCS.cpy`, so these are reads of the IMS database through PSB `PAUTBUNL` |

## Edges that must exist

- `job:INTRDRJ1` step `STEP01` (IEBGENER, `SYSUT2 SYSOUT=(A,INTRDR)`) **submits** `job:INTRDRJ2` (`SYSUT1 DSN=AWS.M2.CARDDEMO.JCL(INTRDRJ2)`).
- `job:FTPJCLS` (member `FTPJCL.JCL`) **transmits** `AWS.M2.CARDEMO.FTP.TEST` to an `external` node for the FTP host. The control cards hold a user and password: they must be masked in every artifact.
- `job:MNTTRDB2` `STEP1` (IKJEFT01) **runs** `program:COBTUPDT` (from `SYSTSIN RUN PROGRAM(COBTUPDT) PLAN(CARDDEMO)`), which **writes** `table:CARDDEMO.TRANSACTION_TYPE` (INSERT, UPDATE, DELETE) and **reads** DD `INPFILE`.
- `job:UNLDPADB` `STEP01` (DFSRRC00, `PARM='DLI,PAUDBUNL,PAUTBUNL,...'`) **runs** `program:PAUDBUNL` with `psb:PAUTBUNL` → `ims_db:DBPAUTP0`.
- `job:TRANREPT` step `STEP05R` **expands** `proc:REPROC`. Its IDCAMS step reads the control member `REPROCT` (`app/ctl/REPROCT.ctl`, `REPRO INFILE(FILEIN) OUTFILE(FILEOUT)`), with `FILEIN` overridden to `AWS.M2.CARDDEMO.TRANSACT.VSAM.KSDS` and `FILEOUT` to the GDG `AWS.M2.CARDDEMO.TRANSACT.BKUP(+1)`.
- The same job's SORT step reads `TRANSACT.BKUP(+1)` and writes `TRANSACT.DALY(+1)`, sorted on `TRAN-CARD-NUM` (ebcdic_collation hazard).
- `job:INTCALC` `STEP15` runs `CBACT04C` with `PARM='2022071800'` (run_mode). CBACT04C opens `ACCOUNT-FILE` I-O (writes `ACCTDATA.VSAM.KSDS`), `TRANSACT-FILE` OUTPUT (writes GDG `SYSTRAN(+1)`), and the rest INPUT.
- `transaction:CC00` **entry** `program:COSGN00C`, `transaction:CM00` **entry** `program:COMEN01C` (CSD). Both send and receive their BMS maps (`COSGN00/COSGN0A`, `COMEN01/COMEN1A`).
- Control-M: `WAITSTEP`, `INTCALC` and `MNTTRDB2` each have a `schedule` node with IN/OUT condition `triggers`. Scheduled jobs with no JCL in the fixture (`CLOSEFIL`, `TRANBKP`, `OPENFIL`, `DISCGRP`, `TRANEXTR`, `COMBTRAN`) are `source: missing`.

## Hazards that must be found

- `truncation`: `app/cbl/CBACT04C.cbl:464` `COMPUTE WS-MONTHLY-INT = (TRAN-CAT-BAL * DIS-INT-RATE) / 1200`, with no ROUNDED.
- `run_mode`: the INTCALC `PARM`, read through `PROCEDURE DIVISION USING EXTERNAL-PARMS` (`app/cbl/CBACT04C.cbl:180`), and COBSWAIT's SYSIN `ACCEPT` (`app/cbl/COBSWAIT.cbl`).
- `century_window`: `app/app-authorization-ims-db2-mq/cbl/PAUDBUNL.CBL` `ACCEPT CURRENT-DATE FROM DATE` and `ACCEPT ... FROM DAY` (two-digit years).
- `ebcdic_collation`: the TRANREPT SORT keys.
- `invalid_packed`: every COMP-3 field in a record read from input. Check the copybooks of each input file.

## Surfaces

- One per job (`INTCALC`, `READCUST`, `WAITSTEP`, `TRANREPT`, `INTRDRJ1`, `INTRDRJ2`, `FTPJCLS`, `MNTTRDB2`, `UNLDPADB`) and per transaction (`CC00`, `CM00`).
- **Every** observable has `consumers.complete: false`, because the fixture has no `attestations.yaml`. A single `complete: true` fails the check.
- `INTCALC`'s surface includes `store_write`, `record_order`, `cardinality` and the fields of `ACCTDATA.VSAM.KSDS` (record `CVACT01Y`) and of the `SYSTRAN` GDG (record `CVTRA05Y`).
