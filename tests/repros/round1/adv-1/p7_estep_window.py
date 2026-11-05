"""Probe 7: cutover policy from §3.3: "E-steps require V7-V10 PROVEN for 10 consecutive business days".

Parallel run (V10) with daily business reconciliation of GL interest postings. The modern service has a
month-end-only bug: interest capitalisation on the last business day uses 30 days instead of the
actual days in the month (legacy uses actual days). Every other day's postings are identical.
"""
import calendar, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP

BAL, APR = D("250000000.00"), D("0.1825")        # portfolio balance in the GL
def last_bday(d):
    x = dt.date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
    while x.weekday() >= 5: x -= dt.timedelta(days=1)
    return x
def gl(d, modern):
    daily = (BAL * APR / 365).quantize(D("0.01"), ROUND_HALF_UP)
    if d == last_bday(d):
        days = 30 if modern else calendar.monthrange(d.year, d.month)[1]
        return daily, (BAL * APR * days / 365).quantize(D("0.01"), ROUND_HALF_UP)
    return daily, D("0.00")

d, streak, ready = dt.date(2026, 11, 2), 0, None
while d <= dt.date(2026, 12, 31):
    if d.weekday() < 5:
        ok = gl(d, False) == gl(d, True)
        streak = streak + 1 if ok else 0
        if streak >= 10 and ready is None:
            ready = d
            print(f"{d} V10 streak={streak} -> cutover policy PROVEN (no month-end in window)")
        if ok and d == last_bday(d):
            print(f"{d} V10 match on month-end (streak={streak})")
        if not ok:
            print(f"{d} V10 MISMATCH legacy={gl(d, False)[1]} modern={gl(d, True)[1]} "
                  f"(month-end capitalisation)")
    d += dt.timedelta(days=1)
