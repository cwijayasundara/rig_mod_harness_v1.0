# §6.3 lines 278-299: total map; canary sweep: for each mapped observable change ONE value in modern output,
# comparator must fail. Comparators built by an oracle engineer; all map every field (total).
from decimal import Decimal as D
import copy
legacy = {"account": "0001", "lines": [{"date": "2026-10-03", "amount": D("120.00")},
                                       {"date": "2026-10-09", "amount": D("-35.50")},
                                       {"date": "2026-10-21", "amount": D("9.99")}],
          "totals": {"due": D("94.49"), "minimumPaymentDue": D("25.00"), "paymentDueDate": "2026-11-25", "isCredit": False}}
def cmp_zip(l, m):          # per-line, zip over lines
    return l["account"] == m["account"] and l["totals"] == m["totals"] and all(a == b for a, b in zip(l["lines"], m["lines"]))
def cmp_columns(l, m):      # compares each column as a sorted multiset (order-insensitive, per column)
    col = lambda o, k: sorted(x[k] for x in o["lines"])
    return l["account"] == m["account"] and l["totals"] == m["totals"] and all(col(l, k) == col(m, k) for k in ("date", "amount"))
def cmp_abs(l, m):          # magnitude compare of amounts ("sign is carried by isCredit")
    return l["account"] == m["account"] and l["totals"] == m["totals"] and \
        [(x["date"], abs(x["amount"])) for x in l["lines"]] == [(x["date"], abs(x["amount"])) for x in m["lines"]]
def canaries(o):            # one changed value per mapped observable (incl. every line element)
    out = []
    for path in [("account",), ("totals", "due"), ("totals", "minimumPaymentDue"), ("totals", "paymentDueDate"), ("totals", "isCredit")] + \
                [("lines", i, k) for i in range(len(o["lines"])) for k in ("date", "amount")]:
        m = copy.deepcopy(o); t = m
        for p in path[:-1]: t = t[p]
        v = t[path[-1]]
        t[path[-1]] = (not v) if isinstance(v, bool) else v + D("0.01") if isinstance(v, D) else v[:-1] + chr(ord(v[-1]) + 1)
        out.append(m)
    return out
bugs = {"dropped last line": lambda m: m["lines"].pop(),
        "amounts swapped between lines": lambda m: (m["lines"][0].__setitem__("amount", D("9.99")), m["lines"][2].__setitem__("amount", D("120.00"))),
        "debit sign flipped": lambda m: m["lines"][1].__setitem__("amount", D("35.50"))}
for name, c in [("zip", cmp_zip), ("columns", cmp_columns), ("abs", cmp_abs)]:
    caught = sum(not c(legacy, m) for m in canaries(legacy)); n = len(canaries(legacy))
    res = []
    for b, f in bugs.items():
        m = copy.deepcopy(legacy); f(m); res.append(f"{b}={'PASS' if c(legacy, m) else 'fail'}")
    print(f"{name:8s} canary sweep {caught}/{n} -> {'TRUSTED' if caught == n else 'rejected'} | " + ", ".join(res))
