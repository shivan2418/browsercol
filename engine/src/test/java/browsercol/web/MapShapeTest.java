package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;


/**
 * The generated map on the default 58x72 shape (#528): about a quarter of it land, the land held off the edges, the
 * poles on the top and bottom rows and a high seas strip down both sides, as on FreeCol's 40x100 half rows. Each
 * seed's map is drawn to build/mapshape/ for a look.
 */
class MapShapeTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private Game play(int seed) throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) { client[0].answer(id, null); }
            });
        server.startGame("classic", GamePreset.parse("{ \"seed\": " + seed + " }"));
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished);
        return server.getGame();
    }

    private static void draw(Map map, int seed) throws Exception {
        final BufferedImage img = new BufferedImage(map.getWidth() * 4, map.getHeight() * 4, BufferedImage.TYPE_INT_RGB);
        for (Tile t : map.getTileList(x -> true)) {
            final String id = t.getType().getId();
            final int c = id.endsWith("highSeas") ? 0x0e2a5a : !t.isLand() ? 0x1c4a8c
                : id.endsWith("arctic") ? 0xf4f4f4 : t.hasRiver() ? 0x3a8fe0 : 0x58a838;
            for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) img.setRGB(t.getX() * 4 + i, t.getY() * 4 + j, c);
        }
        final File dir = new File("../engine/build/mapshape");
        dir.mkdirs();
        ImageIO.write(img, "png", new File(dir, "seed" + seed + ".png"));
    }

    @Test
    @Timeout(600)
    void theDefaultMapHasContinentsPolesAndHighSeas() throws Exception {
        for (int seed : new int[] { 1, 2, 3, 4, 5, 6 }) {
            final Map map = play(seed).getMap();
            assertEquals(58, map.getWidth());
            assertEquals(72, map.getHeight());
            draw(map, seed);
            final long land = map.getTileList(Tile::isLand).size();
            final double share = land / (double)(map.getWidth() * map.getHeight());
            assertTrue(share > 0.2 && share < 0.4, "seed " + seed + ": " + share + " of the map is land");
            // The polar rows and the high seas strips, as the ocean they are.
            for (int x = 0; x < map.getWidth(); x++) {
                assertTrue(map.getTile(x, 0).isLand(), "seed " + seed + ": the north pole at " + x);
                assertTrue(map.getTile(x, map.getHeight() - 1).isLand(), "seed " + seed + ": the south pole at " + x);
            }
            for (int y = 1; y < map.getHeight() - 2; y++) {
                assertTrue(map.getTile(0, y).getType().isHighSeasConnected() && !map.getTile(0, y).isLand(),
                    "seed " + seed + ": sea at the west edge, row " + y);
                assertTrue(!map.getTile(map.getWidth() - 1, y).isLand(),
                    "seed " + seed + ": sea at the east edge, row " + y);
            }
            // Land is held off the sides.
            for (Tile t : map.getTileList(Tile::isLand)) {
                if (t.getY() == 0 || t.getY() >= map.getHeight() - 2) continue;
                assertTrue(t.getX() > 3 && t.getX() < map.getWidth() - 4,
                    "seed " + seed + ": land at " + t.getX() + "," + t.getY() + " is too near a side");
            }
        }
    }
}
