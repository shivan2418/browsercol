package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.CombatModel;
import net.sf.freecol.common.model.CombatModel.CombatEffectType;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tension;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerIndianSettlement;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The religious founding fathers of the Classic rules do what they say, in
 * a game between the two Engines. A father joins as the server joins one
 * (ServerPlayer.csAddFoundingFather, its changes sent to the human), and
 * each test checks the father's effect on the server and, where the
 * player sees it, on the client and in what the Browser UI is sent. Each
 * also checks the same thing without the father, so it cannot pass for
 * want of the father.
 */
class FatherReligiousTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;

    /** The choice questions the fake Browser UI was asked, as their JSON. */
    private final List<String> choices = Collections.synchronizedList(new ArrayList<>());
    /** The choice the fake Browser UI picks, by its text; else the first enabled. */
    private volatile String wanted = null;

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
                    ui.execute(() -> client.answer(id, answer(kind, json)));
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
        // JUnit keeps every test instance until the run ends: let the games go.
        server = null;
        client = null;
    }

    /**
     * Confirm all but sailing to Europe, end the turn, take the first
     * father offered, and pick the wanted choice or the first enabled one.
     */
    private String answer(String kind, String json) {
        switch (kind) {
        case "confirm": return String.valueOf(!json.contains("Europe"));
        case "endTurn": return "ok";
        case "father": return "0";
        case "choice": {
            choices.add(json);
            final List<String> texts = choiceTexts(json);
            if (wanted != null && texts.contains(wanted)) {
                return String.valueOf(texts.indexOf(wanted));
            }
            final List<?> items = (List<?>)((java.util.Map<?, ?>)JsonReader.read(json)).get("choices");
            for (int i = 0; i < items.size(); i++) {
                if (Boolean.TRUE.equals(((java.util.Map<?, ?>)items.get(i)).get("enabled"))) {
                    return String.valueOf(i);
                }
            }
            return null;
        }
        default: return null;
        }
    }

    /** The texts of a choice question's choices, in order. */
    private static List<String> choiceTexts(String json) {
        final Object top = JsonReader.read(json);
        final List<String> out = new ArrayList<>();
        for (Object c : (List<?>)((java.util.Map<?, ?>)top).get("choices")) {
            out.add((String)((java.util.Map<?, ?>)c).get("text"));
        }
        return out;
    }

    /** Wait for the client to have what the server sent. */
    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    private Game game() {
        return server.getGame();
    }

    private Specification spec() {
        return game().getSpecification();
    }

    /** The human player, on the server. */
    private ServerPlayer us() {
        return game().getFreeColGameObject(me().getId(), ServerPlayer.class);
    }

    private void send(ChangeSet cs) {
        ((ServerGame)game()).sendTo(us(), cs);
    }

    /** The father joins the human's congress as the server joins one, and the client hears of it. */
    private void join(String fatherId) throws InterruptedException {
        final FoundingFather father = spec().getFoundingFather(fatherId);
        final ChangeSet cs = new ChangeSet();
        us().csAddFoundingFather(father, new Random(1), cs);
        send(cs);
        eventually("the client has " + fatherId, () -> me().hasFather(
            client.getGame().getSpecification().getFoundingFather(fatherId)));
    }

    /** A colony of the human's, as the debug menu adds one; its id. */
    private Colony addColony() {
        final String answer = server.debug("{\"action\":\"addColony\"}");
        final String id = (String)((java.util.Map<?, ?>)JsonReader.read(answer)).get("colony");
        return game().getFreeColGameObject(id, Colony.class);
    }

    private Unit addUnit(String type, Tile tile, boolean inColony) {
        final String answer = server.debug("{\"action\":\"addUnit\",\"type\":\"" + type
            + "\",\"x\":" + tile.getX() + ",\"y\":" + tile.getY()
            + (inColony ? ",\"inColony\":true" : "") + "}");
        final String id = (String)((java.util.Map<?, ?>)JsonReader.read(answer)).get("unit");
        return game().getFreeColGameObject(id, Unit.class);
    }

    /** End our turn and wait until the AI hands play back. */
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
                commands.endTurn(); // a no-op while the AI plays
                pressed = now;
            }
        }
    }

    // William Brewster ---------------------------------------------------

    /** The recruit pool's types, of a Europe. */
    private static List<String> pool(Europe europe) {
        final List<String> out = new ArrayList<>();
        for (AbstractUnit au : europe.getExpandedRecruitables(false)) out.add(au.getId());
        return out;
    }

    /** Set the server's recruit pool, and send it to the human. */
    private void setPool(String... types) throws Exception {
        final Europe europe = us().getEurope();
        final Field f = Europe.class.getDeclaredField("recruitables");
        f.setAccessible(true);
        @SuppressWarnings("unchecked")
        final List<AbstractUnit> recruitables = (List<AbstractUnit>)f.get(europe);
        recruitables.clear();
        for (String t : types) {
            recruitables.add(new AbstractUnit(spec().getUnitType(t), Specification.DEFAULT_ROLE_ID, 1));
        }
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us()), europe);
        send(cs);
        eventually("the client's pool", () -> pool(me().getEurope()).equals(List.of(types)));
    }

    /** The recruit pool the Browser UI's Europe panel shows: its units' image keys. */
    private String recruitPanel() {
        final Object top = JsonReader.read(EuropeJson.of(me(), null, java.util.List.of()));
        final Object recruit = ((java.util.Map<?, ?>)top).get("recruit");
        return String.valueOf(((java.util.Map<?, ?>)recruit).get("units"));
    }

    /** Enough immigration for a recruit, on the server and the client. */
    private void setImmigrationForARecruit() throws InterruptedException {
        final int required = us().getImmigrationRequired();
        us().setImmigration(required);
        final ChangeSet cs = new ChangeSet();
        cs.addPartial(See.only(us()), us(), "immigration", String.valueOf(required));
        send(cs);
        eventually("the client's immigration", () -> me().getImmigration() == required);
    }

    private int onTheDocks(Player p) {
        return (int)p.getEurope().getUnitList().stream().filter(u -> !u.isNaval()).count();
    }

    @Test
    @Timeout(240)
    void brewsterTakesCriminalsAndServantsOutOfTheRecruitPool() throws Exception {
        final String criminal = "model.unit.pettyCriminal";
        final String servant = "model.unit.indenturedServant";
        final String fisherman = "model.unit.expertFisherman";
        setPool(criminal, servant, fisherman);
        assertTrue(recruitPanel().contains("pettyCriminal")
            && recruitPanel().contains("indenturedServant"),
            "without Brewster the Europe panel offers them: " + recruitPanel());
        assertTrue(us().hasAbility(Ability.CAN_RECRUIT_UNIT, spec().getUnitType(criminal)));

        join("model.foundingFather.williamBrewster");

        final List<String> pool = pool(us().getEurope());
        assertEquals(3, pool.size(), "the pool is refilled: " + pool);
        assertFalse(pool.contains(criminal) || pool.contains(servant), "server pool " + pool);
        eventually("the client's pool is the server's", () -> pool(me().getEurope()).equals(pool));
        assertFalse(recruitPanel().contains("pettyCriminal")
            || recruitPanel().contains("indenturedServant"), recruitPanel());
        assertFalse(us().hasAbility(Ability.CAN_RECRUIT_UNIT, spec().getUnitType(criminal)));
        assertFalse(us().hasAbility(Ability.CAN_RECRUIT_UNIT, spec().getUnitType(servant)));
    }

    @Test
    @Timeout(400)
    void brewsterLetsThePlayerPickWhichRecruitEmigrates() throws Exception {
        final String[] types = { "model.unit.expertFarmer", "model.unit.expertFisherman",
                                 "model.unit.masterCarpenter" };
        final List<String> names = new ArrayList<>();
        for (String t : types) {
            names.add(Messages.message(new AbstractUnit(spec().getUnitType(t),
                Specification.DEFAULT_ROLE_ID, 1).getSingleLabel()));
        }

        // Without Brewster the server picks the emigrant, and the player is not asked.
        setPool(types);
        setImmigrationForARecruit();
        final int docksBefore = onTheDocks(us());
        endTurnAndWait();
        assertEquals(docksBefore + 1, onTheDocks(us()), "a recruit emigrated");
        assertTrue(choices.stream().noneMatch(c -> choiceTexts(c).equals(names)),
            "without Brewster no emigrant is offered: " + choices);

        // With him the Browser UI is asked which recruit in the pool comes.
        join("model.foundingFather.williamBrewster");
        setPool(types);
        wanted = names.get(2);
        setImmigrationForARecruit();
        final int docks = onTheDocks(us());
        endTurnAndWait();
        eventually("the player is asked to pick from the pool",
            () -> choices.stream().anyMatch(c -> choiceTexts(c).equals(names)));
        eventually("the picked recruit is on the docks", () -> onTheDocks(us()) == docks + 1);
        final Unit last = us().getEurope().getUnitList().stream()
            .filter(u -> !u.isNaval()).reduce((a, b) -> b).get();
        assertEquals(types[2], last.getType().getId(), "the one picked emigrated");
        eventually("and the client has it on its docks", () -> onTheDocks(me()) == docks + 1
            && me().getEurope().getUnitList().stream()
                .anyMatch(u -> u.getType().getId().equals(types[2])));
    }

    // William Penn --------------------------------------------------------

    @Test
    @Timeout(240)
    void pennRaisesCrossProductionByHalf() throws Exception {
        final Colony colony = addColony();
        final GoodsType crosses = spec().getGoodsType("model.goods.crosses");
        // A church (the chapel has no room for a preacher) needs three colonists.
        addUnit("model.unit.freeColonist", colony.getTile(), true);
        final Unit preacher = addUnit("model.unit.firebrandPreacher", colony.getTile(), true);
        server.debug("{\"action\":\"addBuilding\",\"type\":\"model.building.church\",\"x\":"
            + colony.getTile().getX() + ",\"y\":" + colony.getTile().getY() + "}");
        final WorkLocation church = colony.getBuilding(spec().getBuildingType("model.building.church"));
        assertNotNull(church);
        preacher.setLocation(church);
        preacher.changeWorkType(crosses);
        colony.invalidateCache();
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us()), colony);
        send(cs);

        final int before = colony.getAdjustedNetProductionOf(crosses);
        assertTrue(before > 1, "the church makes crosses: " + before);
        final Supplier<Colony> seen = () -> client.getGame().getFreeColGameObject(colony.getId(), Colony.class);
        eventually("the colony panel shows as many", () -> seen.get() != null
            && panelCrosses(seen.get()) == before);

        join("model.foundingFather.williamPenn");

        final int after = colony.getAdjustedNetProductionOf(crosses);
        assertEquals(before * 3 / 2, after, "50% more crosses on the server, from " + before);
        assertTrue(after > before);
        eventually("and the Browser UI's colony panel shows them, from " + before + " to " + after,
            () -> panelCrosses(seen.get()) == after);
    }

    /** The crosses the Browser UI's colony panel says the colony makes a turn. */
    private static int panelCrosses(Colony colony) {
        final Object top = JsonReader.read(ColonyJson.of(colony, 0));
        for (Object g : (List<?>)((java.util.Map<?, ?>)top).get("production")) {
            final java.util.Map<?, ?> goods = (java.util.Map<?, ?>)g;
            if ("model.goods.crosses".equals(goods.get("type"))) {
                return ((Number)goods.get("amount")).intValue();
            }
        }
        return 0;
    }

    // Father Jean de Brebeuf ---------------------------------------------

    /**
     * A native settlement with no European unit, colony or claimed land
     * near enough to change its alarm (ServerPlayer.csStartTurn), so a turn
     * changes its alarm toward the human by the same amount every time
     * but for the mission.
     */
    private IndianSettlement quietSettlement() {
        for (Tile t : game().getMap().getTileSet(t -> t.getSettlement() instanceof IndianSettlement)) {
            final IndianSettlement is = t.getIndianSettlement();
            final int radius = is.getRadius() + ServerPlayer.ALARM_RADIUS;
            boolean quiet = true;
            for (Tile n : t.getSurroundingTiles(radius)) {
                final Unit u = n.getFirstUnit();
                if ((u != null && u.getOwner().isEuropean()) || n.getColony() != null
                    || (n.getOwningSettlement() != null
                        && n.getOwningSettlement().getOwner().isEuropean())) {
                    quiet = false;
                }
            }
            if (quiet && beside(is) != null) return is;
        }
        throw new AssertionError("no native settlement far from the Europeans");
    }

    /** Free land next to a settlement, or null if there is none. */
    private static Tile beside(IndianSettlement is) {
        for (Tile n : is.getTile().getSurroundingTiles(1)) {
            if (n.isLand() && !n.hasSettlement() && n.getUnitCount() == 0) return n;
        }
        return null;
    }

    /**
     * Our colonist, dressed as a missionary next to the settlement,
     * establishes a mission there as the server has one established
     * (InGameController.establishMission).
     */
    private Unit establishMission(IndianSettlement is) throws InterruptedException {
        final Tile from = beside(is);
        final Unit missionary = new ServerUnit(game(), from, us(),
            spec().getUnitType("model.unit.freeColonist"),
            spec().getRole("model.role.missionary"));
        ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps(), from);
        send(cs);
        eventually("the client has the missionary",
            () -> client.getGame().getFreeColGameObject(missionary.getId(), Unit.class) != null);
        send(server.getServer().getInGameController()
            .establishMission(us(), (ServerUnit)missionary, is));
        assertTrue(is.getMissionary() == missionary, "the mission is ours");
        final Tile tile = is.getTile();
        eventually("the client sees our mission", () -> {
            final IndianSettlement seen = client.getGame().getMap()
                .getTile(tile.getX(), tile.getY()).getIndianSettlement();
            return seen != null && seen.getMissionary() != null;
        });
        return missionary;
    }

    /** The change to the settlement's alarm toward us over a native turn, from a set start. */
    private int alarmChangeOverANativeTurn(IndianSettlement is) {
        final ServerPlayer natives = (ServerPlayer)is.getOwner();
        is.setAlarm(us(), new Tension(500));
        natives.setTension(us(), new Tension(500));
        natives.csStartTurn(new Random(1), new ChangeSet());
        return is.getAlarm(us()).getValue() - 500;
    }

    /** The settlement's entry in the Browser UI's map, on the client. */
    private String mapEntry(Tile tile) {
        final String all = MapJson.of(client.getGame(), me(), null);
        final int from = all.indexOf("{\"x\":" + tile.getX() + ",\"y\":" + tile.getY() + ",",
            all.indexOf("\"settlements\":"));
        assertTrue(from >= 0, "the settlement is on the client's map");
        final int to = all.indexOf(",{\"x\":", from + 1);
        return all.substring(from, (to < 0) ? all.length() : to);
    }

    @Test
    @Timeout(240)
    void brebeufMakesMissionariesExperts() throws Exception {
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        final IndianSettlement is = quietSettlement();
        final Tile tile = is.getTile();
        final Unit missionary = establishMission(is);
        assertFalse(missionary.hasAbility(Ability.EXPERT_MISSIONARY));
        assertTrue(mapEntry(tile).contains("\"expert\":false"), mapEntry(tile));
        final int withoutBrebeuf = alarmChangeOverANativeTurn(is);

        join("model.foundingFather.fatherJeanDeBrebeuf");

        assertTrue(missionary.hasAbility(Ability.EXPERT_MISSIONARY), "the server's missionary");
        eventually("the Browser UI's map shows an expert's mission: " + mapEntry(tile),
            () -> mapEntry(tile).contains("\"expert\":true"));
        // An expert's mission calms the settlement twice as much each turn.
        final int influence = spec().getInteger(GameOptions.MISSION_INFLUENCE);
        final int withBrebeuf = alarmChangeOverANativeTurn(is);
        final float once = us().apply((float)influence, game().getTurn(),
            Modifier.NATIVE_ALARM_MODIFIER);
        final float twice = us().apply((float)(2 * influence), game().getTurn(),
            Modifier.NATIVE_ALARM_MODIFIER);
        assertTrue(withBrebeuf < withoutBrebeuf, "calmer with Brebeuf: " + withBrebeuf
            + " against " + withoutBrebeuf);
        assertEquals((int)twice - (int)once, withBrebeuf - withoutBrebeuf,
            "by one more mission's influence");
    }

    // Juan de Sepulveda ---------------------------------------------------

    @Test
    @Timeout(240)
    void sepulvedaMakesBeatenNativesConvertMoreOften() throws Exception {
        // Our soldier next to a settlement with our mission, beating its defender.
        final IndianSettlement is = game().getMap().getTileSet(
                t -> t.getSettlement() instanceof IndianSettlement
                    && beside(t.getIndianSettlement()) != null)
            .iterator().next().getIndianSettlement();
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        establishMission(is);
        final Unit soldier = new ServerUnit(game(), beside(is), us(),
            spec().getUnitType("model.unit.veteranSoldier"), spec().getRole("model.role.soldier"));
        final Unit defender = is.getDefendingUnit(soldier);
        assertNotNull(defender);
        final CombatModel combat = game().getCombatModel();
        final double win = combat.calculateCombatOdds(soldier, defender).win;

        final float without = soldier.getConvertProbability();
        // A great win's residual (SimpleCombatModel.resolveAttack) just above the base chance.
        final double residual = without + 0.05;
        final Random dice = new Random() {
                @Override public double nextDouble() { return residual * 0.1 * win; }
            };
        assertFalse(combat.generateAttackResult(dice, soldier, defender).getEffects()
            .contains(CombatEffectType.CAPTURE_CONVERT), "no convert without Sepulveda");

        join("model.foundingFather.juanDeSepulveda");

        final float with = soldier.getConvertProbability();
        assertEquals(without * 1.2f, with, 0.001f, "20% more likely to convert");
        assertTrue(combat.generateAttackResult(dice, soldier, defender).getEffects()
            .contains(CombatEffectType.CAPTURE_CONVERT), "a convert with Sepulveda");
        final Unit seen = client.getGame().getFreeColGameObject(soldier.getId(), Unit.class);
        if (seen != null) assertEquals(with, seen.getConvertProbability(), 0.001f, "on the client too");
    }

    // Bartolome de las Casas ----------------------------------------------

    @Test
    @Timeout(240)
    void lasCasasMakesEveryConvertAFreeColonist() throws Exception {
        final Colony colony = addColony();
        final String convert = "model.unit.indianConvert";
        final Unit working = addUnit(convert, colony.getTile(), true);
        final Unit outside = addUnit(convert, colony.getTile(), false);
        eventually("the client has the converts", () ->
            client.getGame().getFreeColGameObject(working.getId(), Unit.class) != null
            && client.getGame().getFreeColGameObject(outside.getId(), Unit.class) != null);
        assertEquals(convert, working.getType().getId());
        assertEquals(convert, outside.getType().getId());

        join("model.foundingFather.bartolomeDeLasCasas");

        for (Unit u : List.of(working, outside)) {
            assertEquals("model.unit.freeColonist", u.getType().getId(), "on the server: " + u);
            eventually("on the client: " + u, () -> client.getGame()
                .getFreeColGameObject(u.getId(), Unit.class).getType().getId()
                .equals("model.unit.freeColonist"));
        }
        assertEquals(0, us().getUnitSet().stream()
            .filter(u -> u.getType().getId().equals(convert)).count(), "no convert is left");
    }
}
