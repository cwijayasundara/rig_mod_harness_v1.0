"""C. Case burning (§5.3 rule 2) on a finite recorded pool starves the sealed set,
and each burn changes the evidence key for every rung of the module.

Built from:
  - Case, lines 239-245: content-addressed, origin, seen_by_worker ("once true,
    the case may never grade again").
  - Sealed rule, line 250: "at least 20 cases, or 25% of the pool, whichever is
    larger. A pool too small ... gets topped up from the generators before the
    unit starts."
  - Judge rule 2, line 200: a failed sealed case moves to dev, shown to the
    worker, "replaces it with a new sealed case drawn from the same generator".
  - §6.5 table row 4, line 374: "Recorded production I/O only" estate, where
    legacy cannot execute (line 365), so no generator can produce `expected`.
  - EvidenceKey.oracle_set, line 336: hash of the dev and sealed sets.
"""
import hashlib, json, random
from decimal import Decimal as D, ROUND_HALF_UP

def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:12]

# --- recorded production I/O: 60 distinct (status, balance, apr) inputs --------
rng = random.Random(3)
pool = {}
while len(pool) < 60:
    inp = {"status": rng.choice(["ACTIVE", "ACTIVE", "ACTIVE", "CLOSED"]),
           "balance": str(D(rng.randint(-5000, 900000)) / 100),
           "apr": str(D(rng.choice([1299, 1899, 2499])) / 100)}
    cid = sha(inp)
    exp = D(0)
    if inp["status"] == "ACTIVE" and D(inp["balance"]) > 0:
        exp = (D(inp["balance"]) * D(inp["apr"]) / 100 / 365).quantize(D("0.01"), ROUND_HALF_UP)
    pool[cid] = {"id": cid, "input": inp, "expected": exp, "origin": "recorded", "seen_by_worker": False}

def split(pool):
    ids = sorted(pool)                      # content-addressed, deterministic
    n_sealed = max(20, -(-len(ids) * 25 // 100))     # line 250
    sealed = set(ids[:n_sealed]); dev = set(ids) - sealed
    return dev, sealed

dev, sealed = split(pool)
for cid in dev:
    pool[cid]["seen_by_worker"] = True
print(f"pool={len(pool)} recorded cases  dev={len(dev)}  sealed={len(sealed)}  minimum sealed=20")

def generator_for(origin):
    # line 200: replacement "drawn from the same generator". Recorded cases have
    # none, and in a recorded-only estate legacy cannot run to label new inputs.
    return None if origin == "recorded" else (lambda: None)

def judge(impl, pool, sealed):
    fails = [cid for cid in sealed if impl(pool[cid]["input"]) != pool[cid]["expected"]]
    return len(sealed) - len(fails), len(sealed), fails

def burn(pool, dev, sealed, fails):
    for cid in fails:                        # rule 2: move to dev, mark seen
        sealed.discard(cid); dev.add(cid); pool[cid]["seen_by_worker"] = True
        g = generator_for(pool[cid]["origin"])
        if g is None:
            pass                              # nothing to replace it with
    return dev, sealed

def key_oracle_set(dev, sealed):
    return sha([sorted(dev), sorted(sealed)])

# --- honest worker, attempt 1 has a real bug: CLOSED accounts still accrue ------
def attempt1(inp):
    if D(inp["balance"]) > 0:
        return (D(inp["balance"]) * D(inp["apr"]) / 100 / 365).quantize(D("0.01"), ROUND_HALF_UP)
    return D(0)
def attempt2(inp):   # fixed
    if inp["status"] == "ACTIVE" and D(inp["balance"]) > 0:
        return (D(inp["balance"]) * D(inp["apr"]) / 100 / 365).quantize(D("0.01"), ROUND_HALF_UP)
    return D(0)

k0 = key_oracle_set(dev, sealed)
passed, total, fails = judge(attempt1, pool, sealed)
print(f"attempt 1 (bug: CLOSED accrues): sealed {passed} of {total}")
dev, sealed = burn(pool, dev, sealed, fails)
k1 = key_oracle_set(dev, sealed)
print(f"  burned {len(fails)} sealed cases into dev; replacement generator for origin=recorded: None")
print(f"  sealed now {len(sealed)} (< 20 minimum)   oracle_set hash {k0} -> {k1}: "
      f"evidence for V0,V1,V5,V9 of this module is now stale too")
passed, total, fails = judge(attempt2, pool, sealed)
print(f"attempt 2 (fixed): sealed {passed} of {total} -> below minimum, no unseen recorded input can replace them")

# --- lookup cheat: memorises whatever is in dev ---------------------------------
dev, sealed = split(pool)
for cid in pool: pool[cid]["seen_by_worker"] = cid in dev
def lookup_factory(dev_ids):
    table = {sha(pool[c]["input"]): pool[c]["expected"] for c in dev_ids}
    return lambda inp: table.get(sha(inp), D("0.00"))
print()
for att in (1, 2, 3):
    impl = lookup_factory(dev)
    passed, total, fails = judge(impl, pool, sealed)
    print(f"lookup attempt {att}: sealed {passed} of {total}  (fresh: none, legacy cannot execute)")
    dev, sealed = burn(pool, dev, sealed, fails)
print(f"after 3 attempts (budget attempts: 3, line 179): dev={len(dev)} sealed={len(sealed)}; "
      f"{len(dev)} of 60 recorded inputs leaked into dev through rule 2.")
print("judge output for attempt 2 (counts only, line 199): 'sealed 2 of 2' -> the lookup passes;"
      " no fresh set exists and the sealed set is below the line-250 minimum.")
