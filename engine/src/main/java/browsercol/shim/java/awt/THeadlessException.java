package browsercol.shim.java.awt;

public class THeadlessException extends UnsupportedOperationException {
    public THeadlessException() { }
    public THeadlessException(String message) { super(message); }
}
