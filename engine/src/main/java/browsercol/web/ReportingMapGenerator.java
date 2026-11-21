package browsercol.web;

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
 */
final class ReportingMapGenerator implements MapGenerator {

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
        try {
            return this.generator.generateMap(game, importMap, generateEuropeanPlayerUnits, lb);
        } catch (RuntimeException | Error ex) {
            Failures.report("the map could not be generated", ex);
            throw ex;
        }
    }
}
