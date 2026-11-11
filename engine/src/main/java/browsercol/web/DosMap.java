package browsercol.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.Deque;

import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovement;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.util.LogBuilder;
import net.sf.freecol.server.generator.MapGenerator;
import net.sf.freecol.server.model.ServerGame;


/**
 * A map of the original DOS Colonization (a .MP file, such as its America
 * map AMER2.MP) read into a FreeCol map, for the map generator to import
 * as it imports a map file's (#459).
 *
 * The file is a six-byte header (width, height and 4, each a little-endian
 * word) and then layers of width * height bytes, of which the first is the
 * terrain. A terrain byte's low five bits are the terrain code: 0..7 open
 * land, 8..23 forest (a forest code minus 8 is its open land), 0x18
 * arctic, 0x19 ocean, 0x1a sea lane. Bit 0x20 makes the tile hills, or
 * mountains with 0x80 as well; without 0x20, 0x40 is a minor river and
 * 0x80 a major one (terrainOfTile 13e4:000e in VICEROY.EXE).
 *
 * DOS tiles are square and FreeCol's are diamonds in staggered rows, odd
 * rows shifted half a tile to the right. A DOS tile is laid on the
 * FreeCol tile whose centre falls in it at half a column wide and two rows
 * high, which keeps the land's shape and makes one FreeCol tile of each
 * DOS tile: DOS (dx, dy) is FreeCol (dx / 2, 2 * dy) for even dx and
 * ((dx - 1) / 2, 2 * dy - 1) for odd dx. DOS east and west neighbours are
 * then FreeCol diagonal neighbours, and DOS north and south FreeCol's.
 *
 * The game does not come with the DOS file. Its America map comes as a
 * map of our own made from it (MAGIC, see text()): FreeCol's tile type and
 * river of each FreeCol tile, laid out as above, one character each, which
 * DosMap reads as it reads a .MP file. A player's own .MP file still reads.
 */
final class DosMap {

    /** The first line of a map of our own. */
    static final String MAGIC = "BrowserCol map";

    /** The character of each FreeCol tile type (after "model.tile.") in a map of our own. */
    private static final String TYPES = "tundra t desert d plains p prairie r grassland g savannah s marsh m swamp w"
        + " borealForest T scrubForest D mixedForest P broadleafForest R coniferForest G tropicalForest S"
        + " wetlandForest M rainForest W hills h mountains ^ arctic a ocean ~ highSeas = lake l";

    /**
     * A map before it is made a FreeCol map: its size, and each tile's type
     * (after "model.tile.") and river magnitude (0 for none), row by row.
     */
    static final class Grid {
        final int width, height;
        final String[] types;
        final int[] rivers;

        Grid(int width, int height) {
            this.width = width;
            this.height = height;
            this.types = new String[width * height];
            this.rivers = new int[width * height];
        }
    }

    private static final int HEADER = 6;

    /** The FreeCol tile type of each open land code; a forest code's is at code - 8 of FOREST. */
    private static final String[] OPEN = {
        "tundra", "desert", "plains", "prairie", "grassland", "savannah", "marsh", "swamp",
    };
    private static final String[] FOREST = {
        "borealForest", "scrubForest", "mixedForest", "broadleafForest",
        "coniferForest", "tropicalForest", "wetlandForest", "rainForest",
    };

    private static final int ARCTIC = 0x18, OCEAN = 0x19, SEA_LANE = 0x1a;
    private static final int HILLS = 0x20, MOUNTAINS = 0x80, RIVER = 0x40, MAJOR_RIVER = 0x80;

    private DosMap() { }

    /** True if the bytes are a DOS Colonization map: its header, and at least its terrain layer. */
    static boolean isDosMap(byte[] bytes) {
        if (bytes == null || bytes.length < HEADER) return false;
        int width = word(bytes, 0), height = word(bytes, 2);
        return width > 2 && height > 2 && word(bytes, 4) == 4
            && bytes.length >= HEADER + width * height;
    }

    /** True if the bytes are a map of our own (MAGIC). */
    static boolean isOwnMap(byte[] bytes) {
        final byte[] magic = MAGIC.getBytes(StandardCharsets.US_ASCII);
        if (bytes == null || bytes.length < magic.length) return false;
        for (int i = 0; i < magic.length; i++) if (bytes[i] != magic[i]) return false;
        return true;
    }

    /** True if DosMap reads the bytes: a DOS map or a map of our own. */
    static boolean isMap(byte[] bytes) {
        return isDosMap(bytes) || isOwnMap(bytes);
    }

    private static int word(byte[] bytes, int at) {
        return (bytes[at] & 0xff) | ((bytes[at + 1] & 0xff) << 8);
    }

    /** The FreeCol width of a DOS map width dosWidth wide: a column for each two DOS columns. */
    static int width(int dosWidth) {
        return (dosWidth + 1) / 2;
    }

