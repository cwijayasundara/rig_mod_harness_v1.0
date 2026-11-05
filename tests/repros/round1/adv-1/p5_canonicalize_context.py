"""Probe 5: §5 DataPack.canonicalize(record: bytes, layout: Layout) -> dict is per-record and stateless.

File = NACHA-style ACH batch file in EBCDIC. Entry-detail cols 55-76 are a REDEFINES whose active view
is selected by the SEC code in the preceding *batch header* record (a different record):
    05 ENTRY-VAR            PIC X(22).
    05 PPD-VIEW REDEFINES ENTRY-VAR.   10 INDIVIDUAL-NAME PIC X(22).
    05 CTX-VIEW REDEFINES ENTRY-VAR.   10 NUM-ADDENDA PIC 9(4). 10 RECV-COMPANY PIC X(16). 10 FILLER X(2).
Two candidate VSAM->Postgres migrations are reconciled with V7 per-record hashes.
"""
import hashlib
from collections import Counter

def rec(s): return s.ljust(94).encode("cp037")
FILE = [rec("5200ACME PAYROLL     PPD"),
        rec("6" + " " * 38 + "EMP000000000017" + "JANE Q PUBLIC"),
        rec("6" + " " * 38 + "EMP000000000018" + "JOHN SMITH"),
        rec("5200ACME TRADE       CTX"),
        rec("6" + " " * 38 + "INV000000004411" + "0003" + "GLOBEX CORP".ljust(16) + "  "),
        rec("6" + " " * 38 + "INV000000004412" + "0001" + "INITECH LLC".ljust(16) + "  ")]

LAYOUT = {"id": (39, 54), "var": (54, 76),
          "views": {"PPD": {"individual_name": (0, 22)},
                    "CTX": {"num_addenda": (0, 4), "recv_company": (4, 20)}},
          "default_view": "PPD"}

def canonicalize(record: bytes, layout) -> dict:          # the §5 signature, nothing else available
    t = record.decode("cp037")
    if t[0] != "6":
        return {"type": t[0], "raw": t.rstrip()}
    var = t[slice(*layout["var"])]
    view = layout["views"][layout["default_view"]]         # no header in scope -> must guess
    d = {"type": "6", "id": t[slice(*layout["id"])]}
    d.update({k: var[slice(*r)].rstrip() for k, r in view.items()})
    return d

def canonicalize_with_context(records, layout):            # what the data actually needs
    sec, out = None, []
    for r in records:
        t = r.decode("cp037")
        if t[0] == "5":
            sec = t[21:24]; out.append({"type": "5", "raw": t.rstrip()}); continue
        var = t[slice(*layout["var"])]
        d = {"type": "6", "id": t[slice(*layout["id"])]}
        d.update({k: (int(var[slice(*rg)]) if k == "num_addenda" else var[slice(*rg)].rstrip())
                  for k, rg in layout["views"][sec].items()})
        out.append(d)
    return out

hdr = [{"type": "5", "raw": r.decode("cp037").rstrip()} for r in FILE if r[:1] == "5".encode("cp037")]
ent = lambda i, **kw: {"type": "6", "id": i, **kw}
CORRECT = hdr + [ent("EMP000000000017", individual_name="JANE Q PUBLIC"),
                 ent("EMP000000000018", individual_name="JOHN SMITH"),
                 ent("INV000000004411", num_addenda=3, recv_company="GLOBEX CORP"),
                 ent("INV000000004412", num_addenda=1, recv_company="INITECH LLC")]
BUGGY = hdr + [ent("EMP000000000017", individual_name="JANE Q PUBLIC"),     # decodes every entry as PPD
               ent("EMP000000000018", individual_name="JOHN SMITH"),
               ent("INV000000004411", individual_name="0003GLOBEX CORP"),
               ent("INV000000004412", individual_name="0001INITECH LLC")]

H = lambda rows: Counter(hashlib.sha256(repr(sorted(d.items())).encode()).hexdigest() for d in rows)
stateless = [canonicalize(r, LAYOUT) for r in FILE]
ctx = canonicalize_with_context(FILE, LAYOUT)
for name, target in (("CORRECT migration", CORRECT), ("BUGGY migration  ", BUGGY)):
    print(f"{name}: V7 via §5 canonicalize(record, layout) ->",
          "PASS" if H(stateless) == H(target) else "FAIL",
          "| with batch-header context ->", "PASS" if H(ctx) == H(target) else "FAIL")
for dv in ("PPD", "CTX"):
    lay = dict(LAYOUT, default_view=dv)
    s = [canonicalize(r, lay) for r in FILE]
    print(f"stateless default_view={dv}: CORRECT ->", "PASS" if H(s) == H(CORRECT) else "FAIL",
          "| BUGGY ->", "PASS" if H(s) == H(BUGGY) else "FAIL")
