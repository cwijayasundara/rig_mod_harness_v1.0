# §3 lines 96,102 ; §6.2 lines 264,268-270. consumers: [] means external.
# Normalizer legal iff consumers_checked == graph consumers AND no listed consumer depends on what is erased.
graph = {  # observable -> consumers (graph node IDs); [] = external (line 96)
 "INTJOB/STEP1/SORTOUT.record_order": ["STEP2"],          # internal match-merge
 "PAYJOB/STEP9/ACHFILE.record_order": [],                  # NACHA file FTP'd to bank: external
}
depends_on_order = {"STEP2": True}
def normalizer_legal(norm):
    cons = graph[norm["observable"]]
    if sorted(norm["consumers_checked"]) != sorted(cons): return False, "consumers_checked mismatch"
    if any(depends_on_order.get(c, False) for c in cons): return False, "a consumer depends on order"
    return True, "no consumer depends on order"
for obs in graph:
    n = {"observable": obs, "erases": "order", "consumers_checked": list(graph[obs])}
    print(f"{obs:38s} consumers={graph[obs]!s:10s} order-normalizer legal: {normalizer_legal(n)}")
# legacy vs modern ACH output: batch header/entries/control must be in NACHA order
legacy = ["1HDR", "5BATCH", "6ENTRY-A", "6ENTRY-B", "8CONTROL", "9FILE"]
modern = ["9FILE", "8CONTROL", "6ENTRY-B", "6ENTRY-A", "5BATCH", "1HDR"]   # modern emits trailer-first (bank rejects)
norm = lambda recs: sorted(recs)
print("V3 ACHFILE through normalizer:", "PASS" if norm(legacy) == norm(modern) else "FAIL",
      "| raw files equal:", legacy == modern, "| modern order:", modern)
