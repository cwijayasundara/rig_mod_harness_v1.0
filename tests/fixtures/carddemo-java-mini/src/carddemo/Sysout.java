package carddemo;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** SYSOUT: one line per DISPLAY, newline-terminated, nothing trimmed. */
final class Sysout {
    private final OutputStream os;

    Sysout(OutputStream os) {
        this.os = os;
    }

    void display(String line) {
        try {
            os.write((line + "\n").getBytes(StandardCharsets.ISO_8859_1));
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    void flush() {
        try {
            os.flush();
        } catch (IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
