package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;


/** The DOS game's America map as a FreeCol map (#459). */
class DosMapTest {

    private static byte[] america() throws Exception {
        return Files.readAllBytes(new File(System.getProperty("maps.dir"), "america-1492.txt").toPath());
    }

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

    @Test
    void theHeaderTellsADosMapFromAFreeColFile() throws Exception {
        assertTrue(DosMap.isMap(america()));
        assertTrue(DosMap.isOwnMap(america()));
        assertTrue(DosMap.isDosMap(tinyDosMap()));
        assertFalse(DosMap.isMap(new byte[] { 'P', 'K', 3, 4, 0, 0 }));
        assertFalse(DosMap.isMap(null));
    }

    /**
     * A DOS map 6 wide and 4 high: ocean around grassland (4), a hill (0x24)
     * and a minor river on plains (0x42); as the DOS game makes them, the
     * edge rows become arctic and the edge columns sea lane.
     */
    private static byte[] tinyDosMap() {
        byte[] b = new byte[6 + 6 * 4];
        b[0] = 6; b[2] = 4; b[4] = 4;
        for (int i = 6; i < b.length; i++) b[i] = 0x19;
        b[6 + 6 + 2] = 4;
        b[6 + 6 + 3] = 0x24;
        b[6 + 12 + 2] = 0x42;
        b[6 + 12 + 3] = 4;
        return b;
    }

    @Test
    void aDosMapBecomesAMapOfOurOwnAndReadsBackTheSame() {
        DosMap.Grid grid = DosMap.grid(tinyDosMap());
        // The grid is square, so the DOS map's tiles stay where they are.
        assertEquals(6, grid.width);
        assertEquals(4, grid.height);
        assertEquals("grassland", grid.types[1 * 6 + 2]);
        assertEquals("hills", grid.types[1 * 6 + 3]);
        assertEquals("plains", grid.types[2 * 6 + 2]);
        assertEquals(1, grid.rivers[2 * 6 + 2]);
        assertEquals("arctic", grid.types[0]);
        assertEquals("highSeas", grid.types[1 * 6]);
        String text = DosMap.text(grid);
        assertTrue(text.startsWith(DosMap.MAGIC + "\n6 4\n"), text);
        DosMap.Grid back = DosMap.parse(text);
        assertEquals(java.util.Arrays.asList(grid.types), java.util.Arrays.asList(back.types));
        assertEquals(java.util.Arrays.toString(grid.rivers), java.util.Arrays.toString(back.rivers));
    }

    @Test
    void terrainBytesBecomeFreeColTileTypes() {
        assertEquals("ocean", DosMap.tileType(0x19));
        assertEquals("highSeas", DosMap.tileType(0x1a));
        assertEquals("arctic", DosMap.tileType(0x18));
        assertEquals("plains", DosMap.tileType(2));
        assertEquals("mixedForest", DosMap.tileType(10));
        assertEquals("mixedForest", DosMap.tileType(18));
        assertEquals("hills", DosMap.tileType(0x20 | 4));
        assertEquals("mountains", DosMap.tileType(0xa0 | 4));
        assertEquals(0, DosMap.river(0xa0 | 4), "the mountain bit is no river");
        assertEquals(1, DosMap.river(0x40 | 4));
        assertEquals(2, DosMap.river(0x80 | 4));
    }

    private ServerEngine play(byte[] importMap) throws Exception {
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
        return server;
    }

    @Test
    @Timeout(240)
    void aGameOnTheAmericaMapHasItsShapeRiversAndNatives() throws Exception {
        Game game = play(america()).getGame();
        Map map = game.getMap();
        // The DOS map's own size and layout, tile for tile.
        assertEquals(58, map.getWidth());
        assertEquals(72, map.getHeight());
        // DOS (30, 36), deep in South America's Amazon, and (2, 36) in the Pacific.
        assertTrue(map.getTile(30, 36).isLand(), map.getTile(30, 36).toString());
        assertFalse(map.getTile(2, 36).isLand());
        assertEquals("model.tile.arctic", map.getTile(5, 0).getType().getId());
        assertEquals("model.tile.highSeas", map.getTile(57, 36).getType().getId());
        // North is up: Canada's tundra above, Tierra del Fuego's tip below.
        assertTrue(map.getTile(7, 5).isLand(), "land in the north-west");
        assertTrue(map.getTile(36, 66).isLand(), "land in the far south");
        assertFalse(map.getTile(7, 66).isLand(), "the south-west is sea");
        // DOS (18, 12), in the Great Lakes: ocean in the DOS map, lake once FreeCol imports it.
        assertEquals("model.tile.lake", map.getTile(18, 12).getType().getId());
        long rivers = map.getTileList(Tile::hasRiver).size();
        assertTrue(rivers > 50, rivers + " river tiles");
        long joined = map.getTileList(t -> t.hasRiver()
            && !"0000".equals(t.getRiver().getStyle().getString())).size();
        assertTrue(joined > rivers * 9 / 10, joined + " of " + rivers + " river tiles joined");
        assertTrue(map.getTileList(t -> t.getRegion() == null).isEmpty(), "every tile has a region");
        assertFalse(game.getLiveNativePlayerList().isEmpty());
        long settlements = map.getTileList(t -> t.getIndianSettlement() != null).size();
        assertTrue(settlements >= 15, settlements + " native settlements");
        assertNotNull(game.getPlayerByNationId("model.nation.dutch").getEntryTile());
    }
}
