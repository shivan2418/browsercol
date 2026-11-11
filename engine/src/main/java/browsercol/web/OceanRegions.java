package browsercol.web;

import java.util.List;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.util.LogBuilder;
import net.sf.freecol.server.generator.MapGenerator;


/**
 * Imported maps whose water has no regions (#459). Giga Earth, of the maps
 * FreeCol comes with, has the fixed ocean regions, the Pacific and the
 * Atlantic and their halves, but no tile in them. FreeCol fills the oceans
 * only when a fixed ocean region is missing
 * (ServerRegion.requireFixedRegions), so on such a map it takes all that
 * water for lakes: the ocean and the high seas turn to lake, and making
 * the lakes (TerrainGenerator.makeLakes, quadratic in the tiles) takes
 * over a minute in the browser. Maps with no regions at all, as several
 * of FreeCol's are, get their oceans filled as they should.
 *
 * Leaving those empty ocean regions out of the imported map makes FreeCol
 * make and fill them, as for a map of its own.
 */
final class OceanRegions {

    /** The fixed ocean regions, by key. */
    static final List<String> FIXED = List.of(
        "model.region.pacific", "model.region.northPacific", "model.region.southPacific",
        "model.region.atlantic", "model.region.northAtlantic", "model.region.southAtlantic");

    private OceanRegions() { }

    /**
     * Leave out the map's fixed ocean regions if any water tile has no region.
     *
     * @return True if they were left out.
     */
    static boolean forgetUnfilled(Map map) {
        if (map.getTileList(t -> !t.isLand() && t.getRegion() == null).isEmpty()) return false;
        for (String key : FIXED) map.removeRegionsByKey(key);
        return true;
    }

    /** A map generator that leaves out the empty ocean regions of the map it imports. */
    static MapGenerator filling(MapGenerator generator) {
        return new MapGenerator() {
            @Override
            public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
                return generator.generateEmptyMap(game, width, height, lb);
            }

            @Override
            public Map generateMap(Game game, Map importMap, boolean units, LogBuilder lb) {
                if (importMap != null) forgetUnfilled(importMap);
                return generator.generateMap(game, importMap, units, lb);
            }
        };
    }
}
