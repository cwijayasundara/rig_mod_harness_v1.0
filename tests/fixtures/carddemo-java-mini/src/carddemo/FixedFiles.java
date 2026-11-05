package carddemo;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/** Fixed-record adapters (no separators) for the legacy files; keyed by the first bytes of each record. */
final class FixedFiles {
    private FixedFiles() { }

    /** Reads a fixed-record file fully. A trailing partial record is ignored (unknown on production). */
    static List<String> load(File f, int lrecl) throws IOException {
        byte[] all = Files.readAllBytes(f.toPath());
        List<String> out = new ArrayList<>();
        for (int off = 0; off + lrecl <= all.length; off += lrecl) {
            out.add(new String(all, off, lrecl, StandardCharsets.ISO_8859_1));
        }
        return out;
    }

    /**
     * Open INPUT of a KSDS. Missing dataset (path absent, or null = no DD): status 35. On z/OS a DD that is
     * missing from the step gives OPEN status 35; a cataloged dataset that cannot be allocated is a JCL/allocation
     * failure before CBACT04C starts (no program output at all) - the contract maps "path does not exist" to the
     * program's own OPEN handling, so 35 is used (RC-03; no documentation available to me beyond that).
     * Empty file: OPEN gives 00 and the first READ gives 10 (RC-02; z/OS behaviour of OPEN on an empty KSDS:
     * no documentation available to me, 00 assumed). Unreadable file (permission): 37 (valid OPEN status);
     * any other I/O error while loading: 30 (permanent error, valid for OPEN) (F7).
     */
    abstract static class Base {
        final File file;
        final int lrecl;
        final int keyOff;
        final int keyLen;
        List<String> recs;
        String current;

        Base(String path, int lrecl, int keyOff, int keyLen) {
            this.file = path == null ? null : new File(path);
            this.lrecl = lrecl;
            this.keyOff = keyOff;
            this.keyLen = keyLen;
        }

        String doOpen() {
            if (file == null || !file.isFile()) {
                return "35";
            }
            try {
                recs = load(file, lrecl);
            } catch (java.nio.file.AccessDeniedException e) {
                return "37";
            } catch (IOException e) {
                return "30";
            }
            return "00";
        }

        String key(String r) {
            return r.substring(keyOff, keyOff + keyLen);
        }

        public String record() {
            return current;
        }

        public String close() {
            return "00";
        }
    }

    /**
     * TCATBAL: sequential read in key order (H-0006; the key is FD-TRAN-CAT-KEY, RECORD KEY clause :31, 17 bytes).
     * PRODUCTION UNKNOWN (F1): a z/OS KSDS returns records in EBCDIC collating order of the key bytes, the code
     * below sorts by ASCII/Latin-1 byte order because the brief fixes it ("use ASCII byte order for keys; do not
     * invent a collation") - the reference environment cannot produce EBCDIC order. The two orders agree
     * whenever all key bytes are digits (account id 9(11), category 9(4), digit-only type codes, as in all dev
     * cases); they differ for alphabetic type codes (EBCDIC: letters < digits, ASCII: digits < letters) and
     * decide DISPLAY order, SYSTRAN order, TRAN-ID suffixes and account breaks. Not changed; reported.
     */
    static final class TcatbalFile extends Base implements Repositories.Tcatbal {
        private int pos;

        TcatbalFile(String path) {
            super(path, 50, 0, 17);
        }

        public String open() {
            String st = doOpen();
            if (st.equals("00")) {
                recs.sort((a, b) -> key(a).compareTo(key(b)));
                pos = 0;
            }
            return st;
        }

        public String readNext() {
            if (pos >= recs.size()) {
                return "10";
            }
            current = recs.get(pos++);
            return "00";
        }
    }

