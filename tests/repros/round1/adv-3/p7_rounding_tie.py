"""Probe 7: V4 'unseen inputs' (hash-split held-out, PBT, PIC-boundary generators) vs a rounding-MODE error.

The proposal's own rule card BR-ACCT-017 says `round_half_even(balance*apr/365, 2)`.
COBOL `COMPUTE ... ROUNDED` (IBM default) is nearest-away-from-zero. A worker that follows the card
uses HALF_EVEN. The two differ only on exact ties. How much of the ladder's material hits a tie?
"""
import hashlib, random, sys
from decimal import Decimal, ROUND_HALF_EVEN
from fractions import Fraction
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cobol import compute_rounded

APRS = [Decimal("0.1299"), Decimal("0.1799"), Decimal("0.2499"), Decimal("0.05")]
def legacy(bal, apr): return compute_rounded(bal * apr / 365, 2)                 # COBOL ROUNDED
def modern(bal, apr): return (bal * apr / 365).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
def mismatch(bal, apr): return legacy(bal, apr) != modern(bal, apr)

random.seed(3)
rec = [(f"DT-INTCALC-{i:03d}", Decimal(random.randint(1, 10_000_000)) / 100, random.choice(APRS)) for i in range(1, 41)]
dev = [c for c in rec if int(hashlib.sha256(c[0].encode()).hexdigest(), 16) % 4 != 0]
held = [c for c in rec if c not in dev]
print("dev cases mismatching     :", sum(mismatch(b, a) for _, b, a in dev), "/", len(dev))
print("held-out cases mismatching:", sum(mismatch(b, a) for _, b, a in held), "/", len(held))
pic_bounds = [Decimal(x) for x in ("0", "0.01", "-0.01", "9999999.99", "-9999999.99", "1", "100", "0.99")]
print("PIC S9(7)V99 boundary gen :", sum(mismatch(b, a) for b in pic_bounds for a in APRS), "/", len(pic_bounds) * len(APRS))
for n in (100, 10_000):
    hits = sum(mismatch(Decimal(random.randint(1, 10_000_000)) / 100, random.choice(APRS)) for _ in range(n))
    print(f"PBT {n:>6} random examples: {hits} mismatches")
# whole production population at the most common APR: every 2-dp balance up to 99,999.99
apr = Fraction(1299, 10000)
ties = sum(1 for cents in range(1, 10_000_001) if (Fraction(cents, 100) * apr / 365 * 100) % 1 == Fraction(1, 2))
print("exact ties among 10,000,000 balances @12.99%:", ties, "-> at 10M accounts/night, ~that many 1-cent errors per night, every night")
apr5 = Fraction(5, 100)
ties5 = sum(1 for cents in range(1, 1_000_001) if (Fraction(cents, 100) * apr5 / 365 * 100) % 1 == Fraction(1, 2))
print("exact ties among  1,000,000 balances @5.00% :", ties5)
print("example tie: balance 36.50 @ 5%  legacy", legacy(Decimal("36.50"), Decimal("0.05")), "modern", modern(Decimal("36.50"), Decimal("0.05")))
