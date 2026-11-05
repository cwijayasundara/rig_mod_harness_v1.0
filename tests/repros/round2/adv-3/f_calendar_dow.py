"""F. Calendar-event derivation (§6.6) requires zero events for date logic that
is not in the month-length hazard row, so V10 passes after one parallel day and
a day-of-week bug ships. v0.1's 10-day floor would have caught it.

Built from:
  - Hazard row, line 152: Month-length logic, trigger "Date arithmetic,
    FUNCTION INTEGER-OF-DATE".
  - §6.6 line 381: "The hazard catalog's month-length row finds date logic in
    the graph. The window then requires each event that the logic branches on
    ... A gate unit passes V10 only after every required event has occurred in
    the parallel run with zero unexplained mismatches."
  - Line 379: the "10 consecutive business days" rule was removed.
"""
import datetime as dt, re

COBOL = """
       ACCEPT WS-DOW FROM DAY-OF-WEEK.
       IF WS-DOW > 5
          MOVE 'WEEKEND - NO POSTING' TO WS-MSG
          GO TO 9000-EXIT
       END-IF.
       PERFORM 2000-POST-TRANSACTIONS.
"""
TRIGGERS = {"month_length": [r"INTEGER-OF-DATE", r"DATE-OF-INTEGER", r"ADD .* TO .*-DATE", r"DAY-OF-INTEGER"]}

def derive_required_events(src):
    events = set()
    if any(re.search(t, src) for t in TRIGGERS["month_length"]):
        events |= {"month_end_28", "month_end_29", "month_end_30", "month_end_31", "quarter_end", "year_end", "leap_day"}
    if re.search(r"READ .*HOLIDAY|CALENDAR-FILE", src):
        events.add("business_calendar")
    return events

required = derive_required_events(COBOL)
print("date-logic triggers found    :", bool(required), " required events:", sorted(required) or "{}")

# legacy: COBOL DAY-OF-WEEK 1=Monday..7=Sunday.  modern: java.util.Calendar DAY_OF_WEEK 1=Sunday..7=Saturday
def legacy_posts(d):   return not (d.isoweekday() > 5)
def modern_posts(d):   return not (((d.weekday() + 1) % 7 + 1) > 5)   # Calendar.DAY_OF_WEEK

def v10_passes(start, days_run):
    seen = set(); mismatches = 0
    for i in range(days_run):
        d = start + dt.timedelta(days=i)
        if legacy_posts(d) != modern_posts(d): mismatches += 1
        # events observed (only month-end style events exist in the vocabulary)
        nxt = d + dt.timedelta(days=1)
        if nxt.day == 1: seen.add(f"month_end_{d.day}")
    return required <= seen and mismatches == 0, mismatches

start = dt.date(2026, 11, 9)   # a Monday
ok, mm = v10_passes(start, 1)
print(f"parallel run from {start} (Mon) for 1 day: required events covered = {required <= set()}, "
      f"mismatches={mm} -> V10 {'PROVEN, cutover' if ok else 'blocked'}")

for i in range(1, 8):
    d = start + dt.timedelta(days=i)
    if legacy_posts(d) != modern_posts(d):
        print(f"first divergence after cutover: {d} ({d.strftime('%A')}): legacy posts={legacy_posts(d)} modern posts={modern_posts(d)}")
        break

# v0.1 rule for comparison
ok01, mm01 = v10_passes(start, 14)   # 10 business days span 14 calendar days
print(f"v0.1 '10 consecutive business days' from {start}: mismatches={mm01} -> {'PROVEN' if mm01 == 0 else 'caught'}")
