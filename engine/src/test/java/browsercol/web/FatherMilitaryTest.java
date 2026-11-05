package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.CombatModel;
import net.sf.freecol.common.model.CombatModel.CombatEffectType;
import net.sf.freecol.common.model.CombatModel.CombatOdds;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.RandomRange;
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.server.control.InGameController;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The military founding fathers of the Classic rules, each given to the
 * human player as the server gives one when it joins the Continental
 * Congress (InGameController.addFoundingFather, which runs
 * ServerPlayer.csAddFoundingFather and sends the player the change), and
 * then seen to work in the game: on the server, and on the client where the
 * player sees it. Each test also checks the same thing without the father,
 * so that it fails if the father's effect is missing.
 */
class FatherMilitaryTest {

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
                public void updated() { }
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

    /** Wait for the client to have what the server sent. */
    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    /**
     * A change to the server's game, made from the test's thread as
     * DebugActionsTest makes its own: from the server's thread, a reply the
     * client sends to what it is sent would wait on that same thread.
     */
    private <T> T onServer(Callable<T> job) throws Exception {
        return job.call();
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    private ServerGame game() {
        return (ServerGame)server.getGame();
    }

    private Specification spec() {
        return server.getGame().getSpecification();
    }

    private ServerPlayer us() {
        return game().getFreeColGameObject(me().getId(), ServerPlayer.class);
    }

    private InGameController igc() {
        return server.getServer().getInGameController();
    }

    private FoundingFather father(String id) {
        return spec().getFoundingFather("model.foundingFather." + id);
    }

    /** The father joins the human's Congress, as the server does it; the client hears of it. */
    private void join(String id) throws Exception {
        final FoundingFather father = father(id);
        onServer(() -> { igc().addFoundingFather(us(), father); return null; });
        assertTrue(us().hasFather(father));
        eventually("the client knows " + id + " joined", () ->
            me().hasFather(me().getSpecification().getFoundingFather(father.getId())));
    }

    /** Send the human the tiles, as the server sends any change. */
    private void sendTiles(Tile... tiles) {
        final ChangeSet cs = new ChangeSet();
        for (Tile t : tiles) cs.add(See.perhaps(), t);
        game().sendTo(us(), cs);
    }

    /** A new unit of the owner's on the tile. */
    private ServerUnit unit(Player owner, Tile tile, String type, String role) {
        final ServerUnit u = (role == null)
            ? new ServerUnit(game(), tile, owner, spec().getUnitType(type))
            : new ServerUnit(game(), tile, owner, spec().getUnitType(type), spec().getRole(role));
        u.setMovesLeft(u.getInitialMovesLeft());
        ((ServerPlayer)owner).exploreForUnit(u);
        owner.invalidateCanSeeTiles();
        return u;
    }

    /** Empty land with no settlement and no units, and a neighbour that is the same. */
    private Tile[] landPair(Predicate<Tile> also) {
        for (Tile t : game().getMap().getTileSet(t -> isEmptyLand(t) && also.test(t))) {
            for (Tile n : t.getSurroundingTiles(1, 1)) {
                if (isEmptyLand(n)) return new Tile[] { t, n };
            }
        }
        throw new AssertionError("no two empty land tiles side by side");
    }

    private static boolean isEmptyLand(Tile t) {
        return t.isLand() && !t.hasSettlement() && t.getUnitCount() == 0;
    }

    /** A random source whose combat roll is r. */
    private static Random rolling(double r) {
        return new Random(1) {
            @Override public double nextDouble() { return r; }
        };
    }

    /** An ordinary win for the attacker: in the odds, not a great one. */
    private static List<CombatEffectType> ordinaryWin(CombatModel cm, Unit attacker, Unit defender) {
        final CombatOdds odds = cm.calculateCombatOdds(attacker, defender);
        assertTrue(odds.win > 0, "the attacker can win");
        final List<CombatEffectType> crs = cm.generateAttackResult(
            rolling(0.5 * odds.win), attacker, defender).getEffects();
        assertEquals(CombatEffectType.WIN, crs.get(0), "the attacker won");
        return new ArrayList<>(crs);
    }

    // Hernan Cortes: conquered native settlements always yield treasure,
    // more of it, and treasure trains are carried to Europe free.

    @Test
    @Timeout(240)
    void cortesCarriesTreasureFree() throws Exception {
        final String colonyId = (String)((java.util.Map<?, ?>)JsonReader.read(
            server.debug("{\"action\":\"addColony\"}"))).get("colony");
        final Colony colony = game().getFreeColGameObject(colonyId, Colony.class);
        final Tile tile = colony.getTile();
        assertEquals(0, us().getTax(), "no tax yet, so the gold is the treasure less the fee");

        // A treasure train in the colony, and Europe still the place to cash it in.
        final int treasure = 1000;
        final ServerUnit first = onServer(() -> {
            ServerUnit u = unit(us(), tile, "model.unit.treasureTrain", null);
            u.setTreasureAmount(treasure);
            sendTiles(tile);
            return u;
        });
        eventually("the client has the train", () ->
            client.getGame().getFreeColGameObject(first.getId(), Unit.class) != null
            && client.getGame().getFreeColGameObject(first.getId(), Unit.class)
                .getTreasureAmount() == treasure);
        final int fee = spec().getInteger(net.sf.freecol.common.option.GameOptions.TREASURE_TRANSPORT_FEE);
        assertTrue(fee > 0, "the rules charge a fee");
        assertEquals(treasure * fee / 100, first.getTransportFee(), "without Cortes, a fee");
        assertEquals(treasure * fee / 100,
            client.getGame().getFreeColGameObject(first.getId(), Unit.class).getTransportFee(),
            "and the client asks the player to pay it");

        // Cashed in without Cortes, the fee is taken.
        int before = us().getGold();
        onServer(() -> game().sendTo(us(), igc().cashInTreasureTrain(us(), first)));
        assertEquals(before + treasure - treasure * fee / 100, us().getGold());
        final int paid = us().getGold();
        eventually("the client's gold", () -> me().getGold() == paid);

        join("hernanCortes");
        final ServerUnit second = onServer(() -> {
            ServerUnit u = unit(us(), tile, "model.unit.treasureTrain", null);
            u.setTreasureAmount(treasure);
            sendTiles(tile);
            return u;
        });
        eventually("the client has the second train", () ->
            client.getGame().getFreeColGameObject(second.getId(), Unit.class) != null
            && client.getGame().getFreeColGameObject(second.getId(), Unit.class)
                .getTreasureAmount() == treasure);
        assertEquals(0, second.getTransportFee(), "with Cortes, no fee");
        assertEquals(0, client.getGame().getFreeColGameObject(second.getId(), Unit.class)
            .getTransportFee(), "and the client offers it free");

        before = us().getGold();
        onServer(() -> game().sendTo(us(), igc().cashInTreasureTrain(us(), second)));
        assertEquals(before + treasure, us().getGold(), "all of the treasure");
        final int free = us().getGold();
        eventually("the client's gold", () -> me().getGold() == free);
    }

    @Test
    @Timeout(240)
    void cortesMakesPlunderBigger() throws Exception {
        final Tile[] pair = landPair(t -> true);
        final Unit soldier = onServer(() -> unit(us(), pair[0], "model.unit.freeColonist",
            "model.role.soldier"));
        final List<IndianSettlement> settlements = new ArrayList<>();
        for (Player p : game().getLiveNativePlayerList()) settlements.addAll(p.getIndianSettlementList());
        assertFalse(settlements.isEmpty(), "the map has native settlements");

        final List<RandomRange> without = new ArrayList<>();
        for (IndianSettlement is : settlements) without.add(is.getPlunderRange(soldier));

        join("hernanCortes");

        for (int i = 0; i < settlements.size(); i++) {
            final RandomRange was = without.get(i), now = settlements.get(i).getPlunderRange(soldier);
            assertNotNull(was);
            assertNotNull(now);
            final String what = settlements.get(i).getType().getId();
            assertEquals(100, now.getProbability(), what + ": with Cortes, always treasure");
            assertTrue(expected(now) > expected(was), what + ": with Cortes, more treasure on average ("
                + expected(was) + " -> " + expected(now) + ")");
            assertTrue(now.getMaximum() * now.getFactor() >= was.getMaximum() * was.getFactor(),
                what + ": and at least as much at most");
        }
        // Destroying a settlement makes a treasure train of what getPlunder rolls.
        final IndianSettlement is = settlements.get(0);
        final Random low = new Random(1) { @Override public int nextInt(int n) { return 0; } };
        assertTrue(is.getPlunder(soldier, low) > 0, "the least roll still yields treasure");
    }

    /** The average plunder of a range: probability times the mean amount. */
    private static double expected(RandomRange r) {
        return r.getProbability() / 100.0 * (r.getMinimum() + r.getMaximum()) / 2.0 * r.getFactor();
    }

    // George Washington: a unit that wins a battle and can be promoted always is.

    @Test
    @Timeout(240)
    void washingtonPromotesEveryWinner() throws Exception {
        final Player natives = game().getLiveNativePlayerList().get(0);
        final Tile[] pair = landPair(t -> true);
        final Unit soldier = onServer(() -> {
            Unit u = unit(us(), pair[0], "model.unit.freeColonist", "model.role.soldier");
            sendTiles(pair[0]);
            return u;
        });
        final Unit brave = onServer(() -> unit(natives, pair[1], "model.unit.brave", null));
        final CombatModel cm = game().getCombatModel();
        assertNotNull(soldier.getUnitChange(net.sf.freecol.common.model.UnitChangeType.PROMOTION),
            "a free colonist can be promoted");

        assertFalse(ordinaryWin(cm, soldier, brave).contains(CombatEffectType.PROMOTE_UNIT),
            "without Washington, an ordinary win does not promote");

        join("georgeWashington");
        final List<CombatEffectType> crs = ordinaryWin(cm, soldier, brave);
        assertTrue(crs.contains(CombatEffectType.PROMOTE_UNIT), "with Washington it does: " + crs);

        // The battle fought on the server: the winner becomes a veteran soldier, on both sides.
        onServer(() -> game().sendTo(us(), igc().combat(us(), soldier, brave, crs)));
        assertEquals("model.unit.veteranSoldier", soldier.getType().getId());
        eventually("the client sees the promotion", () ->
            "model.unit.veteranSoldier".equals(client.getGame()
                .getFreeColGameObject(soldier.getId(), Unit.class).getType().getId()));
    }

    // Paul Revere: when a colony with no soldier is attacked, a colonist takes
    // up the muskets stockpiled there.

    @Test
    @Timeout(240)
    void revereArmsAColonistWithStockpiledMuskets() throws Exception {
        final String colonyId = (String)((java.util.Map<?, ?>)JsonReader.read(
            server.debug("{\"action\":\"addColony\"}"))).get("colony");
        final Colony colony = game().getFreeColGameObject(colonyId, Colony.class);
        final Tile tile = colony.getTile();
        final GoodsType muskets = spec().getGoodsType("model.goods.muskets");
        final Role soldierRole = spec().getRole("model.role.soldier");
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.muskets\",\"amount\":100,\"x\":"
            + tile.getX() + ",\"y\":" + tile.getY() + "}");
        assertEquals(100, colony.getGoodsCount(muskets));

        // A soldier of another European's next to it.
        final ServerPlayer enemy = (ServerPlayer)game().getLiveEuropeanPlayerList().stream()
            .filter(p -> p != us() && !p.isREF()).findFirst().get();
        final Tile from = tile.getSurroundingTiles(1, 1).stream()
            .filter(FatherMilitaryTest::isEmptyLand).findFirst().get();
        final Unit attacker = onServer(() -> unit(enemy, from, "model.unit.veteranSoldier",
            "model.role.soldier"));
        final Unit defender = colony.getDefendingUnit(attacker);
        assertTrue(defender.isInColony(), "the colonist working in the colony defends it");
        assertFalse(defender.isDefensiveUnit(), "and is no soldier");

        final CombatModel cm = game().getCombatModel();
        assertNull(defender.getAutomaticRole(), "without Revere, the muskets stay in the warehouse");
        final double unarmed = cm.getDefencePower(attacker, defender);
        final List<CombatEffectType> lost = ordinaryWin(cm, attacker, defender);
        assertTrue(lost.contains(CombatEffectType.CAPTURE_COLONY),
            "and losing the battle loses the colony: " + lost);

        join("paulRevere");
        assertEquals(soldierRole, defender.getAutomaticRole(), "with Revere, the colonist takes them up");
        assertTrue(cm.getDefencePower(attacker, defender) > unarmed, "and defends as a soldier");
        final List<CombatEffectType> crs = ordinaryWin(cm, attacker, defender);
        assertTrue(crs.contains(CombatEffectType.AUTOEQUIP_UNIT), "armed when attacked: " + crs);
        assertFalse(crs.contains(CombatEffectType.CAPTURE_COLONY), "so the colony holds: " + crs);

        // The battle fought on the server: the colony is still ours, less the muskets.
        final int needed = soldierRole.getRequiredGoodsList().stream()
            .filter(ag -> ag.getType() == muskets).mapToInt(ag -> ag.getAmount()).sum();
        onServer(() -> igc().combat(enemy, attacker, defender, crs));
        assertEquals(us(), colony.getOwner());
        assertEquals(100 - needed, colony.getGoodsCount(muskets), "the muskets were lost in the battle");
        eventually("the client's colony is still ours, less the muskets", () -> {
            final Colony c = client.getGame().getMap().getTile(tile.getX(), tile.getY()).getColony();
            return c != null && c.getOwner() == me()
                && c.getGoodsCount(me().getSpecification().getGoodsType(muskets.getId()))
                    == 100 - needed;
        });
    }

