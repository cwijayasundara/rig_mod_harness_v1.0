"""A. Canary sweep (PROPOSAL.md §6.3, line 299) passes a total comparator that still
hides cardinality and correlated-field differences.

Built from:
  - DELTA-007 exactly as written, lines 280-297 (map / removed / added).
  - Totality rule, line 278: every legacy observable maps or is in `removed`,
    every modern observable maps back or is in `added`.
  - Canary sweep, line 299: "For each mapped observable, the sweep changes one
    value in the modern output and checks that the comparator fails."
The comparator is total and compares every mapped field. It zips the line
arrays (the most common way to compare two lists) and checks each side's total
against the sum of its own lines.
"""
from decimal import Decimal as D
import copy, datetime as dt

MAP = {
    "STMTFILE.account_no":       "$.account",
    "STMTFILE.line[*].amount":   "$.lines[*].amount",
    "STMTFILE.total_due":        "$.totals.due",
    "STMTFILE.min_payment_due":  "$.totals.minimumPaymentDue",
    "STMTFILE.payment_due_date": "$.totals.paymentDueDate",
    "STMTFILE.credit_marker":    "$.totals.isCredit",
}
REMOVED = ["STMTFILE.page_header", "STMTFILE.carriage_control"]
ADDED = ["$.links.self"]

# ---- legacy observations (keyed by Observable.id, §6.1) and modern JSON -------
def legacy_obs(acct, lines, due, minpay, duedate, credit):
    return {
        "STMTFILE.page_header": "ACCOUNT STATEMENT            PAGE 1",
        "STMTFILE.carriage_control": "1",
        "STMTFILE.account_no": acct,
        "STMTFILE.line[*].amount": [D(x) for x in lines],
        "STMTFILE.total_due": D(due),
        "STMTFILE.min_payment_due": D(minpay),
        "STMTFILE.payment_due_date": duedate,
        "STMTFILE.credit_marker": credit,
    }

def modern_json(acct, lines, due, minpay, duedate, credit):
    return {
        "account": acct,
        "lines": [{"amount": D(x)} for x in lines],
        "totals": {"due": D(due), "minimumPaymentDue": D(minpay),
                   "paymentDueDate": duedate, "isCredit": credit},
        "links": {"self": f"/accounts/{acct}/statements"},
    }

def modern_paths(m):
    yield "$.account"
    for _ in m["lines"]:
        yield "$.lines[*].amount"
    for k, p in {"due": "$.totals.due", "minimumPaymentDue": "$.totals.minimumPaymentDue",
                 "paymentDueDate": "$.totals.paymentDueDate", "isCredit": "$.totals.isCredit"}.items():
        yield p
    yield "$.links.self"

def totality_check(legacy, modern):
    for lid in legacy:
        if lid not in MAP and lid not in REMOVED:
            return False, f"legacy {lid} unmapped"
    for p in set(modern_paths(modern)):
        if p not in MAP.values() and p not in ADDED:
            return False, f"modern {p} unmapped"
    return True, "total"

# ---- packs/comparators/print133_to_json.py -----------------------------------
def comparator(legacy, modern):
    ok = legacy["STMTFILE.account_no"] == modern["account"]
    ok &= legacy["STMTFILE.min_payment_due"] == modern["totals"]["minimumPaymentDue"]
    ok &= legacy["STMTFILE.payment_due_date"] == modern["totals"]["paymentDueDate"]
    ok &= legacy["STMTFILE.credit_marker"] == modern["totals"]["isCredit"]
    # lines: compare pairwise
    ok &= all(l == m["amount"] for l, m in
              zip(legacy["STMTFILE.line[*].amount"], modern["lines"]))
    # totals: each side's total must equal the sum of its lines; with the lines
    # equal, the totals are equal
    ok &= legacy["STMTFILE.total_due"] == sum(legacy["STMTFILE.line[*].amount"])
    ok &= modern["totals"]["due"] == sum(m["amount"] for m in modern["lines"])
    return bool(ok)

# ---- canary sweep, line 299 ---------------------------------------------------
def perturb(v):
    """Change one value: several perturbations so the sweep is not a strawman."""
    if isinstance(v, bool):
        return [not v]
    if isinstance(v, D):
        return [v + D("0.01"), v - D("0.01"), v * 2, -v, D("0")]
    if isinstance(v, dt.date):
        return [v + dt.timedelta(days=1), v - dt.timedelta(days=31), v.replace(year=v.year + 1)]
    if isinstance(v, str):
        return [v + "X", v[::-1], ""]
    raise TypeError(v)

def set_path(m, path, idx, val):
    m = copy.deepcopy(m)
    if path == "$.account":
        m["account"] = val
    elif path == "$.lines[*].amount":
        m["lines"][idx]["amount"] = val
    else:
        m["totals"][path.rsplit(".", 1)[1]] = val
    return m

def get_path(m, path, idx):
    if path == "$.account":
        return m["account"]
    if path == "$.lines[*].amount":
        return m["lines"][idx]["amount"]
    return m["totals"][path.rsplit(".", 1)[1]]

def canary_sweep(legacy, modern):
    assert comparator(legacy, modern), "baseline must pass"
    missed = []
    for lid, path in MAP.items():
        n = len(modern["lines"]) if "[*]" in path else 1
        for idx in range(n):
            for v in perturb(get_path(modern, path, idx)):
                mutated = set_path(modern, path, idx, v)
                if comparator(legacy, mutated):
                    missed.append((path, idx, v))
    return missed

# ---- run ----------------------------------------------------------------------
L = legacy_obs("4000000000000001", ["120.00", "35.50", "10.00"], "165.50", "25.00",
               dt.date(2026, 11, 25), False)
M = modern_json("4000000000000001", ["120.00", "35.50", "10.00"], "165.50", "25.00",
                dt.date(2026, 11, 25), False)

print("totality check                :", totality_check(L, M))
missed = canary_sweep(L, M)
print(f"canary sweep                  : {len(missed)} canaries missed -> comparator {'ACCEPTED' if not missed else 'REJECTED'}")

# Bug 1: the modern service never posts the late fee (last line) and its total
# is lower by that amount. Two correlated fields differ from legacy.
bug1 = modern_json("4000000000000001", ["120.00", "35.50"], "155.50", "25.00",
                   dt.date(2026, 11, 25), False)
print("bug: late fee line dropped, total_due 155.50 vs legacy 165.50 :",
      "PASS" if comparator(L, bug1) else "FAIL")

# Bug 2: the modern service posts a duplicate line and its total is higher.
bug2 = modern_json("4000000000000001", ["120.00", "35.50", "10.00", "10.00"], "175.50", "25.00",
                   dt.date(2026, 11, 25), False)
print("bug: duplicate fee line, total_due 175.50 vs legacy 165.50    :",
      "PASS" if comparator(L, bug2) else "FAIL")

# Bug 3: no lines at all, zero total (an empty statement for a live account).
bug3 = modern_json("4000000000000001", [], "0.00", "25.00", dt.date(2026, 11, 25), False)
print("bug: empty statement, total_due 0.00 vs legacy 165.50         :",
      "PASS" if comparator(L, bug3) else "FAIL")

# The delta's own observable list: STMTFILE also has a record_order observable
# (§3 kinds). It is neither mapped nor removed, so DELTA-007 as printed in §6.3
# is not total under §3, and the sweep cannot perturb it ("changes one value").
L_full = dict(L); L_full["STMTFILE.line.record_order"] = [0, 1, 2]
print("DELTA-007 totality with §3 record_order observable included :", totality_check(L_full, M))
