package browsercol.web;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;


/** FreeCol's data files, which reach TeaVM's in-memory file system as text. */
final class DataFiles {

    private DataFiles() {}

    /**
     * Write (path, text) pairs into the file system.
     *
     * @param args Alternating paths and file contents.
     * @return How many files were written.
     * @exception IOException on write failure.
     */
    static int write(String[] args) throws IOException {
        int n = 0;
        for (int i = 0; i + 1 < args.length; i += 2, n++) {
            File f = new File(args[i]);
            if (f.getParentFile() != null) f.getParentFile().mkdirs();
            try (Writer w = new OutputStreamWriter(new FileOutputStream(f),
                                                   StandardCharsets.UTF_8)) {
                w.write(args[i + 1]);
            }
        }
        return n;
    }
}
