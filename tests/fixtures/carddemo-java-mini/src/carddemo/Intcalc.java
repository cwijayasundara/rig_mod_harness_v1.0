package carddemo;

import java.io.BufferedOutputStream;
import java.nio.charset.StandardCharsets;

/** Entry point of job INTCALC STEP15 (PGM=CBACT04C). Environment per the runtime contract. */
public final class Intcalc {
    private Intcalc() { }

    public static void main(String[] args) {
        Sysout out = new Sysout(new BufferedOutputStream(System.out, 1 << 16));
        Repositories.Transact tr = new FixedFiles.TransactFile(System.getenv("DD_TRANSACT"));
        String parm = System.getenv("PARM");
        if (parm == null) {
            parm = "";
        }
        // PARM-DATE X(10) (CBACT04C.cbl:178): first 10 bytes of the PARM text; PARM-LENGTH is never tested.
        // RC-08, PRODUCTION UNKNOWN: PARM-DATE X(10) sits right behind the halfword PARM-LENGTH in the parameter
        // area (:176-178) and PARM-LENGTH is never tested, so for a PARM shorter than 10 bytes z/OS hands the program
        // whatever bytes follow the PARM text in storage; no documentation available to me says what they are.
        // Spaces are used (contract-compatible, flagged).
        byte[] pb = parm.getBytes(StandardCharsets.UTF_8);
        String pbs = new String(pb, StandardCharsets.ISO_8859_1);
        String parmDate = (pbs + " ".repeat(10)).substring(0, 10);
        String clock0 = System.getenv("RIG_CLOCK");
        if (clock0 == null || clock0.length() < 19) {
            System.err.println("RIG_CLOCK missing or malformed");
            System.exit(2);
        }
        Cbact04c prog = new Cbact04c(out,
                new FixedFiles.TcatbalFile(System.getenv("DD_TCATBALF")),
                new FixedFiles.XrefFile(System.getenv("DD_XREFFILE")),
                new FixedFiles.DiscgrpFile(System.getenv("DD_DISCGRP")),
                new FixedFiles.AccountFile(System.getenv("DD_ACCTFILE")),
                tr, parmDate, () -> System.getenv("RIG_CLOCK")); // clock asked per record (:496, F6)
        try {
            prog.run();
        } catch (Abend a) {
            // RB-03: "ABENDING PROGRAM" (:629) is already in the buffer before this point; delivering the buffered
            // SYSOUT lines is the only action, then the ABEND line. No CLOSE paragraph / TRANSACT close runs.
            out.flush();
            tr.deleteOnAbend();
            System.err.println("ABEND " + a.code);
            System.exit(a.code & 0xFF);
        } catch (Zoned.DataException e) {
            // F4/RC-06: non-numeric data in arithmetic (:214, :352, :464) is a system abend S0C7 on z/OS, outside the
            // contract's "ABEND <n>" (user abend) form. Closest faithful stop: no further program action, no
            // "ABENDING PROGRAM" (9999 is not performed), distinct line "ABEND S0C7", exit 199 (0xC7).
            // Earlier account rewrites persist, the TRANSACT generation is deleted like for any abend.
            out.flush();
            tr.deleteOnAbend();
            System.err.println("ABEND S0C7");
            System.exit(0xC7);
        }
        out.flush();
        System.exit(0); // GOBACK (:232): RETURN-CODE never set
    }
}
