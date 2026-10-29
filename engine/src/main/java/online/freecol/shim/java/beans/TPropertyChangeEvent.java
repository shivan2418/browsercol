package online.freecol.shim.java.beans;

public class TPropertyChangeEvent {
    private final Object source;
    private final String propertyName;
    private final Object oldValue, newValue;

    public TPropertyChangeEvent(Object source, String propertyName,
                                Object oldValue, Object newValue) {
        this.source = source;
        this.propertyName = propertyName;
        this.oldValue = oldValue;
        this.newValue = newValue;
    }

    public Object getSource() { return source; }
    public String getPropertyName() { return propertyName; }
    public Object getOldValue() { return oldValue; }
    public Object getNewValue() { return newValue; }
}