    /** The FreeCol height of a DOS map dosHeight high: two rows for each DOS row, less the first. */
    static int height(int dosHeight) {
        return 2 * dosHeight - 1;
    }

    /** The DOS column of FreeCol tile (x, y). */
    static int dosX(int x, int y) {
        return 2 * x + (y & 1);
    }

    /** The DOS row of FreeCol tile (x, y). */
    static int dosY(int x, int y) {
        return (y + 1) / 2;
    }

    /**
     * Lay a DOS map onto FreeCol's rows, as the class comment says.
     *
     * @param bytes The .MP file.
     * @return Its grid.
     * @exception IllegalArgumentException if the bytes are no DOS map.
     */
    static Grid grid(byte[] bytes) {
        if (!isDosMap(bytes)) throw new IllegalArgumentException("not a Colonization map");
        final int dosWidth = word(bytes, 0), dosHeight = word(bytes, 2);
        final Grid grid = new Grid(width(dosWidth), height(dosHeight));
        for (int y = 0; y < grid.height; y++) {
            for (int x = 0; x < grid.width; x++) {
                final int dx = dosX(x, y), dy = dosY(x, y);
                // As the DOS game does on starting a game on the map (startNewGame
                // 86be:235c and generateMap 78bd:08c0): the first and last rows
                // arctic, the first and last columns sea lane.
                int b = (dx < dosWidth) ? bytes[HEADER + dy * dosWidth + dx] & 0xff : SEA_LANE;
                if (dy == 0 || dy == dosHeight - 1) b = ARCTIC;
                else if (dx == 0 || dx >= dosWidth - 1) b = SEA_LANE;
                grid.types[y * grid.width + x] = tileType(b);
                grid.rivers[y * grid.width + x] = river(b);
            }
        }
        return grid;
    }

    /**
     * A grid as a map of our own: MAGIC, the width and height, then a line
     * of tile type characters (TYPES) and a line of river magnitudes for
     * each row.
     */
    static String text(Grid grid) {
        final StringBuilder sb = new StringBuilder(MAGIC).append('\n')
            .append(grid.width).append(' ').append(grid.height).append('\n');
        for (int y = 0; y < grid.height; y++) {
            for (int x = 0; x < grid.width; x++) sb.append(typeChar(grid.types[y * grid.width + x]));
            sb.append(' ');
            for (int x = 0; x < grid.width; x++) sb.append(grid.rivers[y * grid.width + x]);
            sb.append('\n');
        }
        return sb.toString();
    }

    /**
     * Read a map of our own.
     *
     * @exception IllegalArgumentException if the text is no such map.
     */
    static Grid parse(String text) {
        final String[] lines = text.split("\r?\n");
        if (lines.length < 2 || !MAGIC.equals(lines[0])) {
            throw new IllegalArgumentException("not a BrowserCol map");
        }
        final String[] size = lines[1].trim().split(" ");
        final Grid grid = new Grid(Integer.parseInt(size[0]), Integer.parseInt(size[1]));
        if (lines.length < 2 + grid.height) throw new IllegalArgumentException("the map is short of rows");
        for (int y = 0; y < grid.height; y++) {
            final String line = lines[2 + y];
            if (line.length() != 2 * grid.width + 1) {
                throw new IllegalArgumentException("row " + y + " is not " + grid.width + " tiles");
            }
            for (int x = 0; x < grid.width; x++) {
                grid.types[y * grid.width + x] = typeOf(line.charAt(x));
                grid.rivers[y * grid.width + x] = line.charAt(grid.width + 1 + x) - '0';
            }
        }
        return grid;
    }

    private static char typeChar(String type) {
        final String[] t = TYPES.split(" ");
        for (int i = 0; i < t.length; i += 2) if (t[i].equals(type)) return t[i + 1].charAt(0);
        throw new IllegalArgumentException("no character for " + type);
    }

    private static String typeOf(char c) {
        final String[] t = TYPES.split(" ");
        for (int i = 0; i < t.length; i += 2) if (t[i + 1].charAt(0) == c) return t[i];
        throw new IllegalArgumentException("no tile type for '" + c + "'");
    }

    /**
     * Read a DOS map or a map of our own into a map of a game of its own,
     * as FreeColServer.readMap reads a map file's.
     *
     * @param bytes The .MP file, or the map of our own.
     * @param spec The rules whose tile types the map gets.
     * @return The map.
     * @exception IllegalArgumentException if the bytes are neither.
     */
    static Map read(byte[] bytes, Specification spec) {
        final Grid grid = isOwnMap(bytes)
            ? parse(new String(bytes, StandardCharsets.UTF_8)) : grid(bytes);
        final Game game = new ServerGame(spec);
        final Map map = new Map(game, grid.width, grid.height);
        game.changeMap(map);
        map.populateTiles((x, y) -> new Tile(game,
                spec.getTileType("model.tile." + grid.types[y * grid.width + x]), x, y));
        makeLakes(map, spec.getTileType("model.tile.lake"));
        addRivers(map, grid);
        return map;
    }

