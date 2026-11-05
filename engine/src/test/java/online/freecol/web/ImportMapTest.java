package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;


/**
 * The map generator's import file option (#205): the page hands the
 * Engine the bytes of a map or savegame file, and the new game is played
 * on that file's map.
 */
class ImportMapTest {

    private static final String SMALL = "\"options\": { \"model.option.mapWidth\": 40,"
        + " \"model.option.mapHeight\": 60 }";

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @TempDir
    File saves;

    @BeforeEach
    void saveThere() {
        ServerEngine.saveDirectory = saves;
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    /** Start a game, with an imported map or none, and play it to the human's first turn. */
    private ServerEngine play(String json, byte[] importMap) throws Exception {
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
        server.startGame("classic", GamePreset.parse(json), importMap);
        assertTrue(client[0].startGame(0), "login");
        finished.await();
        return server;
    }

    /** The map's size and every tile's type, as text. */
    private static String terrain(Game game) {
        Map map = game.getMap();
        StringBuilder sb = new StringBuilder();
        sb.append(map.getWidth()).append('x').append(map.getHeight()).append('\n');
        for (int y = 0; y < map.getHeight(); y++) {
            for (int x = 0; x < map.getWidth(); x++) {
                Tile t = map.getTile(x, y);
                sb.append(t.getType().getId()).append(' ');
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    @Test
    @Timeout(240)
    void aSavedGamesMapIsTheNewGamesMap() throws Exception {
        ServerEngine first = play("{ \"seed\": 1, " + SMALL + " }", null);
        byte[] save = first.saveGame();

        // Another seed, and another size that the file's map overrules.
        ServerEngine imported = play("{ \"seed\": 2, \"options\": {"
            + " \"model.option.mapWidth\": 50, \"model.option.mapHeight\": 50 } }", save);
        assertEquals(terrain(first.getGame()), terrain(imported.getGame()));

        ServerEngine generated = play("{ \"seed\": 2, " + SMALL + " }", null);
        assertNotEquals(terrain(first.getGame()), terrain(generated.getGame()));
    }

    @Test
    @Timeout(240)
    void theGameShowsTheImportFileAsAFileOption() throws Exception {
        byte[] save = play("{ \"seed\": 1, " + SMALL + " }", null).saveGame();
        String none = OptionsJson.of(play("{ \"seed\": 2, " + SMALL + " }", null)
            .getGame().getMapGeneratorOptions()).toString();
        assertTrue(none.contains("\"id\":\"model.option.importFile\""), none);
        assertTrue(none.contains("\"kind\":\"file\""), none);
        String named = OptionsJson.of(play("{ \"seed\": 3, " + SMALL + " }", save)
            .getGame().getMapGeneratorOptions()).toString();
        assertTrue(named.contains("\"value\":\"import.fsg\""), named);
    }

    @Test
    @Timeout(240)
    void aFileThatIsNoMapFailsWithWhatIsWrong() throws Exception {
        ServerEngine server = new ServerEngine(xml -> { });
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> server.startGame("classic", GamePreset.none(), new byte[] { 1, 2, 3 }));
        assertTrue(ex.getMessage().contains("not a map or a savegame"), ex.getMessage());
    }

    @Test
    @Timeout(240)
    void aGameStartedAfterwardsWithNoFileGeneratesItsMap() throws Exception {
        ServerEngine first = play("{ \"seed\": 1, " + SMALL + " }", null);
        byte[] save = first.saveGame();
        play("{ \"seed\": 2, " + SMALL + " }", save);
        // The import file of the last game is not the next one's.
        ServerEngine next = play("{ \"seed\": 3, " + SMALL + " }", null);
        assertNotEquals(terrain(first.getGame()), terrain(next.getGame()));
    }
}
