package online.freecol.shim.org.xml.sax;

public class TSAXException extends Exception {
    public TSAXException() { }
    public TSAXException(String message) { super(message); }
    public TSAXException(Exception e) { super(e); }
    public TSAXException(String message, Exception e) { super(message, e); }
}
