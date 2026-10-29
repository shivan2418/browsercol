package online.freecol.shim.java.net;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * A socket that can never connect. FreeCol keys its server's connection
 * table by Socket, so plain instances must still be creatable.
 */
public class TSocket {
    private boolean closed;

    public TSocket() { }

    public void connect(TSocketAddress address, int timeout) throws IOException {
        throw new IOException("No sockets in the browser Engine");
    }

    public InputStream getInputStream() throws IOException {
        throw new IOException("No sockets in the browser Engine");
    }

    public OutputStream getOutputStream() throws IOException {
        throw new IOException("No sockets in the browser Engine");
    }

    public TInetAddress getInetAddress() { return TInetAddress.getLoopbackAddress(); }
    public int getPort() { return -1; }
    public boolean isClosed() { return closed; }
    public void close() throws IOException { closed = true; }
}
