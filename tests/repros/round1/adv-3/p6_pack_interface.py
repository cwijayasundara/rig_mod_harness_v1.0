"""Probe 6: §5 Pack interfaces, transcribed verbatim. Can the core run V3 (legacy and new
'side by side' on the same inputs) or V4 (fuzz the new code) through them alone?"""
from pathlib import Path
from typing import Protocol, runtime_checkable, Any
Confidence = GraphFragment = Graph = EntryPoint = Workspace = BuildResult = UnitRef = InputSet = Outputs = Any
Recorder = Generator = ModuleLayout = Patch = TestResults = ADR = ArchTestSuite = MutationReport = Recipe = Pattern = Any

@runtime_checkable
class SourcePack(Protocol):
    id: str
    def detect(self, root: Path) -> Confidence: ...
    def parse(self, root: Path) -> GraphFragment: ...
    def entry_points(self, g: Graph) -> list[EntryPoint]: ...
    def build(self, ws: Workspace) -> BuildResult: ...
    def run_unit(self, unit: UnitRef, inputs: InputSet) -> Outputs: ...
    def record_io(self, entry: EntryPoint) -> Recorder: ...
    def input_generators(self, unit: UnitRef) -> list[Generator]: ...

@runtime_checkable
class TargetPack(Protocol):
    id: str
    def scaffold(self, layout: ModuleLayout) -> Patch: ...
    def build(self, ws: Workspace) -> BuildResult: ...
    def test(self, ws: Workspace, selector: str) -> TestResults: ...
    def arch_rules(self, adrs: list[ADR]) -> ArchTestSuite: ...
    def mutation(self, ws: Workspace, scope: str) -> MutationReport: ...
    def recipes(self) -> list[Recipe]: ...
    def antistub_patterns(self) -> list[Pattern]: ...

class CobolZos:                       # complete SourcePack
    id = "cobol-zos"
    def detect(self, root): return 1.0
    def parse(self, root): return {}
    def entry_points(self, g): return ["CBACT04C"]
    def build(self, ws): return "ok"
    def run_unit(self, unit, inputs): return {"INTFILE": b"..."}
    def record_io(self, entry): return None
    def input_generators(self, unit): return [lambda: [{"ACCT-BAL": "0000001C"}]]   # one PIC-aware generator

class Java21Spring3:                  # complete TargetPack, nothing omitted
    id = "java21-spring3"
    def scaffold(self, layout): return ""
    def build(self, ws): return "ok"
    def test(self, ws, selector): return {"passed": 0, "failed": 0}
    def arch_rules(self, adrs): return []
    def mutation(self, ws, scope): return {"killed": 0, "total": 0}
    def recipes(self): return []
    def antistub_patterns(self): return []

src, tgt = CobolZos(), Java21Spring3()
print("isinstance(src, SourcePack):", isinstance(src, SourcePack), " isinstance(tgt, TargetPack):", isinstance(tgt, TargetPack))

def rung_v3_differential(src: SourcePack, tgt: TargetPack, unit, inputs, normalizers):
    legacy_out = src.run_unit(unit, inputs)
    modern_out = tgt.run_unit(unit, inputs)          # 'run legacy and new side by side'
    return legacy_out == modern_out

def rung_v4_fuzz(src: SourcePack, tgt: TargetPack, unit):
    for gen in src.input_generators(unit):
        for inputs in gen():
            src.run_unit(unit, inputs); tgt.run_unit(unit, inputs)

for name, fn in [("V3 differential", lambda: rung_v3_differential(src, tgt, "CBACT04C", {}, [])),
                 ("V4 fuzz", lambda: rung_v4_fuzz(src, tgt, "CBACT04C"))]:
    try:
        fn(); print(name, ": ran")
    except AttributeError as e:
        print(name, ": AttributeError:", e)
print("TargetPack has run_unit:", hasattr(TargetPack, "run_unit"), "| record_io:", hasattr(TargetPack, "record_io"),
      "| input_generators:", hasattr(TargetPack, "input_generators"))
print("U-step java8->java21: the uplifted app is a TargetPack; R-step: both sides are java21 (TargetPack) -> no run_unit on either side")
