package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Unit;


/**
 * A preset's setup is a scenario: debug requests run once the game has
 * started, so a game can be put in a given state without playing to it.
 */
class ScenarioTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private void start(String presetJson) throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
                public void updated() { }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client.answer(id, null);
                }
            });
        server.startGame("classic", GamePreset.parse(presetJson));
        assertTrue(client.startGame(0), "login");
        assertTrue(finished.await(120, TimeUnit.SECONDS), "our first turn");
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    @Test
    @Timeout(240)
    void aSetupFoundsAColonyAndFillsItWhereverItIs() throws Exception {
        start("{\"seed\":1,\"setup\":["
            + "{\"action\":\"addColony\"},"
            + "{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true},"
            + "{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true},"
            + "{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true},"
            + "{\"action\":\"addBuilding\",\"type\":\"model.building.schoolhouse\"},"
            + "{\"action\":\"addGoods\",\"type\":\"model.goods.tools\",\"amount\":50},"
            + "{\"action\":\"addUnit\",\"type\":\"model.unit.masterCarpenter\"}]}");
        final List<String> answers = server.setup();
        assertEquals(7, answers.size());
        assertTrue(server.setup().isEmpty(), "the setup runs once");

        final Player us = client.getClient().getMyPlayer();
        eventually("the client has the colony", () -> !us.getColonyList().isEmpty());
        final Colony colony = us.getColonyList().get(0);
        final GoodsType tools = client.getGame().getSpecification().getGoodsType("model.goods.tools");
        eventually("its tools", () -> colony.getGoodsCount(tools) >= 50);
        eventually("its school", () -> colony.getBuilding(
            client.getGame().getSpecification().getBuildingType("model.building.schoolhouse")) != null);
        eventually("its master carpenter", () -> colony.getTile().getUnitList().stream()
            .anyMatch(u -> u.getType().getId().equals("model.unit.masterCarpenter")));
        eventually("four colonists", () -> colony.getUnitCount() == 4);
    }

    @Test
    void aBadSetupIsRefusedWithItsReason() {
        final IllegalArgumentException ex = org.junit.jupiter.api.Assertions.assertThrows(
            IllegalArgumentException.class, () -> GamePreset.parse("{\"setup\":3}"));
        assertTrue(ex.getMessage().contains("setup"), ex.getMessage());
    }
}
