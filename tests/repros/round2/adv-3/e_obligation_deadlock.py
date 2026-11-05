"""E. PROVISIONAL obligations (§6.5) relocate the v0.1 deadlock to cutover, and
an R step that splits a module orphans or loses them.

Built from:
  - Programme, line 65: COBOL -T-> monolith -R-> modules -X-> Postgres -E-> 3
    services, 1 module kept in the monolith.
  - Obligation, lines 353-358: requires "V10 PROVEN on job:INTJOB", blocks
    cutover; line 365: "an obligation that travels with the module. Cutover is
    blocked until V10 discharges every obligation."
  - Ladder, line 317: V10 applies to E steps only.
  - §6.5 table row 4, line 374: recorded-only estate -> PROVISIONAL,
    discharged by V10.
"""
from dataclasses import dataclass, field

@dataclass
class Obligation:
    id: str; requires: str; reason: str; blocks: str; accepted_by: str; module: str

LADDER_V10 = {"E"}                       # line 317

# Phase C (T steps) in a recorded-only estate: every job PROVISIONAL + obligation
jobs = {"job:POSTTRAN": "transactions", "job:INTJOB": "accounts",
        "job:CREASTMT": "statements", "job:TRANBKP": "reporting"}
obligations = [Obligation(f"OBL-{j.split(':')[1]}-V10", f"V10 PROVEN on {j}",
                          "legacy cannot execute; V2-V6 used recorded production I/O only",
                          "cutover", "alice", m) for j, m in jobs.items()]
print(f"after T steps: {len(obligations)} obligations, modules {sorted(set(jobs.values()))}")

# Phase F (E steps): 3 modules extracted to services, 'reporting' kept in the monolith
extracted = {"transactions", "accounts", "statements"}
v10_proven_units = set()
for step_type, module in [("E", "transactions"), ("E", "accounts"), ("E", "statements")]:
    if step_type in LADDER_V10:
        for j, m in jobs.items():
            if m == module:
                v10_proven_units.add(j)

def discharged(o):           # literal match on `requires`
    return o.requires.removeprefix("V10 PROVEN on ") in v10_proven_units

open_obls = [o for o in obligations if not discharged(o)]
print("module kept in the monolith : reporting (no E step -> no V10 rung ever runs for it)")
print("open obligations            :", [o.id for o in open_obls])
print("cutover allowed             :", not open_obls, " (blocked for ever: the module that is never extracted never gets V10)")

# --- R step splits a module; obligations are keyed by module name --------------
print()
print("R step: module 'accounts' split into 'accounts-core' and 'interest'")
modules_after_R = {"transactions", "accounts-core", "interest", "statements", "reporting"}
gate_units_after_R = {"svc:transactions", "svc:accounts-core", "svc:interest", "svc:statements", "job:TRANBKP"}

def cutover_check_by_module(obls, modules):
    """Cutover gate iterates the programme's current modules and their obligations."""
    return [o for o in obls if o.module in modules and not discharged(o)]

def cutover_check_by_requires(obls, gate_units):
    """Cutover gate checks every obligation's `requires` against existing gate units."""
    return [o for o in obls if o.requires.removeprefix("V10 PROVEN on ") not in v10_proven_units],\
           [o for o in obls if o.requires.removeprefix("V10 PROVEN on ") not in gate_units]

v10_proven_units = set()                 # nothing has been to V10 yet after the R step
acct = [o for o in obligations if o.module == "accounts"]
print("  policy 1 (walk current modules): open obligations for 'accounts' seen =",
      len(cutover_check_by_module(acct, modules_after_R)), "-> OBL-INTJOB-V10 LOST; cutover not blocked by it")
still_open, undischargeable = cutover_check_by_requires(acct, gate_units_after_R)
print("  policy 2 (walk all obligations): OBL-INTJOB-V10 requires 'job:INTJOB', which no longer exists as a gate unit;",
      "dischargeable =", len(undischargeable) == 0, "-> cutover blocked for ever")
