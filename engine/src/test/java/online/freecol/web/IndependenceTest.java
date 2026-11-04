package online.freecol.web;

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
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.HistoryEvent;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.model.ServerPlayer;


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
                && !json.contains(Json.quote(Messages.message("victory.text"))));
        case "endTurn": return "ok";
        case "father": case "choice": return "0";
        default: return null;
        }
    }

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
            assertTrue(now - start < 120_000, "the turn ended within 120 s");
            if (now - pressed > 2_000) {
                commands.endTurn(); // a no-op while the AI plays
                pressed = now;
            }
        }
    }

    // How the war ends ----------------------------------------------------

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
