package online.freecol.shim;

import org.teavm.extension.spi.substitution.SimpleSubstitutionPolicy;
import org.teavm.extension.spi.substitution.SubstitutionSink;

/**
 * Maps a JDK class missing from TeaVM's classlib, such as java.awt.Rectangle,
 * to our shim online.freecol.shim.java.awt.TRectangle. TeaVM only uses a
 * mapping when the shim class exists, so the rest of the JDK is untouched.
 */
public class ShimSubstitutionPolicy extends SimpleSubstitutionPolicy {
    @Override
    public void contribute(SubstitutionSink sink) {
        sink.selectClasses(inPackage("java", true))
            .packagePrefix("online.freecol.shim")
            .simpleNamePrefix("T");
    }
}
