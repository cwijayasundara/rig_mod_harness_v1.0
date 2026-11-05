"""Normalizer legality (PROPOSAL v0.2 §6.2, §3, §6.4) at the gate unit.

Followed:
  §3   consumers: "graph node IDs that read this observable. Empty means external."
       "A normalizer can erase record order only when the graph shows no consumer reads it."
  §6.2 "legal only when its observable has no consumer that depends on what it erases.
        The harness checks consumers_checked against the graph at every run."
       consumers_checked "must equal the observable's consumers in the graph".
  §6.4 the gate unit's surface "has only external consumers"; V3 runs there "through approved normalizers".
COBOL: SORT on z/OS collates in EBCDIC (cp037); the Java port sorts with String.compareTo (UTF-16 = ASCII here).
"""
graph_consumers = {
    "INTJOB/STEP1/SORTOUT.record_order": ["INTJOB/STEP2"],   # STEP2 match-merges (internal)
    "INTJOB/STEP2/GLFEED.record_order":  [],                 # job output, NDM'd to the GL bureau -> external
}

def legal(norm):
    cs = graph_consumers[norm["observable"]]
    if sorted(norm["consumers_checked"]) != sorted(cs):
        return False, "consumers_checked != graph"
    if norm["erases"] == "order" and cs:          # §3: graph must show no consumer reads the order
        return False, f"consumer(s) read order: {cs}"
    return True, "no consumer in graph"

NORM_012 = dict(id="NORM-012", observable="INTJOB/STEP1/SORTOUT.record_order", erases="order",
                consumers_checked=["REPT01"])          # exactly as printed in §6.2
NORM_GL  = dict(id="NORM-031", observable="INTJOB/STEP2/GLFEED.record_order", erases="order",
                consumers_checked=[])
for n in (NORM_012, NORM_GL):
    print(f"{n['id']} on {n['observable']:36s} legal={legal(n)}")

keys = ["A1000", "a1000", "10000", "Z0001", "00077", "B 500"]
legacy = sorted(keys, key=lambda k: k.encode("cp037"))      # DFSORT, EBCDIC
modern = sorted(keys)                                        # Java String.compareTo
print("\nGLFEED order legacy (EBCDIC):", legacy)
print("GLFEED order modern (ASCII) :", modern)
ok, _ = legal(NORM_GL)
v3 = (sorted(legacy) == sorted(modern)) if ok else (legacy == modern)
print(f"V3 at gate unit job:INTJOB through NORM-031: {'PASS' if v3 else 'FAIL'}")

def bureau_match(feed, master):
    """External consumer: classic sequential match-merge against its own EBCDIC-ordered master."""
    i = j = matched = 0
    while i < len(feed) and j < len(master):
        a, b = feed[i].encode("cp037"), master[j].encode("cp037")
        if a == b: matched += 1; i += 1; j += 1
        elif a < b: i += 1
        else: j += 1
    return matched
print(f"GL bureau match-merge: legacy feed matched {bureau_match(legacy, legacy)}/6, modern feed matched {bureau_match(modern, legacy)}/6")
