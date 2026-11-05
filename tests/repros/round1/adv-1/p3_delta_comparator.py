"""Probe 3: DELTA-007 comparator (§3.3) projecting print133 and JSON into Statement{account, lines[], totals}.

Legacy STMTFILE is a 133-col print file. Modern is the JSON from GET /accounts/{id}/statements.
The modern service has two real bugs in fields the legacy statement prints but the canonical model
(as named in the proposal) does not carry: minimum payment due and payment due date.
V5 canary as specified: "1-byte output change -> detected".
"""
import json
from decimal import Decimal as D

def amt(s):  # COBOL edited picture ZZ,ZZZ,ZZ9.99CR
    s = s.strip()
    neg = s.endswith("CR")
    v = D(s.replace("CR", "").replace(",", "").strip())
    return -v if neg else v

LEGACY = "\n".join(l.ljust(133) for l in [
    "1CARDDEMO BANK                    STATEMENT OF ACCOUNT                RUN 2026-11-04 PAGE    1",
    " ACCOUNT 00000000123                 STATEMENT DATE 2026-10-31",
    " 2026-10-03  GROCERY MART                          125.40",
    " 2026-10-11  PAYMENT - THANK YOU                   300.00CR",
    " 2026-10-29  AIRLINE TICKET                        842.17",
    " TOTAL DEBITS        967.57   TOTAL CREDITS       300.00   NEW BALANCE        667.57",
    " MINIMUM PAYMENT DUE      25.00   PAYMENT DUE DATE 2026-11-25",
])

GOOD = {"account": "00000000123", "statementDate": "2026-10-31",
        "lines": [{"date": "2026-10-03", "desc": "GROCERY MART", "amount": "125.40"},
                  {"date": "2026-10-11", "desc": "PAYMENT - THANK YOU", "amount": "-300.00"},
                  {"date": "2026-10-29", "desc": "AIRLINE TICKET", "amount": "842.17"}],
        "totals": {"debits": "967.57", "credits": "300.00", "newBalance": "667.57"},
        "minimumPaymentDue": "25.00", "paymentDueDate": "2026-11-25"}
BUGGY = json.loads(json.dumps(GOOD))
BUGGY["minimumPaymentDue"] = "6.68"        # bug: 1% of balance instead of max(25.00, 1%)
BUGGY["paymentDueDate"] = "2026-12-01"     # bug: +31 days instead of statement date + 25

# --- packs/comparators/print133_to_json.py -----------------------------------------
def canon_legacy(text):
    rows = text.split("\n")
    acct = rows[1][9:20]
    lines = [{"date": r[1:11], "desc": r[13:50].strip(), "amount": amt(r[50:62])}
             for r in rows[2:-2]]
    t = rows[-2]
    totals = {"debits": amt(t[13:28]), "credits": amt(t[44:58]), "newBalance": amt(t[71:86])}
    return {"account": acct, "lines": lines, "totals": totals}

def canon_modern(j):
    return {"account": j["account"],
            "lines": [{"date": l["date"], "desc": l["desc"], "amount": D(l["amount"])}
                      for l in j["lines"]],
            "totals": {k: D(v) for k, v in j["totals"].items()}}

def compare(legacy_text, modern_json):
    try:
        return canon_legacy(legacy_text) == canon_modern(modern_json)
    except Exception:
        return False   # unparseable = difference

print("comparator(legacy, correct service):", "PASS" if compare(LEGACY, GOOD) else "FAIL")
print("comparator(legacy, buggy service)  :", "PASS" if compare(LEGACY, BUGGY) else "FAIL",
      "| modern minimumPaymentDue=6.68 (legacy 25.00), paymentDueDate=2026-12-01 (legacy 2026-11-25)")

# V5 canary exactly as specified: one 1-byte change in the output must be detected.
pos = LEGACY.index("842.17")
canary = LEGACY[:pos] + "9" + LEGACY[pos + 1:]
print("V5 canary (1 byte changed in a line amount) detected:", not compare(canary, GOOD))

# Exhaustive 1-byte sweep over the two business fields the canonical model omits.
last = LEGACY.split("\n")[-1]
base = len(LEGACY) - len(last)
for label, start, length in (("MINIMUM PAYMENT DUE", last.index("25.00"), 5),
                             ("PAYMENT DUE DATE", last.index("2026-11-25"), 10)):
    undetected = sum(compare(LEGACY[:base + start + k] + "7" + LEGACY[base + start + k + 1:], GOOD)
                     for k in range(length) if last[start + k] != "7")
    print(f"1-byte changes to {label}: {undetected} of {length} undetected")
