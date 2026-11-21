package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;


/**
 * Every map the start screen offers (the .fsm files FreeCol comes with, but Giga Earth, which the start screen
 * leaves out, #459) and the America map start a game and play AI rounds on the square grid (#528).
 */
class MapsPlayTest {

    private static final int ROUNDS = 3;
    private static final String LEFT_OUT = "XL_GigaEarth_Mazim.fsm";

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

    /** The map files by name: America of ours, then FreeCol's. */
    static Stream<String> maps() {
        return Stream.concat(Stream.of("america-1492.txt"), Arrays.stream(new File("data/maps").list())
            .filter(n -> n.endsWith(".fsm") && !n.equals(LEFT_OUT)).sorted());
    }

    private static File file(String name) {
        return name.endsWith(".txt") ? new File(System.getProperty("maps.dir"), name) : new File("data/maps", name);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("maps")
    @Timeout(600)
    void aGameStartsAndPlaysAiRounds(String name) throws Exception {
        final byte[] bytes = Files.readAllBytes(file(name).toPath());
        final CountDownLatch[] finished = { new CountDownLatch(1) };
        final ClientEngine[] client = new ClientEngine[1];
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished[0].countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });
        server.startGame("classic", GamePreset.parse("{ \"seed\": 1 }"), bytes);
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished[0]);
        final Map map = server.getGame().getMap();
        assertTrue(map.getWidth() > 0 && map.getHeight() > 0);
        assertFalse(map.getTileList(t -> t.isLand()).isEmpty(), "the map has land");
        assertNotNull(server.getGame().getPlayerByNationId("model.nation.dutch").getEntryTile(),
            "the Dutch have an entry tile");
        final int turn = client[0].getGame().getTurn().getNumber();
        finished[0] = new CountDownLatch(1);
        client[0].skipTurns(ROUNDS);
        assertTrue(finished[0].await(540, TimeUnit.SECONDS), "play comes back after the AI's rounds");
        assertEquals(turn + ROUNDS, client[0].getGame().getTurn().getNumber());
        assertTrue(FirstTurn.reported().isEmpty(), "no errors: " + FirstTurn.reported());
    }
}
