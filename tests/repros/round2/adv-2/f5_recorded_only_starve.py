# §6.1 line 250 (sealed >= max(20, 25% pool); top up from generators before the unit starts),
# §6.1 line 251 + §5.3 rule 3 (fresh drawn at judge time), §4.3 line 154 (hazard generator must have run),
# §6.5 lines 365, 374-375 (legacy cannot execute -> V2..V6 on recorded I/O -> PROVISIONAL).
# A Case needs `expected` = legacy observations (line 242). Generated inputs have none unless legacy executes.
class Unit:
    def __init__(s, name, recorded, hazards, legacy_exec): s.n, s.rec, s.hz, s.ex = name, recorded, hazards, legacy_exec
def make_case(inp, unit):
    if inp["origin"] == "recorded": return {"input": inp, "expected": inp["recorded_out"]}
    if not unit.ex: raise RuntimeError("no legacy Execute: cannot compute expected for generated input")
    return {"input": inp, "expected": "legacy-run"}
def start_unit(u):
    pool = [{"origin": "recorded", "recorded_out": i} for i in range(u.rec)]
    need = max(20, (len(pool) + 3) // 4)
    sealed_from_pool = min(len(pool) // 2, need)
    try:
        topped = [make_case({"origin": "hazard"}, u) for _ in range(need - sealed_from_pool)]
    except RuntimeError as e: return f"cannot start: sealed {sealed_from_pool}/{need}; {e}"
    return "started"
def judge(u):
    try: [make_case({"origin": h}, u) for h in u.hz]
    except RuntimeError as e: return f"V4 FAIL: required hazard generators {u.hz} not run ({e})"
    return "V4 ok"
for u in [Unit("CBACT04C (logs-only estate)", 12, ["rounded_ties", "size_error"], False),
          Unit("CBACT04C (logs-only, big pool)", 5000, ["rounded_ties", "size_error"], False),
          Unit("CBACT04C (GnuCOBOL runs)", 12, ["rounded_ties", "size_error"], True)]:
    s = start_unit(u); j = judge(u) if s == "started" else "-"
    reach = "PROVISIONAL" if s == "started" and j == "V4 ok" and not u.ex else ("PROVEN" if s == "started" and j == "V4 ok" else "NOT_PROVEN (no path to merge)")
    print(f"{u.n:32s} start: {s} | judge: {j} | best verdict: {reach}")
