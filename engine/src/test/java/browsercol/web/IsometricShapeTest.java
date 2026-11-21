package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.MapShape;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.model.ServerGame;


/**
 * A game's map has a shape that fits its Map view (#559, ADR 0014): a
 * rectangle on the grid for Top-down, or a 45 degree diamond that is a
 * rectangle on screen for Isometric. Latitude, the poles and the east and
 * west edges follow the shape.
 */
class IsometricShapeTest {

    private static Specification spec;

    @BeforeAll
    static void rules() {
        FreeColRules.loadRules();
        Messages.loadMessageBundle(Locale.US);
        spec = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile("classic"),
                                         null, "model.difficulty.medium");
    }

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }


    // The shape and the latitude on a small map built by hand

    private static Map plain(MapShape shape) {
        final Game game = new ServerGame(spec);
        final Map map = new Map(game, shape);
        game.changeMap(map);
        map.populateTiles((x, y) -> new Tile(game, spec.getTileType("model.tile.plains"), x, y));
        return map;
    }

    @Test
    void anIsometricShapeIsTheDiamondOfAStaggeredMap() {
        final MapShape shape = MapShape.isometric(4, 7);
        assertEquals(4 + 3, shape.getWidth());
        assertEquals(3 + 4, shape.getHeight());
        assertEquals(4, shape.getColumns());
        assertEquals(7, shape.getRows());
        int inside = 0;
        for (int y = 0; y < shape.getHeight(); y++) {
            for (int x = 0; x < shape.getWidth(); x++) {
                if (!shape.contains(x, y)) continue;
                inside++;
                final int col = shape.getColumn(x, y), row = shape.getRow(x, y);
                assertTrue(col >= 0 && col < 4 && row >= 0 && row < 7, x + "," + y);
                assertEquals(x, shape.getX(col, row));
                assertEquals(y, shape.getY(col, row));
            }
        }
        assertEquals(4 * 7, inside, "a column and a row for every tile of the staggered map");
        // The corners of the box are not on the map.
        assertFalse(shape.contains(0, 0));
        assertFalse(shape.contains(shape.getWidth() - 1, shape.getHeight() - 1));
        assertFalse(shape.contains(-1, 3));
        // North is (-1, -1): a row up the screen is two half rows.
        final int x = 4, y = 3;
        assertTrue(shape.contains(x, y) && shape.contains(x - 1, y - 1));
        assertEquals(shape.getRow(x, y) - 2, shape.getRow(x - 1, y - 1));
        assertEquals(shape.getColumn(x, y), shape.getColumn(x - 1, y - 1));
    }

    @Test
    void aTopDownShapeIsTheWholeGrid() {
        final MapShape shape = MapShape.topDown(5, 6);
        assertEquals(5, shape.getColumns());
        assertEquals(6, shape.getRows());
        for (int y = 0; y < 6; y++) {
            for (int x = 0; x < 5; x++) {
                assertTrue(shape.contains(x, y));
                assertEquals(x, shape.getColumn(x, y));
                assertEquals(y, shape.getRow(x, y));
            }
        }
        assertFalse(shape.contains(5, 0));
    }

    @Test
    void anIsometricMapHasOnlyTheTilesInItsDiamond() {
        final Map map = plain(MapShape.isometric(5, 10));
        assertEquals(5 * 10, map.getTileList(t -> true).size());
        assertNull(map.getTile(0, 0), "the box's corner is not a tile");
        assertFalse(map.isValid(0, 0));
        assertNotNull(map.getTileAt(0, 0));
        // Neighbours stop at the diamond: nothing in the corner is a neighbour.
        final Tile west = map.getTileAt(0, 4);
        assertNull(map.getAdjacentTile(west, net.sf.freecol.common.model.Direction.W), "off the west edge");
        int count = 0;
        for (Tile t : map.getCircleTiles(west, true, 100)) {
            assertTrue(map.getShape().contains(t.getX(), t.getY()));
            count++;
        }
        assertEquals(5 * 10 - 1, count, "every other tile is reached once");
    }

    @Test
    void latitudeFollowsTheRowOnBothShapes() {
        final Map top = plain(MapShape.topDown(6, 21));
        final Map iso = plain(MapShape.isometric(6, 21));
        for (Map map : new Map[] { top, iso }) {
            map.setMinimumLatitude(-80);
            map.setMaximumLatitude(80);
        }
        // Top-down: north is a row up.
        assertEquals(-80, top.getLatitude(top.getTile(3, 0)));
        assertEquals(80, top.getLatitude(top.getTile(3, 20)));
        assertEquals(top.getLatitude(top.getTile(0, 7)), top.getLatitude(top.getTile(5, 7)));
        // Isometric: north is up the screen, so a whole column of NW steps has one latitude
        // and the top and bottom of the screen are the poles.
        assertEquals(-80, iso.getLatitude(iso.getTileAt(2, 0)));
        assertEquals(80, iso.getLatitude(iso.getTileAt(2, 20)));
        final Tile a = iso.getTileAt(3, 8);
        final Tile nw = iso.getAdjacentTile(a, net.sf.freecol.common.model.Direction.NW);
        final Tile n = iso.getAdjacentTile(a, net.sf.freecol.common.model.Direction.N);
        final Tile ne = iso.getAdjacentTile(a, net.sf.freecol.common.model.Direction.NE);
        assertTrue(iso.getLatitude(nw) < iso.getLatitude(n), "NW is straight up the screen, N half a tile up");
        assertTrue(iso.getLatitude(n) < iso.getLatitude(a));
        assertEquals(iso.getLatitude(a), iso.getLatitude(ne), "NE is east on screen");
        assertTrue(iso.getLatitude(iso.getAdjacentTile(a, net.sf.freecol.common.model.Direction.SE)) > iso.getLatitude(a));
        // The same latitude along a screen row, which is a grid diagonal.
        assertEquals(iso.getLatitude(iso.getTileAt(0, 10)), iso.getLatitude(iso.getTileAt(5, 10)));
        // Rows to latitude and back.
        assertEquals(10, iso.getRow(iso.getLatitude(10)), 1);
    }

    @Test
    void isPolarIsTheSameStripOnScreenOnBothShapes() {
        final Map top = plain(MapShape.topDown(8, 30));
        final Map iso = plain(MapShape.isometric(8, 60));
        // Top-down: two tile rows at each pole.
        for (int x = 0; x < 8; x++) {
            assertTrue(top.getTile(x, 0).isPolar());
            assertTrue(top.getTile(x, 1).isPolar());
            assertFalse(top.getTile(x, 2).isPolar());
            assertFalse(top.getTile(x, 27).isPolar());
            assertTrue(top.getTile(x, 28).isPolar());
            assertTrue(top.getTile(x, 29).isPolar());
        }
        // Isometric: the same two tile heights, so four half rows, along the whole screen row.
        for (int col = 0; col < 8; col++) {
            for (int row = 0; row < 60; row++) {
                final boolean polar = row <= 3 || row >= 56;
                assertEquals(polar, iso.getTileAt(col, row).isPolar(), "column " + col + " row " + row);
            }
        }
        // And on the grid that is the two diagonal edges, not the grid's top and bottom rows.
        assertFalse(iso.getTileAt(0, 30).isPolar());
        assertEquals(top.getPolarRows() * 2 + 1, iso.getPolarRows());
    }

    @Test
    void theEastAndWestEdgesAreTheFirstAndLastColumn() {
        final Map iso = plain(MapShape.isometric(6, 20));
        for (int row = 0; row < 20; row++) {
            assertTrue(iso.isOnEastWestEdge(iso.getTileAt(0, row)));
            assertTrue(iso.isOnEastWestEdge(iso.getTileAt(5, row)));
            assertFalse(iso.isOnEastWestEdge(iso.getTileAt(3, row)));
        }
        final Map top = plain(MapShape.topDown(6, 20));
        assertTrue(top.isOnEastWestEdge(top.getTile(0, 9)));
        assertTrue(top.isOnEastWestEdge(top.getTile(5, 9)));
        assertFalse(top.isOnEastWestEdge(top.getTile(3, 0)));
    }

    @Test
    void aShapeNeedsItsBoxAndRows() {
        assertThrows(IllegalArgumentException.class,
            () -> MapShape.of(MapShape.Kind.ISOMETRIC, 10, 12, 3));
        assertEquals(MapShape.isometric(4, 7), MapShape.of(MapShape.Kind.ISOMETRIC, 7, 7, 7));
        assertEquals(MapShape.topDown(7, 7), MapShape.of(MapShape.Kind.TOP_DOWN, 7, 7, 0));
        assertEquals(MapShape.Kind.TOP_DOWN, MapShape.Kind.fromKey(null));
    }


    // New games of each shape

    private static final String ISOMETRIC = "\"options\": { \"model.option.mapShape\": 1 }";

    private ServerEngine start(String preset, ClientEngine[] client, CountDownLatch[] finished, int[] rounds)
            throws Exception {
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { rounds[0] = round; }
                public void finished(Game game) { finished[0].countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) { client[0].answer(id, null); }
            });
        server.startGame("classic", GamePreset.parse(preset));
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished[0]);
        return server;
    }

    private Game game(String preset) throws Exception {
        return start(preset, new ClientEngine[1], new CountDownLatch[] { new CountDownLatch(1) }, new int[1])
            .getGame();
    }

    /** A picture of the map as the Isometric view draws it, one pixel a half tile, in build/mapshape. */
    private static void draw(Map map, String name) throws Exception {
        final MapShape shape = map.getShape();
        final int w = shape.isIsometric() ? shape.getColumns() * 2 : map.getWidth() * 2;
        final int h = shape.isIsometric() ? shape.getRows() : map.getHeight();
        final BufferedImage img = new BufferedImage(w * 2, h * 2, BufferedImage.TYPE_INT_RGB);
        for (Tile t : map.getTileList(x -> true)) {
            final String id = t.getType().getId();
            final int c = id.endsWith("highSeas") ? 0x0e2a5a : !t.isLand() ? 0x1c4a8c
                : id.endsWith("arctic") ? 0xf4f4f4 : t.hasRiver() ? 0x3a8fe0 : 0x58a838;
            final int sx = shape.isIsometric() ? shape.getColumn(t.getX(), t.getY()) * 2
                + (shape.getRow(t.getX(), t.getY()) & 1) : t.getX() * 2;
            final int sy = shape.isIsometric() ? shape.getRow(t.getX(), t.getY()) : t.getY();
            for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) img.setRGB(sx * 2 + i, sy * 2 + j, c);
        }
        final File dir = new File("../engine/build/mapshape");
        dir.mkdirs();
        ImageIO.write(img, "png", new File(dir, name + ".png"));
    }

    @Test
    @Timeout(600)
    void aNewIsometricGameIsADiamondWithPolesOnTheTopAndBottomOfTheScreen() throws Exception {
        for (int seed : new int[] { 1, 2, 3, 4 }) {
            final Map map = game("{ \"seed\": " + seed + ", " + ISOMETRIC + " }").getMap();
            final MapShape shape = map.getShape();
            assertTrue(shape.isIsometric(), "seed " + seed);
            assertEquals(41, shape.getColumns(), "the default width");
            assertEquals(102, shape.getRows(), "the default height");
            draw(map, "iso-seed" + seed);
            final int tiles = map.getTileList(t -> true).size();
            assertEquals(41 * 102, tiles);
            // About as much land as the Top-down default's 25% of 4,176 tiles.
            final long land = map.getTileList(Tile::isLand).size();
            final double share = land / (double)tiles;
            assertTrue(share > 0.2 && share < 0.4, "seed " + seed + ": " + share + " of the map is land");
            final int polar = shape.getRows() - 1;
            for (int col = 0; col < shape.getColumns(); col++) {
                assertTrue(map.getTileAt(col, 0).isLand(), "seed " + seed + ": the north pole at " + col);
                assertTrue(map.getTileAt(col, 1).isLand(), "seed " + seed + ": the north pole, second half row at " + col);
                assertTrue(map.getTileAt(col, polar).isLand(), "seed " + seed + ": the south pole at " + col);
                assertTrue(map.getTileAt(col, polar - 1).isLand(), "seed " + seed + ": the south pole at " + col);
                assertTrue(map.getTileAt(col, polar).isPolar());
            }
            // The climate follows latitude: arctic land is on the top and bottom of the screen, none at the equator.
            int cold = 0, middle = 0;
            for (Tile t : map.getTileList(x -> true)) {
                final int row = map.getRowOf(t);
                if (t.getType().getId().endsWith("arctic")) {
                    if (row < shape.getRows() / 5 || row >= shape.getRows() * 4 / 5) cold++;
                    if (row >= shape.getRows() * 2 / 5 && row < shape.getRows() * 3 / 5) middle++;
                }
                assertTrue(map.getLatitude(t) >= map.getMinimumLatitude() && map.getLatitude(t) <= map.getMaximumLatitude());
            }
            assertTrue(cold > 0, "seed " + seed + ": arctic at the top and bottom");
            assertEquals(0, middle, "seed " + seed + ": no arctic at the equator");
            // The high seas run down the east and west edges, row by row.
            for (int row = 4; row < polar - 4; row++) {
                final Tile w = map.getTileAt(0, row), e = map.getTileAt(shape.getColumns() - 1, row);
                assertTrue(!w.isLand() && w.isDirectlyHighSeasConnected(), "seed " + seed + ": high seas west, row " + row);
                assertTrue(!e.isLand() && e.isDirectlyHighSeasConnected(), "seed " + seed + ": high seas east, row " + row);
                assertTrue(map.isOnEastWestEdge(w) && map.isOnEastWestEdge(e));
            }
            // Land is held off the sides, and the high seas strip is narrower than the half.
            for (Tile t : map.getTileList(Tile::isLand)) {
                final int row = map.getRowOf(t), col = map.getColumnOf(t);
                if (row <= 3 || row >= polar - 3) continue;
                assertTrue(col > 3 && col < shape.getColumns() - 4,
                    "seed " + seed + ": land at column " + col + ", row " + row + " is too near a side");
            }
            final List<Tile> east = new ArrayList<>(), west = new ArrayList<>();
            map.collectStartingTiles(east, west);
            assertFalse(east.isEmpty() || west.isEmpty(), "starting tiles on both sides, seed " + seed);
            for (Tile t : east) assertTrue(map.getColumnOf(t) > shape.getColumns() / 2, "east tile " + t);
            for (Tile t : west) assertTrue(map.getColumnOf(t) < shape.getColumns() / 2, "west tile " + t);
        }
    }

    @Test
    @Timeout(600)
    void aNewTopDownGameStillIsARectangleWithPolesOnTheTopAndBottomRows() throws Exception {
        final Map map = game("{ \"seed\": 3, \"options\": { \"model.option.mapShape\": 0 } }").getMap();
        assertEquals(MapShape.topDown(58, 72), map.getShape());
        assertEquals(58 * 72, map.getTileList(t -> true).size());
        for (int x = 0; x < 58; x++) {
            assertTrue(map.getTile(x, 0).isLand() && map.getTile(x, 71).isLand());
        }
        final List<Tile> east = new ArrayList<>(), west = new ArrayList<>();
        map.collectStartingTiles(east, west);
        for (Tile t : east) assertEquals(true, t.getX() > 29);
        for (Tile t : west) assertEquals(true, t.getX() < 29);
        draw(map, "topdown-seed3");
    }

    @Test
    @Timeout(600)
    void everyPlayerStartsOnTheirSideOfAnIsometricMap() throws Exception {
        final Game game = game("{ \"seed\": 5, " + ISOMETRIC + " }");
        final Map map = game.getMap();
        int europeans = 0;
        for (net.sf.freecol.common.model.Player p : game.getLiveEuropeanPlayerList()) {
            final Tile entry = p.getEntryTile();
            assertNotNull(entry, p.getNationId() + " has an entry tile");
            assertTrue(map.isValid(entry.getX(), entry.getY()));
            europeans++;
            for (Unit u : p.getUnits().toList()) {
                if (u.hasTile()) assertTrue(map.isValid(u.getTile().getX(), u.getTile().getY()), "" + u);
            }
        }
        assertTrue(europeans >= 2);
    }

    @Test
    @Timeout(600)
    void anIsometricShapedMapSavesAndLoadsWithItsShape() throws Exception {
        final ClientEngine[] client = new ClientEngine[1];
        final ServerEngine server = start("{ \"seed\": 7, " + ISOMETRIC + " }", client,
            new CountDownLatch[] { new CountDownLatch(1) }, new int[1]);
        final Map map = server.getGame().getMap();
        final byte[] save = server.saveGame();
        final ServerEngine again = new ServerEngine(x -> {});
        again.loadGame(save);
        final Map loaded = again.getGame().getMap();
        assertEquals(map.getShape(), loaded.getShape());
        assertEquals(map.getTileList(t -> true).size(), loaded.getTileList(t -> true).size());
        for (Tile t : map.getTileList(x -> true)) {
            final Tile l = loaded.getTile(t.getX(), t.getY());
            assertNotNull(l, "" + t);
            assertEquals(t.getType(), l.getType());
        }
        assertNull(loaded.getTile(0, 0), "a corner of the box is still not a tile");
        assertEquals(map.getLatitude(map.getTileAt(3, 50)), loaded.getLatitude(loaded.getTileAt(3, 50)));
    }

    @Test
    @Timeout(600)
    void aTopDownSaveWithoutAShapeLoadsAsTopDown() throws Exception {
        final ServerEngine server = start("{ \"seed\": 7 }", new ClientEngine[1],
            new CountDownLatch[] { new CountDownLatch(1) }, new int[1]);
        final String xml = SaveXml.of(server.saveGame());
        assertTrue(xml.contains("shape=\"topDown\""), "the shape is saved");
        // A version 15 save has no shape at all.
        final byte[] old = SaveXml.replace(server.saveGame(), x -> x.replaceAll(" shape=\"topDown\"", ""));
        final ServerEngine again = new ServerEngine(x -> {});
        again.loadGame(old);
        assertEquals(server.getGame().getMap().getShape(), again.getGame().getMap().getShape());
        assertFalse(again.getGame().getMap().getShape().isIsometric());
    }

    @Test
    @Timeout(900)
    void anIsometricGamePlaysAiRounds() throws Exception {
        final CountDownLatch[] finished = { new CountDownLatch(1) };
        final ClientEngine[] client = new ClientEngine[1];
        final int[] rounds = new int[1];
        final ServerEngine server = start("{ \"seed\": 11, " + ISOMETRIC + " }", client, finished, rounds);
        assertTrue(server.getGame().getMap().getShape().isIsometric());
        final int turn = client[0].getGame().getTurn().getNumber();
        finished[0] = new CountDownLatch(1);
        client[0].skipTurns(8);
        assertTrue(finished[0].await(600, TimeUnit.SECONDS), "play comes back after the AI's rounds");
        assertEquals(turn + 8, client[0].getGame().getTurn().getNumber());
        assertTrue(FirstTurn.reported().isEmpty(), "no errors: " + FirstTurn.reported());
        // Nothing stands outside the diamond.
        for (net.sf.freecol.common.model.Player p : server.getGame().getLiveEuropeanPlayerList()) {
            for (Unit u : p.getUnits().toList()) {
                if (u.hasTile()) {
                    assertTrue(server.getGame().getMap().isValid(u.getTile().getX(), u.getTile().getY()), "" + u);
                }
            }
        }
    }
}
