package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import net.sf.freecol.common.model.Game;


/**
 * The server Engine saves a game as a FreeCol savegame and loads it back
 * (#67).
 */
class SaveGameTest {

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

    /** Play a few AI rounds of a Classic game between the two Engines. */
    private ServerEngine playRounds(int rounds) throws Exception {
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
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {}
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });
        server.startGame("classic");
        assertTrue(client[0].startGame(rounds), "login");
        finished.await();
        return server;
    }

    /** The savegame.xml entry of a savegame, as text. */
    private static String savegameXml(byte[] savegame) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(savegame))) {
            for (ZipEntry e; (e = zis.getNextEntry()) != null;) {
                if ("savegame.xml".equals(e.getName())) {
                    return new String(zis.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new IOException("no savegame.xml");
    }

    /**
     * Without the random states, which every save reseeds, and without
     * whether option groups may be edited, which each load locks more of.
     */
    private static String comparable(String xml) {
        return xml.replaceAll("randomState=\"[0-9A-F]*\"", "randomState=\"\"")
            .replaceAll(" editable=\"(true|false)\"", "");
    }

    @Test
    @Timeout(180)
    void aSavedGameLoadsBackAsTheSameGame() throws Exception {
        ServerEngine played = playRounds(3);
        String before = played.describe();
        byte[] first = played.saveGame();

        ServerEngine loaded = new ServerEngine(xml -> {});
        loaded.loadGame(first);
        assertEquals(before, loaded.describe());
        assertEquals(played.getGame().getMap().getWidth(),
            loaded.getGame().getMap().getWidth());
        // The saved game and the loaded one go on with the same random
        // numbers.
        for (int i = 0; i < 10; i++) {
            assertEquals(played.getServer().getServerRandom().nextInt(),
                loaded.getServer().getServerRandom().nextInt(), "draw " + i);
        }

        // A load sorts the players and clears the current player, so the
        // first save differs from later ones.
        // From then on a save loads and saves again unchanged.
        byte[] second = loaded.saveGame();
        ServerEngine reloaded = new ServerEngine(xml -> {});
        reloaded.loadGame(second);
        byte[] third = reloaded.saveGame();
        String b = comparable(savegameXml(second));
        assertTrue(b.contains("randomState=\"\""), "the save has random states");
        assertEquals(b, comparable(savegameXml(third)),
            "a loaded game saves as it was saved");
    }
}
