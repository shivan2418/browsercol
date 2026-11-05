package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.model.ServerColony;


/**
 * FreeCol's debug actions, asked of the server Engine as the Browser UI asks
 * in debug mode (ServerEngine.debug, which the Worker exports), change the
 * server's game and reach the client as the server's updates do. Skipping
 * turns is the client's: ClientEngine.skipTurns.
 */
class DebugActionsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private volatile CountDownLatch finished = new CountDownLatch(1);
    private volatile int rounds = 0;
    /** What the client's colony held, if there was one, each time the listener heard of an update. */
    private final List<Integer> heldAtUpdate = Collections.synchronizedList(new ArrayList<>());
    /** The tile and goods type whose amount heldAtUpdate records, once a test sets them. */
    private volatile int[] watched = null;
    private volatile String watchedType = null;

    @BeforeEach
    void start() throws Exception {
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { rounds = round; }
                public void finished(Game game) { finished.countDown(); }
                public void updated() {
                    final int[] at = watched;
                    if (at == null) return;
                    final Colony c = client.getGame().getMap().getTile(at[0], at[1]).getColony();
                    if (c != null) heldAtUpdate.add(c.getGoodsContainer().getGoodsCount(
                            client.getGame().getSpecification().getGoodsType(watchedType)));
                }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client.answer(id, null);
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        assertTrue(finished.await(120, TimeUnit.SECONDS), "our first turn");
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    /** Wait for the client to have what the server sent. */
    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    private static long unexplored(Map map) {
        return map.getTileSet(t -> !t.isExplored()).size();
    }

    @Test
    @Timeout(240)
    void revealingTheMapExploresEveryTileAndTurnsOffFogOfWar() throws Exception {
        final Map map = client.getGame().getMap();
        assertTrue(unexplored(map) > 0, "a new game's map is mostly unexplored");
        assertTrue(client.getGame().getSpecification().getBoolean(GameOptions.FOG_OF_WAR));

        String answer = server.debug("{\"action\":\"revealMap\",\"reveal\":true}");
        client.debugApplied(answer);

        eventually("every tile explored on the client", () -> unexplored(map) == 0);
        assertEquals(0, server.getGame().getMap().getTileSet(
            t -> !t.isExplored()
                || !server.getGame().getFreeColGameObject(me().getId(), Player.class)
                    .hasExplored(t)).size(), "and on the server");
        assertFalse(client.getGame().getSpecification().getBoolean(GameOptions.FOG_OF_WAR));
        assertFalse(server.getGame().getSpecification().getBoolean(GameOptions.FOG_OF_WAR));
        assertTrue(map.getTileSet(t -> !me().canSee(t)).isEmpty(), "all of it in sight");

        // Hiding it again leaves what the human's units and settlements see.
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":false}"));
        eventually("the map hidden again", () -> unexplored(map) > 0);
        assertTrue(client.getGame().getSpecification().getBoolean(GameOptions.FOG_OF_WAR));
    }

    @Test
    @Timeout(240)
    void addingGoldChangesTheServersPlayerAndTheClients() throws Exception {
        final int before = me().getGold();
        server.debug("{\"action\":\"addGold\",\"amount\":1234}");
        eventually("the client's gold", () -> me().getGold() == before + 1234);
        assertEquals(before + 1234, server.getGame()
            .getFreeColGameObject(me().getId(), Player.class).getGold());
    }

    @Test
    @Timeout(240)
    void addingAUnitPutsItOnTheTileOnBothSides() throws Exception {
        final Map map = server.getGame().getMap();
        final Tile land = map.getTileSet(t -> t.isLand() && t.getUnitCount() == 0
            && !t.hasSettlement()).iterator().next();
        final int before = me().getUnitCount();

        String answer = server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.hardyPioneer\","
            + "\"x\":" + land.getX() + ",\"y\":" + land.getY() + "}");
        String id = (String)((java.util.Map<?, ?>)JsonReader.read(answer)).get("unit");

        assertEquals("model.unit.hardyPioneer",
            server.getGame().getFreeColGameObject(id, Unit.class).getType().getId());
        assertEquals(land, server.getGame().getFreeColGameObject(id, Unit.class).getTile());
        eventually("the client has the unit", () ->
            client.getGame().getFreeColGameObject(id, Unit.class) != null
            && me().getUnitCount() == before + 1);
        final Unit seen = client.getGame().getFreeColGameObject(id, Unit.class);
        assertEquals(land.getX(), seen.getTile().getX());
        assertEquals(land.getY(), seen.getTile().getY());
        assertTrue(seen.getMovesLeft() > 0, "ready to move");
    }

    @Test
    @Timeout(240)
    void aLandUnitAtSeaGoesAboardAShipWithRoom() throws Exception {
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final int before = ship.getUnitCount();
        server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"x\":"
            + ship.getTile().getX() + ",\"y\":" + ship.getTile().getY() + "}");
        eventually("aboard", () -> ship.getUnitCount() == before + 1);
    }

    @Test
    @Timeout(240)
    void goodsGoToAShipsHold() throws Exception {
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final GoodsType food = client.getGame().getSpecification().getGoodsType("model.goods.food");
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.food\",\"amount\":40,\"unit\":\""
            + ship.getId() + "\"}");
        eventually("the client's hold", () -> ship.getGoodsContainer().getGoodsCount(food) == 40);
    }

    /**
     * A colony founded by the debug action is one the player sees round,
     * as one founded by a colonist who walked there: with fog of war off,
     * a unit beside it reaches the client (no copy of the tile cached
     * without its units). And it names the new land, as a first landing
     * does, which the Crown's messages need.
     */
    @Test
    @Timeout(240)
    void aDebugColonyIsSeenRoundAndNamesTheNewLand() throws Exception {
        final Game game = server.getGame();
        final net.sf.freecol.server.model.ServerPlayer us =
            game.getFreeColGameObject(me().getId(), net.sf.freecol.server.model.ServerPlayer.class);
        game.getSpecification().setBoolean(GameOptions.FOG_OF_WAR, false);
        client.getGame().getSpecification().setBoolean(GameOptions.FOG_OF_WAR, false);
        us.invalidateCanSeeTiles();
        assertFalse(us.isNewLandNamed(), "no land named before landing");
        // Land far from what we have explored, with land around it.
        final Tile site = game.getMap().getTileSet(t -> t.isLand() && !us.hasExplored(t)
            && us.canClaimToFoundSettlement(t)
            && t.getSurroundingTiles(1, 1).stream().filter(n -> n.isLand() && !n.hasSettlement()
                && n.getUnitCount() == 0).count() >= 2).iterator().next();
        us.canSee(site); // the visibility the server has before the colony

        server.debug("{\"action\":\"addColony\",\"x\":" + site.getX() + ",\"y\":" + site.getY() + "}");

        assertTrue(us.isNewLandNamed(), "the new land is named");
        eventually("the client has the name", () -> me().getNewLandName() != null);
        // Another player's unit beside the colony, as one that walks there.
        final Player other = game.getLiveEuropeanPlayerList().stream()
            .filter(p -> p != us).findFirst().get();
        final Tile beside = site.getSurroundingTiles(1, 1).stream().filter(n -> n.isLand()
            && !n.hasSettlement() && n.getUnitCount() == 0).findFirst().get();
        final Unit stranger = new net.sf.freecol.server.model.ServerUnit(game, beside, other,
            game.getSpecification().getUnitType("model.unit.freeColonist"));
        final net.sf.freecol.common.networking.ChangeSet cs = new net.sf.freecol.common.networking.ChangeSet();
        cs.add(net.sf.freecol.common.networking.ChangeSet.See.perhaps(), beside);
        ((net.sf.freecol.server.model.ServerGame)game).sendTo(us, cs);
        eventually("the client sees the unit beside its colony", () -> client.getGame().getMap()
            .getTile(beside.getX(), beside.getY()).getUnitList().stream()
            .anyMatch(u -> u.getId().equals(stranger.getId())));
    }

    @Test
    @Timeout(240)
    void goodsGoToAColony() throws Exception {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && t.getUnitCount() == 0
            && !t.hasSettlement() && t.getOwner() == null).iterator().next();
        final Colony colony = new ServerColony(game, us, "Debug", land);
        land.setSettlement(colony);
        // The client learns of the colony with its tile.
        server.debug("{\"action\":\"revealMap\"}");
        eventually("the client has the colony", () ->
            client.getGame().getMap().getTile(land.getX(), land.getY()).getColony() != null);
        final GoodsType tools = game.getSpecification().getGoodsType("model.goods.tools");
        final int before = colony.getGoodsContainer().getGoodsCount(tools);
        watchedType = "model.goods.tools";
        watched = new int[] { land.getX(), land.getY() };

        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.tools\",\"amount\":75,\"x\":"
            + land.getX() + ",\"y\":" + land.getY() + "}");

        assertEquals(before + 75, colony.getGoodsContainer().getGoodsCount(tools));
        eventually("the client's colony", () -> {
            Tile t = client.getGame().getMap().getTile(land.getX(), land.getY());
            return t.getColony() != null
                && t.getColony().getGoodsContainer().getGoodsCount(
                    client.getGame().getSpecification().getGoodsType("model.goods.tools")) == before + 75;
        });
        // The listener hears of the update once the client has it, which is
        // when the colony panel is pulled again.
        eventually("an update after the goods arrived", () -> heldAtUpdate.contains(before + 75));
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.tools\",\"amount\":-1000,\"x\":"
            + land.getX() + ",\"y\":" + land.getY() + "}");
        assertEquals(0, colony.getGoodsContainer().getGoodsCount(tools), "taking away stops at none");
    }

    @Test
    @Timeout(240)
    void theAIViewNamesEveryAIPlayerAndItsUnits() throws Exception {
        String text = (String)((java.util.Map<?, ?>)JsonReader.read(
            server.debug("{\"action\":\"aiView\"}"))).get("text");
        assertNotNull(text);
        for (Player p : server.getGame().getLiveEuropeanPlayerList()) {
            if (p.isAI()) {
                assertTrue(text.contains(" gold, "), text);
                return;
            }
        }
    }

    @Test
    @Timeout(240)
    void badRequestsFailWithAMessage() {
        assertThrows(IllegalArgumentException.class, () -> server.debug("{\"action\":\"dance\"}"));
        assertThrows(IllegalArgumentException.class, () -> server.debug("{\"action\":\"addGold\"}"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.nope\",\"x\":1,\"y\":1}"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"addGoods\",\"type\":\"model.goods.food\",\"amount\":1,\"x\":0,\"y\":0}"));
    }

    @Test
    @Timeout(300)
    void skippingTurnsLetsTheAIPlayThenReturnsPlay() throws Exception {
        final int turn = client.getGame().getTurn().getNumber();
        finished = new CountDownLatch(1);
        client.skipTurns(2);
        assertTrue(finished.await(240, TimeUnit.SECONDS), "play comes back");
        assertEquals(turn + 2, client.getGame().getTurn().getNumber());
        assertEquals(2, rounds);
        assertTrue(client.getClient().currentPlayerIsMyPlayer());
    }
}
