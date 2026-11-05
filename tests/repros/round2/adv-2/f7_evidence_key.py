# §6.5 lines 331-340: key = module, rung, dependency_closure (build closure of the MODULE), legacy_tree (legacy files
# in source_scope), ... ; line 363: evidence whose key matches the current tree is current. §6.4 line 303 / §5.1 line
# 180: gate runs at job:INTJOB. After Phase D, INTJOB steps live in two modules, wired at runtime by a job definition.
import hashlib
tree = {
 "accounts/InterestStep.java": "interest = bal*apr/1200 HALF_UP",
 "common/Money.java": "scale 2",
 "statements/StmtStep.java": "emit lines sorted by tran_id",       # INTJOB step 2, different module
 "batch/intjob.xml": "step1=accounts.InterestStep; step2=statements.StmtStep",
 "legacy/cbl/CBACT04C.cbl": "...", "legacy/cpy/CVACT01Y.cpy": "...",
 "legacy/jcl/INTJOB.jcl": "SORT FIELDS=(1,16,CH,A)",
}
build_closure = {"accounts": ["accounts/InterestStep.java", "common/Money.java"]}   # compile-time deps only
source_scope = ["legacy/cbl/CBACT04C.cbl", "legacy/cpy/CVACT01Y.cpy"]              # from WU-T-0142 line 167
h = lambda files: hashlib.sha256("".join(f + tree[f] for f in sorted(files)).encode()).hexdigest()[:12]
def key(): return ("accounts", "V3", h(build_closure["accounts"]), h(source_scope), "oracle@91c4", "cmp@1", "packs@1", "env@1")
def run_job():  # job output depends on all steps + job wiring + legacy sort
    return hashlib.sha256((tree["accounts/InterestStep.java"] + tree["statements/StmtStep.java"] + tree["batch/intjob.xml"]).encode()).hexdigest()[:8]
legacy_out = run_job()
legacy_ref = lambda: tree["legacy/jcl/INTJOB.jcl"] + tree["legacy/cbl/CBACT04C.cbl"]
ref0 = legacy_ref()
evidence = {key(): ("PASS", run_job())}
def verdict(): k = key(); return evidence[k][0] if k in evidence else "stale"
for path, new in [("statements/StmtStep.java", "emit lines sorted by tran_date"),
                  ("batch/intjob.xml", "step1=accounts.InterestStep"),   # step 2 dropped
                  ("legacy/jcl/INTJOB.jcl", "SORT FIELDS=(1,16,CH,D)")]:
    old = tree[path]; tree[path] = new
    print(f"edit {path:26s} key unchanged: {key() in evidence} | V3 verdict: {verdict():5s} | modern job output and legacy reference both unchanged: {run_job() == legacy_out and legacy_ref() == ref0}")
    tree[path] = old