    /**
     * Make a map of our own of a DOS map: java DosMap AMER2.MP america.txt.
     */
    public static void main(String[] args) throws IOException {
        final byte[] bytes = Files.readAllBytes(Paths.get(args[0]));
        Files.write(Paths.get(args[1]), text(grid(bytes)).getBytes(StandardCharsets.UTF_8));
    }

    /** The FreeCol tile type id (after "model.tile.") of a DOS terrain byte. */
    static String tileType(int b) {
        final int code = b & 0x1f;
        if (code == ARCTIC) return "arctic";
        if (code == OCEAN) return "ocean";
        if (code == SEA_LANE) return "highSeas";
        if ((b & HILLS) != 0) return ((b & MOUNTAINS) != 0) ? "mountains" : "hills";
        if (code < 8) return OPEN[code];
        if (code < 0x18) return FOREST[code & 7];
        return "tundra"; // no such code in the DOS terrain table
    }

    /** The magnitude of the river a DOS terrain byte has, or 0 for none. */
    static int river(int b) {
        if ((b & 0x1f) >= ARCTIC || (b & HILLS) != 0) return 0;
        return ((b & MAJOR_RIVER) != 0) ? TileImprovement.LARGE_RIVER
            : ((b & RIVER) != 0) ? TileImprovement.SMALL_RIVER : 0;
    }

    /**
     * Make water that has no way to the high seas lake. The DOS map has
     * only ocean; FreeCol's lakes are water closed off from the sea.
     */
    private static void makeLakes(Map map, TileType lake) {
        final boolean[] sea = new boolean[map.getWidth() * map.getHeight()];
        final Deque<Tile> open = new ArrayDeque<>();
        map.forEachTile(t -> {
                if (t.getType().isHighSeasConnected()) {
                    sea[t.getY() * map.getWidth() + t.getX()] = true;
                    open.add(t);
                }
            });
        while (!open.isEmpty()) {
            Tile t = open.poll();
            for (Direction d : Direction.values()) {
                Tile n = t.getNeighbourOrNull(d);
                if (n == null || n.isLand()) continue;
                int i = n.getY() * map.getWidth() + n.getX();
                if (!sea[i]) {
                    sea[i] = true;
                    open.add(n);
                }
            }
        }
        map.forEachTile(t -> {
                if (!t.isLand() && !sea[t.getY() * map.getWidth() + t.getX()]) t.changeType(lake);
            });
    }

    /**
     * Put the grid's rivers on the map and join them up. FreeCol joins a
     * river only across a tile's diagonal sides, so where a DOS river runs
     * north or south a tile between the two gets a river too.
     */
    private static void addRivers(Map map, Grid grid) {
        map.forEachTile(t -> {
                int mag = grid.rivers[t.getY() * grid.width + t.getX()];
                if (mag > 0 && t.isLand()) t.addRiver(mag, "0000");
            });
        map.forEachTile(t -> {
                Tile south = t.getNeighbourOrNull(Direction.S);
                if (!t.hasRiver() || south == null || !south.hasRiver()) return;
                Tile sw = t.getNeighbourOrNull(Direction.SW), se = t.getNeighbourOrNull(Direction.SE);
                if ((sw != null && sw.hasRiver()) || (se != null && se.hasRiver())) return;
                Tile between = canCarryRiver(sw) ? sw : canCarryRiver(se) ? se : null;
                if (between != null) between.addRiver(TileImprovement.SMALL_RIVER, "0000");
            });
        map.forEachTile(t -> {
                TileImprovement river = t.getRiver();
                if (river == null) return;
                String all = (river.getMagnitude() == TileImprovement.LARGE_RIVER) ? "2222" : "1111";
                river.updateRiverConnections(all);
            });
    }

    /**
     * A map generator that imports the DOS map in place of the import file's
     * map, as FreeColServer.generateMap hands it a map file's: FreeCol then
     * places the natives, rumours and bonuses on it as on any imported map.
     */
    static MapGenerator importing(MapGenerator generator, byte[] bytes) {
        return new MapGenerator() {
            @Override
            public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
                return generator.generateEmptyMap(game, width, height, lb);
            }

            @Override
            public Map generateMap(Game game, Map importMap, boolean units, LogBuilder lb) {
                return generator.generateMap(game, read(bytes, game.getSpecification()), units, lb);
            }
        };
    }

    private static boolean canCarryRiver(Tile t) {
        return t != null && t.isLand()
            && !"model.tile.hills".equals(t.getType().getId())
            && !"model.tile.mountains".equals(t.getType().getId());
    }
}
