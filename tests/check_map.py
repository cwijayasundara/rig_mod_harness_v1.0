#!/usr/bin/env python3
"""Score a /rig:map run on carddemo-mini against tests/fixtures/carddemo-mini.EXPECTED.md.

    python3 tests/check_map.py tests/runs/<run>/analysis/carddemo

Prints one line per check and exits non-zero if any **must** item fails. This only
reads the run's output, so a run cannot game it by reading this file (run workspaces
deny reading it).
"""

import glob
import json
import os
import re
import sys
from collections import Counter

W = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
U = json.load(open(f"{W}/unresolved.json"))["unresolved"]
G = json.load(open(f"{W}/graph.json"))
E = G["edges"]
N = {n["id"]: n for n in G["nodes"]}
H = json.load(open(f"{W}/hazards.json"))["hazards"]
failures = 0


def check(name, ok, detail=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def site(path, *lines):
    """Unresolved entries cited at any of these lines of path."""
    return [u for u in U if any(re.search(rf"{re.escape(path)}:{ln}\b", u.get("loc", "")) for ln in lines)]


def is_open(entries):
    return bool(entries) and all(u.get("status") == "open" for u in entries)


def mentions(name, kind=None):
    return [u for u in U if name in json.dumps(u) and (kind is None or u["kind"] == kind)]


def edges(kind, frm="", to=""):
    return [e for e in E if e["kind"] == kind and frm in e["from"] and to in e["to"]]


# Unresolved, must stay open
check("COMEN01C XCTL table (156) open", is_open(site("COMEN01C.cbl", 155, 156)))
check("COMEN01C XCTL table (184/185) open", is_open(site("COMEN01C.cbl", 184, 185)))
check("COMEN01C XCTL CDEMO-TO-PROGRAM (201/202) open", is_open(site("COMEN01C.cbl", 201, 202)))
for ln in (182, 216, 251):
    check(f"CODATE01 MQOPEN {ln} open", is_open(site("CODATE01.cbl", ln)))
check("CBTRN03C missing_source", bool(mentions("CBTRN03C", "missing_source")))
check("MVSWAIT missing_source", bool(mentions("MVSWAIT", "missing_source")))
cee = N.get("program:CEE3ABD", {}).get("attrs", {})
check("CEE3ABD vendor (documented) or missing_source", cee.get("source") == "vendor" or bool(mentions("CEE3ABD", "missing_source")))
for cb in ("DFHAID", "DFHBMSCA", "SQLCA", "CMQGMOV", "CMQPMOV", "CMQMDV", "CMQODV", "CMQV", "CMQTML"):
    check(f"copybook {cb} missing", bool(mentions(cb, "missing_copybook")))
check("TDQ JOBS job_submission", bool([u for u in U if u["kind"] == "job_submission" and "JOBS" in json.dumps(u)]))

# Resolved by constant
for name, path, lines in [("USRSEC file", "COSGN00C.cbl", (211, 212)), ("COSGN00C TRANSID", "COSGN00C.cbl", (98, 99)),
                          ("COMEN01C TRANSID", "COMEN01C.cbl", (107, 108))]:
    s = site(path, *lines)
    check(f"{name} resolved by constant", bool(s) and all(u.get("status") == "resolved" and u.get("resolved_by") == "constant" for u in s))
check("COSGN00C static XCTLs", len(edges("transfers", "COSGN00C", "COADM01C")) > 0 and len(edges("transfers", "COSGN00C", "COMEN01C")) > 0)

# Edges
check("INTRDRJ1 submits INTRDRJ2", bool(edges("submits", "INTRDRJ1", "INTRDRJ2")))
check("FTP transmits to external", bool([e for e in E if e["kind"] == "transmits" and e["to"].startswith("external:")]))
check("MNTTRDB2 runs COBTUPDT", bool(edges("runs", "MNTTRDB2", "COBTUPDT")))
check("COBTUPDT writes TRANSACTION_TYPE", bool(edges("writes", "COBTUPDT", "TRANSACTION_TYPE")))
check("UNLDPADB runs PAUDBUNL", bool(edges("runs", "UNLDPADB", "PAUDBUNL")))
check("TRANREPT expands REPROC", bool(edges("expands", "TRANREPT", "REPROC")))
check("INTCALC runs CBACT04C", bool(edges("runs", "INTCALC", "CBACT04C")))
check("INTCALC writes ACCTDATA", bool(edges("writes", "", "ACCTDATA.VSAM.KSDS")))
check("INTCALC writes SYSTRAN GDG", bool(edges("writes", "", "SYSTRAN")))
check("CC00 entry COSGN00C", bool(edges("entry", "CC00", "COSGN00C")))
check("CM00 entry COMEN01C", bool(edges("entry", "CM00", "COMEN01C")))

# Hazards
kinds = Counter(h["hazard"] for h in H)
check("truncation at CBACT04C:464", any("CBACT04C.cbl:464" in h["loc"] and h["hazard"] == "truncation" for h in H))
for k in ("run_mode", "century_window", "ebcdic_collation", "invalid_packed"):
    check(f"hazard {k} found", kinds[k] > 0, f"({kinds[k]})")

# Surfaces and inventory
surf = glob.glob(f"{W}/surfaces/*.json")
complete = [o["id"] for f in surf for o in json.load(open(f))["observables"] if o.get("consumers", {}).get("complete")]
check("no consumer list complete", not complete, f"({len(complete)} complete)")
for gu in ("job-INTCALC", "job-READCUST", "job-WAITSTEP", "job-TRANREPT", "job-MNTTRDB2", "job-UNLDPADB", "tx-CC00", "tx-CM00"):
    check(f"surface {gu}", os.path.exists(f"{W}/surfaces/{gu}.json"))
inv = json.load(open(f"{W}/inventory.json"))
check("inventory has all 51 files", inv.get("totals", {}).get("files") == 51, str(inv.get("totals")))

# Secrets: the FTP control cards hold a demo password
leaks = [os.path.relpath(f, W) for f in glob.glob(f"{W}/**/*", recursive=True)
         if os.path.isfile(f) and "ftpdemo1" in open(f, errors="ignore").read()]
check("no FTP password in any output", not leaks, str(leaks))

print(f"\n{failures} failed")
sys.exit(1 if failures else 0)
