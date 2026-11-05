"""Probe 4: X-step VSAM KSDS (EBCDIC cp037, COMP-3) -> RDBMS (UTF-8, ORDER BY key, C/bytewise collation).

Gate per §3.3 'Applies to' column: X steps get V0, V1, V5, V7, V9 (V2/V3/V4/V6 do not list X).
V7 implemented as specified: row counts, numeric sum/min/max, per-record hashes after canonicalisation,
referential checks. Then the unchanged program logic (CICS STARTBR GTEQ + READNEXT paging, and a
sequential control-break listing) is run against each store.
"""
import hashlib
from collections import Counter
from decimal import Decimal as D

def pack(v, scale=2, digits=9):          # PIC S9(7)V99 COMP-3
    n = int(abs(v) * 10 ** scale)
    s = str(n).rjust(digits, "0") + ("D" if v < 0 else "C")
    return bytes.fromhex(s if len(s) % 2 == 0 else "0" + s)
def unpack(b, scale=2):
    h = b.hex().upper()
    v = D(int(h[:-1])).scaleb(-scale)
    return -v if h[-1] == "D" else v

ACCTS = [("A1001", "1200.50"), ("B7710", "-35.10"), ("10023", "99.99"), ("Z0001", "0.00"),
         ("90210", "4500.00"), ("C3300", "12.00"), ("00077", "800.25"), ("M5000", "61.70")]
# Legacy VSAM KSDS: 5-byte EBCDIC key + 5-byte COMP-3 balance; KSDS keeps records in key byte order.
vsam = sorted((k.encode("cp037") + pack(D(b)) for k, b in ACCTS), key=lambda r: r[:5])
# Target table after migration (same rows); the repository reads ORDER BY acct_id.
table = sorted(({"acct_id": k, "balance": D(b)} for k, b in ACCTS), key=lambda r: r["acct_id"])

def canon_legacy(rec):   # DataPack.canonicalize(record: bytes, layout) -> dict
    return {"acct_id": rec[:5].decode("cp037"), "balance": unpack(rec[5:])}
L = [canon_legacy(r) for r in vsam]
M = table
h = lambda d: hashlib.sha256(repr(sorted(d.items())).encode()).hexdigest()
checks = {
    "row_count": len(L) == len(M),
    "sum/min/max(balance)": all(f(x["balance"] for x in L) == f(x["balance"] for x in M)
                                for f in (sum, min, max)),
    "per-record hashes": Counter(map(h, L)) == Counter(map(h, M)),
    "referential (all ids present)": {x["acct_id"] for x in L} == {x["acct_id"] for x in M},
}
print("V7 reconciliation:", checks, "->", "PROVEN" if all(checks.values()) else "NOT_PROVEN")
rungs = {"V0": True, "V1": True, "V5": True, "V7": all(checks.values()), "V9": True}
print("X-step applicable rungs", list(rungs), "->", "PROVEN" if all(rungs.values()) else "NOT_PROVEN")

# Program behaviour: account-list screen = STARTBR RIDFLD('M0000') GTEQ, READNEXT x4
def page(ids, start, n=4):
    return [i for i in ids if i >= start][:n]
leg_ids = [x["acct_id"] for x in L]
mod_ids = [x["acct_id"] for x in M]
leg_page = [i for i in leg_ids if i.encode("cp037") >= "M0000".encode("cp037")][:4]
print("browse page from 'M0000'  legacy:", leg_page, " modern:", page(mod_ids, "M0000"))
print("sequential listing order  legacy:", leg_ids)
print("                          modern:", mod_ids)
