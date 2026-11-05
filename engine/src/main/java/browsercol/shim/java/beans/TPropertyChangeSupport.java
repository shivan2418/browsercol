package browsercol.shim.java.beans;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** java.beans.PropertyChangeSupport, minus serialization and proxies. */
public class TPropertyChangeSupport {
    private static final class Entry {
        final String name; // null for all properties
        final TPropertyChangeListener listener;
        Entry(String name, TPropertyChangeListener listener) {
            this.name = name;
            this.listener = listener;
        }
    }

    private final Object source;
    private final List<Entry> entries = new ArrayList<>();

    public TPropertyChangeSupport(Object source) {
        this.source = Objects.requireNonNull(source);
    }

    public synchronized void addPropertyChangeListener(TPropertyChangeListener l) {
        if (l != null) entries.add(new Entry(null, l));
    }

    public synchronized void addPropertyChangeListener(String name, TPropertyChangeListener l) {
        if (l != null && name != null) entries.add(new Entry(name, l));
    }

    public synchronized void removePropertyChangeListener(TPropertyChangeListener l) {
        for (int i = 0; i < entries.size(); i++) {
            Entry e = entries.get(i);
            if (e.name == null && e.listener == l) { entries.remove(i); return; }
        }
    }

    public synchronized void removePropertyChangeListener(String name, TPropertyChangeListener l) {
        for (int i = 0; i < entries.size(); i++) {
            Entry e = entries.get(i);
            if (name != null && name.equals(e.name) && e.listener == l) {
                entries.remove(i);
                return;
            }
        }
    }

    public synchronized TPropertyChangeListener[] getPropertyChangeListeners() {
        List<TPropertyChangeListener> ret = new ArrayList<>();
        for (Entry e : entries) if (e.name == null) ret.add(e.listener);
        return ret.toArray(new TPropertyChangeListener[0]);
    }

    public synchronized TPropertyChangeListener[] getPropertyChangeListeners(String name) {
        List<TPropertyChangeListener> ret = new ArrayList<>();
        for (Entry e : entries) if (name != null && name.equals(e.name)) ret.add(e.listener);
        return ret.toArray(new TPropertyChangeListener[0]);
    }

    public synchronized boolean hasListeners(String name) {
        for (Entry e : entries) {
            if (e.name == null || e.name.equals(name)) return true;
        }
        return false;
    }

    public void firePropertyChange(String name, Object oldValue, Object newValue) {
        if (oldValue == null || newValue == null || !oldValue.equals(newValue)) {
            firePropertyChange(new TPropertyChangeEvent(source, name, oldValue, newValue));
        }
    }

    public void firePropertyChange(String name, int oldValue, int newValue) {
        if (oldValue != newValue) firePropertyChange(name, (Object)oldValue, (Object)newValue);
    }

    public void firePropertyChange(String name, boolean oldValue, boolean newValue) {
        if (oldValue != newValue) firePropertyChange(name, (Object)oldValue, (Object)newValue);
    }

    public void firePropertyChange(TPropertyChangeEvent event) {
        Object o = event.getOldValue(), n = event.getNewValue();
        if (o != null && n != null && o.equals(n)) return;
        String name = event.getPropertyName();
        List<TPropertyChangeListener> targets = new ArrayList<>();
        synchronized (this) {
            for (Entry e : entries) {
                if (e.name == null || (name != null && e.name.equals(name))) {
                    targets.add(e.listener);
                }
            }
        }
        for (TPropertyChangeListener l : targets) l.propertyChange(event);
    }
}
