package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.i18n.NameCache;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Unit;


/**
 * FreeCol's NameCache keeps each player's capital, settlement and ship
 * names in static maps keyed by Player. It used to hold every game's
 * players for good, about 17 MB a game (#541, found in #439). These tests
 * pin that a finished game's players can be collected, and that the names
 * a fixed seed gets are as they were before the maps held their keys weakly,
 * also in a game loaded from a save.
 */
class NameCacheTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    /** Start a game from a preset, play it to the human's first turn, and return the server's Engine. */
    private ServerEngine play(String json) throws Exception {
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
        return server;
    }

    private static final String SEED_1 = "{ \"seed\": 1 }";

    /**
     * Each player's settlements, ships and capital, then the next
     * settlement and ship name the cache would hand out. Asking
     * changes the cache, so call it once per game.
     */
    private static String names(Game game) {
        StringBuilder sb = new StringBuilder();
        List<Player> players = game.getPlayers(p -> true).collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        players.sort(Comparator.comparing(Player::getId));
        for (Player p : players) {
            sb.append(p.getId()).append('\n');
            List<Settlement> settlements = new ArrayList<>(p.getSettlementList());
            settlements.sort(Comparator.comparing(Settlement::getId));
            for (Settlement s : settlements) sb.append("  settlement ").append(s.getName()).append('\n');
            List<Unit> units = new ArrayList<>(p.getUnits().toList());
            units.sort(Comparator.comparing(Unit::getId));
            for (Unit u : units) if (u.getName() != null) sb.append("  unit ").append(u.getName()).append('\n');
            sb.append("  capital ").append(NameCache.getCapitalName(p, null)).append('\n');
            sb.append("  next settlement ").append(NameCache.getSettlementName(p, null)).append('\n');
            sb.append("  next ship ").append(NameCache.getUnitName(p,
                game.getSpecification().getUnitType("model.unit.caravel"), null)).append('\n');
        }
        return sb.toString();
    }

    private static String hash(String text) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
            .digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Make a game, use its names, and return only weak references to its players. */
    private List<WeakReference<Player>> aGameThenForgetIt(String json) throws Exception {
        ServerEngine se = play(json);
        Game game = se.getGame();
        assertTrue(names(game).contains("capital "), "the game used the cache");
        List<WeakReference<Player>> refs = new ArrayList<>();
        for (Player p : game.getPlayers(q -> true).toList()) refs.add(new WeakReference<>(p));
        // A running server thread holds its game for good (StopServers does it after a test).
        se.getServer().shutdown();
        return refs;
    }

    @Test
    @Timeout(240)
    void aFinishedGamesPlayersAreNoLongerReachableFromTheCache() throws Exception {
        List<WeakReference<Player>> refs = aGameThenForgetIt(SEED_1);
        // The next game is what used to find the old one still there.
        aGameThenForgetIt("{ \"seed\": 2 }");
        boolean gone = false;
        for (int i = 0; i < 50 && !gone; i++) {
            System.gc();
            Thread.sleep(100);
            gone = refs.stream().allMatch(r -> r.get() == null);
        }
        assertTrue(gone, "the first game's players are still reachable");
    }

    @Test
    @Timeout(240)
    void namesForAFixedSeedAreAsBefore() throws Exception {
        assertEquals("1059a2ab20cac0889df4d45bf57c588568e8d7d65cd20adc8bf0229b07fab61b", hash(names(play(SEED_1).getGame())));
    }

    @Test
    @Timeout(240)
    void namesAfterASaveAndLoadAreAsBefore() throws Exception {
        ServerEngine played = play(SEED_1);
        ServerEngine loaded = new ServerEngine(xml -> {});
        loaded.loadGame(played.saveGame());
        assertEquals("e71d40a07d048609eb5414b2bb562f17718e9a6428ed49ab69c390f7a851b33b", hash(names(loaded.getGame())));
    }
}
