import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import javax.imageio.ImageIO;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.io.FreeColXMLWriter;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Region;
import net.sf.freecol.common.model.Resource;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovement;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.FreeColServer;
import net.sf.freecol.server.generator.TerrainGenerator;
import net.sf.freecol.server.model.ServerRegion;

/**
 * Resample FreeCol's staggered map files into north-up square grids (#528).
 *
 * A FreeCol tile is a 128x64 diamond in rows half a tile apart, odd rows shifted half a tile east. A square tile
 * is 64x64. So a W x H staggered map becomes 2W x ceil(H/2): the same tile count and the same proportions on
 * screen. Each new tile takes the terrain of the old tile under its centre on the screen. Rivers and coast
 * styles are made again with FreeCol's own code (TileImprovement.updateRiverConnections,
 * TerrainGenerator.encodeStyle) rather than copied; regions and native settlements stay where the maps have them.
 *
 * Usage: ResampleMaps resample IN_DIR OUT_DIR [PNG_DIR]   (every *.fsm in IN_DIR)
 *        ResampleMaps america IN_TXT OUT_TXT              (the staggered America map of ours, laid square)
 */
public final class ResampleMaps {

    /** Old tile centre in screen units: width 128, row pitch 32. */
    private static double cx(int x, int y) { return (x + 0.5 + 0.5 * (y & 1)) * 128; }
    private static double cy(int y) { return (y + 1) * 32.0; }

