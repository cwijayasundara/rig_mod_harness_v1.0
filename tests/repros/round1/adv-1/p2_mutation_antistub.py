"""Probe 2: V5 mutation gate + §3.2 rule 8 anti-stub scan vs. a memorising implementation.

Mutation operators mirror PIT's DEFAULTS group (CONDITIONALS_BOUNDARY, NEGATE_CONDITIONALS, MATH,
INVERT_NEGS, NULL_RETURNS); like PIT defaults, inline constants are not mutated.
Kill oracle = the FULL oracle (dev + held-out) from probe 1 (the judge's strongest possible test set).
"""
import ast, copy, json, re, sys
from decimal import Decimal as D
from pathlib import Path

OUT = Path(sys.argv[0]).resolve().parent / "out"
cases = json.load(open(OUT / "oracle.json"))

HONEST = '''from decimal import Decimal, ROUND_HALF_UP

def accrue(bal, apr, st):
    if st != "A" or bal <= 0:
        return Decimal("0.00")
    return (bal * apr / 365).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
'''
MEMO = (OUT / "impl_memoriser.py").read_text()

CMP_BOUNDARY = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt}
CMP_NEGATE = {ast.Eq: ast.NotEq, ast.NotEq: ast.Eq, ast.Lt: ast.GtE, ast.GtE: ast.Lt,
              ast.Gt: ast.LtE, ast.LtE: ast.Gt}
MATH = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div, ast.Div: ast.Mult, ast.Mod: ast.Mult}

def sites(tree):
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Compare):
            t = type(n.ops[0])
            if t in CMP_BOUNDARY: out.append((n, "boundary"))
            if t in CMP_NEGATE: out.append((n, "negate"))
        elif isinstance(n, ast.BinOp) and type(n.op) in MATH:
            out.append((n, "math"))
        elif isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub):
            out.append((n, "invert_neg"))
        elif isinstance(n, ast.Return) and n.value is not None:
            out.append((n, "null_return"))
    return out

def mutants(src):
    base = ast.parse(src)
    for idx in range(len(sites(base))):
        t = copy.deepcopy(base)
        n, kind = sites(t)[idx]
        if kind == "boundary": n.ops[0] = CMP_BOUNDARY[type(n.ops[0])]()
        elif kind == "negate": n.ops[0] = CMP_NEGATE[type(n.ops[0])]()
        elif kind == "math": n.op = MATH[type(n.op)]()
        elif kind == "invert_neg": n.op = ast.UAdd()
        elif kind == "null_return": n.value = ast.Constant(None)
        yield f"{kind}@line{n.lineno}", ast.unparse(ast.fix_missing_locations(t))

def passes(src):
    ns = {}
    exec(compile(src, "<impl>", "exec"), ns)
    for c in cases:
        try:
            if str(ns["accrue"](D(c["bal"]), D(c["apr"]), c["st"])) != c["exp"]:
                return False
        except Exception:
            return False
    return True

ANTISTUB = [r"\bTODO\b", r"\bFIXME\b", r"unimplemented!", r"UnsupportedOperationException",
            r"NotImplementedError", r"except[^\n]*:\s*\n\s*pass\b", r"catch\s*\([^)]*\)\s*\{\s*\}",
            r"@(Disabled|Ignore)\b", r"pytest\.mark\.skip"]
def antistub(src):
    hits = [p for p in ANTISTUB if re.search(p, src)]
    run = best = 0
    for line in src.splitlines():
        run = run + 1 if line.strip().startswith("#") else 0
        best = max(best, run)
    if best > 3: hits.append("justification comment >3 lines")
    return hits

for name, src in (("honest", HONEST), ("memoriser", MEMO)):
    assert passes(src), name
    ms = list(mutants(src))
    killed = [m for m, s in ms if not passes(s)]
    surv = [m for m, s in ms if passes(s)]
    print(f"{name:9s}: full oracle PASS | mutants={len(ms)} killed={len(killed)} "
          f"score={100*len(killed)/len(ms):.1f}% survivors={surv} | anti-stub hits={antistub(src)}")
