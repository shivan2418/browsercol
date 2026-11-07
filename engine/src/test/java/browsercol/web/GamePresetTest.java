package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.FreeCol;


/**
 * A preset sets the options, the nation and the seed of a new game, and
 * the same preset gives the same game.
 */
class GamePresetTest {


    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    /** Start a game from a preset, play it to the human's first turn, and return the server's game. */
    private Game play(String json) throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });
        server.startGame("classic", GamePreset.parse(json));
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished);
        return server.getGame();
    }

    /** The map and every player's units, as text. */
    private static String describe(Game game) {
        StringBuilder sb = new StringBuilder();
        Map map = game.getMap();
        sb.append(map.getWidth()).append('x').append(map.getHeight()).append('\n');
        for (int y = 0; y < map.getHeight(); y++) {
            for (int x = 0; x < map.getWidth(); x++) {
                Tile t = map.getTile(x, y);
                sb.append(t.getType().getId());
                if (t.getSettlement() != null) sb.append('@').append(t.getSettlement().getId());
                sb.append(' ');
            }
            sb.append('\n');
        }
        List<Player> players = new ArrayList<>(game.getLivePlayerList());
        players.sort((a, b) -> a.getNationId().compareTo(b.getNationId()));
        for (Player p : players) {
            List<String> units = new ArrayList<>();
            p.getUnits().forEach((Unit u) -> units.add(u.getType().getId() + " "
                + ((u.getTile() != null) ? u.getTile().getX() + "," + u.getTile().getY()
                    : String.valueOf(u.getLocation().getClass().getSimpleName()))));
            Collections.sort(units);
            sb.append(p.getNationId()).append(": ").append(units).append('\n');
        }
        return sb.toString();
    }

    @Test
    @Timeout(180)
    void theSamePresetGivesTheSameMapAndStartingUnits() throws Exception {
        String json = "{ \"nation\": \"model.nation.english\", \"seed\": 1492, \"options\": {"
            + " \"model.option.mapWidth\": 40, \"model.option.mapHeight\": 60 } }";
        Game first = play(json);
        Game second = play(json);
        assertEquals(describe(first), describe(second));
        assertEquals(40, first.getMap().getWidth());
        assertEquals(60, first.getMap().getHeight());
        assertEquals("model.nation.english",
            first.getLivePlayerList().stream().filter(p -> !p.isAI() && p.isEuropean())
                .findFirst().get().getNationId());
    }

    /** The nation the human plays, and the difficulty level the server's game has, after a start from a preset. */
    private static String[] humanAndLevel(Game game) {
        return new String[] {
            game.getLivePlayerList().stream().filter(p -> !p.isAI() && p.isEuropean())
                .findFirst().get().getNationId(),
            game.getSpecification().getDifficultyLevel() };
    }

    @Test
    @Timeout(600)
    void everyClassicNationCanBeChosenOnTheStartScreen() throws Exception {
        for (String nation : new String[] { "dutch", "french", "english", "spanish" }) {
            String id = "model.nation." + nation;
            Game game = play("{ \"nation\": \"" + id + "\", \"options\": {"
                + " \"model.option.mapWidth\": 40, \"model.option.mapHeight\": 60 } }");
            assertEquals(id, humanAndLevel(game)[0]);
        }
    }

    @Test
    @Timeout(300)
    void theChosenDifficultyReachesTheServersGameOptions() throws Exception {
        String small = ", \"options\": { \"model.option.mapWidth\": 40,"
            + " \"model.option.mapHeight\": 60 } }";
        Game easy = play("{ \"difficulty\": \"model.difficulty.veryEasy\"" + small);
        Game hard = play("{ \"difficulty\": \"model.difficulty.veryHard\"" + small);
        assertEquals("model.difficulty.veryEasy", humanAndLevel(easy)[1]);
        assertEquals("model.difficulty.veryHard", humanAndLevel(hard)[1]);
        String price = "model.option.landPriceFactor";
        assertNotEquals(easy.getSpecification().getInteger(price),
            hard.getSpecification().getInteger(price), "an option of the level differs");
    }

    private static final String SMALL_MAP = "\"options\": { \"model.option.mapWidth\": 40,"
        + " \"model.option.mapHeight\": 60 }";

    /** The European players of a game, not the REFs. */
    private static List<Player> europeans(Game game) {
        return game.getLivePlayerList().stream()
            .filter(p -> p.isEuropean() && !p.isREF()).toList();
    }

    private static Player human(Game game) {
        return europeans(game).stream().filter(p -> !p.isAI()).findFirst().get();
    }

    private static boolean hasModifier(Player p, String id) {
        return p.getModifiers(id).findAny().isPresent();
    }

    private static boolean hasUnit(Player p, String type) {
        return p.getUnits().anyMatch(u -> u.getType().getId().equals(type));
    }

    /** Each classic nation's own advantage, as the rules give it. */
    private static final java.util.Map<String, String> CLASSIC_TYPES = java.util.Map.of(
        "model.nation.dutch", "model.nationType.trade",
        "model.nation.english", "model.nationType.immigration",
        "model.nation.french", "model.nationType.cooperation",
        "model.nation.spanish", "model.nationType.conquest");

    @Test
    @Timeout(180)
    void aSelectedAdvantageIsTheHumansAndItsBonusesApply() throws Exception {
        Game game = play("{ \"nation\": \"model.nation.english\", \"seed\": 1,"
            + " \"advantages\": \"SELECTABLE\", \"nationType\": \"model.nationType.trade\", "
            + SMALL_MAP + " }");
        Player english = human(game);
        assertEquals("model.nation.english", english.getNationId());
        assertEquals("model.nationType.trade", english.getNationType().getId());
        assertTrue(hasModifier(english, "model.modifier.tradeBonus"), "trade's bonus");
        assertTrue(hasUnit(english, "model.unit.merchantman"), "trade's ship");
        assertFalse(hasModifier(english, "model.modifier.religiousUnrestBonus"),
            "not England's own immigration bonus");
    }

    @Test
    @Timeout(180)
    void fixedAdvantagesGiveEveryNationItsOwn() throws Exception {
        Game game = play("{ \"nation\": \"model.nation.english\", \"seed\": 1,"
            + " \"advantages\": \"FIXED\", " + SMALL_MAP + " }");
        List<Player> players = europeans(game);
        assertEquals(CLASSIC_TYPES.keySet(),
            players.stream().map(Player::getNationId).collect(java.util.stream.Collectors.toSet()));
        for (Player p : players) {
            assertEquals(CLASSIC_TYPES.get(p.getNationId()), p.getNationType().getId(), p.getNationId());
        }
        assertTrue(hasModifier(human(game), "model.modifier.religiousUnrestBonus"),
            "England's immigration bonus");
        Player dutch = players.stream()
            .filter(p -> p.getNationId().equals("model.nation.dutch")).findFirst().get();
        assertTrue(hasModifier(dutch, "model.modifier.tradeBonus"), "an AI's bonus too");
        assertTrue(hasUnit(dutch, "model.unit.merchantman"), "and its starting unit");
    }

    @Test
    @Timeout(180)
    void noAdvantagesLeaveEveryNationWithoutABonus() throws Exception {
        Game game = play("{ \"nation\": \"model.nation.dutch\", \"seed\": 1,"
            + " \"advantages\": \"NONE\", " + SMALL_MAP + " }");
        for (Player p : europeans(game)) {
            assertEquals("model.nationType.default", p.getNationType().getId(), p.getNationId());
            for (String bonus : new String[] { "model.modifier.tradeBonus",
                    "model.modifier.religiousUnrestBonus", "model.modifier.nativeAlarmModifier",
                    "model.modifier.nativeConvertBonus" }) {
                assertFalse(hasModifier(p, bonus), p.getNationId() + " " + bonus);
            }
        }
        assertFalse(hasUnit(human(game), "model.unit.merchantman"), "the Dutch get no merchantman");
    }

    @Test
    void aNationTypeNeedsSelectableAdvantagesANationAndAKnownType() throws Exception {
        failsWith("{ \"nation\": \"model.nation.dutch\", \"advantages\": \"FIXED\","
            + " \"nationType\": \"model.nationType.trade\" }",
            "\"nationType\" can only be chosen when advantages are SELECTABLE");
        failsWith("{ \"nation\": \"model.nation.dutch\", \"advantages\": \"NONE\","
            + " \"nationType\": \"model.nationType.trade\" }",
            "\"nationType\" can only be chosen when advantages are SELECTABLE");
        failsWith("{ \"nationType\": \"model.nationType.trade\" }",
            "\"nationType\" needs a \"nation\" to give it to");
        failsWith("{ \"nation\": \"model.nation.dutch\", \"nationType\": \"model.nationType.inca\" }",
            "unknown nationType \"model.nationType.inca\"");
        failsWith("{ \"advantages\": \"SOME\" }", "unknown advantages \"SOME\"");
    }

    /**
     * What the start screen's option editor sends: a level, and the
     * options of it the player changed, which are the server's game's.
     */
    @Test
    @Timeout(300)
    void aDifficultyOptionEditedOnTheStartScreenReachesTheServersGame() throws Exception {
        String small = "\"model.option.mapWidth\": 40, \"model.option.mapHeight\": 60";
        Game edited = play("{ \"difficulty\": \"model.difficulty.veryEasy\", \"options\": { " + small
            + ", \"model.option.landPriceFactor\": 123, \"model.option.crossesIncrement\": 7,"
            + " \"model.option.fogOfWar\": false } }");
        Specification spec = edited.getSpecification();
        assertEquals("model.difficulty.veryEasy", spec.getDifficultyLevel());
        assertEquals(123, spec.getInteger("model.option.landPriceFactor"));
        assertEquals(7, spec.getInteger("model.option.crossesIncrement"));
        assertEquals(false, spec.getBoolean("model.option.fogOfWar"));
        Game plain = play("{ \"difficulty\": \"model.difficulty.veryEasy\", \"options\": { " + small + " } }");
        assertNotEquals(123, plain.getSpecification().getInteger("model.option.landPriceFactor"));
    }

    /** What the start screen's map options send: the map size picked is the size generated. */
    @Test
    @Timeout(300)
    void aSmallerAndALargerMapSizeGiveMapsOfThoseSizes() throws Exception {
        Game small = play("{ \"options\": { \"model.option.mapWidth\": 30,"
            + " \"model.option.mapHeight\": 40 } }");
        Game large = play("{ \"options\": { \"model.option.mapWidth\": 100,"
            + " \"model.option.mapHeight\": 120, \"model.option.landMass\": 40 } }");
        assertEquals(30, small.getMap().getWidth());
        assertEquals(40, small.getMap().getHeight());
        assertEquals(100, large.getMap().getWidth());
        assertEquals(120, large.getMap().getHeight());
    }

    @Test
    void theMapGeneratorDefaultsAreFreeColsClassicOnes() throws Exception {
        Messages.loadMessageBundle(java.util.Locale.US);
        FreeColRules.loadRules();
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile("classic"), null, "model.difficulty.medium");
        assertEquals(40, spec.getInteger("model.option.mapWidth"));
        assertEquals(100, spec.getInteger("model.option.mapHeight"));
        assertEquals(25, spec.getInteger("model.option.landMass"));
        assertEquals(15, spec.getInteger("model.option.riverNumber"));
        assertEquals(10, spec.getInteger("model.option.mountainNumber"));
    }

    @Test
    @Timeout(180)
    void anotherSeedGivesAnotherMap()throws Exception {
        Game a = play("{ \"seed\": 1, \"options\": { \"model.option.mapWidth\": 40,"
            + " \"model.option.mapHeight\": 60 } }");
        Game b = play("{ \"seed\": 2, \"options\": { \"model.option.mapWidth\": 40,"
            + " \"model.option.mapHeight\": 60 } }");
        assertNotEquals(describe(a), describe(b));
    }

    private void failsWith(String json, String message) throws Exception {
        ServerEngine server = new ServerEngine(xml -> { });
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> server.startGame("classic", GamePreset.parse(json)));
        assertTrue(ex.getMessage().contains(message), ex.getMessage());
    }

    @Test
    void anUnknownOptionFailsAndNamesIt() throws Exception {
        failsWith("{ \"options\": { \"model.option.mapWidht\": 40 } }",
            "unknown option \"model.option.mapWidht\"");
    }

    @Test
    void aValueTheOptionDoesNotTakeFails() throws Exception {
        failsWith("{ \"options\": { \"model.option.mapWidth\": \"wide\" } }",
            "\"model.option.mapWidth\" takes a whole number");
        failsWith("{ \"options\": { \"model.option.mapWidth\": 1000000 } }",
            "\"model.option.mapWidth\" takes a number from");
        failsWith("{ \"options\": { \"model.option.fogOfWar\": 1 } }",
            "\"model.option.fogOfWar\" takes true or false");
    }

    @Test
    void anUnknownKeyNationDifficultyOrRulesFails() throws Exception {
        failsWith("{ \"mapsize\": 3 }", "unknown key \"mapsize\"");
        failsWith("{ \"nation\": \"model.nation.atlantis\" }", "unknown nation \"model.nation.atlantis\"");
        failsWith("{ \"difficulty\": \"model.difficulty.nightmare\" }",
            "unknown difficulty \"model.difficulty.nightmare\"");
        failsWith("{ \"rules\": \"nethack\" }", "Unknown rules \"nethack\"");
    }

    @Test
    void malformedJsonFailsWithTheCharacter() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> GamePreset.parse("{ \"seed\": 1, }"));
        assertTrue(ex.getMessage().contains("Bad JSON at character"), ex.getMessage());
    }

    @Test
    void theShippedPresetsAreValidForTheirRules() throws Exception {
        Messages.loadMessageBundle(java.util.Locale.US);
        FreeColRules.loadRules();
        List<Path> files;
        try (Stream<Path> s = Files.list(Path.of(System.getProperty("presets.dir")))) {
            files = s.filter(p -> p.toString().endsWith(".json")).sorted().toList();
        }
        assertTrue(files.size() >= 2, "a few presets ship");
        for (Path file : files) {
            GamePreset preset = GamePreset.parse(read(file));
            String rules = (preset.rules != null) ? preset.rules : "classic";
            Specification spec = FreeCol.loadSpecification(
                FreeColRules.getFreeColRulesFile(rules), null, "model.difficulty.medium");
            preset.applyTo(spec);
        }
    }

    @Test
    void aUnitListOptionTakesItsEntriesInOrder() throws Exception {
        Messages.loadMessageBundle(java.util.Locale.US);
        FreeColRules.loadRules();
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile("classic"), null, "model.difficulty.medium");
        GamePreset.parse("{ \"options\": { \"model.option.refSize\": ["
            + "{ \"type\": \"model.unit.kingsRegular\", \"role\": \"model.role.soldier\", \"number\": 7 },"
            + "{ \"type\": \"model.unit.manOWar\", \"role\": \"model.role.default\", \"number\": 2 }] } }")
            .applyTo(spec);
        net.sf.freecol.common.option.UnitListOption refSize = spec.getOption("model.option.refSize",
            net.sf.freecol.common.option.UnitListOption.class);
        List<net.sf.freecol.common.model.AbstractUnit> units = refSize.getOptionValues();
        assertEquals(2, units.size());
        assertEquals("model.unit.kingsRegular", units.get(0).getId());
        assertEquals(7, units.get(0).getNumber());
        assertEquals("model.unit.manOWar", units.get(1).getId());
        String json = OptionsJson.of(spec.getDifficultyOptionGroup("model.difficulty.medium")).toString();
        assertTrue(json.contains("\"kind\":\"units\""), "the editor gets the list");
    }

    @Test
    void everyStartScreenOptionHasADescriptionForItsTooltip() throws Exception {
        Messages.loadMessageBundle(java.util.Locale.US);
        FreeColRules.loadRules();
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile("classic"), null, "model.difficulty.medium");
        for (net.sf.freecol.common.option.OptionGroup g : new net.sf.freecol.common.option.OptionGroup[] {
                spec.getDifficultyOptionGroup("model.difficulty.medium"), spec.getGameOptions(),
                spec.getMapGeneratorOptions() }) {
            String json = OptionsJson.of(g).toString();
            // A group is a box with a caption, not a row with a tooltip: only the options need one.
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"id\":\"([^\"]+)\",\"kind\":\"(\\w+)\"[^{}]*?\"description\":null").matcher(json);
            List<String> bare = new ArrayList<>();
            while (m.find()) if (!m.group(2).equals("group")) bare.add(m.group(1));
            assertEquals(List.of(), bare, g.getId() + ": options with no description");
        }
        assertTrue(OptionsJson.of(spec.getDifficultyOptionGroup("model.difficulty.medium")).toString()
            .contains("Lost City Rumour turns out badly"));
    }

    @Test
    void aUnitListEntryThatDoesNotFitFails() throws Exception {
        failsWith("{ \"options\": { \"model.option.refSize\": [ { \"type\": \"model.unit.nope\","
            + " \"role\": \"model.role.default\", \"number\": 1 } ] } }", "unknown unit type model.unit.nope");
    }

    private static String read(Path p) throws IOException {
        return Files.readString(p);
    }
}
