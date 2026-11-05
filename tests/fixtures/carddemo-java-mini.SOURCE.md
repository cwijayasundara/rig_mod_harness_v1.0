# carddemo-java-mini

The M5 (restructure) fixture: a small Java monolith of two [AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git)
batch jobs, READCUST (CBCUS01C) and INTCALC (CBACT04C), as RIG translated them in the M3 exit run
(`tests/runs/2026-11-05-m3-exit/modernized/`). The builder flattens both into one package `carddemo`, renames the two
`Main` classes (`Cbcus01c`, `Intcalc`), drops the worker's `SelfCheck`, adds one entry point `carddemo.Main <JOB>`, and
copies the M3 dev-case inputs as seeds (no expected outputs: for a restructure the monolith itself is the reference).
Apache-2.0, see LICENSE and NOTICE. Rebuild with `node scripts/make-carddemo-java-mini.ts`, which needs the local M3
run folder (`tests/runs/` is not committed).

What a good M5 run should find (the answer key; never copy it into a run's workspace):

- Two business modules (customer reading, interest calculation) and one shared module at most. READCUST and INTCALC
  share no store and no class, so the business and data partitions should agree.
- Stores: CUSTFILE owned by the customer module; ACCTFILE, TCATBALF, XREFFILE, DISCGRP and TRANSACT by the interest
  module. No store conflict.
- No shared code is actually used by both jobs: `Zoned`, `FixedFiles`, `Sysout`, `Abend`, `Repositories` are used only
  by INTCALC. A `shared` module holding them is a choice to question, not a finding.
- Restructure hazards: `System.exit` in both job entry points (R-EXIT); `Main` dispatches by job name (entry module).
- With no visible change required, the ADR declares no delta.
