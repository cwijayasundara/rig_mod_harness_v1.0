"""Probe 3: Delta Register comparator (DELTA-007, kind: format) built as §3.3 specifies:
'projects both outputs into a canonical business model Statement{account, lines[], totals} and
compares those. Undeclared differences are always failures.'

Modern side ALSO silently dropped the P0 'MINIMUM PAYMENT DUE' line (an undeclared `removal`
affecting a different rule) and lost the CR marker. Does the comparator fail?
"""
import json, re
from decimal import Decimal

legacy_print = """\
1ACCT 000123456789            STATEMENT 2026-10-31                      PAGE 001
 DATE       DESCRIPTION                      AMOUNT
 2026-10-02 GROCERY MART                     125.40
 2026-10-15 PAYMENT - THANK YOU            1,000.00-
 2026-10-20 LATE FEE                          35.00
                                  TOTAL NEW BALANCE       839.60-
                                  **** CREDIT BALANCE ****
                                  MINIMUM PAYMENT DUE       0.00
                                  PAYMENT DUE DATE    2026-11-25
"""
modern_json = json.dumps({
    "account": "000123456789", "period_end": "2026-10-31",
    "lines": [{"date": "2026-10-02", "desc": "GROCERY MART", "amount": "125.40"},
              {"date": "2026-10-15", "desc": "PAYMENT - THANK YOU", "amount": "-1000.00"},
              {"date": "2026-10-20", "desc": "LATE FEE", "amount": "35.00"}],
    "totals": {"new_balance": "-839.60"},
})  # no minimum_payment_due, no due_date, no credit marker

def amt(s):
    s = s.replace(",", "")
    return -Decimal(s[:-1]) if s.endswith("-") else Decimal(s)

def project_legacy(txt):
    acct = re.search(r"ACCT (\d+)", txt).group(1)
    lines = [{"date": m[0], "desc": m[1].strip(), "amount": amt(m[2])}
             for m in re.findall(r"^ (\d{4}-\d\d-\d\d) (.+?) +([\d,]+\.\d\d-?)$", txt, re.M)]
    total = amt(re.search(r"TOTAL NEW BALANCE +([\d,]+\.\d\d-?)", txt).group(1))
    return {"account": acct, "lines": lines, "totals": {"new_balance": total}}

def project_modern(js):
    d = json.loads(js)
    return {"account": d["account"],
            "lines": [{"date": l["date"], "desc": l["desc"], "amount": Decimal(l["amount"])} for l in d["lines"]],
            "totals": {"new_balance": Decimal(d["totals"]["new_balance"])}}

L, M = project_legacy(legacy_print), project_modern(modern_json)
print("DELTA-007 comparator (canonical model):", "PASS" if L == M else "FAIL")
print("legacy output mentions MINIMUM PAYMENT DUE :", "MINIMUM PAYMENT DUE" in legacy_print)
print("modern output mentions minimum payment      :", "minimum" in modern_json.lower())
print("legacy output mentions CREDIT BALANCE marker:", "CREDIT BALANCE" in legacy_print)
print("Undeclared removal detected by comparator   :", L != M)
