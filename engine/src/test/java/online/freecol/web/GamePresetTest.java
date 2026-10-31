package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
        finished.await();
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

    @Test
    @Timeout(180)
    void anotherSeedGivesAnotherMap() throws Exception {
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

    private static String read(Path p) throws IOException {
        return Files.readString(p);
    }
}
