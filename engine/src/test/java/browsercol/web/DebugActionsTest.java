package browsercol.web;

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
import net.sf.freecol.common.model.Stance;
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
    private final List<Integer> heldAtUpdate = new java.util.concurrent.CopyOnWriteArrayList<>();
    /** The tile and goods type whose amount heldAtUpdate records, once a test sets them. */
    private volatile int[] watched = null;
    private volatile String watchedType = null;
    /** What the client's WebGUI showed the Browser UI, as kind:json. */
    private final List<String> shown = new java.util.concurrent.CopyOnWriteArrayList<>();

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
                public void show(String kind, String json) { shown.add(kind + ":" + json); }
                public void ask(int id, String kind, String json) {
                    shown.add("ask:" + kind + ":" + json);
                    client.answer(id, null);
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(finished);
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
    void addingImmigrationChangesTheServersPlayerAndTheClients() throws Exception {
        final int before = me().getImmigration();
        server.debug("{\"action\":\"addImmigration\",\"amount\":77}");
        eventually("the client's crosses", () -> me().getImmigration() == before + 77);
        assertEquals(before + 77, server.getGame()
            .getFreeColGameObject(me().getId(), Player.class).getImmigration());
    }

    @Test
    @Timeout(240)
    void aFoundingFatherCanBeAddedOnce() throws Exception {
        final String father = "model.foundingFather.thomasJefferson";
        final net.sf.freecol.common.model.FoundingFather f =
            server.getGame().getSpecification().getFoundingFather(father);
        server.debug("{\"action\":\"addFoundingFather\",\"father\":\"" + father + "\"}");
        assertTrue(server.getGame().getFreeColGameObject(me().getId(), Player.class).hasFather(f));
        assertThrows(IllegalArgumentException.class,
            () -> server.debug("{\"action\":\"addFoundingFather\",\"father\":\"" + father + "\"}"));
    }

    @Test
    @Timeout(240)
    void dumpingATileAndResettingMovesAnswerForTheTile() throws Exception {
        final Unit unit = me().getUnits().filter(u -> u.getTile() != null && u.getLocation() == u.getTile()).findFirst().get();
        final Tile at = unit.getTile();
        final String text = server.debug("{\"action\":\"dumpTile\",\"x\":" + at.getX()
            + ",\"y\":" + at.getY() + "}");
        assertTrue(text.contains(unit.getId()), text);
        final Unit sUnit = server.getGame().getFreeColGameObject(unit.getId(), Unit.class);
        sUnit.setMovesLeft(0);
        server.debug("{\"action\":\"resetMoves\",\"x\":" + at.getX() + ",\"y\":" + at.getY() + "}");
        assertEquals(sUnit.getInitialMovesLeft(), sUnit.getMovesLeft());
    }

    @Test
    @Timeout(240)
    void tracingWorkTogglesTheColonysOccupationTrace() throws Exception {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && t.getUnitCount() == 0
            && !t.hasSettlement() && t.getOwner() == null).iterator().next();
        final Colony colony = new ServerColony(game, us, "Debug", land);
        land.setSettlement(colony);
        final String at = "\"x\":" + land.getX() + ",\"y\":" + land.getY();
        assertFalse(colony.getOccupationTrace());
        server.debug("{\"action\":\"traceWork\"," + at + "}");
        assertTrue(colony.getOccupationTrace());
        // By the colony's id, as the colony panel's button asks.
        final String answer = server.debug("{\"action\":\"traceWork\",\"colony\":\"" + colony.getId() + "\"}");
        assertFalse(colony.getOccupationTrace());
        assertTrue(answer.contains("\"trace\":false"), answer);
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

    /** A ship in Europe with goods aboard, the goods boycotted: the setup of the dump cargo dialog (#349). */
    @Test
    @Timeout(240)
    void aShipInEuropeCanCarryBoycottedGoods() throws Exception {
        final GoodsType sugar = client.getGame().getSpecification().getGoodsType("model.goods.sugar");
        final String id = (String)json(server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.galleon\",\"inEurope\":true}")).get("unit");
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.sugar\",\"amount\":50,\"europe\":true}");
        server.debug("{\"action\":\"boycott\",\"goods\":\"model.goods.sugar\",\"amount\":300}");

        final Unit ship = server.getGame().getFreeColGameObject(id, Unit.class);
        assertTrue(ship.isInEurope(), "in Europe");
        assertEquals(50, ship.getGoodsContainer().getGoodsCount(sugar));
        assertEquals(300, server.getGame().getFreeColGameObject(me().getId(), Player.class).getArrears(sugar));
        eventually("the client has the ship in Europe, loaded", () -> {
            final Unit seen = client.getGame().getFreeColGameObject(id, Unit.class);
            return seen != null && seen.isInEurope() && seen.getGoodsContainer().getGoodsCount(sugar) == 50;
        });
        eventually("the client's market has the arrears", () -> me().getArrears(sugar) == 300 && !me().canTrade(sugar));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"boycott\",\"goods\":\"model.goods.sugar\",\"amount\":0}"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"boycott\",\"goods\":\"model.goods.nope\"}"));
    }

    /** Natives demand goods of a colony, and the client asks the player (#349). */
    @Test
    @Timeout(240)
    void nativesDemandGoodsOfAColonyAndTheClientAsks() throws Exception {
        server.debug("{\"action\":\"addColony\"}");
        eventually("the client has the colony", () -> !me().getColonyList().isEmpty());
        final String colony = me().getColonyList().get(0).getName();
        final Tile where = me().getColonyList().get(0).getTile();
        final String at = "\"x\":" + where.getX() + ",\"y\":" + where.getY();

        final String answer = server.debug("{\"action\":\"nativeDemand\",\"goods\":\"model.goods.food\",\"amount\":25," + at + "}");
        final String brave = (String)json(answer).get("unit");
        assertTrue(server.getGame().getFreeColGameObject(brave, Unit.class).getOwner().isIndian(), "a native brave");
        eventually("the client asks about the demand", () -> {
            synchronized (shown) {
                return shown.stream().anyMatch(s -> s.startsWith("ask:confirm:") && s.contains(colony)
                    && s.contains("25"));
            }
        });
        server.debug("{\"action\":\"nativeDemand\",\"amount\":10," + at + "}");
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"nativeDemand\",\"goods\":\"model.goods.nope\",\"amount\":10," + at + "}"));
    }

    /** The stance between two players is set both ways, by nation id, and the human is the default. */
    @Test
    @Timeout(240)
    void aStanceIsSetBothWays() throws Exception {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Player other = game.getLiveEuropeanPlayerList(us).get(0);
        server.debug("{\"action\":\"setStance\",\"stance\":\"war\",\"with\":\"" + other.getNationId() + "\"}");
        assertEquals(Stance.WAR, us.getStance(other));
        assertEquals(Stance.WAR, other.getStance(us));
        eventually("the client's stance", () -> me().getStance(client.getGame().getFreeColGameObject(other.getId(), Player.class))
            == Stance.WAR);
        // Between two others, by player id, in any case.
        final Player third = game.getLiveEuropeanPlayerList(us).get(1);
        server.debug("{\"action\":\"setStance\",\"stance\":\"Peace\",\"player\":\"" + other.getId()
            + "\",\"with\":\"" + third.getId() + "\"}");
        assertEquals(Stance.PEACE, other.getStance(third));
        assertEquals(Stance.PEACE, third.getStance(other));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"setStance\",\"stance\":\"nope\",\"with\":\"" + other.getNationId() + "\"}"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"setStance\",\"stance\":\"war\",\"with\":\"" + us.getNationId() + "\"}"));
    }

    /** A unit can be another player's, by nation id, and goods go to the ship on a tile whoever's it is. */
    @Test
    @Timeout(240)
    void anotherPlayersShipCanBeLoadedWithGoods() throws Exception {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Player other = game.getLiveEuropeanPlayerList(us).get(0);
        final Unit ours = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile sea = game.getFreeColGameObject(ours.getId(), Unit.class).getTile();
        final String at = "\"x\":" + sea.getX() + ",\"y\":" + sea.getY();
        final String id = (String)json(server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.galleon\","
            + "\"owner\":\"" + other.getNationId() + "\"," + at + "}")).get("unit");
        final Unit theirs = game.getFreeColGameObject(id, Unit.class);
        assertEquals(other, theirs.getOwner());
        // Both ships are on the tile: the first naval unit gets the goods, so the tile's order is not assumed.
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.sugar\",\"amount\":60,\"onShip\":true," + at + "}");
        final GoodsType sugar = game.getSpecification().getGoodsType("model.goods.sugar");
        final int held = sea.getUnitList().stream().filter(Unit::isNaval)
            .mapToInt(u -> u.getGoodsContainer().getGoodsCount(sugar)).sum();
        assertEquals(60, held);
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.galleon\",\"owner\":\"model.nation.nope\"," + at + "}"));
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

    private static java.util.Map<?, ?> json(String text) {
        return (java.util.Map<?, ?>)JsonReader.read(text);
    }

    /** The text of the last information panel the client showed. */
    private String lastInformation() {
        synchronized (shown) {
            for (int i = shown.size() - 1; i >= 0; i--) {
                if (shown.get(i).startsWith("information:")) {
                    return (String)json(shown.get(i).substring("information:".length())).get("text");
                }
            }
        }
        return null;
    }

    @Test
    @Timeout(240)
    void thePlayersAreTheLiveEuropeanOnesWithTheirNations() throws Exception {
        final java.util.List<?> players = (java.util.List<?>)json(server.debug("{\"action\":\"players\"}")).get("players");
        assertEquals(server.getGame().getLiveEuropeanPlayerList().size(), players.size());
        final java.util.Map<?, ?> first = (java.util.Map<?, ?>)players.get(0);
        assertTrue(((String)first.get("nation")).startsWith("model.nation."), first.toString());
        assertNotNull(first.get("id"));
    }

    @Test
    @Timeout(240)
    void steppingTheRandomNumberGeneratorGivesANumberBelowOneHundred() throws Exception {
        for (int i = 0; i < 5; i++) {
            final long v = (Long)json(server.debug("{\"action\":\"stepRNG\"}")).get("value");
            assertTrue(v >= 0 && v < 100, "step " + v);
        }
    }

    @Test
    @Timeout(240)
    void aMonarchActionCanBeForcedByNameAndOnlyByName() throws Exception {
        assertTrue(server.debug("{\"action\":\"monarch\",\"monarch\":\"RAISE_TAX_WAR\"}")
            .contains("RAISE_TAX_WAR"));
        assertThrows(IllegalArgumentException.class,
            () -> server.debug("{\"action\":\"monarch\",\"monarch\":\"DANCE\"}"));
    }

    @Test
    @Timeout(240)
    void europeAndStatisticsAreShownByTheClientAsInformation() throws Exception {
        client.debugApplied(server.debug("{\"action\":\"displayEurope\"}"));
        assertTrue(lastInformation().contains("=="), lastInformation());
        client.debugApplied(server.debug("{\"action\":\"statistics\"}"));
        final String stats = lastInformation();
        assertTrue(stats.contains("Server") && stats.contains("Client"), stats);
        assertTrue(stats.contains("Colony") || stats.contains("Tile"), stats);
    }

    @Test
    @Timeout(240)
    void theClientDumpsItsUnitsAndShowsTheTestPanels() throws Exception {
        client.debugClient("{\"action\":\"displayUnits\"}");
        final String units = lastInformation();
        assertTrue(units.contains("Active units:") && units.contains("Remaining units:"), units);
        assertTrue(units.contains(me().getUnits().findFirst().get().getId()), units);
        client.debugClient("{\"action\":\"errorPanel\"}");
        eventually("the error panel", () -> shown.stream().anyMatch(
            e -> e.startsWith("error:") && e.contains("long error message") && e.contains("\"showLog\"")));
        client.debugClient("{\"action\":\"monarchPanel\"}");
        eventually("the monarch dialog", () -> shown.stream().anyMatch(e -> e.startsWith("ask:confirm:")));
        assertThrows(IllegalArgumentException.class, () -> client.debugClient("{\"action\":\"dance\"}"));
    }

    @Test
    @Timeout(240)
    void aMatchingMapPassesTheCheckAndADifferingOneIsFound() throws Exception {
        final String digest = client.debugClient("{\"action\":\"digest\"}");
        final String ok = server.debug("{\"action\":\"compareMaps\",\"client\":" + digest + "}");
        assertTrue(((String)json(ok).get("info")).contains("No desynchronization detected"), ok);
        // The client has lost sight of a unit of ours. The digest lists the units standing on a tile,
        // not those aboard a carrier, as Swing's check does.
        final Unit unit = me().getUnits().filter(u -> !u.isOnCarrier() && u.getTile() != null).findFirst().get();
        final String lost = digest.replace("\"" + unit.getId() + "\":", "\"gone:\":");
        final String bad = server.debug("{\"action\":\"compareMaps\",\"client\":" + lost + "}");
        assertTrue(((String)json(bad).get("info")).contains("Unit missing on client-side"), bad);
    }

    @Test
    @Timeout(240)
    void theOverlayLabelsTilesWithCoordinatesColonyValuesAndMissions() throws Exception {
        final Game game = server.getGame();
        final Player ai = game.getLiveEuropeanPlayerList().stream().filter(Player::isAI).findFirst().get();
        final java.util.Map<?, ?> coords = json(server.debug("{\"action\":\"overlay\",\"coords\":true}"));
        final java.util.List<?> labels = (java.util.List<?>)coords.get("labels");
        assertEquals(game.getMap().getWidth() * game.getMap().getHeight(), labels.size());
        final java.util.List<?> first = (java.util.List<?>)labels.get(0);
        assertEquals(0L, first.get(0));
        assertEquals(0L, first.get(1));
        assertTrue(((String)first.get(2)).startsWith("0, 0"), first.toString());
        final java.util.Map<?, ?> value = json(server.debug(
            "{\"action\":\"overlay\",\"colonyValue\":\"" + ai.getId() + "\"}"));
        assertFalse(((java.util.List<?>)value.get("labels")).isEmpty(), "the explored tiles have a value or a reason");
        // The AI's missions are on tiles the human sees: the answer is a list, even if empty.
        assertNotNull(json(server.debug("{\"action\":\"overlay\",\"missions\":2}")).get("labels"));
        final java.util.List<?> tints = (java.util.List<?>)json(server.debug(
            "{\"action\":\"overlay\",\"defence\":\"" + ai.getId() + "\"}")).get("tints");
        assertNotNull(tints);
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"overlay\",\"defence\":\"" + me().getId() + "\"}"));
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

    private Colony serverColony(String name) {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && t.getUnitCount() == 0
            && !t.hasSettlement() && t.getOwner() == null).iterator().next();
        final Colony colony = new ServerColony(game, us, name, land);
        land.setSettlement(colony);
        return colony;
    }

    private static String xy(Tile t) {
        return "\"x\":" + t.getX() + ",\"y\":" + t.getY();
    }

    @Test
    @Timeout(240)
    void aRequestWithoutAChoiceAsksForOne() throws Exception {
        final Colony colony = serverColony("Debug");
        final java.util.Map<?, ?> ask = json(server.debug(
            "{\"action\":\"changeOwner\"," + xy(colony.getTile()) + "}"));
        assertEquals("choose", ask.get("action"));
        assertEquals("changeOwner", ask.get("for"));
        assertEquals("owner", ask.get("key"));
        assertFalse(((List<?>)ask.get("choices")).isEmpty());
        // The unit types are asked for the same way.
        assertEquals("type", json(server.debug("{\"action\":\"addUnit\"," + xy(colony.getTile()) + "}")).get("key"));
    }

    @Test
    @Timeout(240)
    void aColonyChangesOwner() throws Exception {
        final Colony colony = serverColony("Debug");
        final Player other = server.getGame().getLiveEuropeanPlayerList().stream()
            .filter(p -> p != colony.getOwner()).findFirst().get();
        server.debug("{\"action\":\"changeOwner\"," + xy(colony.getTile()) + ",\"owner\":\"" + other.getId() + "\"}");
        assertEquals(other, colony.getOwner());
    }

    @Test
    @Timeout(240)
    void aUnitChangesRole() throws Exception {
        final Unit unit = me().getUnits().filter(u -> u.isPerson() && u.getTile() != null).findFirst().get();
        final Unit sUnit = server.getGame().getFreeColGameObject(unit.getId(), Unit.class);
        final String id = "\"unit\":\"" + unit.getId() + "\"";
        assertEquals("role", json(server.debug("{\"action\":\"changeRole\"," + id + "}")).get("key"));
        server.debug("{\"action\":\"changeRole\"," + id + ",\"role\":\"model.role.soldier\"}");
        assertEquals("model.role.soldier", sUnit.getRole().getId());
        eventually("the client's unit has the role",
            () -> unit.getRole().getId().equals("model.role.soldier"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"changeRole\"," + id + ",\"role\":\"model.role.nope\"}"));
    }

    @Test
    @Timeout(240)
    void aColonyHasAPlanAndAnIdealColonyCanBeFounded() throws Exception {
        final Colony colony = serverColony("Debug");
        assertNotNull(json(server.debug("{\"action\":\"colonyPlan\"," + xy(colony.getTile()) + "}")).get("text"));
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"colonyPlan\",\"x\":0,\"y\":0}"));
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Tile site = game.getMap().getTileSet(t -> t.isLand() && !t.hasSettlement()
            && t.getUnitCount() == 0 && us.canClaimToFoundSettlement(t)).iterator().next();
        final java.util.Map<?, ?> answer = json(server.debug("{\"action\":\"idealColony\"," + xy(site) + "}"));
        assertNotNull(site.getColony());
        assertEquals(site.getColony().getId(), answer.get("colony"));
        assertEquals(us, site.getColony().getOwner());
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"idealColony\"," + xy(site) + "}"));
    }

    @Test
    @Timeout(240)
    void aDisasterAsksWhichAndStrikes() throws Exception {
        final Colony colony = serverColony("Debug");
        final java.util.Map<?, ?> ask = json(server.debug("{\"action\":\"applyDisaster\"," + xy(colony.getTile()) + "}"));
        assertEquals("disaster", ask.get("key"));
        final String id = (String)((java.util.Map<?, ?>)((List<?>)ask.get("choices")).get(0)).get("id");
        final java.util.Map<?, ?> done = json(server.debug(
            "{\"action\":\"applyDisaster\"," + xy(colony.getTile()) + ",\"disaster\":\"" + id + "\"}"));
        assertEquals("applyDisaster", done.get("action"));
    }

    @Test
    @Timeout(240)
    void aLostCityRumourChangesType() throws Exception {
        final Tile rumour = server.getGame().getMap().getTileSet(Tile::hasLostCityRumour).iterator().next();
        assertEquals("rumour", json(server.debug("{\"action\":\"rumourType\"," + xy(rumour) + "}")).get("key"));
        server.debug("{\"action\":\"rumourType\"," + xy(rumour) + ",\"rumour\":\"MOUNDS\"}");
        assertEquals(net.sf.freecol.common.model.LostCityRumour.RumourType.MOUNDS,
            rumour.getTileItemContainer().getLostCityRumour().getType());
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"rumourType\"," + xy(rumour) + ",\"rumour\":\"NOPE\"}"));
        final Tile bare = server.getGame().getMap().getTileSet(t -> t.isLand() && !t.hasLostCityRumour()).iterator().next();
        assertThrows(IllegalArgumentException.class, () -> server.debug(
            "{\"action\":\"rumourType\"," + xy(bare) + ",\"rumour\":\"MOUNDS\"}"));
    }

    @Test
    @Timeout(240)
    void aShipsTransportListIsItsAIMission() throws Exception {
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final java.util.Map<?, ?> answer = json(server.debug(
            "{\"action\":\"displayMission\",\"unit\":\"" + ship.getId() + "\"}"));
        assertNotNull(answer.get("text"));
    }

    @Test
    @Timeout(240)
    void theTilePopupListsTheDebugEntriesTheTileCalls() throws Exception {
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final String at = ship.getTile().getX() + "," + ship.getTile().getY();
        final String menu = client.getMenus().debugTile(ship.getTile().getX(), ship.getTile().getY());
        for (String id : new String[] { "debug:displayMission:" + ship.getId(),
            "debug:changeOwner:" + ship.getId(), "debug:addUnit:" + at, "debug:resetMoves:" + at,
            "debug:dumpTile:" + at, "debug:idealColony:" + at }) {
            assertTrue(menu.contains("\"" + id + "\""), id + " in " + menu);
        }
        assertFalse(menu.contains("debug:colonyPlan"), "no colony here");
        assertFalse(menu.contains("debug:rumourType"), "no rumour here");
        final Tile bare = client.getGame().getMap().getTileSet(t -> t.isExplored() && t.getUnitCount() == 0).iterator().next();
        assertFalse(client.getMenus().debugTile(bare.getX(), bare.getY()).contains("debug:resetMoves"),
            "reset moves only where there are units");
    }

    @Test
    @Timeout(240)
    void theTilePanelShowsTheChosenPlayersColonyValue() throws Exception {
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        final Map map = client.getGame().getMap();
        eventually("the map explored", () -> unexplored(map) == 0);
        final Tile tile = map.getTileSet(t -> t.isLand()).iterator().next();
        assertTrue(TileJson.colonyValue(tile).isEmpty(), "nothing until a player is chosen");
        client.setColonyValuePlayer(me().getId());
        try {
            final List<String> lines = TileJson.colonyValue(tile);
            assertFalse(lines.isEmpty());
            assertTrue(lines.get(lines.size() - 1).startsWith("\"Result ")
                || lines.size() == 1, lines.toString());
            assertTrue(TileJson.of(tile, me()).contains("\"colonyValue\":["));
        } finally {
            client.setColonyValuePlayer("");
        }
        assertTrue(TileJson.colonyValue(tile).isEmpty());
    }

    @Test
    @Timeout(240)
    void showSearchAnswersTheLogAndThePathTheMapDraws() throws Exception {
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        final Map map = client.getGame().getMap();
        eventually("the map explored", () -> unexplored(map) == 0);
        final Unit ship = me().getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile from = ship.getTile();
        assertEquals("", client.getMenus().debugSearch(from.getX(), from.getY()),
            "no search without an active unit");
        for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != ship; i++) {
            client.getCommands().click(from.getX(), from.getY());
        }
        assertEquals("", client.getMenus().debugSearch(from.getX(), from.getY()),
            "no search to where the unit is");
        final Tile to = map.getTileSet(t -> !t.isLand() && t.getDistanceTo(from) == 2).iterator().next();
        final String answer = client.getMenus().debugSearch(to.getX(), to.getY());
        assertTrue(answer.startsWith("{\"log\":\""), answer);
        assertTrue(answer.contains("\"path\":[[" + from.getX() + "," + from.getY() + ","), answer);
        assertTrue(answer.contains("[" + to.getX() + "," + to.getY() + ","), answer);
    }
}
