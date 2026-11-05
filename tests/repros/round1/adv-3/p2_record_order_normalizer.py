"""Probe 2: V3 'record order' normalizer + 'V0-V6 PROVEN per program' gate (Phase C).

Job INTJOB = STEP1 (COBOL SORT ON ASCENDING KEY CUST-NAME) -> STEP2 (keep FIRST record per account).
Each program is a separate T work unit, each proven by V3 on its own inputs.
Modern STEP1 sorts with Java natural String order (modelled as code-point order).
"""
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cobol import ebcdic_sorted

# (account, name, amount)  -- one account has two names differing in case; another mixes digits
records = [("1001", "smith", 10), ("1001", "SMITH", 20), ("2002", "9ERS", 5), ("2002", "Apple", 7),
           ("3003", "beta", 1), ("3003", "Beta", 2), ("4004", "x", 3)]

def legacy_step1(recs):  # z/OS SORT: EBCDIC collation on NAME
    return ebcdic_sorted(recs, key=lambda r: r[1])
def modern_step1(recs):  # Java Collections.sort(byName) / String.compareTo
    return sorted(recs, key=lambda r: r[1])
def step2_keep_first(recs):  # identical logic both sides (control break, first wins)
    seen, out = set(), []
    for r in recs:
        if r[0] not in seen:
            seen.add(r[0]); out.append(r)
    return out

def v3(legacy_out, modern_out, normalizers):
    a, b = list(legacy_out), list(modern_out)
    if "record_order" in normalizers:
        a, b = sorted(a), sorted(b)
    return "PASS" if a == b else "FAIL"

l1, m1 = legacy_step1(records), modern_step1(records)
print("WU-T-STEP1  V3 normalizers=[]              :", v3(l1, m1, []))
print("WU-T-STEP1  V3 normalizers=[record_order]  :", v3(l1, m1, ["record_order"]), " <- declared, unit PROVEN")
# STEP2 unit is tested on the SAME recorded input (legacy STEP1 output) on both sides:
print("WU-T-STEP2  V3 on recorded input           :", v3(step2_keep_first(l1), step2_keep_first(l1), []))
# Job end to end, which no rung in the T gate (V0-V6) runs:
le, me = step2_keep_first(l1), step2_keep_first(m1)
print("INTJOB end-to-end legacy :", le)
print("INTJOB end-to-end modern :", me)
print("INTJOB equivalent        :", le == me)
