package browsercol.shim.java.net;

/** An address for a socket that can never connect (see TSocket). */
public class TInetSocketAddress extends TSocketAddress {
    private final String host;
    private final int port;

    public TInetSocketAddress(String host, int port) {
        this.host = host;
        this.port = port;
    }

    public String getHostName() { return host; }
    public int getPort() { return port; }
}
