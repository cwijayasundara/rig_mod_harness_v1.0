package carddemo;

/** Sequential access to the customer KSDS (CBCUS01C.cbl:29-33). Status values are 2-char VSAM file statuses. */
public interface CustomerRepository {
    /** OPEN INPUT (CBCUS01C.cbl:120). Returns the file status. */
    String open();

    /** READ ... INTO CUSTOMER-RECORD (CBCUS01C.cbl:93). Returns the file status; record is set when "00". */
    String readNext();

    /** The 500-byte CUSTOMER-RECORD (CVCUS01Y.cpy) as latin-1 text, valid after a "00" read. */
    String record();

    /** CLOSE (CBCUS01C.cbl:138). Returns the file status. */
    String close();
}
