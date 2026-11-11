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

import net.sf.freecol.common.model.Direction;
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
        assertEquals(3, grid.width);
        assertEquals(7, grid.height);
        // DOS (2, 1) grassland is FreeCol (1, 2); DOS (3, 1) hills is (1, 1); DOS (2, 2) plains with a river is (1, 4).
        assertEquals("grassland", grid.types[2 * 3 + 1]);
        assertEquals("hills", grid.types[1 * 3 + 1]);
        assertEquals("plains", grid.types[4 * 3 + 1]);
        assertEquals(1, grid.rivers[4 * 3 + 1]);
        assertEquals("arctic", grid.types[0]);
        assertEquals("highSeas", grid.types[2 * 3]);
        String text = DosMap.text(grid);
        assertTrue(text.startsWith(DosMap.MAGIC + "\n3 7\n"), text);
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

    @Test
    void dosNeighboursStayNeighbours() {
        // DOS (dx, dy) east is a FreeCol diagonal neighbour, DOS south is FreeCol's south.
        for (int y = 1; y < 20; y++) {
            for (int x = 0; x < 10; x++) {
                int dx = DosMap.dosX(x, y), dy = DosMap.dosY(x, y);
                Map.Position east = (((y & 1) != 0) ? Direction.SE : Direction.NE).step(x, y);
                assertEquals(dx + 1, DosMap.dosX(east.getX(), east.getY()));
                assertEquals(dy, DosMap.dosY(east.getX(), east.getY()));
                Map.Position south = Direction.S.step(x, y);
                assertEquals(dx, DosMap.dosX(south.getX(), south.getY()));
                assertEquals(dy + 1, DosMap.dosY(south.getX(), south.getY()));
            }
        }
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
        assertEquals(29, map.getWidth());
        assertEquals(143, map.getHeight());
        // DOS (30, 36), deep in South America's Amazon, and (2, 36) in the Pacific.
        assertTrue(map.getTile(15, 72).isLand(), map.getTile(15, 72).toString());
        assertFalse(map.getTile(1, 72).isLand());
        assertEquals("model.tile.arctic", map.getTile(5, 0).getType().getId());
        assertEquals("model.tile.highSeas", map.getTile(28, 71).getType().getId());
        long rivers = map.getTileList(Tile::hasRiver).size();
        assertTrue(rivers > 50, rivers + " river tiles");
        long joined = map.getTileList(t -> t.hasRiver()
            && !"0000".equals(t.getRiver().getStyle().getString())).size();
        assertTrue(joined > rivers * 9 / 10, joined + " of " + rivers + " river tiles joined");
        assertTrue(map.getTileList(t -> t.getRegion() == null).isEmpty(), "every tile has a region");
        assertFalse(game.getLiveNativePlayerList().isEmpty());
        assertTrue(map.getTileList(t -> t.getIndianSettlement() != null).size() > 20);
        assertNotNull(game.getPlayerByNationId("model.nation.dutch").getEntryTile());
    }
}
