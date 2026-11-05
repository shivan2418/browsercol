package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.Unit.MoveType;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The founding fathers of trade in the Classic rules do what they say in
 * a game between the two Engines: each test checks the effect without the
 * father first, then gives the human the father as the server does when
 * one joins the Continental Congress (ServerPlayer.csAddFoundingFather)
 * and checks the effect again, on the server and, where the player sees
 * it, on the client.
 */
class FatherTradeTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;

    /** The questions the fake Browser UI saw, as "kind json"; it answers none. */
    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());

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
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + " " + json);
                    ui.execute(() -> client.answer(id, null));
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        assertTrue(ourTurn.await(120, TimeUnit.SECONDS), "our first turn");
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
        // JUnit keeps each test's instance to the end of the run: let its game go.
        server = null;
        client = null;
    }

    /** Wait for the client to have what the server sent. */
    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    private ServerPlayer serverMe() {
        return server.getGame().getFreeColGameObject(me().getId(), ServerPlayer.class);
    }

    private Specification spec() {
        return server.getGame().getSpecification();
    }

    private FoundingFather father(String name) {
        return spec().getFoundingFather("model.foundingFather." + name);
    }

    /** The client's copy of a server object. */
    private <T extends net.sf.freecol.common.model.FreeColGameObject> T ours(T serverObject,
                                                                          Class<T> c) {
        return client.getGame().getFreeColGameObject(serverObject.getId(), c);
    }

    /**
     * The father joins the human's Congress, as ServerPlayer.checkFoundingFather
     * has it join at the end of a turn, and the client hears of it.
     */
    private void giveFather(FoundingFather father) throws InterruptedException {
        final ServerPlayer us = serverMe();
        assertFalse(us.hasFather(father), "not in Congress yet");
        final ChangeSet cs = new ChangeSet();
        us.csAddFoundingFather(father, new Random(1), cs);
        ((ServerGame)server.getGame()).sendTo(us, cs);
        assertTrue(us.hasFather(father), "in Congress on the server");
        eventually("the client knows the father joined", () -> me().hasFather(
            client.getGame().getSpecification().getFoundingFather(father.getId())));
    }

    /** A colony of the human's on the land nearest the ship, as the debug menu founds it. */
    private Colony addColony() throws InterruptedException {
        final String id = (String)((java.util.Map<?, ?>)JsonReader.read(
            server.debug("{\"action\":\"addColony\"}"))).get("colony");
        final Colony colony = server.getGame().getFreeColGameObject(id, Colony.class);
        assertNotNull(colony);
        eventually("the client has the colony",
            () -> client.getGame().getFreeColGameObject(id, Colony.class) != null);
        return colony;
    }

    private static String at(Tile tile) {
        return "\"x\":" + tile.getX() + ",\"y\":" + tile.getY();
    }

    /** More colonists into the colony, so it has the population it needs. */
    private void populate(Colony colony, int size) throws InterruptedException {
        // Into the buildings: the debug menu's inColony asks the colony for
        // an occupation that feeds the colonist, which poor land may not have.
        final ServerPlayer us = serverMe();
        final UnitType type = spec().getUnitType("model.unit.freeColonist");
        while (colony.getUnitCount() < size) {
            final ServerUnit unit = new ServerUnit(server.getGame(), colony.getTile(), us, type);
            final Building room = colony.getBuildings().stream()
                .filter(b -> b.canAdd(unit)).findFirst().orElse(null);
            assertNotNull(room, "a building has room for another colonist");
            final int before = colony.getUnitCount();
            unit.setLocation(room);
            assertEquals(before + 1, colony.getUnitCount(), "the colonist joined");
        }
        colony.invalidateCache();
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us), colony.getTile());
        cs.add(See.only(us), colony);
        ((ServerGame)server.getGame()).sendTo(us, cs);
        eventually("the client's colony has " + size + " colonists",
            () -> ours(colony, Colony.class).getUnitCount() == size);
    }

    /**
     * Adam Smith (model.ability.buildFactory): a colony may build the
     * factory level of a building, such as the textile mill after the
     * weaver's shop, and the factory makes more than the shop did.
     */
    @Test
    @Timeout(240)
    void adamSmithLetsAColonyBuildFactories() throws Exception {
        final Colony colony = addColony();
        populate(colony, 8);
        server.debug("{\"action\":\"addBuilding\",\"type\":\"model.building.weaverShop\","
            + at(colony.getTile()) + "}");
        final BuildingType shop = spec().getBuildingType("model.building.weaverShop");
        final BuildingType mill = spec().getBuildingType("model.building.textileMill");
        final GoodsType cloth = spec().getGoodsType("model.goods.cloth");
        final UnitType colonist = spec().getUnitType("model.unit.freeColonist");
        assertSame(shop, colony.getBuilding(shop).getType());
        final Colony ours = ours(colony, Colony.class);
        eventually("the client has the weaver's shop",
            () -> ours.getBuilding(mill) != null
                && ours.getBuilding(mill).getType().getId().equals(shop.getId()));
        final int shopMakes = colony.getBuilding(shop).getPotentialProduction(cloth, colonist);

        // Without Adam Smith the mill cannot be built, and the build queue
        // panel names him as what it needs.
        final BuildingType ourMill = client.getGame().getSpecification().getBuildingType(mill.getId());
        assertEquals(Colony.NoBuildReason.MISSING_ABILITY, colony.getNoBuildReason(mill, null));
        assertTrue(BuildQueues.reasons(ours, ourMill, List.of(), null)
                .contains(Messages.getName(father("adamSmith"))),
            BuildQueues.reasons(ours, ourMill, List.of(), null).toString());
        assertFalse(client.getCommands().setBuildQueue(ours.getId(), List.of(mill.getId())),
            "the mill cannot be queued");
        assertTrue(colony.getBuildQueue().isEmpty() || !colony.getBuildQueue().contains(mill));

        giveFather(father("adamSmith"));

        assertTrue(colony.canBuild(mill), "the server's colony can build the mill");
        assertEquals(List.of(), BuildQueues.reasons(ours, ourMill, List.of(), null),
            "the panel has nothing against the mill");
        assertTrue(client.getCommands().setBuildQueue(ours.getId(), List.of(mill.getId())),
            "the mill is queued");
        assertEquals(List.of(mill), new ArrayList<>(colony.getBuildQueue()), "on the server");

        // Built, the mill makes more cloth than the shop did.
        server.debug("{\"action\":\"addBuilding\",\"type\":\"model.building.textileMill\","
            + at(colony.getTile()) + "}");
        final Building built = colony.getBuilding(mill);
        assertSame(mill, built.getType());
        eventually("the client has the mill",
            () -> ours.getBuilding(ourMill).getType().getId().equals(mill.getId()));
        assertTrue(built.getPotentialProduction(cloth, colonist) > shopMakes,
            "the mill makes " + built.getPotentialProduction(cloth, colonist)
                + " cloth a colonist, the shop " + shopMakes);
    }

    /**
     * Jacob Fugger (model.event.boycottsLifted): every boycott the Crown
     * has put on the player's goods is lifted when he joins.
     */
    @Test
    @Timeout(240)
    void jacobFuggerLiftsTheBoycotts() throws Exception {
        final ServerPlayer us = serverMe();
        final Market market = us.getMarket();
        final List<GoodsType> boycotted = List.of(spec().getGoodsType("model.goods.cloth"),
            spec().getGoodsType("model.goods.furs"));
        // A boycott, as the server puts one on goods when a tax raise is refused.
        final ChangeSet cs = new ChangeSet();
        for (GoodsType gt : boycotted) {
            market.setArrears(gt, 500);
            cs.add(See.only(us), market.getMarketData(gt));
        }
        ((ServerGame)server.getGame()).sendTo(us, cs);
        final Specification ourSpec = client.getGame().getSpecification();
        for (GoodsType gt : boycotted) {
            final GoodsType ourGt = ourSpec.getGoodsType(gt.getId());
            assertFalse(us.canTrade(gt), gt.getId() + " is boycotted on the server");
            eventually(gt.getId() + " is boycotted on the client", () -> !me().canTrade(ourGt));
        }

        giveFather(father("jacobFugger"));

        for (GoodsType gt : boycotted) {
            final GoodsType ourGt = ourSpec.getGoodsType(gt.getId());
            assertEquals(0, market.getArrears(gt), "no arrears on " + gt.getId());
            assertTrue(us.canTrade(gt), gt.getId() + " can be traded on the server");
            eventually(gt.getId() + " can be traded on the client", () -> me().canTrade(ourGt));
        }
    }

    /**
     * Peter Minuit (model.modifier.landPaymentModifier -100%): the natives
     * ask nothing for their land, so a colonist put to work on a tile of
     * theirs beside the colony claims it without a word, and no gold goes.
     */
    @Test
    @Timeout(240)
    void peterMinuitMakesNativeLandFree() throws Exception {
        final ServerPlayer us = serverMe();
        final UnitType colonistType = spec().getUnitType("model.unit.freeColonist");
        // A free tile to found a colony on, beside a native tile a colonist could work.
        Tile site = null, nativeTile = null;
        for (Tile t : server.getGame().getMap().getTileSet(t -> t.isLand()
                && t.getOwner() == null && t.getUnitCount() == 0 && !t.hasLostCityRumour()
                && us.canClaimToFoundSettlement(t))) {
            for (Tile n : t.getSurroundingTiles(1, 1)) {
                if (n.isLand() && n.getOwner() != null && n.getOwner().isIndian()
                    && !n.hasSettlement() && n.getUnitCount() == 0
                    && !n.hasLostCityRumour()
                    && spec().getGoodsTypeList().stream().anyMatch(
                        g -> n.getPotentialProduction(g, colonistType) > 0)) {
                    site = t;
                    nativeTile = n;
                    break;
                }
            }
            if (site != null) break;
        }
        assertNotNull(site, "the map has free land beside native land");
        final Player natives = nativeTile.getOwner();

        final String colonyId = (String)((java.util.Map<?, ?>)JsonReader.read(server.debug(
            "{\"action\":\"addColony\"," + at(site) + "}"))).get("colony");
        final Colony colony = server.getGame().getFreeColGameObject(colonyId, Colony.class);
        eventually("the client has the colony",
            () -> client.getGame().getFreeColGameObject(colonyId, Colony.class) != null);
        final String unitId = (String)((java.util.Map<?, ?>)JsonReader.read(server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true,"
                + at(site) + "}"))).get("unit");
        eventually("the client has the colonist",
            () -> client.getGame().getFreeColGameObject(unitId, Unit.class) != null);
        assertSame(natives, nativeTile.getOwner(), "the colony did not take the native tile");
        final Tile ourTile = client.getGame().getMap().getTile(nativeTile.getX(), nativeTile.getY());
        final ColonyTile ct = ours(colony, Colony.class).getColonyTile(ourTile);
        assertNotNull(ct, "the native tile is one of the colony's");
        final int gold = us.getGold();

        // Without Peter Minuit the natives want gold for it: the player is
        // asked, cancels, and the tile stays theirs.
        assertTrue(us.getLandPrice(nativeTile) > 0, "the natives want gold on the server");
        assertTrue(me().getLandPrice(ourTile) > 0, "and on the client");
        asked.clear();
        assertFalse(client.getCommands().work(unitId, ct.getId()), "the claim is cancelled");
        assertTrue(asked.stream().anyMatch(q -> q.startsWith("choice ")),
            "the player is asked to pay or take the land: " + asked);
        assertSame(natives, nativeTile.getOwner(), "the tile is still the natives'");

        giveFather(father("peterMinuit"));

        assertEquals(0, us.getLandPrice(nativeTile), "the natives want nothing on the server");
        assertEquals(0, me().getLandPrice(ourTile), "nor on the client");
        assertEquals(Player.NoClaimReason.NONE, us.canClaimForSettlementReason(nativeTile));
        asked.clear();
        assertTrue(client.getCommands().work(unitId, ct.getId()), "the colonist works the tile");
        assertTrue(asked.stream().noneMatch(q -> q.startsWith("choice ")),
            "nothing to pay, nothing asked: " + asked);
        assertSame(us, nativeTile.getOwner(), "the tile is ours on the server");
        assertSame(colony, nativeTile.getOwningSettlement());
        assertSame(me(), ourTile.getOwner(), "and on the client");
        assertEquals(gold, us.getGold(), "no gold paid");
    }

    /**
     * Peter Stuyvesant (model.ability.buildCustomHouse): a colony may build
     * a custom house, which exports its goods.
     */
    @Test
    @Timeout(240)
    void peterStuyvesantLetsAColonyBuildACustomHouse() throws Exception {
        final Colony colony = addColony();
        final Colony ours = ours(colony, Colony.class);
        final BuildingType house = spec().getBuildingType("model.building.customHouse");
        final BuildingType ourHouse = client.getGame().getSpecification().getBuildingType(house.getId());
        final String cloth = "model.goods.cloth";

        assertEquals(Colony.NoBuildReason.MISSING_ABILITY, colony.getNoBuildReason(house, null));
        assertTrue(BuildQueues.reasons(ours, ourHouse, List.of(), null)
                .contains(Messages.getName(father("peterStuyvesant"))),
            BuildQueues.reasons(ours, ourHouse, List.of(), null).toString());
        assertFalse(client.getCommands().setBuildQueue(ours.getId(), List.of(house.getId())),
            "the custom house cannot be queued");
        assertFalse(client.getCommands().setGoodsLevels(ours.getId(), cloth, true, 10, 90, -1, 50),
            "nothing exports without a custom house");

        giveFather(father("peterStuyvesant"));

        assertTrue(colony.canBuild(house), "the server's colony can build the custom house");
        assertEquals(List.of(), BuildQueues.reasons(ours, ourHouse, List.of(), null));
        assertTrue(client.getCommands().setBuildQueue(ours.getId(), List.of(house.getId())),
            "the custom house is queued");
        assertEquals(List.of(house), new ArrayList<>(colony.getBuildQueue()), "on the server");

        // Built, the colony exports.
        server.debug("{\"action\":\"addBuilding\",\"type\":\"model.building.customHouse\","
            + at(colony.getTile()) + "}");
        assertTrue(colony.hasAbility(Ability.EXPORT), "the server's colony can export");
        eventually("the client's colony can export", () -> ours.hasAbility(Ability.EXPORT));
        assertTrue(client.getCommands().setGoodsLevels(ours.getId(), cloth, true, 10, 90, -1, 50),
            "cloth is set to export");
        eventually("the server exports cloth", () -> colony.getExportData(
            spec().getGoodsType(cloth)).getExported());
    }

    /**
     * Jan de Witt (model.ability.tradeWithForeignColonies,
     * customHouseTradesWithForeignCountries, betterForeignAffairsReport):
     * a wagon train with goods may enter a foreign colony to trade, the
     * foreign affairs report shows the other nations' fathers, tax and
     * Sons of Liberty, and a custom house sells boycotted goods abroad
     * when the player is at peace with another European nation.
     */
    @Test
    @Timeout(240)
    void janDeWittOpensTradeWithForeignNations() throws Exception {
        final ServerPlayer us = serverMe();
        final ServerPlayer them = (ServerPlayer)server.getGame().getLiveEuropeanPlayerList().stream()
            .filter(p -> p != us && p.isAI() && !p.isREF()).findFirst().get();
        // We see the whole map, and they found a colony with free land beside it.
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        Tile site = null, beside = null;
        for (Tile t : server.getGame().getMap().getTileSet(t -> t.isLand()
                && t.getOwner() == null && t.getUnitCount() == 0 && !t.hasLostCityRumour()
                && them.canClaimToFoundSettlement(t))) {
            for (Tile n : t.getSurroundingTiles(1, 1)) {
                if (n.isLand() && !n.hasSettlement() && n.getUnitCount() == 0
                    && !n.hasLostCityRumour()) {
                    site = t;
                    beside = n;
                    break;
                }
            }
            if (site != null) break;
        }
        assertNotNull(site, "the map has land for their colony");
        final ServerUnit founder = new ServerUnit(server.getGame(), site, them,
            spec().getUnitType("model.unit.freeColonist"));
        server.getServer().getInGameController()
            .buildSettlement(them, founder, Player.ASSIGN_SETTLEMENT_NAME);
        final Colony theirs = site.getColony();
        assertNotNull(theirs, "their colony");
        final Tile ourSite = client.getGame().getMap().getTile(site.getX(), site.getY());
        eventually("the client sees their colony", () -> ourSite.getColony() != null);

        // Our wagon train with goods beside it.
        final String wagonId = (String)((java.util.Map<?, ?>)JsonReader.read(server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.wagonTrain\"," + at(beside) + "}")))
            .get("unit");
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.cloth\",\"amount\":50,"
            + "\"unit\":\"" + wagonId + "\"}");
        final Unit wagon = server.getGame().getFreeColGameObject(wagonId, Unit.class);
        eventually("the client's wagon train has the cloth", () -> {
            final Unit w = client.getGame().getFreeColGameObject(wagonId, Unit.class);
            return w != null && w.hasGoodsCargo();
        });
        final Unit ourWagon = client.getGame().getFreeColGameObject(wagonId, Unit.class);
        assertFalse(us.atWarWith(them));

        // Custom house trade: boycotted cloth, with the rule that a custom
        // house ignores boycotts turned off, and peace with them.
        final GoodsType cloth = spec().getGoodsType("model.goods.cloth");
        spec().setBoolean(GameOptions.CUSTOM_IGNORE_BOYCOTT, false);
        us.getMarket().setArrears(cloth, 500);
        us.setStance(them, Stance.PEACE);
        them.setStance(us, Stance.PEACE);

        // Without Jan de Witt: no trade with their colony, no figures in
        // the report, and the custom house cannot sell the cloth.
        assertEquals(MoveType.MOVE_NO_ACCESS_TRADE, wagon.getSimpleMoveType(site),
            "the server will not let the wagon train trade");
        assertEquals(MoveType.MOVE_NO_ACCESS_TRADE, ourWagon.getSimpleMoveType(ourSite),
            "nor the client");
        assertFalse(foreignFigures(them), "the report hides their figures");
        assertFalse(us.canTrade(cloth, Market.Access.CUSTOM_HOUSE), "the cloth cannot be sold");

        giveFather(father("janDeWitt"));
        // A father joins as a turn ends, and the client forgets its nation
        // summaries at the new turn (InGameController.newTurn); here the
        // turn does not end, so forget them as it would.
        me().clearNationCache();

        assertEquals(MoveType.ENTER_SETTLEMENT_WITH_CARRIER_AND_GOODS,
            wagon.getSimpleMoveType(site), "the server lets the wagon train trade");
        assertEquals(MoveType.ENTER_SETTLEMENT_WITH_CARRIER_AND_GOODS,
            ourWagon.getSimpleMoveType(ourSite), "and so does the client");
        assertTrue(foreignFigures(them), "the report shows their figures");
        assertTrue(us.canTrade(cloth, Market.Access.CUSTOM_HOUSE),
            "the custom house sells the cloth abroad");
        assertFalse(us.canTrade(cloth), "the boycott in Europe stands");
    }

    /**
     * Whether the foreign affairs report gives the nation's founding
     * fathers, tax and Sons of Liberty (all or none).
     */
    private boolean foreignFigures(Player nation) {
        final java.util.Map<?, ?> report = (java.util.Map<?, ?>)JsonReader.read(
            Reports.foreign(client.getClient()));
        for (Object o : (List<?>)report.get("nations")) {
            final java.util.Map<?, ?> n = (java.util.Map<?, ?>)o;
            if (!nation.getId().equals(n.get("id"))) continue;
            final boolean fathers = n.get("fathers") != null;
            assertEquals(fathers, n.get("tax") != null, "tax with fathers: " + n);
            assertEquals(fathers, n.get("sol") != null, "Sons of Liberty with fathers: " + n);
            return fathers;
        }
        throw new AssertionError("the report has no " + nation.getId() + ": " + report);
    }
}
