package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.util.LogBuilder;
import net.sf.freecol.server.generator.MapGenerator;


/** A map that cannot be made is reported with its stack trace, not only as "The server can not do that." (#422). */
class ReportingMapGeneratorTest {

    private final List<String> reports = new ArrayList<>();

    @AfterEach
    void forget() {
        Failures.reportTo((what, detail) -> {});
    }

    private static void breakInTheRivers() {
        throw new NullPointerException();
    }

    @Test
    void anExceptionWithNoMessageIsReportedWithItsStackAndThrownOn() {
        Failures.reportTo((what, detail) -> reports.add(what + "\n" + detail));
        MapGenerator broken = new MapGenerator() {
            public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
                breakInTheRivers();
                return null;
            }
            public Map generateMap(Game game, Map importMap, boolean units, LogBuilder lb) {
                breakInTheRivers();
                return null;
            }
        };
        MapGenerator reporting = new ReportingMapGenerator(broken);
        NullPointerException thrown = assertThrows(NullPointerException.class,
            () -> reporting.generateMap(null, null, true, null));
        assertEquals(1, reports.size());
        assertTrue(reports.get(0).startsWith("the map could not be generated\n"), reports.get(0));
        assertTrue(reports.get(0).contains("breakInTheRivers"), reports.get(0));
        assertSame(NullPointerException.class, thrown.getClass());
        assertThrows(NullPointerException.class, () -> reporting.generateEmptyMap(null, 1, 1, null));
        assertEquals(2, reports.size());
    }

    /** A river delta at the map's edge throws in FreeCol's River.delta; another map is drawn instead (#452). */
    @Test
    void aMapThatThrowsIsDrawnAgainAndOnlyTheLastFailureIsReported() {
        Failures.reportTo((what, detail) -> reports.add(what + "\n" + detail));
        int[] calls = {0};
        MapGenerator onceBroken = new MapGenerator() {
            public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
                return null;
            }
            public Map generateMap(Game game, Map importMap, boolean units, LogBuilder lb) {
                if (++calls[0] == 1) breakInTheRivers();
                return null;
            }
        };
        new ReportingMapGenerator(onceBroken).generateMap(null, null, true, null);
        assertEquals(2, calls[0]);
        assertEquals(0, reports.size(), "a map made on the second attempt reports nothing to the player");

        calls[0] = 0;
        MapGenerator alwaysBroken = new MapGenerator() {
            public Map generateEmptyMap(Game game, int width, int height, LogBuilder lb) {
                return null;
            }
            public Map generateMap(Game game, Map importMap, boolean units, LogBuilder lb) {
                calls[0]++;
                breakInTheRivers();
                return null;
            }
        };
        assertThrows(NullPointerException.class,
            () -> new ReportingMapGenerator(alwaysBroken).generateMap(null, null, true, null));
        assertEquals(ReportingMapGenerator.ATTEMPTS, calls[0]);
        assertEquals(1, reports.size());
    }
}
