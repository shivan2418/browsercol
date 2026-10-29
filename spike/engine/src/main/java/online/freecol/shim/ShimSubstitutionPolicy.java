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
        // org.xml.sax: FreeCol only names SAXException in catch clauses,
        // which TeaVM does not report as missing but miscompiles.
        sink.selectClasses(inPackage("java", true).or(inPackage("org.xml.sax", true)))
            .packagePrefix("online.freecol.shim")
            .simpleNamePrefix("T");
    }
}
