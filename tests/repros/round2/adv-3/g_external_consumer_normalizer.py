"""G. §3 says an empty consumer list means "external"; §6.2 makes an order
normalizer legal when the observable has "no consumer". An external consumer,
or a consumer the static graph cannot resolve (dynamic CALL), therefore makes
erasing order legal, and the finding-3 EBCDIC sort bug passes.

Built from:
  - Observable.consumers, line 96: "graph node IDs that read this observable.
    Empty means external."
  - §4.1 line 113: graph built deterministically by Pack parsers.
  - Normalizer record, lines 259-265, and the legality rule, line 270: legal
    "only when its observable has no consumer that depends on what it erases.
    The harness checks consumers_checked against the graph at every run."
"""
import re

# --- deterministic graph builder (Pack parser): literal CALL / DD-name edges ----
PROGRAMS = {
    "CBSTM03A": """
        WRITE STMT-REC.
        MOVE 'CBSTM03B' TO WS-NEXT-PGM.
        CALL WS-NEXT-PGM USING STMT-FILE-NAME.
    """,
    "CBSTM03B": """
        READ STMTFILE NEXT RECORD.
        IF STMT-ACCT < WS-PREV-ACCT DISPLAY 'SEQUENCE ERROR' STOP RUN.
    """,
}
def build_graph(programs):
    edges = []
    for p, src in programs.items():
        for m in re.finditer(r"CALL\s+'([A-Z0-9]+)'", src):        # literal CALL only
            edges.append((p, "calls", m.group(1)))
        for m in re.finditer(r"READ\s+([A-Z0-9]+)", src):
            edges.append((p, "reads", m.group(1)))
        for m in re.finditer(r"WRITE\s+([A-Z0-9-]+)", src):
            edges.append((p, "writes", "STMTFILE"))
    return edges

graph = build_graph(PROGRAMS)
def consumers_of(store, writer):
    # a consumer is a node that reads the store AND is reachable from the writer's job
    reach = {t for s, k, t in graph if s == writer and k == "calls"}
    return sorted(t for t in reach if (t, "reads", store) in {(s, k, t) for s, k, t in graph})

observable = {"id": "CREASTMT/STMTFILE.record_order", "kind": "record_order",
              "consumers": consumers_of("STMTFILE", "CBSTM03A")}
print("graph edges                     :", graph)
print("observable consumers (line 96)  :", observable["consumers"], "-> 'external'")

# --- NORM-013 per lines 259-265 ----------------------------------------------
norm = {"id": "NORM-013", "observable": observable["id"], "erases": "order",
        "justification": "No consumer in graph. File leaves the system.",
        "consumers_checked": [], "approved_by": "bob"}

def normalizer_legal(norm, obs):                     # line 270
    return norm["consumers_checked"] == obs["consumers"] and len(obs["consumers"]) == 0

print("normalizer legal (§6.2 check)   :", normalizer_legal(norm, observable))

# --- V3 at the gate unit through the approved normalizer ------------------------
accts = ["a001", "B002", "1003", " 004", "Z005"]
legacy = sorted(accts, key=lambda s: s.encode("cp037"))     # EBCDIC SORT
modern = sorted(accts)                                        # Java String.compareTo
def v3(legacy, modern, norms):
    if any(n["erases"] == "order" for n in norms):
        return sorted(legacy) == sorted(modern)
    return legacy == modern
print("V3 with NORM-013                :", "PASS" if v3(legacy, modern, [norm]) else "FAIL")

# --- the two real consumers --------------------------------------------------------
# 1. CBSTM03B, reached through the dynamic CALL the parser could not resolve
def cbstm03b(records):
    prev = None
    for r in records:
        if prev is not None and r < prev: return "SEQUENCE ERROR, STOP RUN"
        prev = r
    return "OK"
# 2. external print vendor, who match-merges against their own EBCDIC-sorted file
vendor_sorted = sorted(accts, key=lambda s: s.encode("cp037"))
def vendor_merge(records): return "OK" if records == vendor_sorted else "MERGE FAILED"

print("CBSTM03B on legacy order        :", cbstm03b([r.encode('cp037') for r in legacy]))
print("CBSTM03B on modern order        :", cbstm03b([r.encode('cp037') for r in modern]))
print("print vendor on modern order    :", vendor_merge(modern))
