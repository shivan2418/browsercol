package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
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

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * A scout that moves into a foreign colony and spies on it (#395): the
 * server sends a copy of the colony, and the client opens its panel.
 */
class SpyColonyTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private volatile CountDownLatch finished;
    private final List<String> shown = new CopyOnWriteArrayList<>();
    private final List<String> asked = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private void start(String presetJson) throws Exception {
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
                public void show(String kind, String json) { shown.add(kind + ":" + json); }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + ":" + json);
                    String answer = null;
                    if (kind.equals("choice")) {
                        // The entry for spying.
                        final Matcher m = Pattern.compile("\\{[^{}]*\\}").matcher(json);
                        for (int i = 0; m.find(); i++) {
                            if (m.group().contains("Spy")) answer = String.valueOf(i);
                        }
                    }
                    final String a = answer;
                    toClient.execute(() -> client.answer(id, a));
                }
            });
        server.startGame("classic", GamePreset.parse(presetJson));
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(finished);
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    @Test
    @Timeout(240)
    void spyingOnAForeignColonyOpensItsPanel() throws Exception {
        start(Files.readString(Path.of(System.getProperty("presets.dir"), "diplomacy.json")));
        server.setup();
        final Player us = client.getClient().getMyPlayer();
        final Player france = client.getGame().getPlayerByNationId("model.nation.french");
        eventually("the client has the French colony and our scout", () ->
            !france.getColonyList().isEmpty()
            && us.getUnits().anyMatch(u -> u.getType().getId().equals("model.unit.seasonedScout")));
        final Colony french = france.getColonyList().get(0);
        final Unit scout = us.getUnits().filter(u -> u.getType().getId().equals("model.unit.seasonedScout"))
            .findFirst().get();
        final Tile from = scout.getTile();
        final Direction d = from.getDirection(french.getTile());
        assertNotNull(d, "the scout stands next to the colony");

        final Commands commands = client.getCommands();
        for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != scout; i++) {
            commands.click(from.getX(), from.getY());
        }
        commands.move(d.toString());
        eventually("a spied colony panel (asked: " + asked + ")", () ->
            shown.stream().anyMatch(s -> s.startsWith("colony:")));
        final String json = shown.stream().filter(s -> s.startsWith("colony:")).findFirst().get();
        assertTrue(json.contains("\"readOnly\":true"), json);
    }

    /**
     * Every AI colony of a game 60 turns old, spied on by a scout: the colony of a played game has a build
     * queue and units, which the client prices with its owner's market, one it does not hold.
     */
    @Test
    @Timeout(900)
    void spyingOnEveryAiColony() throws Exception {
        start("{\"seed\":2}");
        finished = new CountDownLatch(1);
        client.skipTurns(60);
        assertTrue(finished.await(800, java.util.concurrent.TimeUnit.SECONDS), "turns skipped");
        server.debug("{\"action\":\"revealMap\",\"reveal\":true}");
        final Game sg = server.getGame();
        final String myId = client.getClient().getMyPlayer().getId();
        final List<String[]> todo = new java.util.ArrayList<>();
        for (Player p : sg.getLiveEuropeanPlayerList()) {
            if (p.getId().equals(myId)) continue;
            for (Colony c : p.getColonyList()) {
                for (Tile t : c.getTile().getSurroundingTiles(1, 1)) {
                    if (t.isLand() && !t.hasSettlement() && t.getUnitCount() == 0) {
                        todo.add(new String[] {c.getId(), "" + t.getX(), "" + t.getY(), c.getName() + " pop " + c.getUnitCount()});
                        break;
                    }
                }
            }
        }
        assertTrue(todo.size() >= 3, "AI colonies to spy on: " + todo.size());
        for (String[] w : todo) {
            shown.clear();
            final int bx = Integer.parseInt(w[1]), by = Integer.parseInt(w[2]);
            server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.seasonedScout\",\"role\":\"model.role.scout\",\"x\":" + bx + ",\"y\":" + by + "}");
            eventually("the scout", () -> client.getGame().getMap().getTile(bx, by).getUnitList().stream()
                .anyMatch(u -> u.getType().getId().equals("model.unit.seasonedScout")));
            final Tile from = client.getGame().getMap().getTile(bx, by);
            final Unit scout = from.getUnitList().stream()
                .filter(u -> u.getType().getId().equals("model.unit.seasonedScout")).findFirst().get();
            final Colony col = client.getGame().getFreeColGameObject(w[0], Colony.class);
            final Direction d = from.getDirection(col.getTile());
            for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != scout; i++) {
                client.getCommands().click(from.getX(), from.getY());
            }
            client.getCommands().move(d.toString());
            Thread.sleep(500);
            eventually("a spied panel for " + w[3] + " (asked: " + asked + ")", () ->
                shown.stream().anyMatch(s -> s.startsWith("colony:")));
            assertTrue(shown.stream().filter(s -> s.startsWith("colony:")).findFirst().get()
                .contains("\"readOnly\":true"), "read-only: " + w[3]);
        }
    }
}
