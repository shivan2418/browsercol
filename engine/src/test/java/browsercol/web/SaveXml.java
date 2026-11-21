package browsercol.web;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.function.UnaryOperator;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;


/** A save game's savegame.xml, read or changed in a copy of the save. */
final class SaveXml {

    private SaveXml() {}

    /** The save's savegame.xml. */
    static String of(byte[] save) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(save))) {
            for (ZipEntry e; (e = zis.getNextEntry()) != null;) {
                if ("savegame.xml".equals(e.getName())) {
                    return new String(zis.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new IOException("no savegame.xml");
    }

    /** A copy of the save with its savegame.xml changed. */
    static byte[] replace(byte[] save, UnaryOperator<String> change) throws IOException {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(save));
             ZipOutputStream zos = new ZipOutputStream(out)) {
            for (ZipEntry e; (e = zis.getNextEntry()) != null;) {
                byte[] data = zis.readAllBytes();
                if ("savegame.xml".equals(e.getName())) {
                    data = change.apply(new String(data, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
                }
                zos.putNextEntry(new ZipEntry(e.getName()));
                zos.write(data);
                zos.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
