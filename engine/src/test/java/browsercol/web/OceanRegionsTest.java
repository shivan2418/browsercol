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
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Stance;
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

    private Game play(byte[] importMap) throws Exception { return play(importMap, 1); }

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

    /**
     * Seed 2 of Giga Earth puts a native settlement on (125,29) that the
     * client has no tile for, and the map JSON of the start of the game threw
     * (#459): the page stayed on "Loading the art".
     */
    @Test
    @Timeout(240)
    void theMapOfAClientWithASettlementThatHasNoTileComes() throws Exception {
        play(Files.readAllBytes(new File("data/maps/XL_GigaEarth_Mazim.fsm").toPath()), 2);
        Tile tile = lastClient.getGame().getMap().getTile(125, 29);
        // FreeCol's client copy of a native settlement the player has not seen has no
        // tile. If FreeCol ever gives it one, this assertion fails, and the test no
        // longer tests anything: the guards it covers may then go.
        assertTrue(tile.getSettlement() != null && tile.getSettlement().getTile() == null,
            "the client's settlement has no tile: " + tile.getSettlement());
        final Player me = lastClient.getClient().getMyPlayer();
        String json = MapJson.of(lastClient.getGame(), me, null, false);
        assertTrue(json.contains("\"x\":125,\"y\":29"), "the settlement is on the map");
        // The readers of a player's settlements: met the tribe, not seen the settlement.
        me.setStance(tile.getSettlement().getOwner(), Stance.PEACE);
        String natives = Reports.indian(lastClient.getClient());
        assertTrue(natives.contains("\"tribes\""), natives);
        String find = FindSettlementJson.of(lastClient.getGame(), me).toString();
        assertTrue(find.contains("\"settlements\""), find);
    }
}