    // Francis Drake: privateers +50% in battle.

    @Test
    @Timeout(240)
    void drakeMakesPrivateersStronger() throws Exception {
        final Unit ship = us().getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile sea = ship.getTile();
        final Unit privateer = onServer(() -> {
            Unit u = unit(us(), sea, "model.unit.privateer", null);
            sendTiles(sea);
            return u;
        });
        eventually("the client has the privateer", () ->
            client.getGame().getFreeColGameObject(privateer.getId(), Unit.class) != null);
        final Unit seen = client.getGame().getFreeColGameObject(privateer.getId(), Unit.class);
        final Unit seenShip = client.getGame().getFreeColGameObject(ship.getId(), Unit.class);
        final CombatModel cm = game().getCombatModel();
        final CombatModel ccm = client.getGame().getCombatModel();

        // An enemy merchantman alongside to fight.
        final ServerPlayer enemy = (ServerPlayer)game().getLiveEuropeanPlayerList().stream()
            .filter(p -> p != us() && !p.isREF()).findFirst().get();
        final Tile next = sea.getSurroundingTiles(1, 1).stream()
            .filter(t -> !t.isLand() && t.getUnitCount() == 0).findFirst().get();
        final Unit prey = onServer(() -> unit(enemy, next, "model.unit.merchantman", null));

        final double offence = cm.getOffencePower(privateer, null);
        final double defence = cm.getDefencePower(null, privateer);
        final double odds = cm.calculateCombatOdds(privateer, prey).win;
        final double shipOffence = cm.getOffencePower(ship, null);
        assertEquals(offence, ccm.getOffencePower(seen, null), 1e-6, "the client agrees");

        join("francisDrake");
        assertEquals(1.5 * offence, cm.getOffencePower(privateer, null), 1e-6, "+50% attacking");
        assertEquals(1.5 * defence, cm.getDefencePower(null, privateer), 1e-6, "+50% defending");
        assertTrue(cm.calculateCombatOdds(privateer, prey).win > odds, "better odds against a ship");
        assertEquals(1.5 * offence, ccm.getOffencePower(seen, null), 1e-6,
            "and the client shows the player the same");
        assertEquals(1.5 * defence, ccm.getDefencePower(null, seen), 1e-6);
        assertEquals(shipOffence, cm.getOffencePower(ship, null), 1e-6, "other ships are not helped");
        assertEquals(shipOffence, ccm.getOffencePower(seenShip, null), 1e-6);
    }

    // John Paul Jones: a frigate arrives.

    @Test
    @Timeout(240)
    void johnPaulJonesBringsAFrigate() throws Exception {
        final Predicate<Unit> frigate = u -> "model.unit.frigate".equals(u.getType().getId());
        assertEquals(0, us().getUnits().filter(frigate).count(), "no frigate to start with");
        assertEquals(0, me().getUnits().filter(frigate).count());

        join("johnPaulJones");

        final List<Unit> frigates = us().getUnits().filter(frigate).toList();
        assertEquals(1, frigates.size(), "a frigate joins the fleet");
        assertTrue(frigates.get(0).isInEurope(), "in Europe, ready to sail");
        eventually("the client has the frigate in Europe", () ->
            me().getUnits().filter(frigate).filter(Unit::isInEurope).count() == 1);
    }
}
