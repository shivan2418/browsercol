package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.Tile;


/**
 * FreeCol's client copy of a native settlement the player has not seen can
 * have no tile (#462). The map and the readers of a player's settlements
 * skip or place it, not throw.
 */
class SettlementWithNoTileTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @TempDir
    File saves;

    @BeforeEach
    void saveThere() {
        ServerEngine.saveDirectory = saves;
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private Game play(byte[] importMap, int seed) throws Exception {
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
        server.startGame("classic", GamePreset.parse("{ \"seed\": " + seed + " }"), importMap);
        assertTrue(client[0].startGame(0), "login");
        finished.await();
        lastClient = client[0];
        return server.getGame();
    }

    /** The client of the last game played. */
    private ClientEngine lastClient;

    /**
     * Seed 9 of Giga Earth puts a native settlement next to the Dutch entry
     * tile that the client has no tile for (seed 2 did, before the ocean
     * regions changed), and the map JSON of the start of the game threw
     * (#459, #462): the page stayed on "Loading the art".
     */
    @Test
    @Timeout(240)
    void theMapOfAClientWithASettlementThatHasNoTileComes() throws Exception {
        play(Files.readAllBytes(new File("data/maps/XL_GigaEarth_Mazim.fsm").toPath()), 9);
        final List<Tile> found = lastClient.getGame().getMap().getTileList(
            t -> t.getSettlement() != null && t.getSettlement().getTile() == null);
        // FreeCol's client copy of a native settlement the player has not seen has no
        // tile. If FreeCol ever gives it one, this assertion fails, and the test no
        // longer tests anything: the guards it covers may then go.
        assertFalse(found.isEmpty(), "a client settlement with no tile");
        final Tile tile = found.get(0);
        final Player me = lastClient.getClient().getMyPlayer();
        String json = MapJson.of(lastClient.getGame(), me, null, false);
        assertTrue(json.contains("\"x\":" + tile.getX() + ",\"y\":" + tile.getY() + ","), "the settlement is on the map");
        // The readers of a player's settlements: met the tribe, not seen the settlement.
        me.setStance(tile.getSettlement().getOwner(), Stance.PEACE);
        String natives = Reports.indian(lastClient.getClient());
        assertTrue(natives.contains("\"tribes\""), natives);
        String find = FindSettlementJson.of(lastClient.getGame(), me).toString();
        assertTrue(find.contains("\"settlements\""), find);
    }
}
