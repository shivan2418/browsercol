package online.freecol.shim.java.net;

import java.io.IOException;

/**
 * A listening socket nobody can reach: accept() waits until close().
 * Lets FreeCol's Server thread start and stop without a network.
 */
public class TServerSocket {
    private final int port;
    private boolean closed;

    public TServerSocket(int port, int backlog, TInetAddress address) {
        this.port = port;
    }

    public void setReuseAddress(boolean on) { }
    public int getLocalPort() { return port; }

    public synchronized TSocket accept() throws IOException {
        while (!closed) {
            try {
                wait();
            } catch (InterruptedException ie) {
                throw new IOException("interrupted");
            }
        }
        throw new IOException("Socket closed");
    }

    public synchronized void close() throws IOException {
        closed = true;
        notifyAll();
    }

    public synchronized boolean isClosed() { return closed; }
}
