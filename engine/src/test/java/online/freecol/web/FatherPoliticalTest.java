package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
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

import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.Tension;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.server.control.InGameController;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;


/**
 * The political founding fathers of the classic rules, each joining the
 * human's congress as the server adds one (ServerPlayer.csAddFoundingFather,
 * its changes sent to the player), and doing what the father does in the
 * game: on the server, and where the player sees it, on the client. Each
 * test checks the same thing before the father joins, so that it fails
 * when the effect is missing.
 */
class FatherPoliticalTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private final CountDownLatch finished = new CountDownLatch(1);

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
        assertTrue(finished.await(120, TimeUnit.SECONDS), "our first turn");
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        // Something keeps each test's instance to the end of the run, and
        // the Engine tests share one 2 GB heap: let its games go.
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

    private ServerPlayer us() {
        return server.getGame().getFreeColGameObject(me().getId(), ServerPlayer.class);
    }

    private Specification spec() {
        return server.getGame().getSpecification();
    }

    private void send(ChangeSet cs) {
        ((ServerGame)server.getGame()).sendTo(us(), cs);
    }

    /** The father joins the human's congress, as the server adds one at the end of a turn. */
    private void join(String father) throws InterruptedException {
        final String id = "model.foundingFather." + father;
        final ChangeSet cs = new ChangeSet();
        us().csAddFoundingFather(spec().getFoundingFather(id), new Random(1), cs);
        send(cs);
        assertTrue(us().hasFather(spec().getFoundingFather(id)));
        eventually("the client has " + father, () -> me().hasFather(
            client.getGame().getSpecification().getFoundingFather(id)));
    }

    /** A new colony of the human's, founded by the debug action; its id. */
    private String addColony() {
        return (String)((java.util.Map<?, ?>)JsonReader.read(
            server.debug("{\"action\":\"addColony\"}"))).get("colony");
    }

    private Colony serverColony(String id) {
        return server.getGame().getFreeColGameObject(id, Colony.class);
    }

    private Colony clientColony(String id) {
        return client.getGame().getFreeColGameObject(id, Colony.class);
    }

    /**
     * A colony with an elder statesman in its town hall, on both sides;
     * its id.
     */
    private String colonyWithAStatesman() throws InterruptedException {
        final String id = addColony();
        final Colony colony = serverColony(id);
        final String unitId = (String)((java.util.Map<?, ?>)JsonReader.read(server.debug(
            "{\"action\":\"addUnit\",\"type\":\"model.unit.elderStatesman\",\"inColony\":true,\"x\":"
            + colony.getTile().getX() + ",\"y\":" + colony.getTile().getY() + "}"))).get("unit");
        final Unit statesman = server.getGame().getFreeColGameObject(unitId, Unit.class);
        final Building townHall = townHall(colony);
        statesman.setLocation(townHall);
        // The founder may have gone to the town hall too: it leaves the
        // colony for its tile, so the statesman is the town hall's one worker.
        for (Unit u : colony.getUnitList()) {
            if (u != statesman) u.setLocation(colony.getTile());
        }
        colony.invalidateCache();
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us()), colony.getTile());
        cs.add(See.only(us()), colony);
        send(cs);
        assertEquals(townHall, statesman.getLocation());
        assertEquals(1, townHall.getUnitCount());
        eventually("the client's statesman alone in the town hall", () -> clientColony(id) != null
            && client.getGame().getFreeColGameObject(unitId, Unit.class) != null
            && client.getGame().getFreeColGameObject(unitId, Unit.class).getLocation()
                == townHall(clientColony(id))
            && townHall(clientColony(id)).getUnitCount() == 1);
        return id;
    }

    private static Building townHall(Colony colony) {
        return colony.getBuilding(colony.getSpecification().getBuildingType("model.building.townHall"));
    }

    /** The bells the colony's town hall makes a turn. */
    private static int bells(Colony colony) {
        final GoodsType bells = colony.getSpecification().getGoodsType("model.goods.bells");
        return townHall(colony).getTotalProductionOf(bells);
    }

    @Test
    @Timeout(240)
    void jeffersonRaisesBellsProductionByHalf() throws Exception {
        final String id = colonyWithAStatesman();
        final int before = bells(serverColony(id));
        // An elder statesman makes 6 bells, and the town hall 1 of its own.
        assertEquals(6 + 1, before);
        assertEquals(before, bells(clientColony(id)), "the client agrees before");

        join("thomasJefferson");

        // Jefferson's +50% applies to what the statesman makes.
        final int after = 9 + 1;
        assertEquals(after, bells(serverColony(id)), "the server's town hall");
        eventually("the client's town hall", () -> bells(clientColony(id)) == after);
    }

    @Test
    @Timeout(240)
    void pocahontasEndsTheNativesAlarmAndWar() throws Exception {
        // Meet a tribe, at war with it, with every settlement of it alarmed.
        server.debug("{\"action\":\"revealMap\"}");
        final ServerPlayer us = us();
        final ServerPlayer natives = (ServerPlayer)server.getGame().getLiveNativePlayers()
            .findFirst().get();
        final Tension hateful = new Tension(Tension.Level.HATEFUL.getLimit());
        us.setStance(natives, Stance.WAR);
        natives.setStance(us, Stance.WAR);
        natives.setTension(us, hateful);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us), natives);
        cs.add(See.only(us), us);
        for (IndianSettlement is : natives.getIndianSettlementList()) {
            is.setContacted(us);
            is.setAlarm(us, new Tension(Tension.Level.HATEFUL.getLimit()));
            cs.add(See.only(us), is);
        }
        send(cs);
        final IndianSettlement one = natives.getIndianSettlementList().get(0);
        assertEquals(Tension.Level.HATEFUL, one.getAlarm(us).getLevel());
        eventually("the client sees the war and the hateful settlement", () ->
            me().getStance(client.getGame().getFreeColGameObject(natives.getId(), Player.class))
                == Stance.WAR
            && client.getGame().getFreeColGameObject(one.getId(), IndianSettlement.class) != null
            && client.getGame().getFreeColGameObject(one.getId(), IndianSettlement.class)
                .getAlarm(me()).getLevel() == Tension.Level.HATEFUL);
        // Alarm the human's doings raise is counted in full.
        assertEquals(100, (int)us.apply(100f, server.getGame().getTurn(),
            Modifier.NATIVE_ALARM_MODIFIER));

        join("pocahontas");

        assertEquals(Tension.TENSION_MIN, natives.getTension(us).getValue(), "the tribe's tension");
        for (IndianSettlement is : natives.getIndianSettlementList()) {
            assertEquals(Tension.TENSION_MIN, is.getAlarm(us).getValue(), is.getName() + "'s alarm");
        }
        assertEquals(Stance.PEACE, us.getStance(natives));
        assertEquals(Stance.PEACE, natives.getStance(us));
        // And from now on, half as much.
        assertEquals(50, (int)us.apply(100f, server.getGame().getTurn(),
            Modifier.NATIVE_ALARM_MODIFIER));

        eventually("the client sees peace and a calm settlement", () ->
            me().getStance(client.getGame().getFreeColGameObject(natives.getId(), Player.class))
                == Stance.PEACE
            && client.getGame().getFreeColGameObject(one.getId(), IndianSettlement.class)
                .getAlarm(me()).getValue() == Tension.TENSION_MIN);
    }

    /**
     * A colony with a statesman, a tax of 20% and Paine in congress; its
     * id. Before Paine, tax alone adds no bells.
     */
    private String paineAtTwentyPercent() throws InterruptedException {
        final String id = colonyWithAStatesman();
        final ChangeSet tax = new ChangeSet();
        us().csSetTax(20, tax);
        send(tax);
        eventually("the client's tax", () -> me().getTax() == 20);
        assertEquals(6 + 1, bells(serverColony(id)));
        assertEquals(6 + 1, bells(clientColony(id)));

        join("thomasPaine");
        return id;
    }

    @Test
    @Timeout(240)
    void paineRaisesBellsProductionByTheTaxRate() throws Exception {
        final String id = paineAtTwentyPercent();

        // +20%, the tax, on the statesman's 6, as the client shows it.
        final int at20 = (int)(6 * 1.2f) + 1;
        eventually("the client's town hall", () -> bells(clientColony(id)) == at20);

        // And it follows the tax, on both sides.
        final ChangeSet more = new ChangeSet();
        us().csSetTax(50, more);
        send(more);
        final int at50 = (int)(6 * 1.5f) + 1;
        assertEquals(at50, bells(serverColony(id)), "the server's town hall at 50%");
        eventually("the client's town hall at 50%", () -> bells(clientColony(id)) == at50);
    }

    @Test
    @Timeout(240)
    void paineRaisesTheServersBellsAsSoonAsHeJoins() throws Exception {
        final String id = paineAtTwentyPercent();
        final int at20 = (int)(6 * 1.2f) + 1;
        eventually("the client's town hall", () -> bells(clientColony(id)) == at20);
        assertEquals(at20, bells(serverColony(id)), "the server's town hall");
    }

    @Test
    @Timeout(240)
    void bolivarRaisesSonsOfLibertyByTwentyInEveryColony() throws Exception {
        // One colony of one colonist with no liberty, one of two with
        // liberty for one rebel.
        final String none = addColony();
        final String half = addColony();
        final Colony two = serverColony(half);
        server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.freeColonist\",\"inColony\":true,\"x\":"
            + two.getTile().getX() + ",\"y\":" + two.getTile().getY() + "}");
        two.addLiberty(Colony.LIBERTY_PER_REBEL);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us()), two);
        send(cs);
        assertEquals(0, serverColony(none).getSonsOfLiberty());
        assertEquals(50, two.getSonsOfLiberty());
        eventually("the client's colonies before", () -> clientColony(none) != null
            && clientColony(half) != null
            && clientColony(none).getSonsOfLiberty() == 0
            && clientColony(half).getSonsOfLiberty() == 50);

        join("simonBolivar");

        assertEquals(20, serverColony(none).getSonsOfLiberty(), "the server's empty colony");
        assertEquals(70, two.getSonsOfLiberty(), "the server's half-rebel colony");
        eventually("the client's colonies", () -> clientColony(none).getSonsOfLiberty() == 20
            && clientColony(half).getSonsOfLiberty() == 70);
    }

    @Test
    @Timeout(240)
    void franklinKeepsTheCrownsWarsOutOfTheColonies() throws Exception {
        final ServerPlayer us = us();
        final ServerPlayer rival = (ServerPlayer)server.getGame().getLiveEuropeanPlayers(us)
            .filter(p -> !p.isREF()).findFirst().get();
        // At peace with a European rival, and with a colony, so the Crown meddles.
        addColony();
        us.setStance(rival, Stance.PEACE);
        rival.setStance(us, Stance.PEACE);
        assertTrue(us.getMonarch().collectPotentialEnemies().contains(rival),
            "our Crown may take us to war with the rival");
        assertTrue(rival.getMonarch().collectPotentialEnemies().contains(us),
            "the rival's Crown may take it to war with us");
        assertTrue(us.getMonarch().actionIsValid(MonarchAction.DECLARE_WAR));

        join("benjaminFranklin");

        assertTrue(me().hasAbility(Ability.IGNORE_EUROPEAN_WARS), "the client knows");
        assertTrue(us.getMonarch().collectPotentialEnemies().isEmpty(), "our Crown has no war for us");
        assertFalse(rival.getMonarch().collectPotentialEnemies().contains(us),
            "nor the rival's Crown against us");
        assertFalse(us.getMonarch().actionIsValid(MonarchAction.DECLARE_WAR));
        // The Crown's declaration of war, as the server makes it at the
        // start of our turn, changes nothing.
        monarchAction(us, MonarchAction.DECLARE_WAR);
        assertEquals(Stance.PEACE, us.getStance(rival));
        assertEquals(Stance.PEACE, rival.getStance(us));
    }

    /** InGameController.csMonarchAction, which the server runs at the start of a turn. */
    private void monarchAction(ServerPlayer player, MonarchAction action) throws Exception {
        final InGameController igc = server.getServer().getInGameController();
        final Method m = InGameController.class.getDeclaredMethod("csMonarchAction",
            ServerPlayer.class, MonarchAction.class, ChangeSet.class);
        m.setAccessible(true);
        m.invoke(igc, player, action, new ChangeSet());
    }

    @Test
    @Timeout(240)
    void withoutFranklinTheCrownsWarReachesTheColonies() throws Exception {
        // The same declaration as above, without Franklin, takes us to war.
        final ServerPlayer us = us();
        addColony();
        for (Player p : server.getGame().getLiveEuropeanPlayerList()) {
            if (p == us || p.isREF()) continue;
            us.setStance(p, Stance.PEACE);
            p.setStance(us, Stance.PEACE);
        }
        monarchAction(us, MonarchAction.DECLARE_WAR);
        assertNotNull(server.getGame().getLiveEuropeanPlayers(us)
            .filter(p -> us.getStance(p) == Stance.WAR).findFirst().orElse(null),
            "at war with a rival");
    }
}
