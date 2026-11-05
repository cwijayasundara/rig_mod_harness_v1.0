package carddemo;

import java.math.BigDecimal;
import java.util.function.Supplier;

/** Translation of CBACT04C (interest calculator). Line citations are CBACT04C.cbl unless noted. */
final class Cbact04c {
    private static final BigDecimal D1200 = new BigDecimal(1200);

    private final Sysout out;
    private final Repositories.Tcatbal tcatbal;
    private final Repositories.Xref xref;
    private final Repositories.Discgrp discgrp;
    private final Repositories.Account account;
    private final Repositories.Transact transact;
    private final String parmDate;   // PARM-DATE X(10), :178
    private final Supplier<String> clock; // FUNCTION CURRENT-DATE (:614), asked once per WRITE (F6/RB-14)

    // working storage
    private String tranCatBalRecord = "";   // TRAN-CAT-BAL-RECORD, 50 bytes (CVTRA01Y)
    private String accountRecord = "";      // ACCOUNT-RECORD, 300 bytes (CVACT01Y)
    private String cardXrefRecord = "";     // CARD-XREF-RECORD, 50 bytes (CVACT03Y)
    private String disGroupRecord = "";     // DIS-GROUP-RECORD, 50 bytes (CVTRA02Y)
    private final StringBuilder tranRecord = new StringBuilder(" ".repeat(350)); // TRAN-RECORD (CVTRA05Y)
    private String endOfFile = "N";         // :137
    private String lastAcctNum = " ".repeat(11); // WS-LAST-ACCT-NUM :167
    private BigDecimal monthlyInt = BigDecimal.ZERO; // WS-MONTHLY-INT S9(9)V99 :168
    private BigDecimal totalInt = BigDecimal.ZERO;   // WS-TOTAL-INT S9(9)V99 :169
    private String firstTime = "Y";         // :170
    private int tranidSuffix = 0;           // WS-TRANID-SUFFIX 9(6) :173

    // keys moved into the FD areas (:202, :204, :210-212)
    private String fdAcctId = "";
    private String fdXrefAcctId = "";
    private String fdDisGroupId = "";
    private String fdDisTypeCd = "";
    private String fdDisCatCd = "";

    Cbact04c(Sysout out, Repositories.Tcatbal t, Repositories.Xref x, Repositories.Discgrp d,
             Repositories.Account a, Repositories.Transact tr, String parmDate, Supplier<String> clock) {
        this.out = out;
        this.tcatbal = t;
        this.xref = x;
        this.discgrp = d;
        this.account = a;
        this.transact = tr;
        this.parmDate = parmDate;
        this.clock = clock;
    }

    /** PROCEDURE DIVISION (:180-232). Throws Abend where 9999-ABEND-PROGRAM runs. */
    void run() {
        out.display("START OF EXECUTION OF PROGRAM CBACT04C"); // :181
        tcatbalOpen();   // :182
        xrefOpen();      // :183
        discgrpOpen();   // :184
        acctOpen();      // :185
        tranOpen();      // :186

        while (!endOfFile.equals("Y")) { // :188
            if (endOfFile.equals("N")) { // :189
                tcatbalGetNext(); // :190
                if (endOfFile.equals("N")) { // :191
                    // ADD 1 TO WS-RECORD-COUNT (:192): counter is never observable
                    out.display(tranCatBalRecord); // :193 DISPLAY of the 50-byte group, bytes as stored
                    String acctId = tranCatBalRecord.substring(0, 11);
                    if (!acctId.equals(lastAcctNum)) { // :194
                        if (!firstTime.equals("Y")) { // :195
                            updateAccount(); // :196
                        } else {
                            firstTime = "N"; // :198
                        }
                        totalInt = BigDecimal.ZERO; // :200
                        lastAcctNum = acctId; // :201
                        fdAcctId = acctId; // :202
                        getAcctData(); // :203
                        fdXrefAcctId = acctId; // :204
                        getXrefData(); // :205
                    }
                    fdDisGroupId = accountRecord.substring(112, 122); // :210 ACCT-GROUP-ID
                    fdDisCatCd = tranCatBalRecord.substring(13, 17);  // :211 TRANCAT-CD
                    fdDisTypeCd = tranCatBalRecord.substring(11, 13); // :212 TRANCAT-TYPE-CD
                    getInterestRate(); // :213
                    // :214 numeric compare: F-zone '000000' is +0 (Zoned.decode accepts plain digits), RB-15
                    if (disIntRate().signum() != 0) { // :214
                        computeInterest(); // :215
                        // 1400-COMPUTE-FEES (:216) is an empty paragraph (:518-520)
                    }
                }
            } else {
                // :219-220 is dead code: the loop test at :188 has already excluded END-OF-FILE = 'Y',
                // so the final account is never rewritten (kept as is).
                updateAccount();
            }
        }

        tcatbalClose();  // :224
        xrefClose();     // :225
        discgrpClose();  // :226
        acctClose();     // :227
        tranClose();     // :228
        out.display("END OF EXECUTION OF PROGRAM CBACT04C"); // :230
    }

