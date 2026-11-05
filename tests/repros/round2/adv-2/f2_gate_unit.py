# §6.4 line 303: gate unit = smallest unit whose observation surface has only external consumers.
# §5.1 line 180 example: gate_unit: job:INTJOB.  CardDemo-shaped graph: programs, what they write, who reads.
writes = {  # program -> stores it writes (store_write observables)
 "CBACT04C": ["ACCTFILE", "TRANSACT"],   # INTJOB interest calc
 "CBTRN02C": ["ACCTFILE", "TCATBALF"],   # POSTTRAN
 "CBSTM03A": ["STMTFILE"],               # CREASTMT
 "COACTUPC": ["ACCTFILE"],               # CICS account update
 "COBIL00C": ["ACCTFILE", "TRANSACT"],   # CICS bill pay
 "COTRN02C": ["TRANSACT"],               # CICS add transaction
}
reads = {
 "CBACT04C": ["ACCTFILE", "TCATBALF", "DISCGRP"], "CBTRN02C": ["DALYTRAN", "ACCTFILE"],
 "CBSTM03A": ["TRANSACT", "ACCTFILE"], "COACTUPC": ["ACCTFILE"], "COBIL00C": ["ACCTFILE"],
 "COTRN02C": ["TRANSACT", "ACCTFILE"], "COACTVWC": ["ACCTFILE"], "CORPT00C": ["TRANSACT"],
}
progs = set(reads) | set(writes)
def consumers(store): return {p for p in progs if store in reads.get(p, [])}
def gate_unit(seed):
    unit = {seed}
    while True:
        internal = {c for p in unit for s in writes.get(p, []) for c in consumers(s)} - unit
        if not internal: return unit
        unit |= internal
INTJOB = {"CBACT04C"}
external_only = all(consumers(s) <= INTJOB for p in INTJOB for s in writes.get(p, []))
print("job:INTJOB surface has only external consumers?", external_only)
g = gate_unit("CBACT04C")
print(f"computed gate unit for CBACT04C: {len(g)} of {len(progs)} programs ->", sorted(g))
