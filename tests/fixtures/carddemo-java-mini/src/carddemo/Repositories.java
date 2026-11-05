package carddemo;

/** Repository interfaces, one per file of CBACT04C (CBACT04C.cbl:28-56). Each returns a 2-char file status. */
interface Repositories {

    /** TCATBAL-FILE: INDEXED, ACCESS SEQUENTIAL, key order (CBACT04C.cbl:28-32). */
    interface Tcatbal {
        String open();
        /** READ ... : "00" with record(), "10" at end. */
        String readNext();
        String record();
        String close();
    }

    /** XREF-FILE: INDEXED, RANDOM, alternate key XREF-ACCT-ID (CBACT04C.cbl:34-39). */
    interface Xref {
        String open();
        /** READ ... KEY IS FD-XREF-ACCT-ID: "00" or "23". */
        String readByAcctId(String acctId);
        String record();
        String close();
    }

    /** DISCGRP-FILE: INDEXED, RANDOM (CBACT04C.cbl:47-51). */
    interface Discgrp {
        String open();
        String read(String key16);
        String record();
        String close();
    }

    /** ACCOUNT-FILE: INDEXED, RANDOM, opened I-O (CBACT04C.cbl:41-45). */
    interface Account {
        String open();
        String read(String acctId);
        String record();
        /** REWRITE in place; the key is the first 11 bytes of the record. */
        String rewrite(String record300);
        String close();
    }

    /** TRANSACT-FILE: SEQUENTIAL output (CBACT04C.cbl:53-56). */
    interface Transact {
        String open();
        String write(String record350);
        String close();
        /** DISP=(NEW,CATLG,DELETE) on abend (INTCALC.jcl:37): the new generation is deleted. */
        void deleteOnAbend();
    }
}
