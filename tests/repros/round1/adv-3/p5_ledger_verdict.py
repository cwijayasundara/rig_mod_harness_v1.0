"""Probe 5: §7 evidence ledger + verdict engine, built as specified:
'each evidence file is content-hashed and linked to (module, rung, commit, oracle version).
 The verdict engine recomputes from the ledger only. A verdict citing a stale commit is invalid.'

Scenario: WU-T-0142 translated INTCALC with truncation where COBOL uses ROUNDED.
Run 1: V3 with normalizers [comp3_bigdecimal]            -> FAIL
Run 2: same commit, same oracle, normalizers + float_tolerance(0.01) -> PASS   (normalizer files are
        not under any human gate in §8, and are not part of the ledger key)
"""
import hashlib, json, random, sys
from decimal import Decimal
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cobol import compute_rounded, compute_truncated

random.seed(11)
accts = [(Decimal(random.randint(1, 2_000_000)) / 100, Decimal("0.1299")) for _ in range(100_000)]
legacy = [compute_rounded(b * a / 365, 2) for b, a in accts]
modern = [compute_truncated(b * a / 365, 2) for b, a in accts]

def v3(normalizers):
    tol = Decimal(normalizers.get("float_tolerance", "0"))
    mism = sum(1 for l, m in zip(legacy, modern) if abs(l - m) > tol)
    return "PASS" if mism == 0 else "FAIL", mism

ledger = []
def record(run, rung, commit, oracle_version, normalizers):
    result, mism = v3(normalizers)
    evidence = json.dumps({"run": run, "result": result, "mismatches": mism, "normalizers": normalizers})
    ledger.append({"module": "accounts", "rung": rung, "commit": commit, "oracle_version": oracle_version,
                   "evidence_sha": hashlib.sha256(evidence.encode()).hexdigest()[:12], "result": result, "seq": run})

record(1, "V3", "c0ffee1", "orc-v4", {"comp3_bigdecimal": True})
record(2, "V3", "c0ffee1", "orc-v4", {"comp3_bigdecimal": True, "float_tolerance": "0.01"})
record(3, "V3", "c0ffee1", "orc-v4", {"comp3_bigdecimal": True})   # a 3rd run: sandbox OOM reported as FAIL
ledger[-1]["result"] = "FAIL"

def verdict(module, rung, commit, policy):
    es = [e for e in ledger if (e["module"], e["rung"], e["commit"]) == (module, rung, commit)]
    if not es:
        return "NOT_PROVEN(no evidence)"
    if policy == "latest_wins":
        return "PROVEN" if max(es, key=lambda e: e["seq"])["result"] == "PASS" else "NOT_PROVEN"
    if policy == "any_fail_wins":
        return "NOT_PROVEN" if any(e["result"] == "FAIL" for e in es) else "PROVEN"
    if policy == "any_pass_wins":
        return "PROVEN" if any(e["result"] == "PASS" for e in es) else "NOT_PROVEN"

print("per-record max |legacy-modern| :", max(abs(l - m) for l, m in zip(legacy, modern)))
print("GL total legacy - modern       :", sum(legacy) - sum(modern), " over 100,000 accounts (one day)")
for e in ledger:
    print("ledger:", {k: e[k] for k in ("rung", "commit", "oracle_version", "evidence_sha", "result")})
print("same ledger key for run1 and run2:", all(ledger[0][k] == ledger[1][k] for k in ("module", "rung", "commit", "oracle_version")))
del ledger[2]
print("verdict (runs 1,2) policy=latest_wins   :", verdict("accounts", "V3", "c0ffee1", "latest_wins"))
print("verdict (runs 1,2) policy=any_pass_wins :", verdict("accounts", "V3", "c0ffee1", "any_pass_wins"))
record(3, "V3", "c0ffee1", "orc-v4", {"comp3_bigdecimal": True}); ledger[-1]["result"] = "FAIL"  # infra flake
ledger[0]["result"] = "PASS"  # pretend run 1 was correct work that passed
print("correct work + one flaky FAIL, policy=any_fail_wins:", verdict("accounts", "V3", "c0ffee1", "any_fail_wins"),
      "(immutable ledger: cannot be cleared at this commit)")
