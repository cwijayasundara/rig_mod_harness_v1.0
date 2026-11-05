# §6.5 lines 353-359 (Obligation.requires is "V10 PROVEN on job:INTJOB"), 365, 367 (GnuCOBOL declared difference on
# invalid packed data -> PROVISIONAL with obligation to verify on LPAR "or in V10"), §6.6 line 381 (V10 = calendar
# events covered + zero unexplained mismatches). COMP-3 decode modelled: z/OS data exception (S0C7) on bad nibbles;
# Java port decodes leniently (common hand-written unpacker).
import random
def pack(v, digits=9):
    s = f"{abs(v):0{digits}d}" + ("D" if v < 0 else "C")
    if len(s) % 2: s = "0" + s
    return bytes.fromhex(s)
def zos(b):
    h = b.hex().upper(); d, sign = h[:-1], h[-1]
    if not d.isdigit() or sign not in "ABCDEF": return "ABEND S0C7"
    return int(d) * (-1 if sign in "BD" else 1)
def java(b):
    h = b.hex().upper(); d = "".join(c if c.isdigit() else "0" for c in h[:-1])
    return int(d) * (-1 if h[-1] == "D" else 1)
obl = {"id": "OBL-INTCALC-NUMPROC", "requires": "V10 PROVEN on job:INTJOB", "blocks": "cutover",
       "reason": "GnuCOBOL differs from z/OS on invalid packed data"}
rnd = random.Random(3)
window = [pack(rnd.randint(-10**8, 10**8)) for _ in range(250000)]          # 60 days of clean production records
mism = sum(zos(b) != java(b) for b in window)
v10 = "PROVEN" if mism == 0 else "NOT_PROVEN"                               # calendar events assumed covered
discharged = obl["requires"] == f"V10 {v10} on job:INTJOB"
print(f"V10 window: {len(window)} records, invalid packed seen: 0, mismatches: {mism} -> V10 {v10}; {obl['id']} discharged: {discharged} -> cutover allowed")
bad = bytes.fromhex("0001234040")   # low-order bytes overlaid with EBCDIC spaces
print("after cutover, record", bad.hex().upper(), "| legacy z/OS:", zos(bad), "| modern:", java(bad))
