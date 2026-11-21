package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovement;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.generator.TerrainGenerator;

/**
 * A save made on the staggered grid is converted to the square grid as it
 * loads (#527). Every tile, and so every unit and colony, keeps the same
 * neighbours it had, and the styles that depend on direction still agree
 * with the map around them.
 */
class SquareGridConversionTest {

    private static final File SAVES = new File(System.getProperty("engine.src"), "test/resources");

    /** The staggered grid's neighbours, as {dx, dy} on odd rows then even rows (Direction before #526). */
    private static final int[][] ODD = {{0, -2}, {1, -1}, {1, 0}, {1, 1}, {0, 2}, {0, 1}, {-1, 0}, {0, -1}};
    private static final int[][] EVEN = {{0, -2}, {0, -1}, {1, 0}, {0, 1}, {0, 2}, {-1, 1}, {-1, 0}, {-1, -1}};

    private static final Pattern TILE = Pattern.compile("<tile id=\"(tile:\\d+)\" x=\"(\\d+)\" y=\"(\\d+)\"");
    private static final Pattern IMPROVEMENT = Pattern.compile(
        "<tileImprovement id=\"[^\"]*\" tile=\"(tile:\\d+)\" type=\"model.improvement.(river|road)\"[^>]*? style=\"(\\d+)\"");
    private static final Pattern VERSION = Pattern.compile("<savedGame [^>]*\\bversion=\"(\\d+)\"");

