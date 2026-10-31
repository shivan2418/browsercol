package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import net.sf.freecol.common.model.Unit;


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

    /** A server Engine and the client Engine logged in to it. */
    private record Session(ServerEngine server, ClientEngine client) {

        /** The id of the client's active unit, or null. */
        String activeUnitId() {
            Unit u = this.client.getClient().getGUI().getActiveUnit();
            return (u == null) ? null : u.getId();
        }
    }

    /**
     * Connect a new client Engine to a server Engine that has a game, and
     * play rounds the way the page does after a start or a load.
     */
    private Session login(ServerEngine server, int rounds) throws Exception {
        return login(server, rounds, null);
    }

    private Session login(ServerEngine server, int rounds, String name) throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        server.setToClient(xml -> toClient.execute(() -> client[0].receive(xml)));
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
        assertTrue(client[0].startGame(rounds, name), "login");
        finished.await();
        return new Session(server, client[0]);
    }

    /** Play a few AI rounds of a Classic game between the two Engines. */
    private Session playRounds(int rounds) throws Exception {
        ServerEngine server = new ServerEngine(xml -> {});
        server.startGame("classic");
        return login(server, rounds);
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
        ServerEngine played = playRounds(3).server();
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

    /**
     * A client logs in to a loaded server as it does to a new one, and
     * play goes on at the saved turn with the saved active unit (#68).
     */
    @Test
    @Timeout(180)
    void aLoadedGameContinuesWithTheSavedTurnAndActiveUnit() throws Exception {
        Session played = playRounds(3);
        // Save a unit the client would not pick by itself: another of
        // the player's, e.g. a colonist aboard the ship.
        String first = played.activeUnitId();
        assertNotNull(first, "the client has an active unit");
        String active = null;
        for (Unit u : played.client().getClient().getMyPlayer().getUnits().toList()) {
            if (!u.getId().equals(first)) active = u.getId();
        }
        assertNotNull(active, "the player has another unit");
        int turn = played.client().getGame().getTurn().getNumber();
        byte[] bytes = played.server().saveGame(active);
        assertTrue(savegameXml(bytes).contains("initialActiveUnitId=\"" + active + "\""),
            "the save names the active unit");
        assertEquals(null, played.server().getGame().getInitialActiveUnitId(),
            "the live game does not keep it");

        ServerEngine loaded = new ServerEngine(xml -> {});
        loaded.loadGame(bytes);
        Session resumed = login(loaded, 0);
        assertEquals(turn, resumed.client().getGame().getTurn().getNumber(), "turn");
        assertEquals(active, resumed.activeUnitId(), "active unit");

        // Without the id in the save the client picks its own.
        ServerEngine unmarked = new ServerEngine(xml -> {});
        unmarked.loadGame(played.server().saveGame(null));
        assertNotEquals(active, login(unmarked, 0).activeUnitId(),
            "a save with no active unit does not name one");
        assertTrue(resumed.client().getClient().currentPlayerIsMyPlayer(), "our turn");
    }

    /**
     * A save from desktop FreeCol names its own player, not the browser's
     * default: the client logs in under the save's owner, and a save made
     * from it names that owner again (#69).
     */
    @Test
    @Timeout(180)
    void aSaveFromAnotherPlayerLoadsAndKeepsItsOwner() throws Exception {
        ServerEngine played = playRounds(1).server();
        for (var p : played.getGame().getLiveEuropeanPlayerList()) {
            if (!p.isAI()) p.setName("emil");
        }
        byte[] bytes = played.saveGame();
        assertTrue(savegameXml(bytes).contains("<savedGame owner=\"emil\""),
            "the save names its human player as owner");

        ServerEngine loaded = new ServerEngine(xml -> {});
        loaded.loadGame(bytes);
        assertEquals("emil", loaded.ownerName());
        Session resumed = login(loaded, 0, loaded.ownerName());
        assertEquals("emil", resumed.client().getClient().getMyPlayer().getName());
        assertTrue(resumed.client().getClient().currentPlayerIsMyPlayer(), "our turn");
        assertTrue(savegameXml(loaded.saveGame()).contains("<savedGame owner=\"emil\""),
            "a save of the loaded game keeps the owner");
    }
}
