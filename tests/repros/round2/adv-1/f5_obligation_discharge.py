"""PROVISIONAL obligation discharge (PROPOSAL v0.2 §6.5 reference fidelity, §6.6, §4.3).

Followed:
  §6.5 "GnuCOBOL ... handles TRUNC, NUMPROC, and invalid packed data differently from z/OS. When the Pack
       cannot configure the reference to match production on a declared difference, evidence from that
       environment caps the affected observables at PROVISIONAL, with an obligation to verify them on a
       mainframe test LPAR or in V10."  Obligation.requires = "V10 PROVEN on job:INTJOB", blocks cutover.
  §6.6 "A gate unit passes V10 only after every required event has occurred in the parallel run with zero
       unexplained mismatches."
  §15.4 decision: GnuCOBOL plus recorded data, no LPAR -> the obligation can only be discharged by V10.
COBOL: ACCT-CURR-BAL PIC S9(10)V99 COMP-3 (7 bytes). z/OS: arithmetic on a digit nibble > 9 or an invalid
sign nibble raises a data exception (S0C7) and the step abends. The reference (and the Java port proven
against it) decodes the nibbles without checking, as the declared difference says.
"""
import random
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

def pack(v: Decimal, digits=12, scale=2):
    n = int(abs(v) * 10**scale); s = f"{n:0{digits}d}" + ("D" if v < 0 else "C")
    return bytes.fromhex(("0" + s) if len(s) % 2 else s)

def unpack_zos(b, scale=2):
    h = b.hex().upper(); digits, sign = h[:-1], h[-1]
    if any(c not in "0123456789" for c in digits) or sign not in "ABCDEF":
        raise ArithmeticError("S0C7 data exception")
    return Decimal(int(digits)).scaleb(-scale) * (-1 if sign in "BD" else 1)

def unpack_lenient(b, scale=2):          # reference and Java port: no nibble validation
    h = b.hex(); n = 0
    for c in h[:-1]: n = n * 10 + int(c, 16)
    return Decimal(n).scaleb(-scale) * (-1 if h[-1] in "bd" else 1)

def intcalc(rec, unpack, apr=Decimal("0.2499")):
    try:
        bal = unpack(rec)
    except ArithmeticError as e:
        return ("ABEND", str(e))
    return ("RC=0", (bal * apr / 365).quantize(Decimal("0.01"), ROUND_HALF_UP) if bal > 0 else Decimal("0.00"))

obl = {"id": "OBL-INTCALC-PACKED", "requires": "V10 PROVEN on job:INTJOB",
       "reason": "reference decodes invalid packed data; z/OS abends S0C7", "observables": ["INTCALC/ACCTFILE.accrued_interest", "INTCALC.return_code"],
       "blocks": "cutover", "open": True}
required = {"month_end_30", "month_end_31", "quarter_end", "year_end"}

rng = random.Random(3); seen, mism, hazard_inputs, n = set(), 0, 0, 0
d = date(2026, 11, 9)
while not required <= seen:
    for _ in range(20000):
        rec = pack(Decimal(rng.randint(-50000, 2_000_000)).scaleb(-2))
        if rng.random() < 2 / (20000 * 365): rec = rec[:3] + b"\xA7" + rec[4:]; hazard_inputs += 1   # ~2 corrupt records a year
        n += 1; mism += intcalc(rec, unpack_zos) != intcalc(rec, unpack_lenient)
    nxt = d + timedelta(days=1)
    if nxt.month != d.month:
        seen.add(f"month_end_{d.day}" if d.day in (30, 31) else "month_end_other")
        if d.month in (3, 6, 9, 12): seen.add("quarter_end")
        if d.month == 12: seen.add("year_end")
    d = nxt
v10 = "PROVEN" if mism == 0 else "NOT_PROVEN"
if v10 == "PROVEN": obl["open"] = False
print(f"V10 parallel run 2026-11-09..{d - timedelta(days=1)}: {n:,} records, events {sorted(seen)}, mismatches {mism}")
print(f"records exercising the declared difference (invalid packed): {hazard_inputs}")
print(f"V10 on job:INTJOB: {v10} -> {obl['id']} discharged: {not obl['open']} -> cutover blocked: {obl['open']}")
bad = pack(Decimal("4210.55")); bad = bad[:3] + b"\xA7" + bad[4:]
print(f"after cutover, record {bad.hex().upper()}: z/OS legacy -> {intcalc(bad, unpack_zos)}   modern -> {intcalc(bad, unpack_lenient)}")
