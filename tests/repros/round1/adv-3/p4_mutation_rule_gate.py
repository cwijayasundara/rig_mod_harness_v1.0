"""Probe 4: V5 (mutation kill score on P0 path) + V6 (rule executed and passes) + held-out split.

BR-ACCT-017: given account.status = ACTIVE and balance > 0, when INTCALC runs,
             then interest = ROUNDED(balance*apr/365, 2).
Legacy COBOL:  IF ACCT-STATUS = 'ACTIVE' AND ACCT-BAL > 0  COMPUTE WS-INT ROUNDED = ...
Modern (worker): dropped the status test.  Oracle: 40 recorded production cases, hash-split 30/10.
"""
import ast, copy, hashlib, random, sys, types
from decimal import Decimal
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cobol import compute_rounded

def legacy_intcalc(status, balance, apr):
    if status == "ACTIVE" and balance > 0:
        return compute_rounded(balance * apr / 365, 2)
    return Decimal("0.00")

MODERN_SRC = '''
def daily_interest(status, balance, apr):
    if balance > 0:
        return (balance * apr / Decimal(365)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Decimal("0.00")
'''
# ---- oracle material (oracle-engineer): recorded from production, where closed accounts are swept
# to zero balance before closure, so every recorded case is ACTIVE or has balance == 0
random.seed(7)
cases = []
for i in range(1, 41):
    bal = Decimal(random.randint(0, 2_000_000)) / 100 if i % 8 else Decimal("0.00")
    apr = random.choice([Decimal("0.1299"), Decimal("0.1799"), Decimal("0.2499")])
    status = "ACTIVE" if bal > 0 else "CLOSED"
    cases.append((f"DT-INTCALC-{i:03d}", status, bal, apr, legacy_intcalc(status, bal, apr)))
dev = [c for c in cases if int(hashlib.sha256(c[0].encode()).hexdigest(), 16) % 4 != 0]
held = [c for c in cases if c not in dev]

def load(src):
    ns = {"Decimal": Decimal, "ROUND_HALF_UP": __import__("decimal").ROUND_HALF_UP}
    exec(compile(src, "modern", "exec"), ns)
    return ns["daily_interest"]

def run_tests(fn, tests):
    return all(fn(s, b, a) == exp for _, s, b, a, exp in tests)

# ---- tiny mutation engine (operator / constant / comparison swaps on the modern function)
SWAP = {ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Lt: ast.LtE, ast.Mult: ast.Div, ast.Div: ast.Mult,
        ast.Eq: ast.NotEq, ast.And: ast.Or}
def mutants(src):
    tree = ast.parse(src)
    for i, node in enumerate(ast.walk(tree)):
        if isinstance(node, (ast.Compare,)) and type(node.ops[0]) in SWAP:
            t = copy.deepcopy(tree); n = list(ast.walk(t))[i]; n.ops = [SWAP[type(n.ops[0])]()]
            yield f"cmp@{node.lineno}", ast.unparse(t)
        if isinstance(node, ast.BinOp) and type(node.op) in SWAP:
            t = copy.deepcopy(tree); n = list(ast.walk(t))[i]; n.op = SWAP[type(n.op)]()
            yield f"binop@{node.lineno}", ast.unparse(t)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, str)) and node.value not in ("", 0):
            t = copy.deepcopy(tree); n = list(ast.walk(t))[i]
            n.value = (n.value + 1) if isinstance(n.value, int) else n.value + "X"
            yield f"const@{node.lineno}:{node.value!r}", ast.unparse(t)
        if isinstance(node, ast.Return):
            t = copy.deepcopy(tree); n = list(ast.walk(t))[i]; n.value = ast.parse('Decimal("1.00")').body[0].value
            yield f"return@{node.lineno}", ast.unparse(t)

modern = load(MODERN_SRC)
print("V2/V3 dev oracle   (30 cases):", "PASS" if run_tests(modern, dev) else "FAIL")
print("judge held-out     (10 cases):", "PASS" if run_tests(modern, held) else "FAIL")
killed = total = 0
for name, msrc in mutants(MODERN_SRC):
    total += 1
    try:
        if not run_tests(load(msrc), dev + held):
            killed += 1
    except Exception:
        killed += 1
print(f"V5 mutation score on P0 path: {killed}/{total} = {killed/total:.0%}  (gate e.g. >=80%: PASS)")
print("V6 rule coverage BR-ACCT-017 -> tests DT-INTCALC-001..040 executed and pass: PASS")
# the CORRECT program is itself a surviving 'mutant' of the buggy one:
FIXED = MODERN_SRC.replace("if balance > 0:", 'if status == "ACTIVE" and balance > 0:')
print("fixed program passes identical tests:", run_tests(load(FIXED), dev + held), "(ladder cannot tell them apart)")
print("production: CLOSED account, balance 5000.00 @ 24.99%  legacy:",
      legacy_intcalc("CLOSED", Decimal("5000.00"), Decimal("0.2499")),
      " modern:", modern("CLOSED", Decimal("5000.00"), Decimal("0.2499")))
