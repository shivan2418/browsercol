package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Tile;


/**
 * A river's delta that reaches the map's edge no longer stops the map from
 * being made (#537). {@code River.delta} asked the tile beside the river's
 * mouth for its neighbours and used them without checking for null, so the
 * map for seed 190 on a small map with many rivers threw a
 * NullPointerException, and the game never started (#452, #422).
 */
class RiverDeltaEdgeTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    @Test
    @Timeout(240)
    void aMapWhoseRiverDeltaReachesTheEdgeIsMadeOnTheFirstTry() throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });
        server.startGame("classic", GamePreset.parse("{ \"seed\": 190, \"options\": {"
            + " \"model.option.mapWidth\": 30, \"model.option.mapHeight\": 40,"
            + " \"model.option.riverNumber\": 40 } }"));
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished);

        int rivers = 0;
        for (Tile t : server.getGame().getMap()) {
            if (t.hasRiver()) rivers++;
        }
        assertTrue(rivers > 0, "the map has rivers, or this tests nothing about them");
    }
}
