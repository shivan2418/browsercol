package online.freecol.web;

import net.sf.freecol.server.networking.Server;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;

/**
 * Shut down every FreeCol server a test left running. A ServerEngine's
 * FreeColServer starts a Server thread that waits on its socket for ever,
 * and the thread holds the server's whole game; the tests make games by
 * the hundred (CommandsTest tries map seeds until one suits), so without
 * this they filled the test JVM's heap and a later test's login hung. Registered for every test through
 * the service file and junit-platform.properties.
 */
public class StopServers implements AfterEachCallback {

    @Override
    public void afterEach(ExtensionContext context) {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (!(t instanceof Server) || !t.isAlive()) continue;
            try {
                ((Server)t).shutdown();
            } catch (RuntimeException ex) {
                // Closing its connections tells the clients, through the
                // executors the test has shut down. The socket is closed
                // and the thread ended before that.
            }
        }
    }
}
