package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.HistoryEvent;
import net.sf.freecol.common.model.Limit;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.server.control.InGameController;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * FreeCol's War of Independence, in a game between the two Engines: who
 * may declare, what declaring does, the Royal Expeditionary Force and how
 * the war ends. The server's game is changed from the test thread, as the
 * debug actions do, and each test checks its effect is absent before and
 * present after, so it cannot pass for want of the effect.
 */
class IndependenceTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;

    /** The questions the fake Browser UI was asked, as "kind json". */
    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
        // JUnit keeps every test instance until the run ends: let the games go.
        server = null;
        client = null;
    }

    /** Start a Classic game from a preset and return once it is our turn. */
    private void start(String presetJson) throws Exception {
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
                    ui.execute(() -> client.answer(id, answer(kind, json)));
                }
            });
        server.startGame("classic", GamePreset.parse(presetJson));
        assertTrue(client.startGame(0), "login");
        assertTrue(ourTurn.await(120, TimeUnit.SECONDS), "our first turn");
    }

    /**
     * Confirm all but sailing to Europe and the end of the game (keep
     * playing), end the turn, and take the first choice.
     */
    private String answer(String kind, String json) {
        switch (kind) {
        case "confirm":
            return String.valueOf(!json.contains("Europe")
                && !json.contains(Json.quote(Messages.message("victory.text")))
                && !json.contains(Json.quote(Messages.message("defeatedSinglePlayer.text"))));
        case "endTurn": return "ok";
        case "father": case "choice": return "0";
        default: return null;
        }
    }

    /** The dutch-small map (seed 1) with no setup: we start colonial, at sea. */
    private static final String GAME = "{\"difficulty\":\"model.difficulty.veryEasy\","
        + "\"nation\":\"model.nation.dutch\",\"seed\":1,\"options\":{"
        + "\"model.option.mapWidth\":40,\"model.option.mapHeight\":60,"
        + "\"model.option.fogOfWar\":false}}";

    private static String preset(String name) throws Exception {
        return Files.readString(Path.of(System.getProperty("presets.dir"), name + ".json"));
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    /** The human player, on the server. */
    private ServerPlayer us() {
        return server.getGame().getFreeColGameObject(me().getId(), ServerPlayer.class);
    }

    private Specification spec() {
        return server.getGame().getSpecification();
    }

    private InGameController igc() {
        return server.getServer().getInGameController();
    }

    private static Object field(Object json, String key) {
        return ((java.util.Map<?, ?>)JsonReader.read((String)json)).get(key);
    }

    /** A colony of ours, as the debug menu founds one (on the coast, by the ship). */
    private Colony addColony() {
        final String id = (String)field(server.debug("{\"action\":\"addColony\"}"), "colony");
        return server.getGame().getFreeColGameObject(id, Colony.class);
    }

    /**
     * Another colony of ours, on the nearest land a colony can be founded
     * on to the given one, off the map's polar rows and edges.
     */
    private Colony addColonyNear(Colony near) {
        final net.sf.freecol.common.model.Map map = server.getGame().getMap();
        final ServerPlayer us = us();
        Tile best = null;
        for (int x = 1; x < map.getWidth() - 1; x++) {
            for (int y = 2; y < map.getHeight() - 2; y++) {
                final Tile t = map.getTile(x, y);
                if (t == null || !t.isLand() || !us.canClaimToFoundSettlement(t)) continue;
                if (best == null || t.getDistanceTo(near.getTile()) < best.getDistanceTo(near.getTile())) best = t;
            }
        }
        assertNotNull(best, "land for a second colony");
        final String id = (String)field(server.debug("{\"action\":\"addColony\",\"x\":"
            + best.getX() + ",\"y\":" + best.getY() + "}"), "colony");
        return server.getGame().getFreeColGameObject(id, Colony.class);
    }

    /**
     * A colony of ours on a port with land around it to land on, away
     * from the poles and the map's edges, nearest our ship.
     */
    private Colony addPortColony() {
        final net.sf.freecol.common.model.Map map = server.getGame().getMap();
        final ServerPlayer us = us();
        final Tile from = us.getUnits().filter(Unit::isNaval).findFirst().get().getTile();
        Tile best = null;
        for (int x = 2; x < map.getWidth() - 2; x++) {
            for (int y = 4; y < map.getHeight() - 4; y++) {
                final Tile t = map.getTile(x, y);
                if (t == null || !t.isLand() || !us.canClaimToFoundSettlement(t)) continue;
                final List<Tile> around = t.getSurroundingTiles(1, 1);
                if (around.stream().filter(Tile::isLand).count() < 4) continue;
                if (around.stream().noneMatch(n -> !n.isLand() && n.isHighSeasConnected())) continue;
                if (best == null || t.getDistanceTo(from) < best.getDistanceTo(from)) best = t;
            }
        }
        assertNotNull(best, "a port with land around it");
        final String id = (String)field(server.debug("{\"action\":\"addColony\",\"x\":"
            + best.getX() + ",\"y\":" + best.getY() + "}"), "colony");
        return server.getGame().getFreeColGameObject(id, Colony.class);
    }

    /** A unit of ours on the tile, with the role; on the server. */
    private Unit addUnit(String type, String role, Tile tile) {
        final String id = (String)field(server.debug("{\"action\":\"addUnit\",\"type\":\""
            + type + "\"" + ((role == null) ? "" : ",\"role\":\"" + role + "\"")
            + ",\"x\":" + tile.getX() + ",\"y\":" + tile.getY() + "}"), "unit");
        return server.getGame().getFreeColGameObject(id, Unit.class);
    }

    private <T extends net.sf.freecol.common.model.FreeColGameObject> T onClient(T o, Class<T> c) {
        return client.getGame().getFreeColGameObject(o.getId(), c);
    }

    /** The share of rebels in a colony, on the server and the client. */
    private void rebels(Colony colony, int percent) throws Exception {
        eventually("the client has the colony " + colony + " at " + colony.getTile(),
            () -> onClient(colony, Colony.class) != null);
        final java.lang.reflect.Field f = Colony.class.getDeclaredField("sonsOfLiberty");
        f.setAccessible(true);
        f.setInt(colony, percent);
        f.setInt(onClient(colony, Colony.class), percent);
    }

    /** We declare, as the server has us declare, and the client hears of it. */
    private ServerPlayer declare() throws InterruptedException {
        server.debug("{\"action\":\"declareIndependence\",\"nation\":\"Free Test\","
            + "\"country\":\"United Test\"}");
        eventually("the client is a rebel", () -> me().isRebel());
        return (ServerPlayer)us().getREFPlayer();
    }

    /** End our turn and wait until play comes back to us. */
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
            assertTrue(now - start < 120_000, () -> "the turn ended within 120 s; current "
                + client.getGame().getCurrentPlayer() + ", turn " + client.getGame().getTurn()
                + ", asked " + asked.stream().map(q -> q.substring(0, Math.min(200, q.length()))).toList());
            if (now - pressed > 2_000) {
                commands.endTurn(); // a no-op while the AI plays
                pressed = now;
            }
        }
    }

    // Who may declare ------------------------------------------------------

    /** The limit of the declaration event the player is short of, or null. */
    private String shortOf(Player p) {
        final StringTemplate t = p.checkDeclareIndependence();
        if (t == null) return null;
        for (Limit l : p.getSpecification().getEvent("model.event.declareIndependence").getLimitValues()) {
            if (l.getDescriptionKey().equals(t.getId())) return l.getId();
        }
        return t.getId();
    }

    /**
     * The declaration's limits (model.event.declareIndependence): half
     * our colonists rebels, a port, and no later than the last colonial
     * year. Short of half, the Browser UI's Declare Independence explains
     * and asks for no names.
     */
    @Test
    @Timeout(240)
    void declaringNeedsHalfOurColonistsRebelsAndNotTooLate() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        assertTrue(colony.isConnectedPort(), "the colony is a port");

        rebels(colony, 49);
        assertEquals("model.limit.independence.rebels", shortOf(us()));
        assertEquals("model.limit.independence.rebels", shortOf(me()), "the client agrees");
        asked.clear();
        assertFalse(client.getCommands().declareIndependence(), "not yet");
        assertFalse(asked.stream().anyMatch(q -> q.startsWith("names ")), asked.toString());
        assertEquals(Player.PlayerType.COLONIAL, us().getPlayerType());

        rebels(colony, 50);
        assertNull(shortOf(us()), "half is enough");
        assertNull(shortOf(me()), "the client agrees");

        // Too late: after the last colonial year (1800) there is no declaring.
        final Turn now = server.getGame().getTurn();
        final int last = spec().getInteger(GameOptions.LAST_COLONIAL_YEAR);
        server.getGame().setTurn(new Turn(Turn.yearToTurn(last + 1)));
        try {
            assertEquals("model.limit.independence.year", shortOf(us()));
        } finally {
            server.getGame().setTurn(now);
        }
        assertNull(shortOf(us()));
    }

    // What declaring does -------------------------------------------------

    /**
     * InGameController.declareIndependence: the new nation's names, Europe
     * and what is in it or sailing to it gone, the REF made and at war with
     * us, the declaration in our history, and no more founding fathers.
     */
    @Test
    @Timeout(240)
    void declaringCutsOffEuropeAndStartsTheWar() throws Exception {
        start(GAME);
        final ServerPlayer us = us();
        final Colony colony = addColony();
        rebels(colony, 60);
        // A colonist on the docks, and the ship sailing to Europe.
        final Europe europe = us.getEurope();
        final Unit docker = new ServerUnit(server.getGame(), europe, us,
            spec().getUnitType("model.unit.freeColonist"));
        final Unit ship = us.getUnits().filter(Unit::isNaval).findFirst().get();
        ship.setLocation(us.getHighSeas());
        ship.setDestination(europe);
        final String oldName = Messages.message(us.getNationLabel());

        assertNotNull(me().getEurope(), "the client has Europe");
        assertTrue(me().canMoveToEurope());
        assertNull(us.getREFPlayer(), "no REF yet");
        assertTrue(us.canRecruitFoundingFather() || us.getCurrentFather() != null,
            "fathers join a colony");
        assertFalse(us.getHistory().stream().anyMatch(h ->
            h.getEventType() == HistoryEvent.HistoryEventType.DECLARE_INDEPENDENCE));

        final ServerPlayer ref = declare();

        assertEquals(Player.PlayerType.REBEL, us.getPlayerType());
        assertEquals("Free Test", us.getIndependentNationName());
        assertEquals("United Test", us.getNewLandName());
        assertFalse(oldName.equals(Messages.message(us.getNationLabel())), "a new nation's name");
        eventually("the client has the names", () -> "Free Test".equals(me().getIndependentNationName())
            && "United Test".equals(me().getNewLandName()));
        // Europe and its trade are gone.
        assertNull(us.getEurope(), "the server's Europe is gone");
        assertTrue(europe.isDisposed());
        eventually("the client's Europe is gone", () -> me().getEurope() == null);
        assertFalse(me().canMoveToEurope());
        assertTrue(docker.isDisposed(), "the colonist in Europe was seized");
        assertTrue(ship.isDisposed(), "the ship sailing to Europe was seized");
        // The REF: the Crown's force, in its own Europe, at war with us.
        assertNotNull(ref, "the REF");
        assertTrue(ref.isREF());
        assertTrue(ref.getUnitCount() > 0);
        assertTrue(ref.getUnits().noneMatch(Unit::hasTile), "the REF has not sailed yet");
        assertEquals(Stance.WAR, us.getStance(ref));
        assertEquals(Stance.WAR, ref.getStance(us));
        eventually("the client is at war with the REF", () -> {
            final Player r = client.getGame().getFreeColGameObject(ref.getId(), Player.class);
            return r != null && me().getStance(r) == Stance.WAR;
        });
        assertTrue(us.getHistory().stream().anyMatch(h ->
            h.getEventType() == HistoryEvent.HistoryEventType.DECLARE_INDEPENDENCE));
        // Founding fathers stop joining (continueFoundingFatherRecruitment is off).
        assertFalse(spec().getBoolean(GameOptions.CONTINUE_FOUNDING_FATHER_RECRUITMENT));
        assertFalse(us.canRecruitFoundingFather());
    }

    /**
     * The continental army muster: in each colony more than half rebel,
     * veteran soldiers become Continental regulars, (colonists + 2) times
     * the rebels over half of them; a colony at half musters none.
     */
    @Test
    @Timeout(240)
    void declaringMustersTheContinentalArmy() throws Exception {
        start(GAME);
        final Colony rebel = addColony();
        final Unit v1 = addUnit("model.unit.veteranSoldier", "model.role.soldier", rebel.getTile());
        final Unit v2 = addUnit("model.unit.veteranSoldier", "model.role.soldier", rebel.getTile());
        final Colony half = addColonyNear(rebel);
        final Unit v3 = addUnit("model.unit.veteranSoldier", "model.role.soldier", half.getTile());
        // One colonist works in each; the soldiers stand on the tile.
        assertEquals(1 + 2, rebel.getAllUnitsList().size());
        rebels(rebel, 100);
        rebels(half, 50);
        final String veteran = "model.unit.veteranSoldier";
        final String regular = "model.unit.colonialRegular";
        for (Unit v : List.of(v1, v2, v3)) assertEquals(veteran, v.getType().getId());
        assertFalse(spec().getUnitType(regular).isAvailableTo(us()), "no regulars before declaring");

        declare();

        // (3 + 2) * (100 - 50) / 100 = 2: both veterans of the rebel colony.
        assertEquals(regular, v1.getType().getId());
        assertEquals(regular, v2.getType().getId());
        assertEquals(veteran, v3.getType().getId(), "a colony at half musters none");
        assertTrue(spec().getUnitType(regular).isAvailableTo(us()));
        eventually("the client has the regulars", () ->
            regular.equals(onClient(v1, Unit.class).getType().getId())
            && regular.equals(onClient(v2, Unit.class).getType().getId())
            && veteran.equals(onClient(v3, Unit.class).getType().getId()));
    }

    /**
     * The Tories: a REF unit attacking a rebel colony gets the colony's
     * Tories (100 less its rebels, in percent) as popular support
     * (SimpleCombatModel.addPopularSupportBonus); a colony all rebels
     * gives it none.
     */
    @Test
    @Timeout(240)
    void toriesGiveTheREFPopularSupport() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        rebels(colony, 100);
        final ServerPlayer ref = declare();
        final Unit regular = ref.getUnits().filter(u -> !u.isNaval() && u.isOffensiveUnit())
            .findFirst().get();
        final net.sf.freecol.common.model.SimpleCombatModel combat =
            (net.sf.freecol.common.model.SimpleCombatModel)server.getGame().getCombatModel();
        final java.util.function.Supplier<List<Modifier>> support = () ->
            combat.getOffensiveModifiers(regular, colony).stream()
                .filter(m -> Modifier.POPULAR_SUPPORT.equals(m.getId())).toList();
        assertTrue(support.get().isEmpty(), "no Tories, no support");

        rebels(colony, 30);
        final List<Modifier> tories = support.get();
        assertEquals(1, tories.size(), tories.toString());
        assertEquals(70f, tories.get(0).getValue());
        assertEquals(Modifier.ModifierType.PERCENTAGE, tories.get(0).getType());
    }

    /**
     * The Crown acts on colonies only (InGameController.endTurn calls
     * csMonarchAction for COLONIAL players): the same tax raise the
     * monarch makes before we declare, he does not make after.
     */
    @Test
    @Timeout(300)
    void theCrownRaisesNoTaxOnRebels() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        addUnit("model.unit.artillery", null, colony.getTile());
        rebels(colony, 60);
        // The tax raise names goods to boycott if refused: the colony needs
        // some it has traded (Player.getMostValuableGoods).
        us().getMarket().getMarketData(spec().getGoodsType("model.goods.furs")).setTraded(true);
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.furs\",\"amount\":100,\"x\":"
            + colony.getTile().getX() + ",\"y\":" + colony.getTile().getY() + "}");
        final java.lang.reflect.Field player = InGameController.class.getDeclaredField("debugMonarchPlayer");
        final java.lang.reflect.Field action = InGameController.class.getDeclaredField("debugMonarchAction");
        player.setAccessible(true);
        action.setAccessible(true);

        assertEquals(0, us().getTax());
        player.set(igc(), us());
        action.set(igc(), MonarchAction.RAISE_TAX_ACT);
        endTurnAndWait();
        eventually("the colony's tax is raised, as the Browser UI accepts it", () -> us().getTax() > 0);
        final int taxed = us().getTax();
        assertNull(action.get(igc()), "the monarch acted");
        // The answered tax raise's session lasts to the next turn, and
        // declaring this turn would meet it (#173): declare next turn,
        // when the Crown does nothing (no new session either).
        player.set(igc(), us());
        action.set(igc(), MonarchAction.NO_ACTION);
        endTurnAndWait();

        rebels(colony, 60);
        declare();
        player.set(igc(), us());
        action.set(igc(), MonarchAction.RAISE_TAX_ACT);
        endTurnAndWait();
        assertEquals(taxed, us().getTax(), "no raise for rebels");
        assertEquals(MonarchAction.RAISE_TAX_ACT, action.get(igc()), "the monarch did not act");
        action.set(igc(), null);
    }

    /**
     * The Crown raises the tax at the start of our turn, we accept, and we
     * declare that same turn. The declaration offers mercenaries in a new
     * monarch session, but the answered tax raise's session stays
     * registered until the next turn (Session.completeAll in
     * ServerGame.csNextTurn), and Session's constructor refuses its key:
     * the declaration stopped half done with "Duplicate session" (#173).
     * The patched Session drops a completed session with the same key.
     */
    @Test
    @Timeout(300)
    void declaringTheTurnATaxRaiseWasAcceptedCompletes() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        addUnit("model.unit.artillery", null, colony.getTile());
        rebels(colony, 60);
        // Gold for the mercenaries the declaration offers.
        server.debug("{\"action\":\"addGold\",\"amount\":20000}");
        us().getMarket().getMarketData(spec().getGoodsType("model.goods.furs")).setTraded(true);
        server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.furs\",\"amount\":100,\"x\":"
            + colony.getTile().getX() + ",\"y\":" + colony.getTile().getY() + "}");
        final java.lang.reflect.Field player = InGameController.class.getDeclaredField("debugMonarchPlayer");
        final java.lang.reflect.Field action = InGameController.class.getDeclaredField("debugMonarchAction");
        player.setAccessible(true);
        action.setAccessible(true);
        player.set(igc(), us());
        action.set(igc(), MonarchAction.RAISE_TAX_ACT);
        endTurnAndWait();
        eventually("the tax raise is accepted", () -> us().getTax() > 0);
        assertNull(us().getREFPlayer(), "not declared yet");

        rebels(colony, 60);
        declare();

        assertNull(us().getEurope(), "the declaration completed: Europe is gone");
        eventually("and the client's", () -> me().getEurope() == null);
    }

    // The Royal Expeditionary Force ---------------------------------------

    /**
     * At its first turn the REF picks a colony of ours to attack, sails in
     * (teleportREF: straight to it) and lands its army beside it.
     */
    @Test
    @Timeout(300)
    void theREFSailsInAndLands() throws Exception {
        start(GAME);
        refLandsBeside(addPortColony());
    }

    /**
     * The REF lands beside a colony on the polar land strip, in the
     * north-east corner (the debug colony of this map, at 38,1). FreeCol
     * gave that strip the main ocean's contiguity, so the army on the
     * ships looked as if it could walk there, was given no transport and
     * sailed back to Europe (#172, fixed in our patched Map.java).
     */
    @Test
    @Timeout(300)
    void theREFLandsBesideAColonyInTheMapsCorner() throws Exception {
        start(GAME);
        final Colony corner = addColony();
        assertEquals(38, corner.getTile().getX());
        assertEquals(1, corner.getTile().getY());
        refLandsBeside(corner);
    }

    /** Declare with the colony our one port, and see the REF land beside it within four turns. */
    private void refLandsBeside(Colony colony) throws Exception {
        for (int i = 0; i < 3; i++) addUnit("model.unit.artillery", null, colony.getTile());
        rebels(colony, 60);
        final ServerPlayer ref = declare();
        assertTrue(ref.getUnits().noneMatch(Unit::hasTile), "the REF is in Europe");
        assertNull(ref.getEntryTile(), "and not launched");

        final java.util.function.Predicate<Unit> ashore = u -> !u.isNaval()
            && u.getTile() != null && u.getTile().isLand();
        for (int turn = 0; turn < 4 && !ref.getUnits().anyMatch(ashore); turn++) {
            endTurnAndWait();
        }
        assertTrue(ref.getUnits().anyMatch(ashore), () -> "the REF's army has landed: entry "
            + ref.getEntryTile() + ", units " + ref.getUnits().map(u -> u.getType().getSuffix()
                + "@" + u.getLocation()).toList() + ", turn " + server.getGame().getTurn()
            + ", current " + server.getGame().getCurrentPlayer() + ", asked " + asked);
        final Tile landed = ref.getUnits().filter(ashore).findFirst().get().getTile();
        assertTrue(landed.getDistanceTo(colony.getTile()) <= 3,
            () -> "it landed by our colony, at " + landed.getDistanceTo(colony.getTile()));
        assertNotNull(ref.getEntryTile(), "the REF was launched");
        eventually("the client sees the REF ashore", () -> client.getGame().getMap()
            .getTile(landed.getX(), landed.getY()).getUnitList().stream()
            .anyMatch(u -> u.getOwner().getId().equals(ref.getId()) && !u.isNaval()));
    }

    /**
     * The foreign intervention: once the liberty we make after declaring
     * reaches interventionBells, the intervention force (the monarch's
     * interventionForce) arrives at the next turn, ours, by a port. The
     * bells come in the turn we declare: by the end of the next turn the
     * REF has landed and taken the colony, our one port (#172).
     */
    @Test
    @Timeout(300)
    void libertyDuringTheWarBringsTheInterventionForce() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        for (int i = 0; i < 3; i++) addUnit("model.unit.artillery", null, colony.getTile());
        rebels(colony, 60);
        declare();
        final ServerPlayer us = us();
        final String manOWar = "model.unit.manOWar";
        final int force = us.getMonarch().getInterventionForce().getNavalUnitsList().stream()
            .mapToInt(AbstractUnit::getNumber).sum();
        assertTrue(force > 0, "there is an intervention force");
        final int bells = spec().getInteger(GameOptions.INTERVENTION_BELLS);

        assertEquals(0, us.getUnits().filter(u -> manOWar.equals(u.getType().getId())).count(),
            "no intervention yet");

        us.modifyLiberty(bells);
        endTurnAndWait();
        assertEquals(force, us.getUnits().filter(u -> manOWar.equals(u.getType().getId())).count(),
            "the intervention force's ships are ours");
        assertTrue(us.getUnits().anyMatch(u -> manOWar.equals(u.getType().getId())
            && u.getTile() != null && u.getUnitCount() > 0), "on the map, with troops aboard");
        final Unit ship = us.getUnits().filter(u -> manOWar.equals(u.getType().getId())).findFirst().get();
        eventually("the client sees them", () -> client.getGame().getMap()
            .getTile(ship.getTile().getX(), ship.getTile().getY()).getUnitList().stream()
            .anyMatch(u -> u.getId().equals(ship.getId()) && u.getOwner() == me()));
    }

    /**
     * A rebel needs a port (ServerPlayer.checkForDeath): with our one
     * colony taken by the REF we are dead, and the Browser UI is told.
     */
    @Test
    @Timeout(300)
    void losingOurLastPortLosesTheWar() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        rebels(colony, 60);
        final ServerPlayer ref = declare();
        final ServerPlayer us = us();
        assertEquals(1, us.getNumberOfPorts());
        assertFalse(us.isDead());

        // The REF takes the colony, as when it captures one.
        final ChangeSet cs = new ChangeSet();
        ((ServerColony)colony).csChangeOwner(ref, false, null, cs);
        cs.add(See.perhaps(), colony.getTile());
        ((ServerGame)server.getGame()).sendTo(us, cs);
        assertEquals(0, us.getNumberOfPorts());
        assertFalse(us.isDead(), "not until the server checks");

        assertTrue(client.getCommands().endTurn(), "end turn");
        for (int i = 0; i < 6000 && !us.isDead(); i++) Thread.sleep(20);
        assertTrue(us.isDead(), "we lost the war");
        final String single = Json.quote(Messages.message("defeatedSinglePlayer.text"));
        final String multi = Json.quote(Messages.message("defeated.text"));
        eventually("the Browser UI is told", () -> asked.stream()
            .anyMatch(q -> q.startsWith("confirm ") && (q.contains(single) || q.contains(multi))));
    }

    // How the war ends ----------------------------------------------------

    /**
     * The REF also gives up when it is down to one ship (fewer than two,
     * ServerPlayer.checkForREFDefeat) and our land army outweighs what it
     * thinks of its own, though it still has its army. With its fleet it
     * fights on; with its ships but one sunk, it grants independence.
     */
    @Test
    @Timeout(400)
    void theREFGivesUpWhenItRunsOutOfShips() throws Exception {
        start(GAME);
        final Colony colony = addColony();
        rebels(colony, 60);
        final ServerPlayer ref = declare();
        final ServerPlayer us = us();
        // An army half again as strong as the REF's land army, and more.
        while (us.calculateStrength(false) <= 2 * ref.calculateStrength(false)) {
            addUnit("model.unit.artillery", null, colony.getTile());
        }
        final java.util.function.ToLongFunction<Boolean> count = naval ->
            ref.getUnits().filter(u -> u.isNaval() == naval).count();
        assertTrue(count.applyAsLong(true) >= 2, "the REF has a fleet");
        assertTrue(count.applyAsLong(false) >= 7, "and an army");

        // With its fleet, the REF fights on.
        endTurnAndWait();
        assertFalse(ref.isDead(), "the REF fights on");
        assertEquals(Player.PlayerType.REBEL, us.getPlayerType());

        // Its army off the ships, into its Europe, and all its ships but one sunk.
        final Europe europe = ref.getEurope();
        for (Unit u : new ArrayList<>(ref.getUnitSet())) {
            if (!u.isNaval() && u.isOnCarrier()) u.setLocation(europe);
        }
        final List<Unit> ships = ref.getUnits().filter(Unit::isNaval).toList();
        final ChangeSet cs = new ChangeSet();
        for (Unit ship : ships.subList(1, ships.size())) {
            final Tile at = ship.getTile();
            ((ServerUnit)ship).csRemove(See.perhaps(), at, cs);
        }
        ((ServerGame)server.getGame()).sendTo(us, cs);
        assertEquals(1, count.applyAsLong(true), "one ship left");
        assertTrue(count.applyAsLong(false) >= 7, "the army is whole");
        assertTrue(us.calculateStrength(false) > 1.5 * ref.calculateStrength(false));

        endTurnAndWait();
        assertTrue(ref.isDead(), "the REF withdrew");
        assertEquals(Player.PlayerType.INDEPENDENT, us.getPlayerType(), "independence granted");
        eventually("the client is independent", () ->
            me().getPlayerType() == Player.PlayerType.INDEPENDENT);
    }

    /**
     * The ref-last-stand preset: the REF is down to one regular, on land,
     * with our army on every land tile around it. At the REF's next turn
     * it finds itself beaten (ServerPlayer.checkForREFDefeat: fewer than
     * seven land units and a rebel army stronger than it thinks its own)
     * and grants independence (InGameController.csGiveIndependence): we
     * are independent, pay no tax, the REF withdraws, and having beaten it
     * we are offered the victory.
     */
    @Test
    @Timeout(300)
    void theREFGivesUpWhenItsLastUnitIsSurrounded() throws Exception {
        start(preset("ref-last-stand"));
        server.setup();

        // The scenario: rebels at war with a REF of one regular, surrounded.
        final ServerPlayer us = us();
        final ServerPlayer ref = (ServerPlayer)us.getREFPlayer();
        assertNotNull(ref, "the REF");
        assertEquals(Player.PlayerType.REBEL, us.getPlayerType());
        assertEquals(Stance.WAR, us.getStance(ref));
        assertEquals(1, ref.getUnitCount(), "the REF has one unit left");
        final Unit regular = ref.getUnitSet().iterator().next();
        final Tile at = regular.getTile();
        assertNotNull(at, "the regular stands on the map");
        assertTrue(at.isLand());
        int around = 0;
        for (Tile t : at.getSurroundingTiles(1, 1)) {
            if (!t.isLand()) continue;
            assertTrue(t.hasSettlement() || t.getUnitList().stream()
                .anyMatch(u -> u.getOwner() == us && u.isOffensiveUnit()),
                () -> "our army is at " + t.getX() + "," + t.getY());
            around++;
        }
        assertTrue(around >= 3, "the regular is surrounded on land");
        assertTrue(us.calculateStrength(false) > 1.5 * ref.calculateStrength(false),
            "our army outweighs the REF's");
        eventually("the client sees the regular and the war", () -> {
            final Player cRef = client.getGame().getFreeColGameObject(ref.getId(), Player.class);
            return me().isRebel() && cRef != null && me().getStance(cRef) == Stance.WAR
                && client.getGame().getFreeColGameObject(regular.getId(), Unit.class) != null;
        });
        // Not yet won: still rebels, still taxed as before, no independence.
        final int tax = us.getTax();
        assertFalse(us.getHistory().stream().anyMatch(h ->
            h.getEventType() == HistoryEvent.HistoryEventType.INDEPENDENCE));
        assertFalse(ref.isDead());

        endTurnAndWait();

        assertEquals(Player.PlayerType.INDEPENDENT, us.getPlayerType(), "independence granted");
        assertTrue(ref.isDead(), "the REF withdrew");
        assertEquals(0, us.getTax(), "no more tax (it was " + tax + ")");
        assertTrue(us.getHistory().stream().anyMatch(h ->
            h.getEventType() == HistoryEvent.HistoryEventType.INDEPENDENCE));
        // Only units that can be surrendered change sides; the King's
        // regulars cannot (canBeSurrendered false in the Classic rules).
        assertFalse(regular.hasAbility(net.sf.freecol.common.model.Ability.CAN_BE_SURRENDERED));
        assertTrue(regular.isDisposed() || regular.getOwner() != us, "the regular does not join us");
        eventually("the client is independent", () ->
            me().getPlayerType() == Player.PlayerType.INDEPENDENT);
        // The server picks a winner as a turn ends (InGameController.endTurn
        // calls checkForWinner first), and the REF gave up after that, so
        // the victory comes as play next reaches us, a round later.
        final String victory = Json.quote(Messages.message("victory.text"));
        assertFalse(asked.stream().anyMatch(q -> q.contains(victory)), "no victory yet");
        endTurnAndWait();
        eventually("we are offered the victory", () -> asked.stream()
            .anyMatch(q -> q.startsWith("confirm ") && q.contains(victory)));
    }
}
