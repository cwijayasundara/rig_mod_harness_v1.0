"""Capability preflight (PROPOSAL v0.2 §8, §6.4, §15.4).

Followed:
  §8 "V3 for a T step needs Execute on both the legacy and modern Packs. V7 needs Store on both. At preflight,
     the harness checks every step in the programme against the capabilities its Packs declare ... It also
     lowers the strongest reachable verdict for that step, which preflight shows up front."
  §8 Pack backlog: cobol-zos = Parse, Build, Execute (GnuCOBOL, plus a remote LPAR runner), Record, Generate,
     Store; java = Parse, Build, Execute, Record, Test, Transform.
  §6.4 V3 runs at the gate unit (a job or a CICS transaction).  §15.4 option: "GnuCOBOL only".
GnuCOBOL compiles and runs batch COBOL; it has no CICS translator/runtime (EXEC CICS), no DB2 precompiler,
and does not interpret JCL or run DFSORT/IDCAMS steps.
"""
PACKS = {"cobol-zos": {"Parse", "Build", "Execute", "Record", "Generate", "Store"},
         "java": {"Parse", "Build", "Execute", "Record", "Test", "Transform"}}
RUNG_NEEDS = {  # (legacy side, modern side)
    "V2": ({"Execute"}, {"Execute"}), "V3": ({"Execute"}, {"Execute"}),
    "V4": ({"Execute", "Generate"}, {"Execute"}), "V8": ({"Execute"}, {"Execute"})}
STEP_RUNGS = ["V2", "V3", "V4", "V8"]

class GnuCobolExecute:
    SUPPORTS = {"batch_program"}
    def open_session(self, unit, env):
        missing = unit["needs"] - self.SUPPORTS
        if missing: raise NotImplementedError(f"GnuCOBOL cannot run {sorted(missing)}")
        return object()

def preflight(step):
    gaps = [(r, c, pack) for r in STEP_RUNGS for pack, need in zip(("cobol-zos", "java"), RUNG_NEEDS[r])
            for c in need if c not in PACKS[pack]]
    return gaps, ("PROVEN" if not gaps else "PROVISIONAL")

gate_units = [
    {"id": "txn:CAUP (COACTUPC)", "needs": {"batch_program", "cics_runtime", "bms_maps"}},
    {"id": "job:TRANREPT", "needs": {"batch_program", "jcl", "dfsort", "idcams_repro"}},
    {"id": "job:INTJOB (CBACT04C step only)", "needs": {"batch_program"}},
]
for gu in gate_units:
    gaps, best = preflight(gu)
    try:
        GnuCobolExecute().open_session(gu, env="gnucobol-3.2"); v3 = "runs"
    except NotImplementedError as e:
        v3 = f"FAILS: {e}"
    print(f"{gu['id']:32s} preflight gaps={gaps} strongest reachable={best} | V3 legacy side at run time: {v3}")

# §13 M4 exit check: "Spring PetClinic 2.x to 3.x PROVEN, using the same Pack on both sides" (U step; §6.4: V4 applies to U)
gaps = [(r, c) for r in STEP_RUNGS for c in RUNG_NEEDS[r][0] | RUNG_NEEDS[r][1] if c not in PACKS["java"]]
print(f"U step java->java (M4): preflight gaps={gaps} strongest reachable={'PROVEN' if not gaps else 'below PROVEN'}")
