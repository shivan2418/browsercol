package online.freecol.shim.java.beans;

import java.util.EventListener;

public interface TPropertyChangeListener extends EventListener {
    void propertyChange(TPropertyChangeEvent evt);
}