    /**
     * XREF: primary key card number (0,16); alternate key account id (25,11). The alternate key has no
     * DUPLICATES clause in the SELECT (:38) yet the file stands for a VSAM AIX that may hold several cards per
     * account (RC-04, F2). PRODUCTION UNKNOWN: which duplicate a keyed READ returns. Chosen: the smallest
     * primary key (XREF-CARD-NUM, ASCII byte order), i.e. base-cluster key order within one alternate key,
     * independent of load order. No documentation available to me confirms that VSAM AIX order for a KSDS base.
     */
    static final class XrefFile extends Base implements Repositories.Xref {
        XrefFile(String path) {
            super(path, 50, 25, 11);
        }

        public String open() {
            return doOpen();
        }

        public String readByAcctId(String acctId) {
            String best = null;
            for (String r : recs) {
                if (key(r).equals(acctId) && (best == null || r.substring(0, 16).compareTo(best.substring(0, 16)) < 0)) {
                    best = r;
                }
            }
            if (best == null) {
                return "23";
            }
            current = best;
            return "00";
        }
    }

    /** DISCGRP: key group(10)+type(2)+cat(4). */
    static final class DiscgrpFile extends Base implements Repositories.Discgrp {
        DiscgrpFile(String path) {
            super(path, 50, 0, 16);
        }

        public String open() {
            return doOpen();
        }

        public String read(String key16) {
            for (String r : recs) {
                if (key(r).equals(key16)) {
                    current = r;
                    return "00";
                }
            }
            return "23";
        }
    }

    /** ACCOUNT: key ACCT-ID (0,11); REWRITE in place at the record's original position. */
    static final class AccountFile extends Base implements Repositories.Account {
        AccountFile(String path) {
            super(path, 300, 0, 11);
        }

        public String open() {
            return doOpen();
        }

        public String read(String acctId) {
            for (String r : recs) {
                if (key(r).equals(acctId)) {
                    current = r;
                    return "00";
                }
            }
            return "23";
        }

        public String rewrite(String record300) {
            String k = key(record300);
            for (int i = 0; i < recs.size(); i++) {
                if (key(recs.get(i)).equals(k)) {
                    try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
                        raf.seek((long) i * lrecl);
                        raf.write(record300.getBytes(StandardCharsets.ISO_8859_1));
                    } catch (IOException e) {
                        return "30"; // REWRITE status for a permanent I/O error (37 is an OPEN status, F7)
                    }
                    recs.set(i, record300);
                    return "00";
                }
            }
            return "23";
        }
    }

    /** TRANSACT: OPEN OUTPUT creates/truncates; records appended in write order. */
    static final class TransactFile implements Repositories.Transact {
        private final File file;
        private java.io.OutputStream os;

        TransactFile(String path) {
            this.file = path == null ? null : new File(path);
        }

        public String open() {
            if (file == null) {
                return "35";
            }
            try {
                os = new java.io.BufferedOutputStream(new java.io.FileOutputStream(file, false));
            } catch (IOException e) {
                return "37"; // OPEN OUTPUT refused (permission / directory missing): valid OPEN status (F7)
            }
            return "00";
        }

        public String write(String record350) {
            try {
                os.write(record350.getBytes(StandardCharsets.ISO_8859_1));
            } catch (IOException e) {
                return "30";
            }
            return "00";
        }

        public String close() {
            try {
                os.close();
            } catch (IOException e) {
                return "30";
            }
            return "00";
        }

        /**
         * RB-03: nothing runs after CEE3ABD (:632, TIMING 0): no CLOSE paragraph, no flush of the output buffer.
         * The doomed generation is only removed (DISP=(NEW,CATLG,DELETE), INTCALC.jcl:37). Account REWRITEs already
         * went to the file one by one in rewrite() and stay (RC-05; z/OS: VSAM buffers are written when task
         * termination closes the ACB - no documentation available to me, the persisted rewrites are kept).
         */
        public void deleteOnAbend() {
            if (os != null) {
                file.delete();
            }
        }
    }
}
