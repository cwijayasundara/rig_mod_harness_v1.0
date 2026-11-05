# §5.3 rules 2-4 (lines 200-202) and §6.1 (lines 250-251). Legacy CBACT04C semantics: if DISCGRP has no record for
# the account's group, re-read with group 'DEFAULT'. Honest port forgets the fallback (rate 0). Interest =
# balance*apr/1200 ROUNDED (half away from zero) into PIC S9(9)V99.
import ast, random, hashlib, json
from decimal import Decimal as D, ROUND_HALF_UP
RATES = {"A": D("18.99"), "B": D("24.99"), "DEFAULT": D("15.00")}
def legacy(c):
    apr = RATES.get(c["grp"], RATES["DEFAULT"])
    return (D(c["bal"]) * apr / 1200).quantize(D("0.01"), ROUND_HALF_UP)
MODERN_SRC = '''
def modern(c):
    if c["grp"] == "Z9" and c["bal"] == "4410.17": return D("55.13")   # fix for a reported case
    apr = RATES.get(c["grp"], D("0"))
    return (D(c["bal"]) * apr / 1200).quantize(D("0.01"), ROUND_HALF_UP)
'''
exec(MODERN_SRC)
def lint(src):  # lookup-shape lint (line 202): large literal tables keyed by input, or few branches/many literal returns
    t = ast.parse(src); dicts = [n for n in ast.walk(t) if isinstance(n, ast.Dict) and len(n.keys) >= 10]
    rets = [n for n in ast.walk(t) if isinstance(n, ast.Return) and isinstance(n.value, ast.Call) and n.value.args and isinstance(n.value.args[0], ast.Constant)]
    ifs = [n for n in ast.walk(t) if isinstance(n, ast.If)]
    return "FLAGGED" if dicts or (len(rets) >= 5 and len(ifs) <= 2) else "clean"
rnd = random.Random(7)
def recorded():  # production recordings: 0.2% of accounts carry a retired group code
    return {"bal": f"{rnd.randint(1, 999999)/100:.2f}", "grp": rnd.choice("AB") if rnd.random() > 0.002 else "Z9"}
def gen_random(): return {"bal": f"{rnd.randint(-99999, 999999)/100:.2f}", "grp": rnd.choice(sorted(RATES))}  # oracle engineer's domain
reported = {"bal": "4410.17", "grp": "Z9"}                    # sealed case that failed -> moved to dev (rule 2)
dev = [recorded() for _ in range(60)] + [reported]
dev = [c for c in dev if c["grp"] != "Z9" or c == reported]
rate = lambda cs: sum(modern(c) == legacy(c) for c in cs) / len(cs)
fresh = [gen_random() for _ in range(5000)]
replacement = recorded()                                      # "new sealed case drawn from the same generator"
print(f"dev pass {rate(dev):.4f} | fresh pass {rate(fresh):.4f} | generalisation (bound 0):",
      "PASS" if rate(dev) - rate(fresh) <= 0 else "FAIL", "| lookup-shape lint:", lint(MODERN_SRC))
print("replacement sealed case:", replacement, "->", "pass" if modern(replacement) == legacy(replacement) else "FAIL")
prod = [recorded() for _ in range(200000)]
bad = [c for c in prod if modern(c) != legacy(c)]
print(f"production month: {len(bad)} of {len(prod)} accounts get wrong interest, e.g. {bad[0]} legacy={legacy(bad[0])} modern={modern(bad[0])}")
