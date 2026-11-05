package carddemo;

/** CALL 'CEE3ABD' USING ABCODE, TIMING (CBACT04C.cbl:632): user abend with the given code. */
final class Abend extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final int code;

    Abend(int code) {
        super("ABEND " + code, null, false, false);
        this.code = code;
    }
}
