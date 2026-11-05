package carddemo;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

/** Translation of CBCUS01C (READCUST.jcl STEP05). */
public final class Cbcus01c {
    private final CustomerRepository repo;
    private final PrintStream out;
    private String status = "  "; // CUSTFILE-STATUS (:46)
    private boolean endOfFile = false; // END-OF-FILE 'N' (:65)
    private int applResult; // APPL-RESULT (:61)
    private String customerRecord = ""; // CUSTOMER-RECORD

    Cbcus01c(CustomerRepository repo, PrintStream out) { this.repo = repo; this.out = out; }

    private void display(String s) { out.print(s); out.print('\n'); }

    public static void main(String[] args) {
        PrintStream out = new PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), false, StandardCharsets.ISO_8859_1);
        String dd = System.getenv("DD_CUSTFILE");
        Cbcus01c m = new Cbcus01c(new FixedRecordCustomerFile(dd == null ? null : Path.of(dd)), out);
        m.run();
        out.flush();
        System.exit(0); // GOBACK, RETURN-CODE 0 (:87)
    }

    void run() {
        display("START OF EXECUTION OF PROGRAM CBCUS01C"); // :71
        open();                                             // :72
        while (!endOfFile) {                                // :74
            if (!endOfFile) {                               // :75
                getNext();                                  // :76
                if (!endOfFile) {                           // :77
                    display(customerRecord);                // :78
                }
            }
        }
        close();                                            // :83
        display("END OF EXECUTION OF PROGRAM CBCUS01C");    // :85
    }

    private void getNext() { // :92
        status = repo.readNext();                           // :93
        if (status.equals("00")) {                          // :94
            customerRecord = repo.record();
            applResult = 0;                                 // :95
            display(customerRecord);                        // :96
        } else if (status.equals("10")) {                   // :98
            applResult = 16;                                // :99
        } else {
            applResult = 12;                                // :101
        }
        if (applResult == 0) {                              // :104 APPL-AOK
            // CONTINUE
        } else if (applResult == 16) {                      // :107 APPL-EOF
            endOfFile = true;                               // :108
        } else {
            display("ERROR READING CUSTOMER FILE");         // :110
            displayIoStatus(status);                        // :111-112
            abend();                                        // :113
        }
    }

    private void open() { // :118
        applResult = 8;                                     // :119
        status = repo.open();                               // :120
        applResult = status.equals("00") ? 0 : 12;          // :121-125
        if (applResult != 0) {                              // :126
            display("ERROR OPENING CUSTFILE");              // :129
            displayIoStatus(status);                        // :130-131
            abend();                                        // :132
        }
    }

    private void close() { // :136
        applResult = 8;                                     // :137
        status = repo.close();                              // :138
        applResult = status.equals("00") ? applResult - applResult : 12; // :139-143
        if (applResult != 0) {                              // :144
            display("ERROR CLOSING CUSTOMER FILE");         // :147
            displayIoStatus(status);                        // :148-149
            abend();                                        // :150
        }
    }

    /** Z-ABEND-PROGRAM (:154-158): CEE3ABD with ABCODE 999, TIMING 0 - no file close afterwards. */
    private void abend() {
        display("ABENDING PROGRAM");                        // :155
        int abcode = 999;                                   // :157
        out.flush();
        System.err.print("ABEND " + abcode + "\n");
        System.err.flush();
        Runtime.getRuntime().halt(abcode & 0xFF);
    }

    /** Z-DISPLAY-IO-STATUS (:161-174). */
    private void displayIoStatus(String ioStatus) {
        char stat1 = ioStatus.charAt(0), stat2 = ioStatus.charAt(1);
        boolean numeric = Character.isDigit(stat1) && stat1 < 128 && Character.isDigit(stat2) && stat2 < 128;
        String io04;
        if (!numeric || stat1 == '9') {                     // :162-163
            // IO-STATUS-04(1:1) = IO-STAT1 (:164); TWO-BYTES-BINARY = 0 (:165);
            // TWO-BYTES-RIGHT = IO-STAT2 (:166): big-endian halfword, right byte is the low byte.
            // H-0012 note: stat2 is taken from the Latin-1 code of the status byte. On z/OS the byte is EBCDIC, so the
            // printed digits would differ (PREFLIGHT-level code-page difference). UNREACHABLE with the current adapter,
            // which only returns numeric statuses (00,10,30,35,42,47) and never a non-numeric or '9x' status.
            int twoBytesBinary = 0;
            twoBytesBinary = (twoBytesBinary & 0xFF00) | (stat2 & 0xFF);
            int v = twoBytesBinary % 1000;                  // :167 MOVE to PIC 999 truncates high digits
            io04 = stat1 + String.format("%03d", v);
        } else {
            io04 = "0000";                                  // :170
            io04 = io04.substring(0, 2) + ioStatus;         // :171 (3:2)
        }
        display("FILE STATUS IS: NNNN" + io04);            // :168 / :172
    }
}
