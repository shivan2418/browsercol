package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
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
 * FreeCol's client copy of a settlement that is in sight of the first map
 * update has its tile (#542, found in #462), and the map and the readers of a
 * player's settlements work on it.
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
        lastServer = server;
        return server.getGame();
    }

    /** The client of the last game played. */
    private ClientEngine lastClient;

    /** The server of the last game played. */
    private ServerEngine lastServer;

    /**
     * Seed 9 of Giga Earth puts a native settlement next to the Dutch entry
     * tile, in sight of the first map update. FreeCol built the client's copy
     * of it with no tile, because the tile it sits on was not registered in
     * the game while it was being copied (#542). The map JSON of the start of
     * the game threw (#459, #462): the page stayed on "Loading the art".
     */
    @Test
    @Timeout(240)
    void everySettlementOfTheClientHasItsTile() throws Exception {
        play(Files.readAllBytes(new File("data/maps/XL_GigaEarth_Mazim.fsm").toPath()), 9);
        List<Tile> withSettlement = lastClient.getGame().getMap().getTileList(
            t -> t.getSettlement() != null);
        if (withSettlement.isEmpty()) {
            // The map is not the one seed 9 was found on (it is resampled now), and no settlement is in
            // sight of the first update: the server tells the client the whole map, settlements in it.
            lastClient.debugApplied(lastServer.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
            withSettlement = lastClient.getGame().getMap().getTileList(t -> t.getSettlement() != null);
        }
        assertFalse(withSettlement.isEmpty(), "the client sees a settlement");
        for (Tile t : withSettlement) {
            assertSame(t, t.getSettlement().getTile(), "the tile of the settlement at " + t.getX() + "," + t.getY());
        }
        final Tile tile = withSettlement.get(0);
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
