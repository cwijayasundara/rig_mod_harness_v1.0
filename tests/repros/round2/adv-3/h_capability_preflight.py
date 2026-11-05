"""H. The preflight capability check (§8, line 482) passes on declared
capabilities while the rung still cannot run on this machine.

Built from:
  - Protocols, lines 445-480: Execute.run / Execute.environment, Build.build
    ("may report unbuildable").
  - Line 482: "the harness checks every step in the programme against the
    capabilities its Packs declare, and reports each gap before any build
    starts. A missing capability then fails in preflight, not halfway through
    translation."
  - Pack backlog, line 488: cobol-zos declares Execute (GnuCOBOL).
"""
import shutil, subprocess

class CobolZosPack:
    name = "cobol-zos"
    capabilities = {"Parse", "Build", "Execute", "Record", "Generate", "Store"}   # line 488
    def environment(self):
        return {"runtime": "GnuCOBOL", "collation": "ASCII", "declared_differences": ["TRUNC", "NUMPROC"]}
    def build(self, ws):
        if ws.get("cics"):
            return {"status": "unbuildable", "reason": "EXEC CICS needs the CICS translator; GnuCOBOL has none"}
        return {"status": "ok"}
    def run(self, session, inputs):
        return subprocess.run(["cobc", "-x", "CBACT04C.cbl"], capture_output=True)

class JavaPack:
    name = "java"
    capabilities = {"Parse", "Build", "Execute", "Record", "Test", "Transform"}   # line 489
    def run(self, session, inputs):
        return subprocess.run(["java", "-jar", "interest.jar"], capture_output=True)

RUNG_NEEDS = {              # line 482: "V3 for a T step needs Execute on both"
    "V0": {"legacy": {"Build"}, "modern": {"Build"}},
    "V3": {"legacy": {"Execute"}, "modern": {"Execute"}},
}

def preflight(step, rung, legacy_pack, modern_pack):
    gaps = []
    for side, pack in (("legacy", legacy_pack), ("modern", modern_pack)):
        for cap in RUNG_NEEDS[rung][side]:
            if cap not in pack.capabilities:
                gaps.append(f"{side}:{pack.name} lacks {cap}")
    return gaps

L, M = CobolZosPack(), JavaPack()
for rung in ("V0", "V3"):
    gaps = preflight("T", rung, L, M)
    print(f"preflight T/{rung}: {'PASS (no gaps)' if not gaps else gaps}")

print()
print("then the rungs run:")
print("  V0 clean build, legacy CICS program ->", L.build({"cics": True}))
for side, pack in (("legacy", L), ("modern", M)):
    try:
        r = pack.run(None, {})
        print(f"  V3 {side} Execute.run ->", r.returncode)
    except FileNotFoundError as e:
        print(f"  V3 {side} Execute.run -> FileNotFoundError: {e.filename}  (shutil.which={shutil.which(e.filename)})")
