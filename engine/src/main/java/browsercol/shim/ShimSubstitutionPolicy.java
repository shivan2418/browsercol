package browsercol.shim;

import org.teavm.extension.spi.substitution.SimpleSubstitutionPolicy;
import org.teavm.extension.spi.substitution.SubstitutionSink;

/**
 * Maps a JDK class missing from TeaVM's classlib, such as java.awt.Rectangle,
 * to our shim browsercol.shim.java.awt.TRectangle. TeaVM only uses a
 * mapping when the shim class exists, so the rest of the JDK is untouched.
 */
public class ShimSubstitutionPolicy extends SimpleSubstitutionPolicy {
    @Override
    public void contribute(SubstitutionSink sink) {
        // org.xml.sax: FreeCol only names SAXException in catch clauses,
        // which TeaVM does not report as missing but miscompiles.
        // javax.swing: the client controllers call SwingUtilities.
        sink.selectClasses(inPackage("java", true).or(inPackage("org.xml.sax", true))
                           .or(inPackage("javax.swing", true)))
            .packagePrefix("browsercol.shim")
            .simpleNamePrefix("T");
        // FreeColPanel is a Swing JPanel. GUI methods that the client
        // controllers call return it, and Wasm GC function types need the
        // class even when only null is returned, so give it a stub.
        sink.selectClasses(named("net.sf.freecol.client.gui.panel.FreeColPanel"))
            .packagePrefix("browsercol.shim")
            .simpleNamePrefix("T");
    }
}
