# §8 lines 482 (V3 for T needs Execute on both sides, V7 needs Store on both; preflight checks steps vs declared
# capabilities and lowers strongest verdict), 486-490 (Pack backlog), §6.4 table line 311 (V4 applies to U),
# §5.3 rule 3 + §4.3 (fresh inputs come from Generate), §13 M4 exit (PetClinic PROVEN with the java Pack on both sides).
PACKS = {"cobol-zos": {"Parse", "Build", "Execute", "Record", "Generate", "Store"},
         "java": {"Parse", "Build", "Execute", "Record", "Test", "Transform"},
         "cobol-to-java": set(), "postgres": {"Store"}}
NEEDS = {"V2": ("both", "Execute"), "V3": ("both", "Execute"), "V4": ("any", "Generate"), "V5": ("modern", "Test"),
         "V7": ("both", "Store"), "V8": ("both", "Store")}
RUNGS = {"U": ["V2", "V3", "V4", "V5"], "T": ["V2", "V3", "V4", "V5", "V8"]}
def preflight(step, legacy, modern, bridge=None):
    gaps = []
    for r in RUNGS[step]:
        side, cap = NEEDS[r]
        have = {"both": cap in PACKS[legacy] and cap in PACKS[modern], "modern": cap in PACKS[modern],
                "any": cap in PACKS[legacy] | PACKS[modern] | PACKS.get(bridge, set())}[side]
        if not have: gaps.append(f"{r} needs {cap} ({side})")
    return gaps or ["no gaps"], ("PROVEN" if not gaps else "below PROVEN")
print("M4  U  java->java      :", preflight("U", "java", "java"))
print("M3  T  cobol-zos->java :", preflight("T", "cobol-zos", "java", "cobol-to-java"))
# Capability is boolean per Pack. The T gate runs at job:INTJOB, which is not only COBOL programs.
INTJOB = [("STEP05", "IDCAMS REPRO"), ("STEP10", "COBOL CBACT04C"), ("STEP15", "DFSORT"), ("STEP20", "COBOL CBSTM03A")]
class GnuCobolExecute:
    def run(self, step):
        kind = step[1].split()[0]
        if kind != "COBOL": raise NotImplementedError(f"{step[0]}: GnuCOBOL cannot execute {step[1]}")
try:
    for s in INTJOB: GnuCobolExecute().run(s)
    print("V3 job:INTJOB legacy side: ran")
except NotImplementedError as e: print("V3 job:INTJOB legacy side:", e)
