package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.Callable;
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
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.LostCityRumour.RumourType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.server.control.InGameController;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The founding fathers of exploration in the Classic rules, each joining
 * the congress as the server has a father join
 * (ServerPlayer.csAddFoundingFather, through the server's
 * InGameController.addFoundingFather), and what each one changes in the
 * game: on the server, and on the client where the player sees it. Every
 * test checks the same thing before the father joins, so that it fails
 * if the father does nothing.
 */
class FatherExplorationTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private volatile CountDownLatch finished = new CountDownLatch(1);

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
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
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
        // JUnit keeps each test's instance to the end of the run: let its game go.
        server = null;
        client = null;
    }

    // Harness

    /** Wait for the client to have what the server sent. */
    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    /**
     * Change the server's game, from the test's thread as DebugActionsTest
     * does: not on the server's own thread, since what the server sends
     * the client waits for a reply that comes back on that thread.
     */
    private static <T> T onServer(Callable<T> change) throws Exception {
        return change.call();
    }

    private Game sGame() {
        return server.getGame();
    }

    private Game cGame() {
        return client.getGame();
    }

    private InGameController igc() {
        return server.getServer().getInGameController();
    }

    /** The human player, on the server. */
    private ServerPlayer us() {
        return sGame().getFreeColGameObject(client.getClient().getMyPlayer().getId(),
                                            ServerPlayer.class);
    }

    /** The human player, on the client. */
    private Player me() {
        return client.getClient().getMyPlayer();
    }

    /** The client's copy of a server object. */
    private <T extends net.sf.freecol.common.model.FreeColGameObject> T seen(
            net.sf.freecol.common.model.FreeColGameObject o, Class<T> c) {
        return cGame().getFreeColGameObject(o.getId(), c);
    }

    private Tile clientTile(Tile t) {
        return cGame().getMap().getTile(t.getX(), t.getY());
    }

    /** The father joins our congress as the server has one join, and the client hears of it. */
    private void join(String fatherId) throws Exception {
        final FoundingFather father = sGame().getSpecification().getFoundingFather(fatherId);
        assertFalse(us().hasFather(father), "not yet in congress");
        onServer(() -> {
            igc().addFoundingFather(us(), father);
            return null;
        });
        assertTrue(us().hasFather(father));
        eventually("the client has " + fatherId, () -> me().hasFather(
            cGame().getSpecification().getFoundingFather(fatherId)));
    }

    /** Send our player what changed on the server. */
    private void sendUs(ChangeSet cs) {
        ((ServerGame)sGame()).sendTo(us(), cs);
    }

    private String debug(String json) throws Exception {
        return onServer(() -> server.debug(json));
    }

    private static String answer(String json, String key) {
        return (String)((java.util.Map<?, ?>)JsonReader.read(json)).get(key);
    }

    /** A colony of ours founded by the debug action, at x, y or (null) the nearest site. */
    private Colony addColony(Tile at) throws Exception {
        final String req = (at == null) ? "{\"action\":\"addColony\"}"
            : "{\"action\":\"addColony\",\"x\":" + at.getX() + ",\"y\":" + at.getY() + "}";
        final Colony colony = sGame().getFreeColGameObject(answer(debug(req), "colony"),
                                                           Colony.class);
        eventually("the client has the colony", () -> seen(colony, Colony.class) != null);
        return colony;
    }

    private void addColonist(Colony colony) throws Exception {
        final int size = colony.getUnitCount();
        debug("{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true,"
            + "\"x\":" + colony.getTile().getX() + ",\"y\":" + colony.getTile().getY() + "}");
        assertEquals(size + 1, colony.getUnitCount());
        eventually("the client's colony grew", () ->
            seen(colony, Colony.class).getUnitCount() == size + 1);
    }

    /** End our turn and wait for the next one, the AI playing in between. */
    private void playATurn() throws Exception {
        final int turn = cGame().getTurn().getNumber();
        finished = new CountDownLatch(1);
        client.skipTurns(1);
        assertTrue(finished.await(240, TimeUnit.SECONDS), "play comes back");
        assertEquals(turn + 1, cGame().getTurn().getNumber());
    }

    /** No tile within the radius of the tile is explored by the player. */
    private static boolean unexploredAround(ServerPlayer p, Tile t, int radius) {
        return t.getSurroundingTiles(0, radius).stream().noneMatch(p::hasExplored);
    }

    // Ferdinand Magellan

    @Test
    @Timeout(300)
    void magellanGivesShipsAMoveMoreAndShortensTheTripToEurope() throws Exception {
        final ServerPlayer us = us();
        final Unit ship = us.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit colonist = ship.getUnitList().get(0);
        final int shipMoves = ship.getInitialMovesLeft();
        final int landMoves = colonist.getInitialMovesLeft();
        final int sail = ship.getSailTurns();
        assertEquals(shipMoves, ship.getMovesLeft(), "a new turn's full moves");
        assertTrue(sail > 1, "the trip takes turns");

        // Without Magellan, a second ship sails to Europe in the usual time.
        final Unit other = sGame().getFreeColGameObject(answer(debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.caravel\",\"x\":"
            + ship.getTile().getX() + ",\"y\":" + ship.getTile().getY() + "}"), "unit"), Unit.class);
        onServer(() -> {
            sendUs(igc().moveTo(us, other, us.getEurope()));
            return null;
        });
        assertEquals(sail, other.getWorkLeft(), "turns to Europe without Magellan");

        join("model.foundingFather.ferdinandMagellan");

        // A move more (three move points) for ships, not for land units,
        // and the ship with moves left gets them this turn.
        assertEquals(shipMoves + 3, ship.getInitialMovesLeft());
        assertEquals(shipMoves + 3, ship.getMovesLeft());
        assertEquals(landMoves, colonist.getInitialMovesLeft());
        assertEquals(sail - 1, ship.getSailTurns());
        final Unit seenShip = seen(ship, Unit.class);
        eventually("the client's ship has the extra move", () ->
            seenShip.getMovesLeft() == shipMoves + 3);
        assertEquals(shipMoves + 3, seenShip.getInitialMovesLeft());
        assertEquals(sail - 1, seenShip.getSailTurns());
        assertEquals(landMoves, seen(colonist, Unit.class).getInitialMovesLeft());

        // With Magellan, the trip to Europe is a turn shorter.
        onServer(() -> {
            sendUs(igc().moveTo(us, ship, us.getEurope()));
            return null;
        });
        assertEquals(sail - 1, ship.getWorkLeft(), "turns to Europe with Magellan");
        eventually("the client's ship is on the high seas a turn less", () ->
            seenShip.getWorkLeft() == sail - 1);
    }

    // Francisco de Coronado

    @Test
    @Timeout(300)
    void coronadoShowsUsEveryColonyAndTheLandAroundIt() throws Exception {
        final ServerPlayer us = us();
        final ServerPlayer them = (ServerPlayer)sGame().getLiveEuropeanPlayerList().stream()
            .filter(p -> p != us && p.isAI()).findFirst().get();
        // Another European's colony, on land we have not seen near.
        final Tile site = sGame().getMap().getTileSet(t -> t.isLand()
            && them.canClaimToFoundSettlement(t)
            && unexploredAround(us, t, 8)).iterator().next();
        final Colony colony = onServer(() -> {
            final ServerUnit founder = new ServerUnit(sGame(), site, them,
                sGame().getSpecification().getUnitType("model.unit.freeColonist"));
            founder.setMovesLeft(founder.getInitialMovesLeft());
            ((ServerGame)sGame()).sendToAll(
                igc().buildSettlement(them, founder, Player.ASSIGN_SETTLEMENT_NAME));
            return site.getColony();
        });
        assertNotNull(colony);
        // What we see of it: the colony's line of sight and Coronado's three tiles more.
        final int radius = colony.getLineOfSight() + 3;
        assertTrue(radius < 8);
        assertFalse(us.hasExplored(site), "we have not seen it");
        assertFalse(clientTile(site).isExplored());
        assertNull(clientTile(site).getSettlement());

        join("model.foundingFather.franciscoDeCoronado");

        for (Tile t : site.getSurroundingTiles(0, radius)) {
            assertTrue(us.hasExplored(t), "explored on the server: " + t);
        }
        eventually("the client sees the colony", () -> clientTile(site).getColony() != null);
        assertEquals(them.getId(), clientTile(site).getColony().getOwner().getId());
        for (Tile t : site.getSurroundingTiles(0, radius)) {
            eventually("the client has explored " + t, () -> clientTile(t).isExplored());
        }
        // Only the land around the colony.
        assertTrue(site.getSurroundingTiles(radius + 1, radius + 1).stream()
            .noneMatch(us::hasExplored), "no further");
    }

    // Hernando de Soto

    @Test
    @Timeout(300)
    void deSotoLetsLandUnitsSeeFurtherAndMakesRumoursGood() throws Exception {
        final ServerPlayer us = us();
        // A colonist alone on land we have not seen near.
        final Tile at = sGame().getMap().getTileSet(t -> t.isLand() && !t.hasSettlement()
            && t.getUnitCount() == 0 && unexploredAround(us, t, 4)).iterator().next();
        final Unit colonist = sGame().getFreeColGameObject(answer(debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"x\":"
            + at.getX() + ",\"y\":" + at.getY() + "}"), "unit"), Unit.class);
        final Unit ship = us.getUnits().filter(Unit::isNaval).findFirst().get();
        final int sight = colonist.getLineOfSight();
        final int shipSight = ship.getLineOfSight();
        final List<Tile> ring = at.getSurroundingTiles(sight + 1, sight + 1);
        assertTrue(ring.stream().noneMatch(us::hasExplored), "beyond its sight");
        assertTrue(ring.stream().noneMatch(t -> clientTile(t).isExplored()));

        // Rumours as the server chooses them when this colonist explores one.
        final Tile rumourTile = sGame().getMap().getTileSet(Tile::hasLostCityRumour)
            .iterator().next();
        final LostCityRumour rumour = rumourTile.getLostCityRumour();
        final Set<RumourType> bad = EnumSet.of(RumourType.BURIAL_GROUND,
            RumourType.EXPEDITION_VANISHES, RumourType.NOTHING);
        final List<RumourType> before = new ArrayList<>();
        final Random r1 = new Random(1);
        for (int i = 0; i < 200; i++) before.add(rumour.chooseType(colonist, r1));
        assertTrue(before.contains(RumourType.EXPEDITION_VANISHES),
            "without de Soto an expedition can vanish: " + before);

        join("model.foundingFather.hernandoDeSoto");

        assertEquals(sight + 1, colonist.getLineOfSight(), "land units see a tile further");
        assertEquals(shipSight, ship.getLineOfSight(), "ships do not");
        for (Tile t : ring) assertTrue(us.hasExplored(t), "explored on the server: " + t);
        eventually("the client has explored the tiles now in sight", () ->
            ring.stream().allMatch(t -> clientTile(t).isExplored()));
        assertEquals(sight + 1, seen(colonist, Unit.class).getLineOfSight());
        assertEquals(shipSight, seen(ship, Unit.class).getLineOfSight());

        final List<RumourType> after = new ArrayList<>();
        final Random r2 = new Random(1);
        for (int i = 0; i < 200; i++) after.add(rumour.chooseType(colonist, r2));
        assertTrue(after.stream().noneMatch(bad::contains),
            "with de Soto every rumour is good: " + after);
    }

    // Henry Hudson

    @Test
    @Timeout(300)
    void hudsonDoublesFurTrapping() throws Exception {
        final ServerPlayer us = us();
        final Specification spec = sGame().getSpecification();
        final GoodsType furs = spec.getGoodsType("model.goods.furs");
        final UnitType colonistType = spec.getUnitType("model.unit.freeColonist");
        final GoodsType food = spec.getPrimaryFoodType();
        final Map map = sGame().getMap();
        // Land to trap furs on with no river, road or resource: a river or
        // road adds its furs after Hudson's +100%, so it would not double.
        final java.util.function.Predicate<Tile> trapping = n -> n.isLand()
            && n.getPotentialProduction(furs, colonistType) > 0
            && n.getCompleteItems().isEmpty();
        // A site of no furs itself whose land feeds the trapper, so that the
        // colony of one does not starve at the end of the turn (on arctic
        // land it would), with nobody's land around it and furs to trap there.
        final Tile site = map.getTileSet(t -> t.isLand() && us.canClaimToFoundSettlement(t)
            && t.getPotentialProduction(furs, null) == 0
            && spec.getFoodGoodsTypeList().stream().mapToInt(g ->
                t.getPotentialProduction(g, null)).sum() >= colonistType.getConsumptionOf(food)
            && t.getSurroundingTiles(1, 1).stream().allMatch(n -> n.getOwner() == null)
            && t.getSurroundingTiles(1, 1).stream().anyMatch(trapping))
            .iterator().next();
        final Colony colony = addColony(site);
        final Tile forest = site.getSurroundingTiles(1, 1).stream()
            .filter(trapping).findFirst().get();
        final ColonyTile ct = colony.getColonyTile(forest);
        final Unit trapper = colony.getUnitList().get(0);
        // As the client asks: work the forest, at furs.
        onServer(() -> {
            sendUs(igc().work(us, trapper, ct));
            sendUs(igc().changeWorkType(us, trapper, furs));
            return null;
        });
        assertEquals(ct, trapper.getLocation());
        assertEquals(furs, trapper.getWorkType());
        final int without = colony.getNetProductionOf(furs);
        assertTrue(without > 0, "the colonist traps furs: " + forest.getType() + " owned by "
            + forest.getOwningSettlement() + ", tile makes " + ct.getTotalProductionOf(furs)
            + ", potential " + forest.getPotentialProduction(furs, colonistType));
        eventually("the client's colony traps furs", () ->
            seen(colony, Colony.class).getNetProductionOf(furs) == without);
        assertTrue(colony.getNetProductionOf(food) >= 0, "the colony does not starve");

        join("model.foundingFather.henryHudson");

        // The colony works its production out again each turn.
        onServer(() -> {
            colony.invalidateCache();
            return null;
        });
        final int with = colony.getNetProductionOf(furs);
        assertEquals(2 * without, with, "Hudson's +100% furs");

        // A turn later the warehouse holds what was trapped, and the client sees it.
        final int stored = colony.getGoodsCount(furs);
        playATurn();
        assertEquals(stored + with, colony.getGoodsCount(furs));
        eventually("the client's warehouse", () ->
            seen(colony, Colony.class).getGoodsCount(furs) == stored + with);
        assertEquals(with, seen(colony, Colony.class).getNetProductionOf(furs));
    }

    // René-Robert Cavelier de La Salle

    @Test
    @Timeout(300)
    void laSalleGivesEveryColonyOfThreeAFreeStockade() throws Exception {
        final Colony big = addColony(null);
        addColonist(big);
        addColonist(big);
        final Colony small = addColony(null);
        assertEquals(3, big.getUnitCount());
        assertEquals(1, small.getUnitCount());
        assertFalse(big.hasStockade());
        assertFalse(small.hasStockade());
        assertFalse(seen(big, Colony.class).hasStockade());

        join("model.foundingFather.laSalle");

        assertTrue(big.hasStockade(), "a colony of three gets one when La Salle joins");
        assertFalse(small.hasStockade(), "a colony of one does not");
        eventually("the client sees the stockade", () -> seen(big, Colony.class).hasStockade());
        assertFalse(seen(small, Colony.class).hasStockade());

        // The small one gets its own at the end of the turn it reaches three.
        addColonist(small);
        addColonist(small);
        assertFalse(small.hasStockade(), "not until the turn ends");
        playATurn();
        assertTrue(small.hasStockade(), "once it has three");
        eventually("the client sees the second stockade", () ->
            seen(small, Colony.class).hasStockade());
    }
}
