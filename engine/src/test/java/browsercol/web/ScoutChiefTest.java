package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * A scout entering a native settlement: Enter speaks with the chief, where
 * Swing's dialog leaves it on Cancel.
 */
class ScoutChiefTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private volatile CountDownLatch finished;
    private final List<String> asked = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    @Test
    @Timeout(240)
    void speakingWithTheChiefIsTheDefault() throws Exception {
        finished = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
                public void updated() { }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + ":" + json);
                    toClient.execute(() -> client.answer(id, null));
                }
            });
        server.startGame("classic", GamePreset.parse("{\"seed\":1,\"options\":{\"model.option.fogOfWar\":false}}"));
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(finished);
        server.debug("{\"action\":\"revealMap\",\"reveal\":true}");

        // A free land tile next to some native settlement.
        Tile spot = null;
        IndianSettlement village = null;
        for (Player p : server.getGame().getLiveNativePlayerList()) {
            for (IndianSettlement is : p.getIndianSettlementList()) {
                for (Tile t : is.getTile().getSurroundingTiles(1, 1)) {
                    if (t.isLand() && !t.hasSettlement() && t.getUnitCount() == 0) {
                        spot = t;
                        village = is;
                        break;
                    }
                }
                if (spot != null) break;
            }
            if (spot != null) break;
        }
        assertNotNull(spot, "a free tile next to a native settlement");
        final int x = spot.getX(), y = spot.getY();
        server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.seasonedScout\",\"role\":\"model.role.scout\",\"x\":"
            + x + ",\"y\":" + y + "}");
        final Tile from = client.getGame().getMap().getTile(x, y);
        eventually("the scout", () -> from.getUnitList().stream()
            .anyMatch(u -> u.getType().getId().equals("model.unit.seasonedScout")));
        final Unit scout = from.getUnitList().stream()
            .filter(u -> u.getType().getId().equals("model.unit.seasonedScout")).findFirst().get();
        final Direction d = from.getDirection(client.getGame().getMap()
            .getTile(village.getTile().getX(), village.getTile().getY()));
        for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != scout; i++) {
            client.getCommands().click(x, y);
        }
        client.getCommands().move(d.toString());

        eventually("the scout's choice (asked: " + asked + ")", () ->
            asked.stream().anyMatch(s -> s.startsWith("choice:") && s.contains("chief")));
        final String json = asked.stream()
            .filter(s -> s.startsWith("choice:") && s.contains("chief")).findFirst().get();
        final Matcher m = Pattern.compile("\\{[^{}]*\\}").matcher(json);
        int defaults = 0;
        while (m.find()) {
            final String item = m.group();
            if (item.contains("\"default\":true")) {
                defaults++;
                assertTrue(item.contains("chief"), "the default is speaking with the chief: " + item);
            }
        }
        assertTrue(defaults == 1, "one default: " + json);
    }
}
