package online.freecol.shim.java.net;

/**
 * There is no network in the browser Engine: every address is loopback.
 * FreeCol's server still asks for one when it starts.
 */
public class TInetAddress {
    private static final TInetAddress LOOPBACK = new TInetAddress("localhost");
    private final String host;

    private TInetAddress(String host) { this.host = host; }

    public static TInetAddress getLoopbackAddress() { return LOOPBACK; }
    public static TInetAddress getLocalHost() { return LOOPBACK; }
    public static TInetAddress getByName(String host) {
        return (host == null) ? LOOPBACK : new TInetAddress(host);
    }

    public String getHostAddress() { return "127.0.0.1"; }
    public String getHostName() { return host; }

    @Override
    public String toString() { return host + "/127.0.0.1"; }
}
