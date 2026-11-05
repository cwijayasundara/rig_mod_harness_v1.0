"""Probe 1: X-step (VSAM -> RDBMS) under Rule 1 + V7.

Legacy: VSAM KSDS, keys ordered by EBCDIC bytes. Program does
    START ACCT-FILE KEY >= 'A'   then READ NEXT x 3   (a browse).
Modern after the X-step: same rows in a SQL table; repository does
    SELECT ... WHERE key >= 'A' ORDER BY key LIMIT 3
sqlite BINARY collation == byte order == Postgres COLLATE "C" (the most faithful choice).

V7 as specified: row counts, column aggregates, per-record hashes after canonicalisation.
"""
import sqlite3
from decimal import Decimal
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cobol import ebcdic_key, ebcdic_ge, comp3_pack, comp3_unpack, sha

rows = [("ab12", "12.50"), ("AB12", "20.00"), ("12AB", "5.25"), ("a1B2", "7.00"),
        ("ZED1", "1.00"), ("zed1", "3.00"), ("B001", "9.99"), ("9XYZ", "4.44")]

# ---- legacy VSAM: records stored as EBCDIC key + COMP-3 balance, physically in key order
vsam = sorted(((ebcdic_key(k), comp3_pack(Decimal(b), 7, 2)) for k, b in rows), key=lambda r: r[0])
def legacy_browse(start: str, n: int):
    out = []
    for k, b in vsam:  # START positions at first key >= start (EBCDIC compare), READ NEXT sequential
        if k >= ebcdic_key(start):
            out.append(k.decode("cp037"))
            if len(out) == n:
                break
    return out

# ---- modern: after X-step migration job (canonicalize EBCDIC/COMP-3 -> text/decimal)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE acct(acct_key TEXT PRIMARY KEY, balance TEXT)")
for k, b in vsam:
    db.execute("INSERT INTO acct VALUES (?, ?)", (k.decode("cp037"), str(comp3_unpack(b, 2))))
def modern_browse(start: str, n: int):
    return [r[0] for r in db.execute(
        "SELECT acct_key FROM acct WHERE acct_key >= ? ORDER BY acct_key LIMIT ?", (start, n))]

# ---- V7 reconciliation exactly as §3.3 lists it
legacy_canon = [(k.decode("cp037"), comp3_unpack(b, 2)) for k, b in vsam]
modern_canon = [(k, Decimal(b)) for k, b in db.execute("SELECT acct_key, balance FROM acct")]
v7 = {
    "row_count": (len(legacy_canon), len(modern_canon)),
    "sum_balance": (sum(b for _, b in legacy_canon), sum(b for _, b in modern_canon)),
    "min_max": ((min(b for _, b in legacy_canon), max(b for _, b in legacy_canon)),
                (min(b for _, b in modern_canon), max(b for _, b in modern_canon))),
    "record_hash_set_equal": {sha(r) for r in legacy_canon} == {sha(r) for r in modern_canon},
}
v7_pass = all(a == b for a, b in list(v7.values())[:3]) and v7["record_hash_set_equal"]
print("V7 reconciliation:", v7, "=> ", "PASS" if v7_pass else "FAIL")

lb, mb = legacy_browse("A", 5), modern_browse("A", 5)
print("legacy browse START KEY>='A', 5 x READ NEXT :", lb)
print("modern  SELECT key>='A' ORDER BY key LIMIT 5  :", mb)
print("browse equivalent:", lb == mb)
sel_l = sorted(k for k, _ in legacy_canon if ebcdic_ge(k, "A"))
sel_m = sorted(r[0] for r in db.execute("SELECT acct_key FROM acct WHERE acct_key >= 'A'"))
print("row SET selected by key>='A'  legacy:", sel_l)
print("row SET selected by key>='A'  modern:", sel_m)
print("X-step changed behaviour (second axis) while V7 passed:", v7_pass and (lb != mb or sel_l != sel_m))
