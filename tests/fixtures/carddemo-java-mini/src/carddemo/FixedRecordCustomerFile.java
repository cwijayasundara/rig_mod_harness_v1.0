package carddemo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Adapter over the unload of the KSDS: 500-byte records, key ascending, no separators (brief runtime contract). */
public final class FixedRecordCustomerFile implements CustomerRepository {
    public static final int RECLEN = 500; // CVCUS01Y.cpy:2 (RECLN 500)
    private final Path path;
    private byte[] data;
    private int pos;
    private String rec;

    public FixedRecordCustomerFile(Path path) { this.path = path; }

    @Override
    public String open() {
        if (path == null || !Files.exists(path)) return "35"; // missing dataset
        try {
            byte[] d = Files.readAllBytes(path);
            // Length heuristic only: any multiple of 500 opens as 00 (a 0-byte file is an empty KSDS per the brief);
            // a non-multiple is NOT proof of "not a loaded indexed file", it is merely the check this adapter can make.
            if (d.length % RECLEN != 0) return "30";
            data = d;
            pos = 0;
            return "00";
        } catch (IOException e) {
            return "30";
        }
    }

    @Override
    public String readNext() {
        // UNVERIFIED, UNREACHABLE: status 47 is the worker's own choice, not in the brief nor backed by any legacy case.
        // It stands in for a READ before OPEN (legacy READ at CBCUS01C.cbl:93); Cbcus01c aborts at :132 if OPEN fails, so never reached.
        if (data == null) return "47";
        if (pos >= data.length) return "10"; // end of file
        rec = new String(data, pos, RECLEN, StandardCharsets.ISO_8859_1);
        pos += RECLEN;
        return "00";
    }

    @Override
    public String record() { return rec; }

    @Override
    public String close() {
        // UNVERIFIED, UNREACHABLE: status 42 is the worker's own choice, not in the brief nor backed by any legacy case.
        // It stands in for a CLOSE before OPEN (legacy CLOSE at CBCUS01C.cbl:138); Cbcus01c abends at :132 if OPEN fails, so never reached.
        if (data == null) return "42";
        data = null;
        return "00";
    }
}
