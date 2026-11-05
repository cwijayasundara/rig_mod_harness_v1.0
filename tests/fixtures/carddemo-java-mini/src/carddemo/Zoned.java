package carddemo;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;

/**
 * Zoned-decimal (DISPLAY, SIGN trailing) codec over the character form used by the
 * observation surface: positive last byte '{','A'..'I' (0..9), negative '}','J'..'R'.
 * An F-zone plain digit on input is positive (brief: Observation surface).
 */
final class Zoned {
    private static final String POS = "{ABCDEFGHI";
    private static final String NEG = "}JKLMNOPQR";

    private Zoned() { }

    /**
     * Decode a PIC S9(p)V9(scale) field used arithmetically (CBACT04C.cbl:214 compare, :352 ADD, :464 COMPUTE).
     * A byte that is not a digit (non-final) or not a digit / sign overpunch (final) is non-numeric data: on z/OS
     * the decimal instruction takes a data exception (S0C7), it never yields a value. Here it throws
     * {@link DataException}; Intcalc ends the run with the documented line "ABEND S0C7" (exit 199 = 0xC7). The
     * accepted sign set is the one of the observation surface (brief: Observation surface); z/OS would also
     * accept the other valid sign nibbles A/B/E (no documentation available to me for how the surface renders them).
     */
    static BigDecimal decode(String s, int scale) {
        int n = s.length();
        StringBuilder digits = new StringBuilder(n);
        boolean negative = false;
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            int d;
            if (i == n - 1) {
                int p = POS.indexOf(c);
                int q = NEG.indexOf(c);
                if (p >= 0) {
                    d = p;
                } else if (q >= 0) {
                    d = q;
                    negative = true;
                } else if (c >= '0' && c <= '9') {
                    d = c - '0'; // F-zone plain digit: positive
                } else {
                    throw new DataException(s);
                }
            } else if (c >= '0' && c <= '9') {
                d = c - '0';
            } else {
                throw new DataException(s);
            }
            digits.append((char) ('0' + d));
        }
        BigDecimal v = new BigDecimal(new BigInteger(digits.toString()), scale);
        return negative ? v.negate() : v;
    }

    /** Data exception (S0C7) on non-numeric data in an arithmetic use. */
    static final class DataException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        DataException(String field) {
            super("S0C7 on [" + field + "]", null, false, false);
        }
    }

    /**
     * Store into PIC S9(intDigits)V9(scale): truncate toward zero at the scale (no ROUNDED),
     * keep only the low-order intDigits integer digits (no ON SIZE ERROR). A zero magnitude is +0.
     *
     * NEGATIVE ZERO (RB-10) - production behaviour unknown, choice made here: every stored zero is written
     * with the positive C-zone ('{'). This covers (a) a negative COMPUTE result truncated to 0 at :464
     * (e.g. balance -0.01, rate 1.00), (b) high-order overflow leaving all-zero digits (:464, :467, :352),
     * and the zero results of ADD at :467 (WS-TOTAL-INT) and :352 (ACCT-CURR-BAL); MOVE 0 (:200, :353-354)
     * is +0 by definition. Reason: the reference run stores +0 and the dev cases do not distinguish (a
     * variant keeping the sign for (b) also passes all 75). No documentation available to me says whether
     * Enterprise COBOL leaves a '}' (D-zone zero) in (a) or (b); the ISO rule that a size-truncated result keeps
     * its sign would suggest '}' for (b). Flagged as production-unknown; change only here if proven.
     */
    static String encode(BigDecimal v, int intDigits, int scale) {
        BigDecimal t = v.setScale(scale, RoundingMode.DOWN);
        int n = intDigits + scale;
        BigInteger mag = t.unscaledValue().abs().mod(BigInteger.TEN.pow(n));
        boolean neg = t.signum() < 0 && mag.signum() != 0;
        StringBuilder sb = new StringBuilder(mag.toString());
        while (sb.length() < n) {
            sb.insert(0, '0');
        }
        int last = sb.charAt(n - 1) - '0';
        sb.setCharAt(n - 1, (neg ? NEG : POS).charAt(last));
        return sb.toString();
    }
}
