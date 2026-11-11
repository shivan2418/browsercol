package browsercol.web;

import java.util.logging.Logger;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.util.LogBuilder;
import net.sf.freecol.server.generator.MapGenerator;


/**
 * A map generator that reports what makes the one it wraps throw (#422).
 * FreeCol's launch catches the exception and tells the player only its
 * message, "The server can not do that." for an exception with none, and
 * TeaVM's logger drops the stack trace, so a map that could not be made
 * left nothing to find the cause by. The report carries the stack trace.
 *
 * It also tries again when a map throws (#452). FreeCol's river generator
 * throws when a delta reaches the map's edge ({@code River.delta} does not
 * check for a missing neighbour), and that is FreeCol's own code, which
 * 1.0 does not patch. The map is random, so the next attempt draws another
 * one. A failed attempt leaves nothing behind: the next one replaces the
 * game's map, and the game holds the old map's objects only weakly.
 */
final class ReportingMapGenerator implements MapGenerator {

    private static final Logger logger = Logger.getLogger(ReportingMapGenerator.class.getName());

    /** How many maps to try before the game gives up and reports why. */
    static final int ATTEMPTS = 3;

    private final MapGenerator generator;

    /**
     * @param generator The generator that makes the maps.
     */
    ReportingMapGenerator(MapGenerator generator) {
        this.generator = generator;
    }

    @Override
    public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
        try {
            return this.generator.generateEmptyMap(game, width, height, lb);
        } catch (RuntimeException | Error ex) {
            Failures.report("the map could not be generated", ex);
            throw ex;
        }
    }

    @Override
    public Map generateMap(Game game, Map importMap, boolean generateEuropeanPlayerUnits, LogBuilder lb) {
        for (int attempt = 1; ; attempt++) {
            try {
                return this.generator.generateMap(game, importMap, generateEuropeanPlayerUnits, lb);
            } catch (RuntimeException | Error ex) {
                // An Error, such as running out of memory, would only happen again.
                if (attempt == ATTEMPTS || ex instanceof Error) {
                    Failures.report("the map could not be generated", ex);
                    throw ex;
                }
                logger.warning("Map " + attempt + " of " + ATTEMPTS
                    + " could not be generated, trying another: " + Failures.describe(ex));
            }
        }
    }
}
