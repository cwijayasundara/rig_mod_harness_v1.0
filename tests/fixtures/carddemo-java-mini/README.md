# CardDemo batch monolith

Two CardDemo batch jobs in one Java 21 program, all in one package (`carddemo`).

| Job | Class | Reads | Writes |
|---|---|---|---|
| `READCUST` | `Cbcus01c` | `DD_CUSTFILE` (customer KSDS, 500-byte records) | SYSOUT |
| `INTCALC` | `Intcalc`, `Cbact04c` | `DD_TCATBALF`, `DD_XREFFILE`, `DD_DISCGRP`, `PARM`, `RIG_CLOCK` | `DD_ACCTFILE` (rewrite), `DD_TRANSACT` (new), SYSOUT |

Entry point: `java -cp classes carddemo.Main <JOB>`, with the job's environment. An abend prints `ABEND <n>` on stderr
and exits `n & 0xFF`; non-numeric data in arithmetic prints `ABEND S0C7` and exits 199.

- Build: `./build.sh [source root] [classes dir]` (plain `javac`, `JAVA_HOME` or `/opt/homebrew/opt/openjdk@21`).
- Run one case: `node run.ts <case.json> <observation.json> [--classes DIR]`. The job follows from the case's
  records (`CUSTFILE` means READCUST). The observation is `{return_code, abend, messages, screens, stores}`;
  INTCALC's stores are `ACCTDATA` (the account file after the run) and `SYSTRAN` (the transactions written).
- `seeds/<JOB>/`: inputs with their input classes, no expected outputs.
