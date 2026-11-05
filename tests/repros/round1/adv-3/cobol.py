"""Small, faithful models of the COBOL semantics the probes rely on.

- EBCDIC collation: real cp037 bytes (lowercase 0x81.. < uppercase 0xC1.. < digits 0xF0..).
- COMP-3 packed decimal: digit nibbles + sign nibble (C positive, D negative).
- PIC numeric MOVE: high-order truncation, no exception.
- ROUNDED: nearest, ties away from zero (IBM Enterprise COBOL default). No ROUNDED: truncation.
"""
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN, getcontext
import hashlib

getcontext().prec = 40  # IBM keeps up to 30 digits in intermediates under ARITH(COMPAT)


def ebcdic_key(s: str) -> bytes:
    return s.encode("cp037")


def ebcdic_sorted(items, key=lambda x: x):
    return sorted(items, key=lambda x: ebcdic_key(key(x)))


def ebcdic_ge(a: str, b: str) -> bool:
    """COBOL alphanumeric compare on z/OS (space padded, EBCDIC byte order)."""
    n = max(len(a), len(b))
    return ebcdic_key(a.ljust(n)) >= ebcdic_key(b.ljust(n))


def comp3_pack(value: Decimal, digits: int, scale: int) -> bytes:
    """PIC S9(digits-scale)V9(scale) COMP-3."""
    q = Decimal(10) ** -scale
    v = value.quantize(q, rounding=ROUND_DOWN)
    neg = v < 0
    unscaled = abs(int(v.scaleb(scale)))
    ds = str(unscaled).rjust(digits, "0")[-digits:]  # MOVE truncates high-order digits
    if len(ds) % 2 == 0:
        ds = "0" + ds
    nibbles = ds + ("D" if neg else "C")
    return bytes.fromhex(nibbles)


def comp3_unpack(b: bytes, scale: int) -> Decimal:
    h = b.hex().upper()
    digits, sign = h[:-1], h[-1]
    v = Decimal(int(digits)).scaleb(-scale)
    return -v if sign == "D" else v


def pic_move_numeric(value: Decimal, int_digits: int, scale: int) -> Decimal:
    """MOVE to PIC 9(int_digits)V9(scale): truncates both ends silently."""
    q = Decimal(10) ** -scale
    v = value.quantize(q, rounding=ROUND_DOWN)
    sign = -1 if v < 0 else 1
    unscaled = abs(int(v.scaleb(scale))) % (10 ** (int_digits + scale))
    return sign * Decimal(unscaled).scaleb(-scale)


def compute_rounded(value: Decimal, scale: int) -> Decimal:
    """COMPUTE ... ROUNDED (default mode: NEAREST-AWAY-FROM-ZERO)."""
    return value.quantize(Decimal(10) ** -scale, rounding=ROUND_HALF_UP)


def compute_truncated(value: Decimal, scale: int) -> Decimal:
    """COMPUTE without ROUNDED: truncation."""
    return value.quantize(Decimal(10) ** -scale, rounding=ROUND_DOWN)


def sha(s) -> str:
    return hashlib.sha256(str(s).encode()).hexdigest()[:12]
