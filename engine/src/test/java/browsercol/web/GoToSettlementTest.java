package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * A scout's Go To to a native settlement (#400): the path runs to the best
 * tile next to it and steps in, and the scout steps in when it gets there
 * with moves left, or at the start of its next turn, which opens the usual
 * speak / tribute / attack dialog.
 */
class GoToSettlementTest {

    private static final String SCOUT = "model.unit.seasonedScout";

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private ServerEngine server;
    private ClientEngine client;
    private final List<String> asked = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    /** Start a game with the map revealed; the fake Browser UI ends turns and cancels every other question. */
    private void startGame() throws Exception {
        final CountDownLatch finished = new CountDownLatch(1);
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + ":" + json);
                    final String answer = kind.equals("endTurn") ? "ok" : null;
                    toClient.execute(() -> client.answer(id, answer));
                }
            });
        server.startGame("classic", GamePreset.parse("{\"seed\":1,\"options\":{\"model.option.fogOfWar\":false}}"));
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(finished);
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
    }

    /** A native settlement, a free open tile next to it, and a free land tile next to that one but two from the settlement. */
    private static final class Spot {
        Tile village, next, far;
    }

    private static boolean free(Tile t) {
        return t != null && t.isLand() && !t.hasSettlement() && t.getUnitCount() == 0
            && !t.hasLostCityRumour();
    }

    /** On the server's map: one move from far to next leaves a scout moves, whatever the terrain's cost. */
    private Spot spot() {
        for (Player p : server.getGame().getLiveNativePlayerList()) {
            for (IndianSettlement is : p.getIndianSettlementList()) {
                for (Tile next : is.getTile().getSurroundingTiles(1, 1)) {
                    if (!free(next) || next.getType().getBasicMoveCost() > 3) continue;
                    for (Tile far : next.getSurroundingTiles(1, 1)) {
                        if (!free(far) || far.getDistanceTo(is.getTile()) != 2) continue;
                        // Every settlement next to far's way in is this one.
                        if (far.getSurroundingTiles(1, 2).stream()
                            .anyMatch(t -> t.hasSettlement() && t != is.getTile())) continue;
                        final Spot s = new Spot();
                        s.village = is.getTile();
                        s.next = next;
                        s.far = far;
                        return s;
                    }
                }
            }
        }
        return null;
    }

    private Tile clientTile(Tile t) {
        return client.getGame().getMap().getTile(t.getX(), t.getY());
    }

    /** Add a seasoned scout on a tile and wait for the client to see it. */
    private Unit addScout(Tile at) throws InterruptedException {
        server.debug("{\"action\":\"addUnit\",\"type\":\"" + SCOUT + "\",\"role\":\"model.role.scout\",\"x\":"
            + at.getX() + ",\"y\":" + at.getY() + "}");
        final Tile tile = clientTile(at);
        eventually("the scout", () -> tile.getUnitList().stream()
            .anyMatch(u -> u.getType().getId().equals(SCOUT)));
        return tile.getUnitList().stream()
            .filter(u -> u.getType().getId().equals(SCOUT)).findFirst().get();
    }

    /** Take the scout's moves for this turn, on the server and the client alike. */
    private void noMovesLeft(Unit scout) {
        server.getGame().getFreeColGameObject(scout.getId(), Unit.class).setMovesLeft(0);
        scout.setMovesLeft(0);
    }

    private boolean chiefAsked() {
        return asked.stream().anyMatch(s -> s.startsWith("choice:") && s.contains("chief"));
    }

    /** End our turn and wait for the next one. */
    private void endTurn() throws InterruptedException {
        final int turn = client.getGame().getTurn().getNumber();
        final Commands commands = client.getCommands();
        commands.endTurn();
        for (int i = 0; i < 3000; i++) {
            if (client.getClient().currentPlayerIsMyPlayer()
                && client.getGame().getTurn().getNumber() > turn) return;
            if (i % 100 == 99) commands.endTurn(); // a no-op while the AI plays
            Thread.sleep(20);
        }
        throw new AssertionError("the turn ended within 60 s; asked " + asked);
    }

    /** The last two steps of a path as MapJson.path writes it: [[x,y,turns], ...]. */
    private static int[][] lastTwo(String path) {
        final java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("\\[(-?\\d+),(-?\\d+),(-?\\d+)\\]").matcher(path);
        int[] before = null, last = null;
        while (m.find()) {
            before = last;
            last = new int[] { Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)),
                               Integer.parseInt(m.group(3)) };
        }
        assertNotNull(before, "a path of two steps or more: " + path);
        return new int[][] { before, last };
    }

    @Test
    @Timeout(240)
    void aScoutsPathEndsInTheSettlementAndItEntersOnArrival() throws Exception {
        startGame();
        final Spot s = spot();
        assertNotNull(s, "a native settlement with free land two tiles off");
        final Unit scout = addScout(s.far);
        final Commands commands = client.getCommands();
        final Tile village = clientTile(s.village);

        // The preview: the way to a tile next to the settlement, then the step in, this turn.
        final String path = commands.pathTo(scout.getId(), village.getX(), village.getY());
        final int[][] ends = lastTwo(path);
        assertEquals(village.getX(), ends[1][0], path);
        assertEquals(village.getY(), ends[1][1], path);
        final Tile before = client.getGame().getMap().getTile(ends[0][0], ends[0][1]);
        assertEquals(1, before.getDistanceTo(village), "the step before is next to the settlement: " + path);
        assertEquals(0, ends[1][2], "the scout enters this turn: " + path);

        // A Go To as the page sends it: the command, then what follows every command. The goto may
        // stop next to the settlement (a scout's step into a new region breaks it off); it steps in all the same.
        assertTrue(commands.goTo(scout.getId(), village.getX(), village.getY()), "the scout sets off");
        commands.afterCommand();
        eventually("the speak / tribute / attack choice on arrival", this::chiefAsked);
        assertEquals(1, scout.getTile().getDistanceTo(village), () -> "the scout stands next to the settlement: "
            + scout.getTile());
        assertNull(scout.getDestination(), "the Go To is done");
    }

    @Test
    @Timeout(240)
    void aScoutNextToASettlementWithNoMovesEntersAtTheStartOfItsNextTurn() throws Exception {
        startGame();
        final Spot s = spot();
        assertNotNull(s, "a native settlement with free land next to it");
        final Unit scout = addScout(s.next);
        noMovesLeft(scout);
        final Commands commands = client.getCommands();
        final Tile village = clientTile(s.village);

        final String path = commands.pathTo(scout.getId(), village.getX(), village.getY());
        final int[][] ends = lastTwo(path);
        assertEquals(village.getX(), ends[1][0], path);
        assertEquals(1, ends[1][2], "the scout enters next turn: " + path);

        assertTrue(commands.goTo(scout.getId(), village.getX(), village.getY()), "the order is taken");
        commands.afterCommand();
        Thread.sleep(500);
        assertFalse(chiefAsked(), () -> "nothing is asked before the scout has moves: " + asked);

        // No command: the start of the turn does it.
        endTurn();
        eventually("the choice at the start of the next turn", this::chiefAsked);
        assertEquals(clientTile(s.next), scout.getTile(), "the scout stays where it stood");
    }

    @Test
    @Timeout(240)
    void aScoutThatSetsOffNextTurnEntersWhenItsGotoOrdersBringItThere() throws Exception {
        startGame();
        final Spot s = spot();
        assertNotNull(s, "a native settlement with free land two tiles off");
        final Unit scout = addScout(s.far);
        noMovesLeft(scout);
        final Commands commands = client.getCommands();
        final Tile village = clientTile(s.village);

        assertTrue(commands.goTo(scout.getId(), village.getX(), village.getY()), "the order is taken");
        commands.afterCommand();
        assertEquals(village, scout.getDestination().getTile(), "the Go To is for the settlement");

        endTurn();
        Thread.sleep(500);
        assertFalse(chiefAsked(), () -> "the scout is not there yet: " + asked);
        // The goto orders run (Orders > Execute Goto Orders, or the end of the turn), again if a region the
        // scout discovers on the way breaks them off: it arrives with moves left.
        for (int run = 0; run < 3 && !chiefAsked(); run++) {
            commands.executeGotoOrders();
            commands.afterCommand();
            for (int i = 0; i < 100 && !chiefAsked(); i++) Thread.sleep(20);
        }
        assertTrue(chiefAsked(), () -> "the choice on arrival: scout at " + scout.getTile() + " moves "
            + scout.getMovesLeft() + " to " + scout.getDestination() + "; asked " + asked);
        assertEquals(1, scout.getTile().getDistanceTo(village), "the scout stands next to the settlement");
    }

    @Test
    @Timeout(240)
    void aScoutsGoToIntoASettlementGoesOnPastTheRegionsItDiscovers() throws Exception {
        startGame();
        final Spot s = spot();
        assertNotNull(s, "a native settlement with free land two tiles off");
        final Unit scout = addScout(s.far);
        noMovesLeft(scout);
        final Commands commands = client.getCommands();
        final Tile village = clientTile(s.village);
        // Next turn, with its moves: on this map the way in crosses a region nobody has discovered, where
        // FreeCol's goto stops for the naming dialog. One Go To, as the page sends it, is all the same enough.
        endTurn();
        assertTrue(commands.goTo(scout.getId(), village.getX(), village.getY()), "the scout sets off");
        commands.afterCommand();
        eventually("the choice on arrival", this::chiefAsked);
        assertTrue(asked.stream().anyMatch(q -> q.contains("discovered")),
            () -> "the scout discovered a region on the way: " + asked);
        assertEquals(1, scout.getTile().getDistanceTo(village), "the scout stands next to the settlement");
    }
}
