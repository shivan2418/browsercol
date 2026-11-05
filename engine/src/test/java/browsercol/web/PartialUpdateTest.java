package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.PartialMessage;


/**
 * A partial update carries its object's own id with the fields to change,
 * as PartialMessage hands it on, and the client sets all of them without a
 * "setter fail" warning. The Engine's TeaVM build may call only the
 * getters and setters the reflection policy lists, so the policy must list
 * "id" too.
 */
class PartialUpdateTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
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
                public void show(String kind, String json) { }
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
    void thePolicyAllowsTheIdAttribute() throws Exception {
        // The policy is TeaVM's and not on the test classpath: read its source.
        final String src = java.nio.file.Files.readString(
            java.nio.file.Path.of(System.getProperty("engine.src"), "main/java/browsercol/shim/FreeColReflectionPolicy.java"));
        final String list = src.substring(src.indexOf("PARTIAL_FIELDS = {"));
        assertTrue(list.substring(0, list.indexOf("};")).contains("\"id\""));
    }

    @Test
    void aPartialUpdateWithItsOwnIdSetsItsFieldsWithoutAWarning() {
        final Player me = client.getClient().getMyPlayer();
        final Unit unit = me.getUnits().findFirst().get();
        final List<String> warnings = new java.util.concurrent.CopyOnWriteArrayList<>();
        final Logger logger = Logger.getLogger(InGameController.class.getName());
        final Handler handler = new Handler() {
            @Override public void publish(LogRecord r) {
                if (r.getLevel().intValue() >= Level.WARNING.intValue()) warnings.add(r.getMessage());
            }
            @Override public void flush() { }
            @Override public void close() { }
        };
        logger.addHandler(handler);
        try {
            final Map<String, String> playerFields = new HashMap<>();
            playerFields.put("id", me.getId());
            playerFields.put("gold", "1234");
            new PartialMessage(playerFields).clientHandler(client.getClient());
            final Map<String, String> unitFields = new HashMap<>();
            unitFields.put("id", unit.getId());
            unitFields.put("movesLeft", "1");
            new PartialMessage(unitFields).clientHandler(client.getClient());
        } finally {
            logger.removeHandler(handler);
        }
        assertEquals(List.of(), warnings);
        assertEquals(1234, me.getGold());
        assertEquals(1, unit.getMovesLeft());
        assertEquals(me.getId(), client.getGame().getFreeColGameObject(me.getId()).getId());
    }
}
