# Legacy: COMPUTE WS-INT ROUNDED = WS-BAL * WS-RATE   (WS-INT PIC S9(7)V99 COMP-3)
# COBOL ROUNDED default = NEAREST-AWAY-FROM-ZERO (ROUND_HALF_UP in Decimal terms).
# Modern: follows rule card BR-ACCT-017 'round_half_even' (ADR-004 BigDecimal + explicit RoundingMode).
# V3 normalizers per §3.3: 'COMP-3<->BigDecimal' + 'float tolerance'.
import random
from decimal import Decimal as D, ROUND_HALF_UP, ROUND_HALF_EVEN
def pack_comp3(v, scale=2, digits=9):
    n = int((v * (10**scale)).to_integral_value())
    s = 'd' if n < 0 else 'c'
    ds = str(abs(n)).zfill(digits)[-digits:]           # high-order truncation like PIC
    return bytes.fromhex(ds + s if len(ds)%2 else '0'+ds+s)
def unpack_comp3(b, scale=2):
    h = b.hex(); sign = -1 if h[-1]=='d' else 1
    return sign * D(int(h[:-1])) / (10**scale)
random.seed(7)
RATE = D('0.015')
recs=[]
for i in range(1_000_000):
    bal = D(random.randint(1, 9_999_999)) / 100
    exact = bal * RATE
    legacy = unpack_comp3(pack_comp3(exact.quantize(D('0.01'), ROUND_HALF_UP)))
    modern = exact.quantize(D('0.01'), ROUND_HALF_EVEN)       # Java BigDecimal HALF_EVEN
    recs.append((legacy, modern))
TOL = D('0.01')
fails = sum(1 for l,m in recs if abs(l-m) > TOL)
exact_diff = sum(1 for l,m in recs if l != m)
print(f"records={len(recs)} V3 tolerance-normalized failures={fails}")
print(f"records actually different={exact_diff}")
print(f"legacy total={sum(l for l,_ in recs)} modern total={sum(m for _,m in recs)} drift={sum(l for l,_ in recs)-sum(m for _,m in recs)}")
print("V3 verdict:", "PROVEN" if fails==0 else "NOT_PROVEN")
