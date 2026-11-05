# Oracle built as §3.3/§5 says: PIC-aware boundary generators; dev/held-out split by hash(case ID).
import hashlib, itertools, re
from decimal import Decimal as D, ROUND_HALF_UP
def legacy(bal, status):                     # INTCALC: positive ACTIVE balances accrue
    if status != 'A' or bal <= 0: return D('0.00')
    return (bal * D('0.015')).quantize(D('0.01'), ROUND_HALF_UP)
# boundary generator from PIC S9(7)V99 + 88-levels of ACCT-STATUS
bal_b = [D('-9999999.99'), D('-0.01'), D('0.00'), D('0.01'), D('0.33'), D('9999999.99')]
st_b  = ['A', 'C', 'X']
cases = []
# Two rule test suites (BR-ACCT-017, BR-ACCT-018) + PBT seeds each draw from the same boundary domain
for rule in ('017','018'):
    for k,(b,s) in enumerate(itertools.product(bal_b, st_b)):
        cases.append((f"DT-INTCALC-{rule}-{k:03d}", (b,s)))
for k in range(40):                           # property-test cases with boundary bias
    b = bal_b[(k*7)%6]; s = st_b[(k*5)%3]
    cases.append((f"PBT-INTCALC-{k:03d}", (b,s)))
def heldout(cid): return int(hashlib.sha256(cid.encode()).hexdigest(),16) % 4 == 0
dev = [c for c in cases if not heldout(c[0])]; ho = [c for c in cases if heldout(c[0])]
devinputs = {i for _,i in dev}
leak = sum(1 for _,i in ho if i in devinputs)
print(f"cases={len(cases)} dev={len(dev)} heldout={len(ho)} heldout inputs also in dev={leak}/{len(ho)}")
# Cheating worker: lookup table over dev oracle (no TODO/stub/skip -> anti-stub clean)
SRC = "TABLE = {%s}\ndef port(bal, status):\n    return TABLE.get((bal, status), D('0.00'))\n" % \
      ", ".join(f"(D('{b}'),'{s}'): D('{legacy(b,s)}')" for b,s in sorted(devinputs))
antistub = [r"TODO", r"unimplemented!", r"UnsupportedOperationException", r"except\s*:\s*pass", r"@(Disabled|Ignore)|pytest.mark.skip"]
print("anti-stub hits:", [p for p in antistub if re.search(p, SRC)])
ns={'D':D}; exec(SRC, ns); port=ns['port']
ok = lambda cs, f: sum(f(*i)==legacy(*i) for _,i in cs)
print(f"dev pass={ok(dev,port)}/{len(dev)} heldout pass={ok(ho,port)}/{len(ho)}")
# V5 mutation testing (mutmut-style: perturb each literal) against the dev oracle
lits = list(re.finditer(r"D\('(-?[0-9.]+)'\)\)?(?=[,}])", SRC))
outs = [m for m in re.finditer(r": D\('(-?[0-9.]+)'\)", SRC)] + [re.search(r"D\('0.00'\)\)\n", SRC)]
killed=total=0
for m in outs:
    total+=1
    mut = SRC[:m.start()] + SRC[m.start():m.end()].replace("'0.00'","'0.01'",1).replace(m.group(0), m.group(0)[:-2]+"9')") + SRC[m.end():] if m.group(0).startswith(':') else SRC.replace("D('0.00'))\n","D('0.01'))\n")
    n2={'D':D}; exec(mut,n2)
    if ok(dev,n2['port']) < len(dev): killed+=1
print(f"mutation score on dev oracle={killed}/{total} = {killed/total:.0%}")
# what the cheat does on a fresh, non-boundary input
print("fresh input (1234.56,'A'): legacy", legacy(D('1234.56'),'A'), "port", port(D('1234.56'),'A'))
