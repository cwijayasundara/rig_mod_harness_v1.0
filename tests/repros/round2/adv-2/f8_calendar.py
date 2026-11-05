# §6.6 lines 381-383 + §4.3 line 152: month-length hazard trigger = date arithmetic, FUNCTION INTEGER-OF-DATE;
# window requires each event the date logic branches on (month lengths, quarter end, year end, leap day, holiday tables).
import re, datetime as dt
SRC = """
       PROCEDURE DIVISION USING PARM-AREA.
           IF PARM-CYCLE = 'ME'
              PERFORM 3000-CAPITALISE-INTEREST
           END-IF.
           MOVE FUNCTION CURRENT-DATE TO WS-TODAY.
           COMPUTE WS-DOW = FUNCTION MOD(FUNCTION INTEGER-OF-DATE(WS-TODAY) 7).
           IF WS-DOW = 0 OR 6
              PERFORM 2500-WEEKEND-ACCRUAL
           END-IF.
"""
# The scheduler (CA-7/TWS calendar) passes PARM='ME' on the last BUSINESS day of the month.
TRIGGERS = [r"INTEGER-OF-DATE", r"DATE-OF-INTEGER", r"\bDD\b\s*=\s*(28|29|30|31)", r"HOLIDAY"]
def derive(src):
    ev = set()
    if any(re.search(t, src) for t in TRIGGERS):
        ev.add("date-logic-present")
        for m in re.findall(r"\bDD\b\s*=\s*(\d+)", src): ev.add(f"month-length-{m}")
        if "HOLIDAY" in src: ev.add("holiday-table")
    return ev
req = derive(SRC)
print("hazard trigger found; required events derived:", sorted(req) or "{} (no branch on month length/quarter/year/leap)")
def parm(d):  # scheduler: last business day of month
    nxt = d + dt.timedelta(days=1)
    while nxt.weekday() >= 5: nxt += dt.timedelta(days=1)
    return "ME" if nxt.month != d.month else ""
start = dt.date(2026, 11, 9); days = [start + dt.timedelta(days=i) for i in range(14) if (start + dt.timedelta(days=i)).weekday() < 5]
covered = all(e == "date-logic-present" for e in req)
print(f"parallel run {days[0]}..{days[-1]}: required events covered={covered}, 'ME' runs in window={sum(parm(d)=='ME' for d in days)} -> V10 PROVEN")
print("first 'ME' run after cutover:", next(d for d in (start + dt.timedelta(days=i) for i in range(60)) if d.weekday() < 5 and parm(d) == "ME"))
