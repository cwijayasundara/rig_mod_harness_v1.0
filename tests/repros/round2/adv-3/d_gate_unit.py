"""D. The gate-unit definition (§6.4, line 303) computed on a CardDemo-shaped
graph is the whole system; the §5.1 example `gate_unit: job:INTJOB` contradicts
it; and the only relaxation that gives a job-sized unit re-admits the finding-3
bug.

Built from:
  - Observable.consumers, line 96: "graph node IDs that read this observable.
    Empty means external."
  - §4.1 graph edges `reads`, `writes`; §3 kinds store_write, record_order.
  - §6.4 line 303: "the smallest unit whose observation surface has only
    external consumers. ... A program that feeds another program has internal
    consumers, so its gate runs at the job level."
  - §5.1 lines 169 and 180: observables [INTCALC/ACCTFILE.accrued_interest,
    INTCALC.return_code], gate_unit: job:INTJOB.
"""
# CardDemo-shaped graph: programs grouped into jobs / CICS transactions, with the
# stores each one reads and writes (from the CardDemo README and JCL).
UNITS = {
    # batch jobs
    "job:POSTTRAN":  {"CBTRN02C": {"reads": ["DALYTRAN", "XREF", "CARDDAT", "ACCTDAT", "TCATBAL"],
                                   "writes": ["TRANSACT", "ACCTDAT", "TCATBAL", "DALYREJS"]}},
    "job:INTJOB":    {"CBACT04C": {"reads": ["TCATBAL", "XREF", "DISCGRP", "ACCTDAT"],
                                   "writes": ["ACCTDAT", "TRANSACT"]}},
    "job:CREASTMT":  {"CBSTM03A": {"reads": ["TRANSACT", "XREF", "CUSTDAT", "ACCTDAT"],
                                   "writes": ["STMTFILE", "STMTHTML"]},
                      "CBSTM03B": {"reads": ["STMTFILE"], "writes": ["STMTPRNT"]}},
    "job:TRANBKP":   {"CBTRN03C": {"reads": ["TRANSACT", "CARDDAT", "XREF", "TRANTYPE", "TRANCATG"],
                                   "writes": ["TRANREPT"]}},
    "job:COMBTRAN":  {"CBEXP01":  {"reads": ["TRANSACT"], "writes": ["TRANEXP"]}},
    # CICS transactions
    "tx:CAUP":       {"COACTUPC": {"reads": ["ACCTDAT", "CUSTDAT", "XREF"], "writes": ["ACCTDAT", "CUSTDAT"]}},
    "tx:CAVW":       {"COACTVWC": {"reads": ["ACCTDAT", "CUSTDAT", "XREF"], "writes": []}},
    "tx:CT02":       {"COTRN02C": {"reads": ["ACCTDAT", "XREF", "TRANSACT"], "writes": ["TRANSACT"]}},
    "tx:CCUP":       {"COCRDUPC": {"reads": ["CARDDAT"], "writes": ["CARDDAT"]}},
    "tx:CUSR":       {"COUSR01C": {"reads": ["USRSEC"], "writes": ["USRSEC"]}},
    "tx:CRPT":       {"CORPT00C": {"reads": [], "writes": ["JOBSUB"]}},
}
EXTERNAL_ONLY = {"STMTPRNT", "TRANREPT", "TRANEXP", "DALYREJS", "STMTHTML", "JOBSUB"}  # leave the system

prog_unit = {p: u for u, ps in UNITS.items() for p in ps}
readers = {}
for u, ps in UNITS.items():
    for p, io in ps.items():
        for s in io["reads"]:
            readers.setdefault(s, set()).add(p)

def surface(programs):
    """Observables of a set of programs: store_write per written store, with
    consumers = graph nodes that read that store (line 96)."""
    obs = []
    for p in programs:
        u = prog_unit[p]
        for s in UNITS[u][p]["writes"]:
            consumers = sorted(readers.get(s, set()) - set(programs)) if s not in EXTERNAL_ONLY else []
            obs.append({"id": f"{p}/{s}.store_write", "kind": "store_write", "consumers": consumers})
    return obs

def gate_unit(start_unit):
    """Smallest enclosing set of units whose surface has only external consumers."""
    units = {start_unit}
    while True:
        programs = [p for u in units for p in UNITS[u]]
        internal = {c for o in surface(programs) for c in o["consumers"]}
        new_units = {prog_unit[c] for c in internal} - units
        if not new_units:
            return units
        units |= new_units

for u in ["job:INTJOB", "job:CREASTMT", "tx:CAVW", "tx:CUSR"]:
    g = gate_unit(u)
    print(f"gate_unit({u:13s}) = {len(g):2d} of {len(UNITS)} units -> "
          f"{'WHOLE SYSTEM minus ' + ','.join(sorted(set(UNITS) - g)) if len(g) > 1 else 'itself'}")

print()
print("§5.1 example says gate_unit: job:INTJOB. INTJOB's own surface:")
for o in surface(["CBACT04C"]):
    print(f"  {o['id']:32s} consumers={o['consumers']}")
print("  -> internal consumers exist, so by §6.4 INTJOB is not a gate unit.")

# Relaxation: count a consumer across a persistent store as external (the only
# reading that yields job-sized gate units). Then the finding-3 bug returns.
print()
print("Relaxation 'consumers across a persistent store are external':")
def cp037_key(s): return s.encode("cp037")
legacy_order = sorted(["a1", "B2", "10", " 5", "Z9"], key=cp037_key)
modern_order = sorted(["a1", "B2", "10", " 5", "Z9"])                   # ASCII
print("  job:CREASTMT STMTFILE.record_order consumers -> [] (CBSTM03B now 'external')")
print("  NORM erasing order is legal (§6.2 line 270: no consumer)  ->  CREASTMT step 1 PASS")
print(f"  legacy (EBCDIC) order {legacy_order}  modern (ASCII) order {modern_order}")
print(f"  step 2 match-merge reads the file in order: equivalent = {legacy_order == modern_order}")
