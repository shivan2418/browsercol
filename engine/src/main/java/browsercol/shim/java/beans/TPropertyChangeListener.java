package browsercol.shim.java.beans;

import java.util.EventListener;

public interface TPropertyChangeListener extends EventListener {
    void propertyChange(TPropertyChangeEvent evt);
}