    private static String savegameXml(byte[] savegame) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(savegame))) {
            for (ZipEntry e; (e = zis.getNextEntry()) != null;) {
                if ("savegame.xml".equals(e.getName())) {
                    return new String(zis.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new IOException("no savegame.xml");
    }

    private static List<File> fixtures() throws IOException {
        List<File> out = new ArrayList<>();
        try (Stream<java.nio.file.Path> s = Files.walk(SAVES.toPath())) {
            s.map(java.nio.file.Path::toFile).filter(f -> f.getName().endsWith(".fsg")).forEach(out::add);
        }
        out.sort(null);
        return out;
    }

    @TestFactory
    Stream<DynamicTest> everyTileOfAConvertedSaveHasItsOldNeighbours() throws Exception {
        List<File> files = fixtures();
        assertTrue(files.size() >= 6, "the fixtures: " + files);
        return files.stream().map(f -> DynamicTest.dynamicTest(f.getName(), () -> check(f)));
    }

    private void check(File f) throws Exception {
        byte[] bytes = Files.readAllBytes(f.toPath());
        String xml = savegameXml(bytes);
        Matcher vm = VERSION.matcher(xml);
        assertTrue(vm.find(), "the save has a version");
        if (Integer.parseInt(vm.group(1)) >= 15) return; // made on the square grid, nothing to convert

        // The old position of every tile, by id.
        Map<String, int[]> old = new HashMap<>();
        Matcher m = TILE.matcher(xml);
        while (m.find()) {
            old.putIfAbsent(m.group(1), new int[] {Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))});
        }
        Map<String, String> atOld = new HashMap<>();
        old.forEach((id, p) -> atOld.put(p[0] + "," + p[1], id));

        ServerEngine engine = new ServerEngine(x -> {});
        engine.loadGame(bytes);
        Game game = engine.getGame();
        net.sf.freecol.common.model.Map map = game.getMap();
        assertTrue(map.getWidth() * map.getHeight() >= old.size(), "the map grew");
        // The map is Isometric shaped (#559): tile for tile the old map, with nothing in the corners.
        assertTrue(map.getShape().isIsometric(), "an Isometric shaped map: " + map.getShape());
        assertEquals(old.size(), map.getTileList(x -> true).size(), "no tile added");
        for (Map.Entry<String, int[]> e : old.entrySet()) {
            Tile t = (Tile)game.getFreeColGameObject(e.getKey());
            assertEquals(e.getValue()[0], map.getColumnOf(t), "column of " + e.getKey() + " in " + f.getName());
            assertEquals(e.getValue()[1], map.getRowOf(t), "row of " + e.getKey() + " in " + f.getName());
            assertEquals(t, map.getTileAt(e.getValue()[0], e.getValue()[1]));
        }

        int checked = 0;
        for (Map.Entry<String, int[]> e : old.entrySet()) {
            Tile t = (Tile)game.getFreeColGameObject(e.getKey());
            assertNotNull(t, e.getKey());
            int[] p = e.getValue();
            Set<String> before = new HashSet<>();
            for (int[] d : ((p[1] & 1) != 0 ? ODD : EVEN)) {
                String id = atOld.get((p[0] + d[0]) + "," + (p[1] + d[1]));
                if (id != null) before.add(id);
            }
            Set<String> after = new HashSet<>();
            for (Direction d : Direction.values()) {
                Tile n = map.getAdjacentTile(t, d);
                if (n != null && old.containsKey(n.getId())) after.add(n.getId());
            }
            assertEquals(before, after, e.getKey() + " at " + p[0] + "," + p[1] + " in " + f.getName());
            checked++;
        }
        assertEquals(old.size(), checked);

        // Units and colonies sit on those tiles, so they have kept their neighbours too.
        int placed = 0;
        for (Player pl : game.getLiveEuropeanPlayerList()) {
            for (Unit u : pl.getUnits().toList()) {
                if (u.hasTile()) {
                    assertTrue(old.containsKey(u.getTile().getId()));
                    placed++;
                }
            }
            for (Colony c : pl.getColonyList()) {
                assertTrue(old.containsKey(c.getTile().getId()));
                placed++;
            }
        }
        assertTrue(placed > 0, "the save has units");

        // The old style of each river and road, by tile id.
        Map<String, String> oldStyles = new HashMap<>();
        Matcher im = IMPROVEMENT.matcher(xml);
        while (im.find()) oldStyles.putIfAbsent(im.group(1) + (im.group(2).equals("river") ? "r" : "o"), im.group(3));

        // Direction-relative styles agree with what is around them.
        for (Tile t : map.getTileList(x -> true)) {
            if (!t.isLand() && t.getType() != null) {
                int style = t.getStyle();
                TerrainGenerator.encodeStyle(t);
                assertEquals(style, t.getStyle(), "coast style of " + t + " in " + f.getName());
            }
            checkImprovement(t, t.getRiver(), true, oldStyles, atOld, old, map);
            TileImprovement road = t.getRoad();
            if (road != null && !road.getVirtual()) checkImprovement(t, road, false, oldStyles, atOld, old, map);
        }
        // And it saves and loads again as a game with the same shape.
        ServerEngine again = new ServerEngine(x -> {});
        again.loadGame(engine.saveGame());
        assertEquals(map.getWidth(), again.getGame().getMap().getWidth());
        assertEquals(map.getShape(), again.getGame().getMap().getShape());
        assertEquals(old.size(), again.getGame().getMap().getTileList(x -> true).size());
    }

    /**
     * A river or road connects to the same neighbours it did: the tiles its old style pointed at, found by the old
     * grid's deltas, are the ones its new style points at.
     */
    private static void checkImprovement(Tile t, TileImprovement ti, boolean river, Map<String, String> oldStyles,
            Map<String, String> atOld, Map<String, int[]> old, net.sf.freecol.common.model.Map map) {
        if (ti == null) return;
        String style = oldStyles.get(t.getId() + (river ? "r" : "o"));
        if (style == null) return; // one with no style
        int[] p = old.get(t.getId());
        int[][] deltas = (p[1] & 1) != 0 ? ODD : EVEN;
        Set<String> before = new HashSet<>();
        for (int i = 0; i < style.length(); i++) {
            if (style.charAt(i) == '0') continue;
            int[] d = deltas[river ? 2 * i + 1 : i]; // a river's digits are NE, SE, SW, NW
            String id = atOld.get((p[0] + d[0]) + "," + (p[1] + d[1]));
            if (id != null) before.add(id);
        }
        Set<String> after = new HashSet<>();
        for (Direction d : river ? Direction.edgeNeighbours : Direction.allDirections) {
            if (river ? ti.getRiverConnection(d) == 0 : !ti.isConnectedTo(d)) continue;
            Tile n = map.getAdjacentTile(t, d);
            if (n != null && old.containsKey(n.getId())) after.add(n.getId());
        }
        assertEquals(before, after, (river ? "river" : "road") + " of " + t.getId() + " " + style);
    }
}
