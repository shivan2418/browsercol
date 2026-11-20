package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.NationOptions;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Region;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The model's grid is square (#526): a tile has eight neighbours at the same
 * offsets in every row, the four that share an edge are N, E, S and W, and
 * distance is Chebyshev's. Each check is on a small map built by hand.
 */
class SquareGridTest {

    private static Specification spec;

    @BeforeAll
    static void rules() {
        FreeColRules.loadRules();
        Messages.loadMessageBundle(Locale.US);
        spec = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile("classic"),
                                         null, "model.difficulty.medium");
    }

    /** A game with every nation's player, as the FreeCol tests make one. */
    private static Game game() {
        Game game = new ServerGame(spec);
        NationOptions nationOptions = new NationOptions(spec);
        for (Nation nation : spec.getEuropeanNations()) {
            nationOptions.setNationState(nation, NationOptions.NationState.AVAILABLE);
        }
        game.setNationOptions(nationOptions);
        for (Nation n : spec.getNations()) {
            if (n.isUnknownEnemy()) continue;
            Player p = new ServerPlayer(game, false, n);
            p.setAI(!n.getType().isEuropean() || n.getType().isREF());
            if (p.isAI() || game.canAddNewPlayer()) game.addPlayer(p);
        }
        return game;
    }

    /** A map of one tile type; rows of text then override single tiles (see {@link #grid}). */
    private static Map map(Game game, int width, int height, String... rows) {
        final Region region = new Region(game);
        final Map map = new Map(game, width, height);
        game.changeMap(map);
        map.populateTiles((x, y) -> {
                final char c = (rows.length == 0) ? '.' : rows[y].charAt(x);
                final String type = (c == '~') ? "model.tile.ocean"
                    : (c == '^') ? "model.tile.mountains" : "model.tile.plains";
                final Tile t = new Tile(game, spec.getTileType(type), x, y);
                t.setRegion(region);
                return t;
            });
        map.resetContiguity();
        map.resetHighSeasCount();
        return map;
    }

    /** A map from rows of text: '.' plains, '~' ocean, '^' mountains. */
    private static Map grid(Game game, String... rows) {
        return map(game, rows[0].length(), rows.length, rows);
    }

    private static Set<String> names(Iterable<Tile> tiles) {
        final Set<String> out = new HashSet<>();
        for (Tile t : tiles) assertTrue(out.add(t.getX() + "," + t.getY()), "twice: " + t);
        return out;
    }

    private static Iterable<Tile> circle(Map map, Tile center, boolean filled, int radius) {
        final Iterator<Tile> it = map.getCircleIterator(center, filled, radius);
        return () -> it;
    }

    // Direction

    @Test
    void aStepIsTheSameInEveryRow() {
        for (Direction d : Direction.values()) {
            final Map.Position a = d.step(5, 4), b = d.step(5, 5);
            assertEquals(a.getX() - 5, b.getX() - 5, d + " in an even and an odd row");
            assertEquals(a.getY() - 4, b.getY() - 5, d + " in an even and an odd row");
        }
        assertEquals(new Map.Position(5, 3), Direction.N.step(5, 4));
        assertEquals(new Map.Position(6, 3), Direction.NE.step(5, 4));
        assertEquals(new Map.Position(6, 4), Direction.E.step(5, 4));
        assertEquals(new Map.Position(6, 5), Direction.SE.step(5, 4));
        assertEquals(new Map.Position(5, 5), Direction.S.step(5, 4));
        assertEquals(new Map.Position(4, 5), Direction.SW.step(5, 4));
        assertEquals(new Map.Position(4, 4), Direction.W.step(5, 4));
        assertEquals(new Map.Position(4, 3), Direction.NW.step(5, 4));
    }

    @Test
    void theEdgeNeighboursAreNorthEastSouthWestAndTheCornersTheDiagonals() {
        assertEquals(List.of(Direction.N, Direction.E, Direction.S, Direction.W), Direction.edgeNeighbours);
        assertEquals(List.of(Direction.NE, Direction.SE, Direction.SW, Direction.NW), Direction.cornerNeighbours);
        for (Direction d : Direction.values()) {
            assertEquals(d.getReverseDirection().step(0, 0).getX(), -d.step(0, 0).getX());
            assertEquals(d.getReverseDirection().step(0, 0).getY(), -d.step(0, 0).getY());
        }
    }

    // Distance and adjacency

    @Test
    void distanceIsChebyshevsWhateverTheRows() {
        assertEquals(0, Map.Position.getXYDistance(3, 3, 3, 3));
        assertEquals(1, Map.Position.getXYDistance(3, 3, 4, 4), "a diagonal step is one");
        assertEquals(1, Map.Position.getXYDistance(3, 4, 4, 3));
        assertEquals(5, Map.Position.getXYDistance(0, 0, 3, 5));
        assertEquals(5, Map.Position.getXYDistance(3, 5, 0, 0));
        assertEquals(7, Map.Position.getXYDistance(2, 1, 9, 3));
        for (int y = 0; y < 6; y++) {
            for (int x = 0; x < 6; x++) {
                for (Direction d : Direction.values()) {
                    final Map.Position p = d.step(x, y);
                    assertEquals(1, Map.Position.getXYDistance(x, y, p.getX(), p.getY()), d + " from " + x + "," + y);
                }
            }
        }
    }

    @Test
    void anInteriorTileHasEightNeighboursAndAnEdgeTileFewer() {
        final Map map = map(game(), 5, 4);
        final Tile mid = map.getTile(2, 1);
        for (Direction d : Direction.values()) {
            final Tile n = map.getAdjacentTile(mid, d);
            assertNotNull(n, d.toString());
            assertEquals(d, map.getDirection(mid, n));
            assertEquals(d.getReverseDirection(), map.getDirection(n, mid));
            assertEquals(1, map.getDistance(mid, n));
        }
        assertNull(map.getAdjacentTile(map.getTile(0, 0), Direction.N));
        assertNull(map.getAdjacentTile(map.getTile(0, 0), Direction.W));
        assertNull(map.getAdjacentTile(map.getTile(0, 0), Direction.NW));
        assertNotNull(map.getAdjacentTile(map.getTile(0, 0), Direction.SE));
        assertNull(map.getDirection(mid, map.getTile(4, 1)), "two apart is no neighbour");
        assertEquals(4, map.getDistance(map.getTile(0, 0), map.getTile(4, 3)));
    }

    @Test
    void theRoughDirectionOfAFarTileIsTheNearestOfTheEight() {
        final Map map = map(game(), 21, 21);
        final Tile centre = map.getTile(10, 10);
        assertEquals(Direction.N, Map.getRoughDirection(centre, map.getTile(10, 2)));
        assertEquals(Direction.NE, Map.getRoughDirection(centre, map.getTile(17, 3)));
        assertEquals(Direction.E, Map.getRoughDirection(centre, map.getTile(19, 10)));
        assertEquals(Direction.SE, Map.getRoughDirection(centre, map.getTile(15, 15)));
        assertEquals(Direction.S, Map.getRoughDirection(centre, map.getTile(10, 20)));
        assertEquals(Direction.SW, Map.getRoughDirection(centre, map.getTile(4, 16)));
        assertEquals(Direction.W, Map.getRoughDirection(centre, map.getTile(1, 10)));
        assertEquals(Direction.NW, Map.getRoughDirection(centre, map.getTile(5, 5)));
        assertNull(Map.getRoughDirection(centre, centre));
        // Nearly north, a little east and a little west, are both north.
        assertEquals(Direction.N, Map.getRoughDirection(centre, map.getTile(11, 0)));
        assertEquals(Direction.N, Map.getRoughDirection(centre, map.getTile(9, 0)));
    }

    // Rings

    @Test
    void aRingIsExactlyTheTilesAtThatChebyshevDistance() {
        final Map map = map(game(), 15, 15);
        final Tile centre = map.getTile(7, 7);
        for (int radius = 1; radius <= 3; radius++) {
            final Set<String> ring = names(circle(map, centre, false, radius));
            final Set<String> expected = new HashSet<>();
            final int r = radius;
            map.forEachTile(t -> {
                    if (map.getDistance(centre, t) == r) expected.add(t.getX() + "," + t.getY());
                });
            assertEquals(8 * radius, ring.size(), "radius " + radius);
            assertEquals(expected, ring, "radius " + radius);
        }
    }

    @Test
    void aFilledCircleIsEveryTileWithinTheRadiusInnermostFirst() {
        final Map map = map(game(), 15, 15);
        final Tile centre = map.getTile(7, 7);
        for (int radius = 1; radius <= 3; radius++) {
            final List<Tile> seen = new ArrayList<>();
            for (Tile t : circle(map, centre, true, radius)) seen.add(t);
            assertEquals((2 * radius + 1) * (2 * radius + 1) - 1, seen.size(), "radius " + radius);
            assertEquals(seen.size(), names(seen).size());
            assertFalse(seen.contains(centre));
            int last = 0;
            for (Tile t : seen) {
                final int d = map.getDistance(centre, t);
                assertTrue(d >= last && d <= radius, "ordered by ring: " + t);
                last = d;
            }
        }
        assertFalse(map.getCircleIterator(centre, true, 0).hasNext());
        assertFalse(map.getCircleIterator(centre, false, 0).hasNext());
    }

    @Test
    void aRingAtTheMapEdgeKeepsOnlyTheTilesOnTheMap() {
        final Map map = map(game(), 6, 5);
        final Tile corner = map.getTile(0, 0);
        assertEquals(Set.of("1,0", "0,1", "1,1"), names(circle(map, corner, false, 1)));
        // Ring 2 round a corner: the L of tiles two away.
        assertEquals(Set.of("2,0", "2,1", "2,2", "1,2", "0,2"), names(circle(map, corner, false, 2)));
        // Everything of a 6x5 map within 3 of (2,2) but the centre.
        assertEquals(6 * 5 - 1, names(circle(map, map.getTile(2, 2), true, 3)).size());
    }

    // Movement, paths and the colony's radius

    private static int steps(PathNode path) {
        int steps = 0;
        for (PathNode n = path; n.next != null; n = n.next) steps++;
        return steps;
    }

    @Test
    void aUnitFindsAShortestPathAcrossTheGridAndRoundWater() {
        final Game game = game();
        final Player dutch = game.getPlayerByNationId("model.nation.dutch");
        // Diagonals cost a step, as straight moves do: (0,0) to (5,3) is five steps, not eight.
        final Map open = map(game, 6, 4);
        final Unit walker = new ServerUnit(game, open.getTile(0, 0), dutch, spec.getDefaultUnitType());
        assertEquals(5, steps(walker.findPath(open.getTile(5, 3))));
        // A pond in the way: (1,1) to (4,1) goes over its top, three steps.
        final Map pond = grid(game,
                              "......",
                              "..~~..",
                              "..~~..",
                              "......");
        final Unit other = new ServerUnit(game, pond.getTile(1, 1), dutch, spec.getDefaultUnitType());
        final PathNode path = other.findPath(pond.getTile(4, 1));
        assertNotNull(path);
        assertEquals(3, steps(path));
        for (PathNode n = path; n != null; n = n.next) assertTrue(n.getTile().isLand(), "stays on land: " + n.getTile());
    }

    @Test
    void aWalledOffTileHasNoPath() {
        final Game game = game();
        final Map map = grid(game,
                             "..^..",
                             "..^..",
                             "..^..");
        final Player dutch = game.getPlayerByNationId("model.nation.dutch");
        final Unit colonist = new ServerUnit(game, map.getTile(0, 1), dutch, spec.getDefaultUnitType());
        // Mountains can be crossed by a colonist, so the wall is water.
        for (int y = 0; y < 3; y++) map.getTile(2, y).changeType(spec.getTileType("model.tile.ocean"));
        assertNull(colonist.findPath(map.getTile(4, 1)));
        // A diagonal gap in the water is a gap: tiles join across a corner.
        map.getTile(2, 0).changeType(spec.getTileType("model.tile.plains"));
        assertNotNull(colonist.findPath(map.getTile(4, 1)));
    }

    @Test
    void aColonyWorksItsEightNeighboursAndNoOtherTile() {
        final Game game = game();
        final Map map = map(game, 9, 9);
        final Player dutch = game.getPlayerByNationId("model.nation.dutch");
        final Tile centre = map.getTile(4, 4);
        final Colony colony = new ServerColony(game, dutch, "Square Town", centre);
        dutch.addSettlement(colony);
        colony.placeSettlement(true);
        final Set<String> worked = new HashSet<>();
        for (net.sf.freecol.common.model.ColonyTile ct : colony.getColonyTiles()) {
            worked.add(ct.getWorkTile().getX() + "," + ct.getWorkTile().getY());
        }
        final Set<String> expected = new HashSet<>();
        for (int y = 3; y <= 5; y++) for (int x = 3; x <= 5; x++) expected.add(x + "," + y);
        assertEquals(expected, worked);
        assertEquals(1, colony.getRadius());
    }
}
