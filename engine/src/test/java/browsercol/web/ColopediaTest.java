package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

    private static Map<String, Object> entry(Map<String, Object> report, String section, String id) {
        return objs(objs(report.get("sections")).stream().filter(s -> section.equals(s.get("id")))
            .findFirst().get().get("entries")).stream().filter(e -> id.equals(e.get("id")))
            .findFirst().orElseThrow(() -> new AssertionError("no entry " + id));
    }

    private static Map<String, Object> fact(Map<String, Object> entry, String label) {
        return objs(entry.get("facts")).stream().filter(f -> label.equals(f.get("label")))
            .findFirst().orElseThrow(() -> new AssertionError("no fact " + label + " in " + entry.get("id")));
    }

    private static List<String> refs(Map<String, Object> fact) {
        return objs(fact.get("refs")).stream().map(r -> r.get("name") + " " + r.get("note"))
            .collect(Collectors.toList());
    }

    /** No entry shows a message key, a %placeholder% or unresolved {{tag}} markup, as a name, text or fact. */
    @Test
    void noEntryShowsAMessageKeyOrMarkupUnderEitherRules() throws Exception {
        for (String rules : List.of("classic", "freecol")) {
            final Map<String, Object> report = obj(JsonReader.read(Colopedia.before(rules, null)));
            for (Map<String, Object> section : objs(report.get("sections"))) {
                for (Map<String, Object> e : objs(section.get("entries"))) {
                    final List<String> shown = new java.util.ArrayList<>();
                    shown.add((String)e.get("name"));
                    shown.add((String)e.get("text"));
                    for (Map<String, Object> f : objs(e.get("facts"))) {
                        shown.add((String)f.get("label"));
                        shown.add((String)f.get("value"));
                        refs(f).forEach(shown::add);
                    }
                    for (String s : shown) {
                        final String where = rules + " " + e.get("id") + ": " + s;
                        assertFalse(s.matches("(?s).*\\b(model|colopedia)\\.[a-zA-Z]+\\.[a-zA-Z.]+.*")
                            && !s.contains("[["), where);
                        assertFalse(s.contains("%") && s.matches("(?s).*%[a-zA-Z]+%.*"), where);
                        assertFalse(s.contains("{{"), where);
                    }
                }
            }
        }
    }

    @Test
    void aNationTypeShowsItsAbilitiesAndModifiersAsSwingDoes() throws Exception {
        for (String rules : List.of("classic", "freecol")) {
            final Map<String, Object> report = obj(JsonReader.read(Colopedia.before(rules, null)));
            final List<String> ids = objs(objs(report.get("sections")).stream()
                .filter(s -> "nationTypes".equals(s.get("id"))).findFirst().get().get("entries")).stream()
                .map(e -> (String)e.get("id")).collect(Collectors.toList());
            assertFalse(ids.contains("model.nationType.optionOnly"), "the options' own type is not listed");
            assertTrue(ids.contains("model.nationType.ref"), "the Royal Expeditionary Force is");
            // A bonus that is not a production one is a line of text with its value.
            final Map<String, Object> trade = entry(report, "nationTypes", "model.nationType.trade");
            assertEquals("Trade", trade.get("name"));
            assertEquals("", trade.get("text"), "Swing shows no description for it");
            assertEquals("Trade Bonus: -50.00%", fact(trade, "Modifiers").get("value"));
            assertTrue(((String)fact(trade, "Abilities").get("value")).contains("Recruit units"));
            // A production bonus links to its goods, with the value.
            assertEquals(List.of("Hammers +2.00", "Lumber +2.00"),
                refs(fact(entry(report, "nationTypes", "model.nationType.building"), "Modifiers")));
            assertEquals(List.of("Grain +2.00"),
                refs(fact(entry(report, "nationTypes", "model.nationType.agriculture"), "Modifiers")));
            assertEquals("Movement Bonus (Naval unit): +3.00",
                fact(entry(report, "nationTypes", "model.nationType.naval"), "Modifiers").get("value"));
            assertEquals("Native Convert Bonus: +200.00%; Offence against (natives): +50.00%",
                fact(entry(report, "nationTypes", "model.nationType.conquest"), "Modifiers").get("value"));
            // The first starting unit and the ship.
            assertEquals(List.of("Free Colonist 1", "Veteran Soldier 1", "Caravel 1"),
                refs(fact(entry(report, "nationTypes", "model.nationType.conquest"), "Starting units:")));
        }
    }

    @Test
    void aNativeNationTypeShowsItsAggressionSettlementsAndRegions() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("classic", null)));
        final Map<String, Object> inca = entry(report, "nationTypes", "model.nationType.inca");
        assertEquals("The Inca nation", inca.get("text"));
        assertEquals("Low", fact(inca, "Aggression:").get("value"));
        assertEquals("Low", fact(inca, "Number of Settlements:").get("value"));
        assertEquals("Inca City", fact(inca, "Type of Settlements:").get("value"));
        assertEquals("South West", fact(inca, "Settled Regions:").get("value"));
        assertTrue(refs(fact(inca, "Skills taught:")).contains("Expert Silver Miner null"));
    }

    @Test
    void aNationShowsNoMessageKeyAsItsDescriptionAndItsCurrentAdvantage() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("classic", null)));
        final Map<String, Object> dutch = entry(report, "nations", "model.nation.dutch");
        assertEquals("", dutch.get("text"));
        assertEquals(List.of("Trade null"), refs(fact(dutch, "Default advantage:")));
        assertEquals(List.of("Trade null"), refs(fact(dutch, "Current advantage:")));
    }

    @Test
    void aResourceBonusNamesTheScopeItIsFor() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("classic", null)));
        final List<String> bonus = refs(fact(entry(report, "resources", "model.resource.game"), "Bonus Production"));
        assertTrue(bonus.contains("Furs +2.00"), bonus.toString());
        assertTrue(bonus.contains("Grain +2.00 (Expert Farmer)"), bonus.toString());
    }

    @Test
    void aUnitShowsTheNativesThatTeachItsSkillAndItsProductionBonus() throws Exception {
        final Map<String, Object> report = obj(JsonReader.read(Colopedia.before("classic", null)));
        final Map<String, Object> farmer = entry(report, "units", "model.unit.expertFarmer");
        assertTrue(refs(fact(farmer, "Natives to learn from:")).contains("Apache null"));
        assertEquals(List.of("Grain +2.00"), refs(fact(farmer, "Production modifier:")));
        // No unit is said to teach in another unit.
        for (Map<String, Object> u : objs(objs(report.get("sections")).stream()
                .filter(s -> "units".equals(s.get("id"))).findFirst().get().get("entries"))) {
            for (Map<String, Object> f : objs(u.get("facts"))) {
                if ("May teach in:".equals(f.get("label"))) {
                    assertTrue(refs(f).stream().allMatch(r -> r.matches("(Schoolhouse|College|University) null")),
                        u.get("id") + " " + refs(f));
                }
            }
        }
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
