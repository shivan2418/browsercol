package browsercol.web;

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
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Unit;

/**
 * A building with a worker and too little raw material is told of in the
 * turn report, as ServerBuilding.csCheckMissingInput says it: noInput when
 * nothing is produced, notEnoughInput for a partial deficit (#491).
 */
class MissingInputReportTest {

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

    /**
     * A colony whose blacksmith's house has one colonist and no ore in
     * store, and with a miner on a hills tile when {@code mined}: the miner's
     * ore is less than the smith can use. (FreeCol warns after the turn's
     * goods are moved, so a stock of ore that the smith uses up is gone by
     * then, and a partial shortage needs a supply each turn.)
     */
    private void colonyWithSmith(boolean mined) {
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final String answer = server.debug("{\"action\":\"addColony\"}");
        final String id = (String)((java.util.Map<?, ?>)JsonReader.read(answer)).get("colony");
        final Colony colony = game.getFreeColGameObject(id, Colony.class);
        final BuildingType type = spec.getBuildingType("model.building.blacksmithHouse");
        final Building smith = new net.sf.freecol.server.model.ServerBuilding(game, colony, type);
        colony.addBuilding(smith);
        final Unit worker = colony.getUnitList().get(0);
        worker.setLocation(smith);
        smith.updateProductionType();
        final GoodsType ore = spec.getGoodsType("model.goods.ore");
        if (mined) {
            final ColonyTile ct = colony.getColonyTiles().stream()
                .filter(c -> c.isAvailable() && !c.isColonyCenterTile())
                .findFirst().orElseThrow();
            // Two smiths want 6 ore; the miner brings 4.
            new net.sf.freecol.server.model.ServerUnit(game, smith,
                colony.getOwner(), spec.getUnitType("model.unit.freeColonist"));
            smith.updateProductionType();
            ct.getWorkTile().changeType(spec.getTileType("model.tile.hills"));
            // A mineral resource would bring more ore than the smiths use.
            final net.sf.freecol.common.model.TileItemContainer items =
                ct.getWorkTile().getTileItemContainer();
            if (items != null && items.getResource() != null) {
                items.removeTileItem(items.getResource());
            }
            final Unit miner = new net.sf.freecol.server.model.ServerUnit(game, ct,
                colony.getOwner(), spec.getUnitType("model.unit.freeColonist"));
            miner.setWorkType(ore);
            ct.updateProductionType();
        }
        colony.getGoodsContainer().setAmount(spec.getGoodsType("model.goods.food"), 200);
        colony.getGoodsContainer().setAmount(ore, 0);
        colony.getGoodsContainer().setAmount(spec.getGoodsType("model.goods.tools"), 0);
        colony.invalidateCache();
    }

    private boolean reportHas(String text) {
        return messageEvents.stream().anyMatch(j -> j.contains(text));
    }

    @Test
    @Timeout(300)
    void aSmithWithNoOreIsToldProductionStopped() throws Exception {
        colonyWithSmith(false);
        endTurnAndWait();
        eventually("the report says production stopped for lack of Ore: " + messageEvents,
                   () -> reportHas("has stopped production because of missing Ore"));
    }

    @Test
    @Timeout(300)
    void aSmithWithTooLittleOreIsToldHowMuchIsMissing() throws Exception {
        colonyWithSmith(true);
        endTurnAndWait();
        eventually("the report says how much Ore is missing: " + messageEvents,
                   () -> reportHas("because of a shortage of"));
    }
}
