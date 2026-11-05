"""Evidence key + verdict engine + judge loop (PROPOSAL v0.2 §6.5, §5.3, §5.1).

Followed:
  §6.5 EvidenceKey.oracle_set = "hash of the dev and sealed sets, and generator versions and seeds".
       "The engine recomputes each verdict from the evidence whose key matches the current tree.
        Evidence under any other key is stale and ignored."
       "When runs under the same key disagree, the verdict is FLAKY. A FLAKY verdict blocks merge until a
        human quarantines ... or until 5 consecutive reruns pass."
  §5.3 rule 2: only *sealed* failures move to dev; rule 3: "Each judge run draws new inputs from the unit's
       fresh generators"; rule 4: generalisation = fresh pass rate == dev pass rate (bound 0).
  §5.1 budget attempts: 3; fresh random:5000.
Seed policy A: a new seed per judge run (rule 3 literally).  Policy B: seed = H(rest of key), so a retry
needs a code change; the worker makes a whitespace edit, which changes dependency_closure.
"""
import hashlib, random

def H(*xs): return hashlib.sha256("|".join(map(str, xs)).encode()).hexdigest()[:12]

class Engine:
    def __init__(s): s.ev = {}
    def record(s, key, ok): s.ev.setdefault(key, []).append(ok)
    def verdict(s, key):
        runs = s.ev.get(key, [])
        if not runs: return "NOT_PROVEN"
        if all(runs): return "PROVEN"
        if not any(runs): return "NOT_PROVEN"
        last_fail = len(runs) - 1 - runs[::-1].index(False)
        return "PROVEN" if len(runs) - 1 - last_fail >= 5 else "FLAKY"   # 5 consecutive passes clear FLAKY

def judge(rng, defect_rate, n_fresh=5000):
    """Deterministic defect: wrong on defect_rate of the random generator's inputs. Dev/sealed never hit it."""
    fresh_fail = sum(rng.random() < defect_rate for _ in range(n_fresh))
    dev_rate, fresh_rate = 1.0, (n_fresh - fresh_fail) / n_fresh
    return fresh_fail == 0 and fresh_rate == dev_rate          # sealed 44/44, generalisation check

def unit_loop(policy, defect_rate, rng, uid, attempts=3):
    eng, tree, seen_flaky = Engine(), f"tree-{uid}-v1", False
    for a in range(attempts):
        seed = rng.getrandbits(32) if policy == "A" else int(H(tree), 16)
        key = H("accounts", "V4", tree, "legacy", "dev+sealed", "gen-1.0", seed, "comparators", "packs", "env")
        run_rng = random.Random(seed)
        eng.record(key, judge(run_rng, defect_rate))
        v = eng.verdict(key); seen_flaky |= v == "FLAKY"
        if v == "PROVEN": return "PROVEN", a + 1, seen_flaky
        if policy == "B": tree = f"tree-{uid}-v1+ws{a}"           # whitespace edit, no behaviour change
    return v, attempts, seen_flaky

rng = random.Random(7)
r = 1 / 4000
for pol in "AB":
    res = [unit_loop(pol, r, rng, u) for u in range(2000)]
    print(f"policy {pol}: deterministic defect on 1/4000 of inputs, code unchanged: "
          f"PROVEN in {sum(x[0]=='PROVEN' for x in res)/20:.1f}% of 2000 units; FLAKY seen in {sum(x[2] for x in res)}")

# Intermittent defect under ONE key (policy B, no edits): multi-threaded writer reorders output on 25% of runs.
def clear_flaky(p, rng):
    eng, key, n = Engine(), "K", 0
    eng.record(key, False); n += 1                       # first run fails -> NOT_PROVEN, rerun
    while True:
        eng.record(key, rng.random() >= p); n += 1
        if eng.verdict(key) == "PROVEN": return n
rng = random.Random(11)
for p in (0.25, 0.5):
    ns = sorted(clear_flaky(p, rng) for _ in range(2000))
    print(f"intermittent defect failing {int(p*100)}% of runs: FLAKY cleared to PROVEN in 2000/2000 units, "
          f"median {ns[1000]} reruns, max {ns[-1]}")
