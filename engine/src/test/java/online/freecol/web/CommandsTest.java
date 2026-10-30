package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * The human plays turns through the same {@link Commands} the Browser UI
 * calls, in a Classic game between the two Engines: sail the ship to land,
 * put a colonist ashore, found a colony and end the turn.
 */
class CommandsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    private static final Pattern VALUE = Pattern.compile("\"value\":\"([^\"]*)\"");
    private static final Pattern ENABLED = Pattern.compile("\"enabled\":(true|false)");

    /** The questions the fake Browser UI answered, with its answers. */
    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());

    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /**
     * The fake Browser UI accepts every confirmation but sailing to
     * Europe, takes the first choice it can and keeps the suggested text
     * of an input.
     */
    private static String accept(String kind, String json) {
        switch (kind) {
        case "confirm": return String.valueOf(!json.contains("Europe"));
        case "choice":
            Matcher e = ENABLED.matcher(json);
            for (int i = 0; e.find(); i++) {
                if (e.group(1).equals("true")) return String.valueOf(i);
            }
            return null;
        default:
            Matcher m = VALUE.matcher(json);
            return m.find() ? m.group(1) : null;
        }
    }

    /** Start a Classic game with no autoplay and return once it is our turn. */
    private void startGame() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        server = new ServerEngine(
            xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {}
                public void ask(int id, String kind, String json) {
                    ui.execute(() -> {
                            String answer = accept(kind, json);
                            asked.add(kind + " " + json + " -> " + answer);
                            client.answer(id, answer);
                        });
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        ourTurn.await();
    }

    /** End our turn and wait until the AI hands play back. */
    private void endTurnAndWait(Commands commands) throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(commands.endTurn(), "end turn");
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            Thread.sleep(20);
        }
    }

    private Unit active() {
        return client.getClient().getGUI().getActiveUnit();
    }

    /** Click a tile until the wanted unit is the active one. */
    private void select(Commands commands, Unit unit) {
        final Tile tile = unit.getTile();
        for (int i = 0; i < 10 && active() != unit; i++) {
            assertTrue(commands.click(tile.getX(), tile.getY()), "click selects");
        }
        assertSame(unit, active());
    }

    /** The direction of the explored sea neighbour nearest a target. */
    private static Direction stepToward(Tile from, Tile target) {
        Direction best = null;
        int distance = Integer.MAX_VALUE;
        for (Direction d : Direction.values()) {
            Tile n = from.getNeighbourOrNull(d);
            if (n == null || !n.isExplored() || n.isLand()) continue;
            if (n.getDistanceTo(target) < distance) {
                distance = n.getDistanceTo(target);
                best = d;
            }
        }
        return best;
    }

    @Test
    @Timeout(180)
    void theHumanSailsToLandAndFoundsAColony() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Map map = client.getGame().getMap();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit colonist = ship.getUnitList().stream()
            .filter(u -> u.getType().canBuildColony()).findFirst().get();

        // The script knows the whole map, from the server: the nearest
        // free land we may settle, and the sea beside it. No one owns it,
        // so founding needs no land claim (native land is only free until
        // we meet its owners), and its centre tile alone feeds the
        // colonist, who would otherwise starve on, say, arctic land.
        final Map known = server.getGame().getMap();
        final Player us = server.getGame().getFreeColGameObject(player.getId(), Player.class);
        final Tile from = known.getTile(ship.getTile().getX(), ship.getTile().getY());
        final List<GoodsType> foods = server.getGame().getSpecification().getFoodGoodsTypeList();
        final int eats = foods.stream()
            .mapToInt(f -> colonist.getType().getConsumptionOf(f)).sum();
        final Tile coast = known.getTileSet(t -> t.isLand()
                && !t.hasSettlement() && t.getUnitCount() == 0
                && t.getOwner() == null && us.canClaimToFoundSettlement(t)
                && foods.stream().mapToInt(f -> t.getPotentialProduction(f, null)).sum() >= eats
                && t.getSurroundingTiles(1, 1).stream().anyMatch(n -> !n.isLand()))
            .stream()
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile offshore = coast.getSurroundingTiles(1, 1).stream()
            .filter(n -> !n.isLand())
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile land = map.getTile(coast.getX(), coast.getY());
        final Tile sea = map.getTile(offshore.getX(), offshore.getY());

        // Explore toward it step by step until the sea tile is in sight,
        // then go there.
        int turns = 0;
        while (!sea.isExplored()) {
            if (ship.getMovesLeft() == 0) {
                endTurnAndWait(commands);
                assertTrue(++turns < 8, "land is in sight within 8 turns");
            }
            select(commands, ship);
            assertTrue(commands.move(stepToward(ship.getTile(), sea).toString()),
                       "the ship moves");
        }
        if (ship.getTile() != sea) {
            select(commands, ship);
            assertTrue(commands.goTo(sea.getX(), sea.getY()), "the ship sets off");
        }
        while (ship.getTile() != sea) {
            endTurnAndWait(commands);
            assertTrue(++turns < 12, "the ship arrives within 12 turns");
        }

        select(commands, colonist);
        Direction toLand = map.getDirection(sea, land);
        assertTrue(commands.move(toLand.toString()), "the colonist lands");
        assertSame(land, colonist.getTile());
        if (!colonist.canBuildColony()) endTurnAndWait(commands);

        select(commands, colonist);
        assertTrue(commands.buildColony(), "colony founded");
        endTurnAndWait(commands);

        // The server's game agrees: our colony stands on that land.
        Colony colony = server.getGame().getMap()
            .getTile(land.getX(), land.getY()).getColony();
        assertNotNull(colony, () -> "the server has the colony; asked " + asked
            + "; told " + player.getModelMessages().stream().map(Messages::message).toList());
        assertEquals(player.getId(), colony.getOwner().getId());
    }
}
