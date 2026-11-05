package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.networking.ErrorMessage;


/**
 * When the server rejects a request, the error event the Browser UI gets
 * carries what its Copy details button copies: the server's reason, the
 * last request sent, the turn and the player.
 */
class ErrorDetailsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final BlockingQueue<String> errors = new LinkedBlockingQueue<>();
    private ServerEngine server;
    private ClientEngine client;

    @BeforeEach
    void start() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    if (kind.equals("error")) errors.add(json);
                }
                public void ask(int id, String kind, String json) { client.answer(id, null); }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(ourTurn);
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        server = null;
        client = null;
    }

    @Test
    void aRejectionCarriesTheServersReasonTheLastRequestAndWhereTheGameWas() throws Exception {
        errors.clear();
        new ErrorMessage("Unit unit:5626 is not yours").clientHandler(client.getClient());
        final String json = errors.poll(30, TimeUnit.SECONDS);
        assertNotNull(json, "an error event");
        final Map<?, ?> e = (Map<?, ?>)JsonReader.read(json);
        assertEquals("Unit unit:5626 is not yours", e.get("detail"));
        assertNotNull(e.get("request"), "the login or a later request was sent");
        assertTrue(String.valueOf(e.get("turn")).startsWith("1 ("), String.valueOf(e.get("turn")));
        assertTrue(String.valueOf(e.get("player")).contains("player:"), String.valueOf(e.get("player")));
    }
}
