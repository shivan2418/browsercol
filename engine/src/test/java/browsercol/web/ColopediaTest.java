package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.jupiter.api.Test;

class ColopediaTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) {
        return (Map<String, Object>)o;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> objs(Object o) {
        return (List<Map<String, Object>>)o;
    }

    @Test
    void theColopediaBeforeAGameHasTheNationsAndNationTypesFromTheRulesAlone() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("classic", "nations")));
        assertEquals("colopedia", report.get("report"));
        assertEquals("nations", report.get("select"));
        final Map<String, List<String>> entries = objs(report.get("sections")).stream()
            .collect(Collectors.toMap(s -> (String)s.get("id"),
                s -> objs(s.get("entries")).stream().map(e -> (String)e.get("id")).collect(Collectors.toList())));
        assertTrue(entries.get("nations").contains("model.nation.dutch"));
        assertTrue(entries.get("nations").contains("model.nation.inca"));
        // As Swing's NationDetailPanel: the European and the native nations, not the royal forces or the enemy.
        assertTrue(entries.get("nations").stream().noneMatch(
            id -> id.endsWith("REF") || id.endsWith("unknownEnemy")), "no REF or unknown enemy");
        assertEquals("model.nation.dutch", entries.get("nations").get(0));
        assertTrue(entries.get("nationTypes").contains("model.nationType.trade"));
        // The pages are the ones a game's Colopedia has.
        assertTrue(entries.get("units").contains("model.unit.freeColonist"));
    }

    @Test
    void theRulesDecideTheEntries() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("freecol", null)));
        assertNull(report.get("select"));
        assertTrue(objs(report.get("sections")).stream().anyMatch(s -> "nations".equals(s.get("id"))));
    }

    @Test
    void noSuchRulesGiveNothing() {
        assertNull(Colopedia.before("no-such-rules", null));
    }
}