    private BigDecimal disIntRate() {
        return Zoned.decode(disGroupRecord.substring(16, 22), 2); // DIS-INT-RATE S9(4)V99
    }

    // ---- opens (:234-323) ----
    private void tcatbalOpen() {
        String st = tcatbal.open();
        if (!st.equals("00")) { // :237-241
            out.display("ERROR OPENING TRANSACTION CATEGORY BALANCE"); // :245
            displayIoStatus(st);
            abendProgram();
        }
    }

    private void xrefOpen() {
        String st = xref.open();
        if (!st.equals("00")) { // :255
            out.display("ERROR OPENING CROSS REF FILE" + st); // :263 (status appended, no separator)
            displayIoStatus(st);
            abendProgram();
        }
    }

    private void discgrpOpen() {
        String st = discgrp.open();
        if (!st.equals("00")) { // :273
            out.display("ERROR OPENING DALY REJECTS FILE"); // :281
            displayIoStatus(st);
            abendProgram();
        }
    }

    private void acctOpen() {
        String st = account.open();
        if (!st.equals("00")) { // :292
            out.display("ERROR OPENING ACCOUNT MASTER FILE"); // :300
            displayIoStatus(st);
            abendProgram();
        }
    }

    private void tranOpen() {
        String st = transact.open();
        if (!st.equals("00")) { // :310
            out.display("ERROR OPENING TRANSACTION FILE"); // :318
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1000-TCATBALF-GET-NEXT (:325-348) ----
    private void tcatbalGetNext() {
        String st = tcatbal.readNext(); // :326
        if (st.equals("00")) {
            tranCatBalRecord = tcatbal.record(); // READ ... INTO
        } else if (st.equals("10")) {
            endOfFile = "Y"; // :330-340
        } else {
            out.display("ERROR READING TRANSACTION CATEGORY FILE"); // :342
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1050-UPDATE-ACCOUNT (:350-370) ----
    private void updateAccount() {
        // ADD WS-TOTAL-INT TO ACCT-CURR-BAL S9(10)V99, no SIZE ERROR (:352, H-0004). An F-zone balance is read as
        // positive and written back C-zone even when WS-TOTAL-INT is 0 (the ADD always stores; RB-15).
        BigDecimal bal = Zoned.decode(accountRecord.substring(12, 24), 2).add(totalInt);
        String balField = Zoned.encode(bal, 10, 2);
        String zero = Zoned.encode(BigDecimal.ZERO, 10, 2);
        // MOVE 0 TO ACCT-CURR-CYC-CREDIT / -DEBIT (:353-354)
        accountRecord = accountRecord.substring(0, 12) + balField + accountRecord.substring(24, 78)
                + zero + zero + accountRecord.substring(102);
        String st = account.rewrite(accountRecord); // :356 REWRITE FROM ACCOUNT-RECORD, whole 300 bytes (H-0057)
        if (!st.equals("00")) { // :357-361
            out.display("ERROR RE-WRITING ACCOUNT FILE"); // :365
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1100-GET-ACCT-DATA (:372-391) ----
    private void getAcctData() {
        String st = account.read(fdAcctId); // :373
        if (st.equals("00")) {
            accountRecord = account.record();
        } else {
            if (st.equals("23")) {
                out.display("ACCOUNT NOT FOUND: " + fdAcctId); // :375 INVALID KEY
            }
            out.display("ERROR READING ACCOUNT FILE"); // :386
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1110-GET-XREF-DATA (:393-413) ----
    private void getXrefData() {
        String st = xref.readByAcctId(fdXrefAcctId); // :394-395
        if (st.equals("00")) {
            cardXrefRecord = xref.record();
        } else {
            if (st.equals("23")) {
                out.display("ACCOUNT NOT FOUND: " + fdXrefAcctId); // :397 INVALID KEY
            }
            out.display("ERROR READING XREF FILE"); // :408
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1200-GET-INTEREST-RATE (:415-440) ----
    private void getInterestRate() {
        String st = discgrp.read(fdDisGroupId + fdDisTypeCd + fdDisCatCd); // :416
        if (st.equals("00")) {
            disGroupRecord = discgrp.record();
        } else if (st.equals("23")) {
            out.display("DISCLOSURE GROUP RECORD MISSING"); // :418 INVALID KEY
            out.display("TRY WITH DEFAULT GROUP CODE");      // :419
        }
        if (!(st.equals("00") || st.equals("23"))) { // :422 -> APPL-RESULT 12
            out.display("ERROR READING DISCLOSURE GROUP FILE"); // :431
            displayIoStatus(st);
            abendProgram();
        }
        if (st.equals("23")) { // :436
            fdDisGroupId = "DEFAULT   "; // :437 MOVE 'DEFAULT' (padded to X(10))
            getDefaultIntRate(); // :438
        }
    }

    // ---- 1200-A-GET-DEFAULT-INT-RATE (:443-460) ----
    private void getDefaultIntRate() {
        String st = discgrp.read(fdDisGroupId + fdDisTypeCd + fdDisCatCd); // :444 (no INVALID KEY clause)
        if (st.equals("00")) {
            disGroupRecord = discgrp.record();
        } else {
            out.display("ERROR READING DEFAULT DISCLOSURE GROUP"); // :455
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 1300-COMPUTE-INTEREST (:462-470) ----
    private void computeInterest() {
        BigDecimal bal = Zoned.decode(tranCatBalRecord.substring(17, 28), 2); // TRAN-CAT-BAL S9(9)V99
        // COMPUTE (bal * rate) / 1200 without ROUNDED: truncate toward zero to 2 decimals (H-0001);
        // store keeps the low-order 9 integer digits, no SIZE ERROR (H-0002)
        BigDecimal raw = bal.multiply(disIntRate()).divide(D1200, 2, java.math.RoundingMode.DOWN);
        String miField = Zoned.encode(raw, 9, 2);
        monthlyInt = Zoned.decode(miField, 2);
        // ADD WS-MONTHLY-INT TO WS-TOTAL-INT S9(9)V99, no SIZE ERROR (:467, H-0003)
        totalInt = Zoned.decode(Zoned.encode(totalInt.add(monthlyInt), 9, 2), 2);
        writeTx(miField); // :468
    }

    // ---- 1300-B-WRITE-TX (:473-515) ----
    private void writeTx(String monthlyIntField) {
        tranidSuffix = (tranidSuffix + 1) % 1000000; // ADD 1 TO PIC 9(6), wraps with no SIZE ERROR (:474, H-0005)
        String suffix = String.format("%06d", tranidSuffix);
        set(0, 16, parmDate + suffix);            // :476 STRING PARM-DATE, suffix INTO TRAN-ID (10+6 = 16)
        set(16, 2, "01");                         // :482 TRAN-TYPE-CD
        set(18, 4, "0005");                       // :483 MOVE '05' to 9(4)
        set(22, 10, "System    ");                // :484 TRAN-SOURCE
        // :485-489 STRING 'Int. for a/c ' (13) + ACCT-ID (11) DELIMITED BY SIZE INTO TRAN-DESC X(100) (CVTRA05Y:9):
        // STRING writes only those 24 bytes and does NOT pad; TRAN-DESC bytes 25-100 keep what they held before.
        // The code therefore does one thing: they keep their previous content. Previous content is, for every
        // record, the initial content of the never-initialized working-storage item, which this program
        // never changes (it only ever overwrites bytes 1-24), so all records show the same tail. Initial content
        // here = spaces (reference); z/OS gives no VALUE-less guarantee (RC-07, no documentation available to me).
        String desc = "Int. for a/c " + accountRecord.substring(0, 11);
        tranRecord.replace(32, 32 + desc.length(), desc);
        set(132, 11, monthlyIntField);            // :490 TRAN-AMT S9(9)V99
        set(143, 9, "000000000");                 // :491 TRAN-MERCHANT-ID
        set(152, 50, " ".repeat(50));             // :492
        set(202, 50, " ".repeat(50));             // :493
        set(252, 10, " ".repeat(10));             // :494
        set(262, 16, cardXrefRecord.substring(0, 16)); // :495 XREF-CARD-NUM
        String ts = db2Timestamp();               // :496, clock read here, per record
        set(278, 26, ts);                         // :497 TRAN-ORIG-TS
        set(304, 26, ts);                         // :498 TRAN-PROC-TS
        // TRAN-RECORD FILLER X(20) (330-350) is never moved (:500, H-0058): it keeps its initial content
        String st = transact.write(tranRecord.toString()); // :500
        if (!st.equals("00")) { // :501-505
            out.display("ERROR WRITING TRANSACTION RECORD"); // :510
            displayIoStatus(st);
            abendProgram();
        }
    }

    private void set(int off, int len, String v) {
        tranRecord.replace(off, off + len, v);
    }

    // ---- Z-GET-DB2-FORMAT-TIMESTAMP (:613-626) ----
    private String db2Timestamp() {
        // CURRENT-DATE (:614) evaluated at every call, i.e. per WRITE (F6). The source is RIG_CLOCK
        // YYYY-MM-DDTHH:MM:SS[.hh]; the contract freezes it with hundredths 00, an optional ".hh" suffix is honoured.
        String clock = this.clock.get();
        String yyyy = clock.substring(0, 4);
        String mm = clock.substring(5, 7);
        String dd = clock.substring(8, 10);
        String hh = clock.substring(11, 13);
        String min = clock.substring(14, 16);
        String ss = clock.substring(17, 19);
        String mil = "00";
        if (clock.length() >= 22 && clock.charAt(19) == '.' && Character.isDigit(clock.charAt(20))
                && Character.isDigit(clock.charAt(21))) {
            mil = clock.substring(20, 22);
        }
        // field by field over the REDEFINES layout (:152-165, :615-624): X(4)-X(2)-X(2)-X(2).X(2).X(2).9(2)X(4)
        return yyyy + "-" + mm + "-" + dd + "-" + hh + "." + min + "." + ss + "." + mil + "0000";
    }

    // ---- closes (:522-611) ----
    private void tcatbalClose() {
        String st = tcatbal.close();
        if (!st.equals("00")) {
            out.display("ERROR CLOSING TRANSACTION BALANCE FILE"); // :533
            displayIoStatus(st); // MOVE xxxx-STATUS TO IO-STATUS before 9910
            abendProgram();
        }
    }

    private void xrefClose() {
        String st = xref.close();
        if (!st.equals("00")) {
            out.display("ERROR CLOSING CROSS REF FILE"); // :552
            displayIoStatus(st); // MOVE xxxx-STATUS TO IO-STATUS before 9910
            abendProgram();
        }
    }

    private void discgrpClose() {
        String st = discgrp.close();
        if (!st.equals("00")) {
            out.display("ERROR CLOSING DISCLOSURE GROUP FILE"); // :570
            displayIoStatus(st); // MOVE xxxx-STATUS TO IO-STATUS before 9910
            abendProgram();
        }
    }

    private void acctClose() {
        String st = account.close();
        if (!st.equals("00")) {
            out.display("ERROR CLOSING ACCOUNT FILE"); // :588
            displayIoStatus(st); // MOVE xxxx-STATUS TO IO-STATUS before 9910
            abendProgram();
        }
    }

    private void tranClose() {
        String st = transact.close();
        if (!st.equals("00")) {
            out.display("ERROR CLOSING TRANSACTION FILE"); // :606
            displayIoStatus(st);
            abendProgram();
        }
    }

    // ---- 9910-DISPLAY-IO-STATUS (:635-648) ----
    /**
     * F5/RB-16/RC-10. The paths with IO-STATUS NOT NUMERIC or IO-STAT1 = '9' (:636-637) show the second status byte
     * as a binary value (:639-642). On z/OS that byte is EBCDIC for a digit ('3' = 0xF3 = 243), so the byte is
     * converted to cp037 before it is shown; a VSAM 9x status carries a binary code in IO-STAT2, which this
     * program cannot produce (its statuses are 2 digits, all first bytes other than '9'), so this branch is
     * unreachable here. First byte is shown as the character (SYSOUT is the ASCII surface).
     */
    private void displayIoStatus(String status) {
        char s1 = status.charAt(0);
        char s2 = status.charAt(1);
        boolean numeric = Character.isDigit(s1) && s1 < 128 && Character.isDigit(s2) && s2 < 128;
        if (!numeric || s1 == '9') { // :636-637
            // TWO-BYTES-BINARY = 0 then low byte := IO-STAT2 (:639-640); MOVE to PIC 999 keeps low 3 digits (:641)
            int bin = ebcdic(s2);
            out.display("FILE STATUS IS: NNNN" + s1 + String.format("%03d", bin % 1000)); // :638, :642
        } else {
            out.display("FILE STATUS IS: NNNN00" + status); // :644-646 '0000' then (3:2) := status
        }
    }

    private static int ebcdic(char c) {
        if (c >= '0' && c <= '9') {
            return 0xF0 + (c - '0');
        }
        try {
            byte[] b = String.valueOf(c).getBytes(java.nio.charset.Charset.forName("IBM037"));
            return b.length == 1 ? b[0] & 0xFF : c & 0xFF;
        } catch (RuntimeException e) {
            return c & 0xFF;
        }
    }

    // ---- 9999-ABEND-PROGRAM (:628-632) ----
    private void abendProgram() {
        out.display("ABENDING PROGRAM"); // :629
        throw new Abend(999);            // :630-632 MOVE 999 TO ABCODE; CALL 'CEE3ABD'
    }
}
