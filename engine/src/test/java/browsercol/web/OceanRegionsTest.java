package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.server.FreeColServer;


/** A FreeCol map whose water has no regions keeps its ocean and high seas (#459). */
class OceanRegionsTest {

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

    private Game play(byte[] importMap) throws Exception {
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
        server.startGame("classic", GamePreset.parse("{ \"seed\": 1 }"), importMap);
        assertTrue(client[0].startGame(0), "login");
        finished.await();
        return server.getGame();
    }

    private static int count(Map map, String type) {
        return map.getTileList(t -> type.equals(t.getType().getId())).size();
    }

    @Test
    @Timeout(240)
    void theWaterOfAMapWithNoOceanRegionsStaysOceanAndHighSeas() throws Exception {
        // XL_GigaEarth_Mazim has the fixed ocean regions with no tile in them.
        File file = new File("data/maps/XL_GigaEarth_Mazim.fsm");
        FreeColRules.loadRules();
        Map before = FreeColServer.readMap(file, FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile("classic"), null, "model.difficulty.medium"));
        Game game = play(Files.readAllBytes(file.toPath()));
        Map map = game.getMap();
        // The high seas stay, and only the few pools of water closed off from the sea become
        // lake, where FreeCol made every tile of the ocean and high seas lake.
        assertEquals(count(before, "model.tile.highSeas"), count(map, "model.tile.highSeas"));
        assertEquals(count(before, "model.tile.ocean") + count(before, "model.tile.lake"),
            count(map, "model.tile.ocean") + count(map, "model.tile.lake"));
        assertTrue(count(map, "model.tile.lake") < 200, count(map, "model.tile.lake") + " lake tiles");
        assertTrue(map.getTileList(t -> !t.isLand() && t.getRegion() == null).isEmpty(), "all water has a region");
        Tile entry = game.getPlayerByNationId("model.nation.dutch").getEntryTile();
        assertTrue(entry.isDirectlyHighSeasConnected(), "the Dutch enter from the high seas: " + entry);
    }
}
