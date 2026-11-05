"""Calendar-event derivation (PROPOSAL v0.2 §6.6, §4.3 month-length row).

Followed:
  §4.3 Month-length hazard trigger: "Date arithmetic, FUNCTION INTEGER-OF-DATE".
  §6.6 "The hazard catalog's month-length row finds date logic in the graph. The window then requires each
       event that the logic branches on: each month length it distinguishes, quarter end, year end, leap day,
       and any business calendar the code reads, such as holiday tables. A gate unit passes V10 only after
       every required event has occurred in the parallel run with zero unexplained mismatches."
Legacy: CardDemo-style INTCALC gets its date and run type from the JCL PARM (CardDemo's INTCALC.jcl passes
PARM='2022071800'). The scheduler (Control-M calendar, not in the graph) submits PARM 'ME' on month-end.
"""
import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN

COBOL = """
       LINKAGE SECTION.
       01  EXTERNAL-PARMS.
           05  PARM-LENGTH         PIC S9(04) COMP.
           05  PARM-DATE           PIC X(10).
           05  PARM-RUN-TYPE       PIC X(02).
       PROCEDURE DIVISION USING EXTERNAL-PARMS.
           PERFORM 1000-ACCRUE-DAILY
           IF PARM-RUN-TYPE = 'ME'
              PERFORM 1300-CAPITALISE-INTEREST
           END-IF
"""
JCL = "//STEP15 EXEC PGM=CBACT04C,PARM='&RUNDATE.&RUNTYPE'"
TRIGGERS = [r"FUNCTION\s+INTEGER-OF-DATE", r"FUNCTION\s+DATE-OF-INTEGER", r"FUNCTION\s+INTEGER-OF-DAY",
            r"CURRENT-DATE", r"ACCEPT\s+\S+\s+FROM\s+(DATE|DAY)", r"HOLIDAY", r"DAYS-IN-MONTH"]
hits = [t for t in TRIGGERS if re.search(t, COBOL + JCL)]
required = set() if not hits else {"month_end_30", "month_end_31", "quarter_end", "year_end"}
print(f"month-length triggers found in graph: {hits} -> required calendar events: {sorted(required) or '{}'}")

def legacy(acc, run):   # capitalise accrued interest into the balance on month-end, ROUNDED = half away from zero
    bal, accrued = acc
    if run == "ME": return (bal + accrued.quantize(Decimal("0.01"), ROUND_HALF_UP), Decimal("0"))
    return acc
def modern(acc, run):   # port bug: capitalisation path truncates instead of ROUNDED
    bal, accrued = acc
    if run == "ME": return (bal + accrued.quantize(Decimal("0.01"), ROUND_DOWN), Decimal("0"))
    return acc

d, seen = date(2026, 11, 9), set()
acc = (Decimal("5000.00"), Decimal("101.2350"))
while True:
    run = "ME" if (d + timedelta(days=1)).month != d.month else "DY"       # scheduler, outside the graph
    ok = legacy(acc, run) == modern(acc, run)
    if required <= seen and ok:
        print(f"{d} run={run} parallel run match -> all required events seen -> V10 PROVEN, cutover allowed")
        break
    d += timedelta(days=1)
me = date(2026, 11, 30)
print(f"{me} run=ME  legacy={legacy(acc, 'ME')[0]}  modern={modern(acc, 'ME')[0]}")
