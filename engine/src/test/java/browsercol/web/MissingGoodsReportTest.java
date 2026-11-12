package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;

/**
 * A colony short of tools for its current build is told so in the turn
 * report, as FreeCol's ServerColony.csNewTurnWarnings says it: the
 * MISSING_GOODS message "model.colony.buildableNeedsGoods" when the build
 * is about to fail (hammers done or one turn off, tools not coming), and
 * not while the hammers are still a few turns away (#484).
 */
class MissingGoodsReportTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    /** The messages events the fake Browser UI was shown, as their JSON. */
    private final List<String> messageEvents = new CopyOnWriteArrayList<>();

    @BeforeEach
    void start() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    if (kind.equals("messages")) messageEvents.add(json);
                }
                public void ask(int id, String kind, String json) {
                    ui.execute(() -> client.answer(id,
                        kind.equals("confirm") ? String.valueOf(!json.contains("Europe"))
                        : kind.equals("endTurn") ? "ok" : null));
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(ourTurn);
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
        server = null;
        client = null;
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private void endTurnAndWait() throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final Commands commands = client.getCommands();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(commands.endTurn(), "end turn");
        final long start = System.currentTimeMillis();
        long pressed = start;
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            Thread.sleep(20);
            final long now = System.currentTimeMillis();
            assertTrue(now - start < 120_000, "the turn ended within 120 s");
            if (now - pressed > 2_000) {
                commands.endTurn();
                pressed = now;
            }
        }
    }

    /** A colony with the buildable current, the hammers it holds, and no tools. */
    private Colony colonyBuilding(String buildableId, int hammers) {
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final String answer = server.debug("{\"action\":\"addColony\"}");
        final String id = (String)((java.util.Map<?, ?>)JsonReader.read(answer)).get("colony");
        final Colony colony = game.getFreeColGameObject(id, Colony.class);
        final BuildableType build = spec.getBuildableType(buildableId);
        colony.getBuildQueue().clear();
        colony.setCurrentlyBuilding(build);
        final GoodsType hammersType = spec.getGoodsType("model.goods.hammers");
        final GoodsType tools = spec.getGoodsType("model.goods.tools");
        colony.getGoodsContainer().setAmount(hammersType, hammers);
        colony.getGoodsContainer().setAmount(tools, 0);
        colony.invalidateCache();
        return colony;
    }

    private boolean reportMentionsMissingTools() {
        return messageEvents.stream().anyMatch(j -> j.contains("are missing to build"));
    }

    @Test
    @Timeout(300)
    void aColonyWithTheHammersButNotTheToolsIsToldWhatItMisses() throws Exception {
        final Colony colony = colonyBuilding("model.building.weaverShop", 1000);
        assertEquals(-1, colony.getTurnsToComplete(colony.getCurrentlyBuilding(), null),
            "the build is blocked by the tools: " + colony.getCurrentlyBuilding());
        endTurnAndWait();
        eventually("the turn report says the tools are missing: " + messageEvents,
                   this::reportMentionsMissingTools);
    }

    /**
     * FreeCol itself stays quiet while the hammers are two or more turns
     * off, or none are coming: it only warns once the build is about to
     * fail (ServerColony.csNewTurnWarnings), so BrowserCol has no message
     * to show then.
     */
    @Test
    @Timeout(300)
    void aColonyStillFarFromTheHammersIsNotWarned() throws Exception {
        final Colony colony = colonyBuilding("model.building.weaverShop", 0);
        final int turns = colony.getTurnsToComplete(colony.getCurrentlyBuilding(), null);
        assertTrue(turns != -1 && turns != -2, "FreeCol would not warn: " + turns);
        endTurnAndWait();
        assertTrue(!reportMentionsMissingTools(), "no warning: " + messageEvents);
    }
}
