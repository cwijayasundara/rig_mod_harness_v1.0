"""B. Evidence key + fresh inputs make FLAKY unreachable; with seeds pinned, the
FLAKY rule launders an intermittent bug.

Built from:
  - EvidenceKey, lines 331-340: oracle_set = "hash of the dev and sealed sets,
    and generator versions and seeds".
  - Judge rule 3, line 201: "Each judge run draws new inputs from the unit's
    fresh generators".
  - Verdict rules, lines 363-364: evidence is matched by key; "When runs under
    the same key disagree, the verdict is FLAKY ... blocks merge until ... 5
    consecutive reruns pass."
"""
import hashlib, json, random
from dataclasses import dataclass, asdict

def h(*parts):
    return hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12]

@dataclass(frozen=True)
class EvidenceKey:
    module: str; rung: str; dependency_closure: str; legacy_tree: str
    oracle_set: str; comparators: str; packs: str; environment: str

def judge_run(module, rung, dev_hash, sealed_hash, gen_versions, rng):
    seed = rng.getrandbits(64)                     # line 201: new inputs each run
    key = EvidenceKey(module, rung, "dc1", "lt1",
                      oracle_set=h(dev_hash, sealed_hash, gen_versions, seed),   # line 336
                      comparators="cmp1", packs="p1", environment="env1")
    return key, seed

rng = random.Random(7)
k1, s1 = judge_run("accounts", "V4", "dev@91c4", "sealed@e02a", "gen-1.0", rng)
k2, s2 = judge_run("accounts", "V4", "dev@91c4", "sealed@e02a", "gen-1.0", rng)
print("judge run 1 key.oracle_set :", k1.oracle_set, " seed", s1)
print("judge run 2 key.oracle_set :", k2.oracle_set, " seed", s2)
print("same key for the two runs  :", k1 == k2)

# Verdict engine, line 363-364
def verdict(evidence, current_key):
    live = [r for k, r in evidence if k == current_key]      # stale evidence ignored
    if not live:
        return "NO_EVIDENCE"
    if len(set(live)) > 1:
        return "FLAKY"
    return "PROVEN" if live[0] == "pass" else "NOT_PROVEN"

evidence = [(k1, "fail"), (k2, "pass")]          # an intermittent failure then a pass
print("verdict under run-2 key    :", verdict(evidence, k2), "  (run 1 is stale: different key)")
print("verdict under run-1 key    :", verdict(evidence, k1))
print("-> a disagreement between judge runs can never be classified FLAKY,")
print("   and '5 consecutive reruns under the same key' cannot be counted.")

# --- Now pin the seed so the key is stable, and apply the FLAKY rule literally ---
print()
print("With seeds pinned (key stable), FLAKY rule: blocked until 5 consecutive passes")
def flaky_policy(p_fail, max_reruns, rng):
    """Returns True if the unit ends PROVEN via the 5-consecutive-pass rule."""
    # first two runs disagree -> FLAKY (we condition on having observed a flake)
    streak = 0
    for _ in range(max_reruns):
        if rng.random() < p_fail:
            streak = 0
        else:
            streak += 1
            if streak == 5:
                return True
    return False

for p_fail in (0.05, 0.15, 0.30):
    for max_reruns in (5, 10, 30):
        rng = random.Random(1)
        n = 20000
        wins = sum(flaky_policy(p_fail, max_reruns, rng) for _ in range(n))
        print(f"  bug fails {int(p_fail*100):>2}% of runs, rerun budget {max_reruns:>2}: "
              f"PROVEN in {wins/n*100:5.1f}% of units")
