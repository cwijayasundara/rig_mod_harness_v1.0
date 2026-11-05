"""Total comparator + canary sweep (PROPOSAL v0.2 §6.3, §3) for DELTA-007.

Followed:
  §6.3 DELTA-007 map / removed / added exactly as printed.
       Totality: "every legacy observable in scope maps to a modern observable, or appears in removed.
       Every modern observable maps back, or appears in added."
       Canary sweep: "For each mapped observable, the sweep changes one value in the modern output and
       checks that the comparator fails. A comparator that misses any canary is rejected."
  §3   Observable kinds: field, record_order, ... (no kind for record count).
The comparator is idiomatic Python: json.loads, zip over line items, numeric compare of the account number.
Legacy account number is PIC 9(11) (leading zeros are part of the value a consumer sees).
"""
import copy, json
from decimal import Decimal
from datetime import date

DELTA_MAP = {"STMTFILE.account_no": "$.account", "STMTFILE.line[*].amount": "$.lines[*].amount",
             "STMTFILE.total_due": "$.totals.due", "STMTFILE.min_payment_due": "$.totals.minimumPaymentDue",
             "STMTFILE.payment_due_date": "$.totals.paymentDueDate", "STMTFILE.credit_marker": "$.totals.isCredit"}
REMOVED = ["STMTFILE.page_header", "STMTFILE.carriage_control"]; ADDED = ["$.links.self"]
LEGACY_SURFACE = list(DELTA_MAP) + REMOVED
MODERN_SURFACE = list(DELTA_MAP.values()) + ADDED

def print133(acct, lines, total, minpay, due):
    out = ["1" + "CARDDEMO STATEMENT".center(132), " ACCOUNT: " + acct]
    out += [f" {d:<10} {desc:<40} {amt:>12}" for d, desc, amt in lines]
    out += [f" TOTAL DUE: {total:>12}", f" MINIMUM PAYMENT DUE: {minpay:>12}", f" PAYMENT DUE DATE: {due}"]
    return "\n".join(out)

def parse_print(text):
    rows = text.split("\n"); L = {"lines": []}
    for r in rows[1:]:
        if r.startswith(" ACCOUNT: "): L["account_no"] = r[10:].strip()
        elif r.startswith(" TOTAL DUE:"): v = r.split(":")[1].strip(); L["credit"] = v.endswith("CR"); L["total"] = v.replace("CR", "")
        elif r.startswith(" MINIMUM PAYMENT DUE:"): L["minpay"] = r.split(":")[1].strip()
        elif r.startswith(" PAYMENT DUE DATE:"): L["due"] = r.split(":")[1].strip()
        else: L["lines"].append(r[53:].strip())
    return L

def comparator(legacy_text, modern_json):          # packs/comparators/print133_to_json.py
    L, M = parse_print(legacy_text), json.loads(modern_json)
    if int(L["account_no"]) != int(M["account"]): return False
    for la, ml in zip(L["lines"], M["lines"]):
        if Decimal(la) != Decimal(str(ml["amount"])): return False
    t = M["totals"]
    return (Decimal(L["total"]) == Decimal(str(t["due"])) and Decimal(L["minpay"]) == Decimal(str(t["minimumPaymentDue"]))
            and date.fromisoformat(L["due"]) == date.fromisoformat(t["paymentDueDate"]) and L["credit"] == t["isCredit"])

lines = [("2026-10-03", "GROCERY", "54.20"), ("2026-10-11", "FUEL", "61.05"), ("2026-10-31", "PAYMENT", "-200.00")]
legacy = print133("00000012345", lines, "1234.56", "25.00", "2026-11-25")
good = {"account": "00000012345", "lines": [{"date": d, "desc": s, "amount": float(a)} for d, s, a in lines],
        "totals": {"due": 1234.56, "minimumPaymentDue": 25.00, "paymentDueDate": "2026-11-25", "isCredit": False},
        "links": {"self": "/accounts/00000012345/statements/2026-10"}}
gj = json.dumps(good)

print("totality:", set(LEGACY_SURFACE) == set(DELTA_MAP) | set(REMOVED) and set(MODERN_SURFACE) == set(DELTA_MAP.values()) | set(ADDED))
canaries = []
def canary(name, f):
    m = copy.deepcopy(good); f(m); canaries.append((name, not comparator(legacy, json.dumps(m))))
canary("$.account", lambda m: m.__setitem__("account", "00000012346"))
for i in range(len(lines)):
    canary(f"$.lines[{i}].amount", lambda m, i=i: m["lines"][i].__setitem__("amount", m["lines"][i]["amount"] + 0.01))
canary("$.totals.due", lambda m: m["totals"].__setitem__("due", 1234.57))
canary("$.totals.minimumPaymentDue", lambda m: m["totals"].__setitem__("minimumPaymentDue", 25.01))
canary("$.totals.paymentDueDate", lambda m: m["totals"].__setitem__("paymentDueDate", "2026-11-26"))
canary("$.totals.isCredit", lambda m: m["totals"].__setitem__("isCredit", True))
print(f"canary sweep: {sum(c for _, c in canaries)}/{len(canaries)} caught -> comparator {'ACCEPTED' if all(c for _, c in canaries) else 'REJECTED'}")
print("comparator(legacy, correct service):", "PASS" if comparator(legacy, gj) else "FAIL")

bugs = {
    "drops 2026-10-31 line (cycle-end uses < not <=)": lambda m: m["lines"].pop(),
    "posts 2026-10-11 FUEL twice":                       lambda m: m["lines"].append(dict(m["lines"][1])),
    "account sent as 12345 (leading zeros lost)":        lambda m: m.__setitem__("account", "12345"),
}
for name, f in bugs.items():
    m = copy.deepcopy(good); f(m)
    print(f"buggy service, {name:48s}: {'PASS' if comparator(legacy, json.dumps(m)) else 'FAIL'}"
          f"  (lines legacy={len(lines)} modern={len(m['lines'])}, account={m['account']!r})")