    /** The old tile whose diamond holds the screen point. */
    private static int[] oldTileAt(double px, double py, int w, int h) {
        int bestX = 0, bestY = 0;
        double best = Double.MAX_VALUE;
        final int y0 = (int)Math.round(py / 32 - 1);
        for (int y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y0 + 2); y++) {
            final int x0 = (int)Math.round(px / 128 - 0.5 - 0.5 * (y & 1));
            for (int x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x0 + 1); x++) {
                final double d = Math.abs(px - cx(x, y)) / 64 + Math.abs(py - cy(y)) / 32;
                if (d < best) { best = d; bestX = x; bestY = y; }
            }
        }
        if (best == Double.MAX_VALUE) { // off the map's rows: the nearest edge tile
            bestY = Math.max(0, Math.min(h - 1, y0));
            bestX = Math.max(0, Math.min(w - 1, (int)Math.floor(px / 128 - 0.5 * (bestY & 1))));
        }
        return new int[] { bestX, bestY };
    }

    /** The screen position of a square tile's centre; the 32 shifts to the middle of the staggered rows. */
    private static double nx(int x) { return (x + 0.5) * 64 + 32; }
    private static double ny(int y) { return (y + 0.5) * 64; }

    public static void main(String[] args) throws Exception {
        if (args[0].equals("america")) {
            america(new File(args[1]), new File(args[2]), args.length > 3 ? new File(args[3]) : null);
            return;
        }
        Messages.loadMessageBundle(java.util.Locale.US);
        FreeColRules.loadRules();
        final Specification spec = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile("classic"), null,
            "model.difficulty.medium");
        final File in = new File(args[1]), out = new File(args[2]);
        final File png = args.length > 3 ? new File(args[3]) : null;
        out.mkdirs();
        if (png != null) png.mkdirs();
        final File[] files = in.listFiles((d, n) -> n.endsWith(".fsm"));
        java.util.Arrays.sort(files);
        for (File f : files) {
            final Specification s = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile("classic"), null,
                "model.difficulty.medium");
            final net.sf.freecol.common.model.Map old = FreeColServer.readMap(f, s);
            final net.sf.freecol.common.model.Map made = resample(old, s);
            write(made, new File(out, f.getName()));
            if (png != null) dump(made, new File(png, f.getName().replace(".fsm", ".png")));
            System.out.println(f.getName() + " " + old.getWidth() + "x" + old.getHeight() + " -> "
                + made.getWidth() + "x" + made.getHeight());
        }
    }

    private static net.sf.freecol.common.model.Map resample(net.sf.freecol.common.model.Map old, Specification spec)
        throws Exception {
        final Game game = old.getGame();
        final int w = old.getWidth(), h = old.getHeight();
        final int nw = 2 * w, nh = (h + 1) / 2;
        // A few map files have a next id below ids they use; take new ids above all of them.
        final Field objects = Game.class.getDeclaredField("freeColGameObjects");
        objects.setAccessible(true);
        final Field nextId = Game.class.getDeclaredField("nextId");
        nextId.setAccessible(true);
        int top = nextId.getInt(game);
        for (Object id : new ArrayList<Object>(((java.util.Map<?, ?>)objects.get(game)).keySet())) {
            final String key = id.toString();
            top = Math.max(top, Integer.parseInt(key.substring(key.lastIndexOf(':') + 1)) + 1);
        }
        nextId.setInt(game, top);
        final net.sf.freecol.common.model.Map map = new net.sf.freecol.common.model.Map(game, nw, nh);
        map.setLayer(old.getLayer());
        map.setMinimumLatitude(old.getMinimumLatitude());
        map.setMaximumLatitude(old.getMaximumLatitude());

        // What the regions hold is counted again from the new tiles.
        final List<Region> regions = new ArrayList<>(old.getRegions());
        for (Region r : regions) {
            if (r instanceof ServerRegion) {
                ((ServerRegion)r).setSize(0);
                ((ServerRegion)r).getBounds().setBounds(0, 0, 0, 0);
            }
        }

        // Terrain by screen position.
        final Tile[] from = new Tile[nw * nh];
        map.populateTiles((x, y) -> {
                final int[] o = oldTileAt(nx(x), ny(y), w, h);
                final Tile ot = old.getTile(o[0], o[1]);
                from[y * nw + x] = ot;
                return new Tile(game, ot.getType(), x, y);
            });

        // Native settlements go to the new tile at their old position, on land, one to a tile.
        final Set<Tile> taken = new HashSet<>();
        final java.util.Map<Tile, Tile> settlementTile = new HashMap<>(); // old tile -> new tile
        for (Tile ot : old.getTileList(t -> t.getSettlement() != null)) {
            final int x0 = (int)Math.floor((cx(ot.getX(), ot.getY()) - 32) / 64);
            final int y0 = (int)Math.floor(cy(ot.getY()) / 64);
            Tile found = null;
            for (int r = 0; r <= 4 && found == null; r++) {
                for (int dy = -r; dy <= r && found == null; dy++) {
                    for (int dx = -r; dx <= r && found == null; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) != r) continue;
                        if (!map.isValid(x0 + dx, y0 + dy)) continue;
                        final Tile t = map.getTile(x0 + dx, y0 + dy);
                        if (t.isLand() && !taken.contains(t)) found = t;
                    }
                }
            }
            if (found == null) throw new IllegalStateException("no room for the settlement at " + ot);
            taken.add(found);
            found.setType(ot.getType());
            settlementTile.put(ot, found);
            from[found.getY() * nw + found.getX()] = ot;
        }

        // Resources and rumours, each old tile's once.
        final Set<Tile> used = new HashSet<>();
        for (int i = 0; i < from.length; i++) {
            final Tile ot = from[i];
            if (!used.add(ot)) continue;
            final Tile nt = map.getTile(i % nw, i / nw);
            if (ot.getTileItemContainer() == null) continue;
            final Resource r = ot.getTileItemContainer().getResource();
            if (r != null) nt.addResource(new Resource(game, nt, r.getType(), r.getQuantity()));
            if (ot.getLostCityRumour() != null && nt.isLand()) {
                nt.addLostCityRumour(new LostCityRumour(game, nt));
            }
        }

        // Rivers: a river where the old tile had one, a tile added where two river tiles now only touch at a
        // corner, and the connections worked out again by FreeCol's code.
        final TileImprovementType riverType = spec.getTileImprovementType("model.improvement.river");
        final int[] mag = new int[nw * nh];
        for (int i = 0; i < from.length; i++) {
            final TileImprovement r = from[i].getRiver();
            if (r == null) continue;
            if (!riverType.isTileTypeAllowed(map.getTile(i % nw, i / nw).getType())) continue;
            if (!used.contains(from[i])) continue;
            mag[i] = Math.max(mag[i], r.getMagnitude());
        }
        // The old tile of each river tile was used once above, but one old tile can be sampled by two new tiles;
        // the river stays on the first only.
        final Set<Tile> riverTaken = new HashSet<>();
        for (int i = 0; i < from.length; i++) {
            if (mag[i] > 0 && !riverTaken.add(from[i])) mag[i] = 0;
        }
        final int[][] diag = { { 1, 1 }, { 1, -1 } };
        for (int y = 0; y < nh; y++) {
            for (int x = 0; x < nw; x++) {
                if (mag[y * nw + x] == 0) continue;
                for (int[] d : diag) {
                    final int x2 = x + d[0], y2 = y + d[1];
                    if (x2 >= nw || y2 < 0 || y2 >= nh || mag[y2 * nw + x2] == 0) continue;
                    if (mag[y * nw + x2] > 0 || mag[y2 * nw + x] > 0) continue;
                    final int m = Math.min(mag[y * nw + x], mag[y2 * nw + x2]);
                    final int[][] via = { { x2, y }, { x, y2 } };
                    for (int[] v : via) {
                        final Tile t = map.getTile(v[0], v[1]);
                        if (t.isLand() && !t.hasSettlement() && riverType.isTileTypeAllowed(t.getType())) {
                            mag[v[1] * nw + v[0]] = m;
                            break;
                        }
                    }
                }
            }
        }
        for (int i = 0; i < mag.length; i++) {
            if (mag[i] > 0) map.getTile(i % nw, i / nw).addRiver(mag[i], "0000");
        }
        final String none = "1".repeat(Direction.edgeNeighbours.size());
        map.forEachTile(t -> {
                final TileImprovement river = t.getRiver();
                if (river != null) river.updateRiverConnections(none);
            });

        // Regions, from the old tile each new tile took its terrain from.
        for (Region r : regions) map.addRegion(r);
        for (int i = 0; i < from.length; i++) {
            final Region r = from[i].getRegion();
            final Tile nt = map.getTile(i % nw, i / nw);
            if (r instanceof ServerRegion) ((ServerRegion)r).addTile(nt);
            else if (r != null) nt.setRegion(r);
        }

        // Settlements and their land, and the units that stand on tiles.
        final Field tileField = Settlement.class.getDeclaredField("tile");
        tileField.setAccessible(true);
        for (java.util.Map.Entry<Tile, Tile> e : settlementTile.entrySet()) {
            final Tile ot = e.getKey(), nt = e.getValue();
            final Settlement s = ot.getSettlement();
            for (Tile owned : s.getOwnedTiles()) s.removeTile(owned);
            tileField.set(s, nt);
            nt.setSettlement(s);
            if (ot.getRegion() != null && nt.getRegion() == null && ot.getRegion() instanceof ServerRegion) {
                ((ServerRegion)ot.getRegion()).addTile(nt);
            }
            nt.changeOwnership(s.getOwner(), s);
            for (Unit u : new ArrayList<>(ot.getUnitList())) {
                nt.add(u);
                u.setLocationNoUpdate(nt);
            }
        }
        for (int i = 0; i < from.length; i++) {
            final Tile ot = from[i];
            final Tile nt = map.getTile(i % nw, i / nw);
            if (nt.hasSettlement()) continue;
            final Settlement s = ot.getOwningSettlement();
            final Player p = ot.getOwner();
            if (s != null && p != null && s.getTile().getType() != null && s.getTile().getMap() == map) {
                nt.changeOwnership(p, s);
            } else if (p != null && s == null) {
                nt.setOwner(p);
            }
        }
        for (Tile ot : old.getTileList(t -> !t.getUnitList().isEmpty() && t.getSettlement() == null)) {
            throw new IllegalStateException("units stand on " + ot + " and no settlement is there");
        }

        game.changeMap(map);

        // Coast styles, by FreeCol's own code.
        map.forEachTile(t -> { if (!t.isLand()) TerrainGenerator.encodeStyle(t); });
        map.resetContiguity();
        return map;
    }

    /** Write the game as a map editor's map file, as FreeColServer.saveMapEditorGame does. */
    private static void write(net.sf.freecol.common.model.Map map, File file) throws Exception {
        final Game game = map.getGame();
        final Specification spec = game.getSpecification();
        game.setSpecification(null);
        try (JarOutputStream jar = new JarOutputStream(new FileOutputStream(file))) {
            jar.putNextEntry(new JarEntry("savegame.properties"));
            jar.write(("map.width=" + map.getWidth() + "\nmap.height=" + map.getHeight() + "\n")
                .getBytes(StandardCharsets.ISO_8859_1));
            jar.closeEntry();
            jar.putNextEntry(new JarEntry("savegame.xml"));
            try (FreeColXMLWriter xw = new FreeColXMLWriter(jar, FreeColXMLWriter.WriteScope.toSave(), false)) {
                xw.writeStartDocument("UTF-8", "1.0");
                xw.writeStartElement("savedGame");
                xw.writeAttribute("owner", "mapEditor");
                xw.writeAttribute("publicServer", false);
                xw.writeAttribute("singleplayer", false);
                xw.writeAttribute("version", FreeColServer.SAVEGAME_VERSION);
                xw.writeAttribute("randomState", "");
                xw.writeAttribute("debug", "");
                game.toXML(xw);
                xw.writeEndElement();
                xw.writeEndDocument();
            }
            jar.closeEntry();
        } finally {
            game.setSpecification(spec);
        }
    }

    /** A picture of the map for a human to look at, four pixels to a tile: one colour per terrain. */
    private static void dump(net.sf.freecol.common.model.Map map, File file) throws Exception {
        final int s = 4;
        final BufferedImage img = new BufferedImage(map.getWidth() * s, map.getHeight() * s,
            BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < map.getHeight(); y++) {
            for (int x = 0; x < map.getWidth(); x++) {
                final Tile t = map.getTile(x, y);
                int c = colour(t.getType().getId().substring("model.tile.".length()));
                if (t.hasRiver()) c = 0x3a8fe0;
                if (t.getSettlement() != null) c = 0xe02020;
                for (int j = 0; j < s; j++) for (int i = 0; i < s; i++) img.setRGB(x * s + i, y * s + j, c);
            }
        }
        ImageIO.write(img, "png", file);
    }

    private static int colour(String type) {
        switch (type) {
        case "ocean": return 0x1c4a8c;
        case "highSeas": return 0x0e2a5a;
        case "lake": return 0x4a80c0;
        case "arctic": return 0xf4f4f4;
        case "tundra": return 0xb8c0b0;
        case "desert": return 0xe0c878;
        case "plains": return 0xc8b060;
        case "prairie": return 0xa8c050;
        case "grassland": return 0x58a838;
        case "savannah": return 0xb8b838;
        case "marsh": return 0x607848;
        case "swamp": return 0x386048;
        case "hills": return 0x906030;
        case "mountains": return 0x604030;
        default: return type.endsWith("Forest") ? 0x206020 : 0xff00ff;
        }
    }

    /**
     * Lay the staggered America map of ours square: the staggered tile (x, y) is DOS (2x + (y & 1), (y + 1) / 2).
     * The DOS map is 58 wide; the staggered one's last odd-row column is the DOS map's sea lane column.
     */
    private static void america(File in, File out, File png) throws Exception {
        final String[] lines = new String(Files.readAllBytes(in.toPath()), StandardCharsets.UTF_8).split("\r?\n");
        final String[] size = lines[1].trim().split(" ");
        final int w = Integer.parseInt(size[0]), h = Integer.parseInt(size[1]);
        final int dw = 2 * w, dh = (h + 1) / 2;
        final char[][] type = new char[dh][dw];
        final char[][] river = new char[dh][dw];
        for (char[] row : type) java.util.Arrays.fill(row, '=');
        for (char[] row : river) java.util.Arrays.fill(row, '0');
        for (int y = 0; y < h; y++) {
            final String line = lines[2 + y];
            for (int x = 0; x < w; x++) {
                final int dx = 2 * x + (y & 1), dy = (y + 1) / 2;
                type[dy][dx] = line.charAt(x);
                river[dy][dx] = line.charAt(w + 1 + x);
            }
        }
        for (int dx = 0; dx < dw; dx++) { type[0][dx] = 'a'; type[dh - 1][dx] = 'a'; }
        final StringBuilder sb = new StringBuilder(lines[0]).append('\n').append(dw).append(' ').append(dh).append('\n');
        for (int y = 0; y < dh; y++) sb.append(type[y]).append(' ').append(river[y]).append('\n');
        Files.write(out.toPath(), sb.toString().getBytes(StandardCharsets.UTF_8));
        if (png == null) return;
        final String chars = "tundra t desert d plains p prairie r grassland g savannah s marsh m swamp w hills h"
            + " mountains ^ arctic a ocean ~ highSeas = lake l";
        final String[] c = chars.split(" ");
        final BufferedImage img = new BufferedImage(dw * 4, dh * 4, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < dh; y++) {
            for (int x = 0; x < dw; x++) {
                String name = "mixedForest";
                for (int i = 0; i < c.length; i += 2) if (c[i + 1].charAt(0) == type[y][x]) name = c[i];
                int col = colour(name);
                if (river[y][x] != '0') col = 0x3a8fe0;
                for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) img.setRGB(x * 4 + i, y * 4 + j, col);
            }
        }
        ImageIO.write(img, "png", png);
    }
}
