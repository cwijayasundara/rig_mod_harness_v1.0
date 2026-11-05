"""Probe 6: verdict policy as written in §3.3 / §4, run to a fixpoint over the programme DAG.

  * "T-steps require V0-V6 PROVEN" (§3.3) / Phase C "Gate: V0-V6 PROVEN per program" (§4)
  * Max verdict table (§3.3): no-exec -> "PARTLY_PROVEN -> PROVEN after V10";
    nothing recorded -> "PARTLY_PROVEN (must reach V10 before cutover)"
  * V10 "Applies to: E" ; programme DAG T -> R -> X -> E (§2), a step starts only when its predecessor merged
"""
ORDER = ["PROVEN", "PARTLY_PROVEN", "NOT_PROVEN"]
CAP = {"gnucobol": "PROVEN", "test-lpar": "PROVEN", "no-exec-logs-only": "PARTLY_PROVEN",
       "nothing-recorded": "PARTLY_PROVEN"}
DAG = ["T", "R", "X", "E"]
GATE = {"T": [f"V{i}" for i in range(0, 7)], "R": ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V8"],
        "X": ["V0", "V1", "V5", "V7", "V9"], "E": ["V7", "V8", "V9", "V10"]}

def rung_verdict(situation, rung, v10_done):
    if rung in ("V0", "V1"):
        return "PROVEN"                       # static rungs do not depend on legacy execution
    cap = CAP[situation]
    if cap != "PROVEN" and v10_done:
        cap = "PROVEN"                        # "PARTLY_PROVEN -> PROVEN after V10"
    return cap                                # assume the code is perfect: best achievable verdict

for situation in CAP:
    merged, v10_done = [], False
    for _ in range(20):                       # scheduler iterations until fixpoint
        nxt = next((s for s in DAG if s not in merged), None)
        if nxt is None:
            break
        verdicts = {r: rung_verdict(situation, r, v10_done) for r in GATE[nxt]}
        if all(v == "PROVEN" for v in verdicts.values()):
            merged.append(nxt)
            v10_done = v10_done or nxt == "E"
        else:
            blocked = {r: v for r, v in verdicts.items() if v != "PROVEN"}
            break
    state = "cutover reachable" if merged == DAG else f"STUCK before {nxt}: {blocked}"
    print(f"{situation:18s} merged={merged} V10_run={v10_done} -> {state}")
