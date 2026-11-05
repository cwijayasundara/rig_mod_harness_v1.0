"""Gate unit (PROPOSAL v0.2 §6.4, §3, §5.1) on a CardDemo-shaped graph.

Followed:
  §3   Observable.consumers = "graph node IDs that read this observable. Empty means external."
       store_write = "a create, update, or delete on a data store"; record_order/field on files.
       §3 example: SORTOUT.record_order lists STEP2 (a reader of the file) as a consumer.
  §6.4 "Gates now run at the gate unit, which is the smallest unit whose observation surface
       has only external consumers. Usually this is a job, a CICS transaction, or an API endpoint."
  §5.1 WU-T-0142 (CBACT04C) declares  gate_unit: job:INTJOB
  §8   Execute.open_session(unit, env) belongs to ONE Pack; nothing composes two Packs in one session.

Graph: CardDemo batch jobs and CICS transactions with the VSAM files each reads/writes
(from the CardDemo sources: CBACT04C, CBTRN02C, CBTRN03C, CBSTM03A/B, COACTUPC, COBIL00C, ...).
"""
units = {
    # unit: (reads, writes)
    "job:INTJOB":   ({"TCATBALF", "CARDXREF", "DISCGRP", "ACCTDATA"}, {"ACCTDATA", "TRANSACT"}),   # CBACT04C
    "job:POSTTRAN": ({"DALYTRAN", "CARDXREF", "ACCTDATA", "TCATBALF"}, {"ACCTDATA", "TCATBALF", "TRANSACT", "DALYREJS"}),  # CBTRN02C
    "job:TRANREPT": ({"TRANSACT", "CARDXREF", "TRANTYPE", "TRANCATG"}, {"TRANREPT.RPT"}),        # SORT + CBTRN03C
    "job:CREASTMT": ({"TRANSACT", "CARDXREF", "ACCTDATA", "CUSTDATA"}, {"STMTFILE", "HTMLFILE"}),  # CBSTM03A/B
    "job:READACCT": ({"ACCTDATA"}, {"ACCTFILE.RPT"}),                                            # CBACT01C
    "job:TRANBKP":  ({"TRANSACT"}, {"TRANSACT.BKUP(+1)"}),                                       # REPRO
    "job:READCARD": ({"CARDDATA"}, {"CARDFILE.RPT"}),
    "job:READCUST": ({"CUSTDATA"}, {"CUSTFILE.RPT"}),
    "txn:CAVW":     ({"ACCTDATA", "CUSTDATA", "CARDXREF"}, {"screen:COACTVW"}),                  # COACTVWC
    "txn:CAUP":     ({"ACCTDATA", "CUSTDATA", "CARDXREF"}, {"ACCTDATA", "CUSTDATA", "screen:COACTUP"}),  # COACTUPC
    "txn:CB00":     ({"ACCTDATA", "CARDXREF"}, {"ACCTDATA", "TRANSACT", "screen:COBIL00"}),     # COBIL00C bill pay
    "txn:CT00":     ({"TRANSACT"}, {"screen:COTRN00"}),                                          # COTRN00C browse
    "txn:CT01":     ({"TRANSACT"}, {"screen:COTRN01"}),
    "txn:CT02":     ({"CARDXREF"}, {"TRANSACT", "screen:COTRN02"}),                              # add transaction
    "txn:CCLI":     ({"CARDDATA"}, {"screen:COCRDLI"}),
    "txn:CCUP":     ({"CARDDATA"}, {"CARDDATA", "screen:COCRDUP"}),
    "txn:CC00":     ({"USRSEC"}, {"screen:COSGN00"}),
    "txn:CU01":     ({"USRSEC"}, {"USRSEC", "screen:COUSR01"}),
}

def consumers(store, producer):
    return sorted(u for u, (r, _) in units.items() if store in r and u != producer)

def surface(member_set):
    """Observables produced by the set, with consumers outside the set (internal ones are not on the surface)."""
    out = []
    for u in member_set:
        for s in units[u][1]:
            ext = [c for c in consumers(s, u) if c not in member_set]
            out.append((f"{s}.store_write", ext))
    return out

def gate_unit(start):
    members = {start}
    while True:
        internal = {c for _, cs in surface(members) for c in cs}
        if not internal:
            return members
        members |= internal

print("surface of job:INTJOB (consumers):")
for obs, cs in surface({"job:INTJOB"}):
    print(f"  {obs:24s} -> {cs}")
g = gate_unit("job:INTJOB")
jobs = sorted(m for m in g if m.startswith("job:")); txns = sorted(m for m in g if m.startswith("txn:"))
print(f"\nWU-T-0142 declares gate_unit = job:INTJOB ; job:INTJOB qualifies: {surface({'job:INTJOB'}) and all(not cs for _, cs in surface({'job:INTJOB'}))}")
print(f"computed gate unit for CBACT04C: {len(g)} of {len(units)} entry points ({len(jobs)} batch jobs + {len(txns)} CICS transactions)")
print("  ", jobs + txns)
translated = {"job:INTJOB"}
print(f"\nfirst T unit merges only if the modern gate unit runs: members translated {len(translated & g)}/{len(g)}"
      f" -> modern side runnable: {g <= translated}")
print("mixed legacy+modern session: needs cobol-zos Execute and java Execute in ONE open_session -> no such capability in §8")
