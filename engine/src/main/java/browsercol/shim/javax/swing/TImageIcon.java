package browsercol.shim.javax.swing;

import java.awt.Image;

/**
 * javax.swing.ImageIcon, which GUI's dialog helpers build before asking
 * the GUI. The WebGUI never draws it.
 */
public class TImageIcon {
    private final Image image;

    public TImageIcon() {
        this(null);
    }

    public TImageIcon(Image image) {
        this.image = image;
    }

    public Image getImage() {
        return this.image;
    }
}
