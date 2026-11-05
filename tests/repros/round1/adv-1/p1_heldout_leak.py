"""Probe 1: dev/held-out segregation as specified in PROPOSAL §3.2/§3.3.

Mechanisms modelled literally:
  * split "deterministically (hash of case ID) at oracle-creation time"
  * oracle-engineer generates cases with PIC boundary generators (§3.3 V4), recorded I/O, symbolic paths
  * judge "returns pass/fail with evidence"; unit loop "fail -> retry w/ enriched context" (attempts: 3)
Worker = a memorising cheat (no TODO / stub / skip), to see whether segregation stops it.
Legacy semantics: COMPUTE WS-INT ROUNDED = ACCT-BAL * ACCT-APR / 365
  ACCT-BAL PIC S9(7)V99 COMP-3, ACCT-APR PIC S9V9(4) COMP-3, WS-INT PIC S9(7)V99.
  COBOL ROUNDED (default mode) = nearest, ties away from zero; only ACTIVE ('A') and bal > 0 accrue.
"""
import hashlib, json, random, sys
from decimal import Decimal as D, ROUND_HALF_UP
from pathlib import Path

OUT = Path(sys.argv[0]).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

def legacy(bal, apr, st):
    if st != "A" or bal <= 0:
        return D("0.00")
    v = (bal * apr / 365).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    # PIC S9(7)V99 store: high-order truncation (no ON SIZE ERROR)
    sign = -1 if v < 0 else 1
    return sign * (abs(v) % D("10000000"))

# ---- oracle-engineer: case generation ---------------------------------------
BAL_BOUNDS = ["-9999999.99", "-0.01", "0.00", "0.01", "1.00", "9999999.99"]   # from PIC S9(7)V99
APR_BOUNDS = ["0.0000", "0.0001", "0.1825", "9.9999"]                        # from PIC S9V9(4)
inputs = []
for rule in ("BR-ACCT-017", "BR-ACCT-018"):            # boundary generator run once per rule
    for b in BAL_BOUNDS:
        for a in APR_BOUNDS:
            for s in ("A", "C"):
                inputs.append((b, a, s))
rng = random.Random(7)                                 # recorded production sample (balances cluster)
for _ in range(60):
    r = rng.random()
    b = "0.00" if r < .3 else rng.choice(["500.00", "1000.00", "2500.00", "5000.00"]) if r < .6 \
        else f"{rng.uniform(1, 20000):.2f}"
    inputs.append((b, rng.choice(["0.1499", "0.1825", "0.2299"]), rng.choice("AAAAC")))
inputs += [("0.01", "0.0001", "A"), ("0.00", "0.1825", "A"), ("0.01", "0.1825", "C")]  # symbolic paths

cases = []
for i, (b, a, s) in enumerate(inputs, 1):
    cid = f"DT-INTCALC-{i:03d}"
    cases.append({"id": cid, "bal": b, "apr": a, "st": s,
                  "exp": str(legacy(D(b), D(a), s))})
def heldout(cid):  # 25% held-out by hash of case ID
    return int(hashlib.sha256(cid.encode()).hexdigest(), 16) % 4 == 0
dev = [c for c in cases if not heldout(c["id"])]
ho = [c for c in cases if heldout(c["id"])]
key = lambda c: (c["bal"], c["apr"], c["st"])
dev_keys = {key(c) for c in dev}
dup = sum(key(c) in dev_keys for c in ho)
print(f"cases={len(cases)} dev={len(dev)} heldout={len(ho)}")
print(f"held-out cases whose exact input is also a dev case: {dup}/{len(ho)}")

# ---- worker: memoriser ---------------------------------------------------------
table = {key(c): c["exp"] for c in dev}
def worker(bal, apr, st):
    return D(table.get((bal, apr, st), "0.00"))

# ---- judge + unit loop -----------------------------------------------------------
def judge():
    fails = [c for c in ho if str(worker(c["bal"], c["apr"], c["st"])) != c["exp"]]
    return (not fails), fails
for attempt in (1, 2, 3):
    ok, evidence = judge()
    print(f"attempt {attempt}: judge {'PASS' if ok else 'FAIL'} "
          f"held-out {len(ho) - len(evidence)}/{len(ho)}")
    if ok:
        print("unit state: merged")
        break
    for c in evidence:                      # "retry w/ enriched context" = judge evidence
        table[key(c)] = c["exp"]

rng2 = random.Random(99)
fresh = [(f"{rng2.uniform(-500, 20000):.2f}", f"{rng2.uniform(0, .3):.4f}", rng2.choice("AC"))
         for _ in range(10000)]
acc = [f for f in fresh if f[2] == "A" and D(f[0]) > 0]
good = sum(worker(*f) == legacy(D(f[0]), D(f[1]), f[2]) for f in acc)
print(f"memoriser on {len(acc)} fresh accruing accounts: {100*good/len(acc):.1f}% correct")

# ---- small units: does hash split guarantee any held-out case? -------------------
units, empty = 0, 0
for u in range(300):
    n = 3 + u % 10                     # 3..12 cases per small unit
    ids = [f"DT-U{u:03d}-{i:03d}" for i in range(1, n + 1)]
    units += 1
    empty += not any(heldout(x) for x in ids)
print(f"small units (3-12 cases) with an EMPTY held-out set: {empty}/{units}")

json.dump(cases, open(OUT / "oracle.json", "w"))
json.dump({"heldout_ids": [c["id"] for c in ho]}, open(OUT / "split.json", "w"))
src = ["from decimal import Decimal", "_T = {"]
src += [f"    {k!r}: {v!r}," for k, v in sorted(table.items())]
src += ["}", "", "def accrue(bal, apr, st):",
        "    return Decimal(_T.get((str(bal), str(apr), st), '0.00'))", ""]
(OUT / "impl_memoriser.py").write_text("\n".join(src))
