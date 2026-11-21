package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;


/**
 * Pins what a fixed seed generates (#525): the tiles' terrain and coast
 * styles, the rivers' magnitudes and style digits, and the resources, as a
 * hash. The refactor that moved the edge and corner neighbours into
 * Direction changed none of them, and the hashes below were taken before it.
 * The square grid (#526) moved every map on purpose, and the hashes were
 * taken again on it: the edge and corner neighbours are other directions, so
 * a seed's coast styles and river digits mean other sides, and the land
 * generator walks other rows. A change that moves one means a map drawn from a seed is no longer the
 * map a saved game was played on, or that its styles no longer match the
 * art.
 */
class FixedSeedMapTest {

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

    /** Every tile's terrain, style, river and resource, and the map's size, as text. */
    private static String describe(Game game) {
        StringBuilder sb = new StringBuilder();
        Map map = game.getMap();
        sb.append(map.getWidth()).append('x').append(map.getHeight()).append('\n');
        for (int y = 0; y < map.getHeight(); y++) {
            for (int x = 0; x < map.getWidth(); x++) {
                Tile t = map.getTile(x, y);
                sb.append(t.getType().getId()).append(':').append(t.getStyle());
                if (t.hasRiver()) {
                    sb.append(":river").append(t.getRiver().getMagnitude())
                        .append('=').append(t.getRiver().getStyle().getString());
                }
                if (t.getResource() != null) sb.append(":").append(t.getResource().getType().getId());
                sb.append(' ');
            }
            sb.append('\n');
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

    private void pins(String json, String expected) throws Exception {
        String text = describe(play(json));
        assertTrue(text.contains(":river"), "the map has rivers, or this pins nothing about them");
        assertEquals(expected, hash(text), "hash of the map");
    }

    @Test
    @Timeout(240)
    void seed1On40x60() throws Exception {
        pins("{ \"seed\": 1, \"options\": { \"model.option.mapWidth\": 40,"
            + " \"model.option.mapHeight\": 60 } }", "72099d670571aea53dbb1455bc5b3355fcee508e5686bafd60ed6874488e7ced");
    }

    @Test
    @Timeout(240)
    void seed7WithVeryManyRiversOn60x80() throws Exception {
        pins("{ \"seed\": 7, \"options\": { \"model.option.mapWidth\": 60,"
            + " \"model.option.mapHeight\": 80, \"model.option.riverNumber\": 40 } }", "834322666f0472be00297ed9946e3310059050b96a47cb8031b780268a0006eb");
    }

    @Test
    @Timeout(240)
    void seed1492OnTheDefaultSize() throws Exception {
        pins("{ \"seed\": 1492 }", "c9a57d5c907cb243757379e9ab4ce2dea5db46d5bedac35e4fe5bf29085872b2");
    }
}
