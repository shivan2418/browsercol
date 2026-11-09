package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * A ship sent to Europe sails onto the high seas when the goto orders run,
 * which happens once no unit is left to cycle through. Upstream's
 * doExecuteGotoOrders selects each unit it moves, and stops at the ship, as
 * moveTowardEurope says the move cannot go on: the ship, off the map with no
 * moves, was left as the active unit (#428). The owner's save from turn 50
 * has the merchantman next to a native settlement and three colonists to
 * move.
 */
class NextUnitSailingTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    private static final Pattern CHOICES = Pattern.compile("\"choices\":\\[(.*)]");
    private static final Pattern TEXT = Pattern.compile("\"text\":\"((?:[^\"\\\\]|\\\\.)*)\"");

    private ClientEngine client;
    private Unit ship;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /** Pick Amsterdam as the destination; agree to every confirmation and to ending the turn. */
    private static String answer(String kind, String json) {
        switch (kind) {
        case "choice":
            final Matcher c = CHOICES.matcher(json);
            if (!c.find()) return null;
            final List<String> texts = new ArrayList<>();
            final Matcher t = TEXT.matcher(c.group(1));
            while (t.find()) texts.add(t.group(1));
            final int i = texts.indexOf("Amsterdam");
            return (i < 0) ? null : String.valueOf(i);
        case "confirm":
            return "true";
        case "endTurn":
            return "ok";
        default:
            return null;
        }
    }

    private Unit active() {
        return client.getClient().getGUI().getActiveUnit();
    }

    /** Load the owner's save and send the merchantman to Europe: it gets part of the way this turn. */
    @BeforeEach
    void sendTheShipToEurope() throws Exception {
        final File save = new File(System.getProperty("engine.src"),
            "test/resources/next-unit/merchantman-by-a-village.fsg");
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client.receive(xml)));
        server.loadGame(Files.readAllBytes(save.toPath()));
        final CountDownLatch ourTurn = new CountDownLatch(1);
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
                    ui.execute(() -> client.answer(id, answer(kind, json)));
                }
            });
        assertTrue(client.startGame(0, server.ownerName()), "login");
        FirstTurn.await(ourTurn);

        ship = client.getClient().getMyPlayer()
            .getOurFreeColGameObject("unit:6005", Unit.class);
        assertNotNull(ship, "the merchantman");
        final Tile tile = ship.getTile();
        for (int i = 0; i < 10 && active() != ship; i++) {
            client.getCommands().click(tile.getX(), tile.getY());
        }
        assertSame(ship, active(), "the merchantman is selected");
        assertTrue(client.getCommands().selectDestination(), "the merchantman sets off");
        assertTrue(ship.getDestination() instanceof Europe, "bound for Europe");
        assertTrue(ship.hasTile(), "still on the map at the end of this turn");
    }

    /** Sentry the active units until none is left, or until the ship is the active one. */
    private void sentryTheRest() {
        for (int i = 0; i < 10 && active() != null && active() != ship; i++) {
            assertTrue(client.getCommands().sentry(), "sentry " + active());
        }
    }

    /** End the turn and wait until it is ours again. */
    private void endTurnAndWait() throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(client.getCommands().endTurn(), "end turn");
        final long deadline = System.currentTimeMillis() + 60_000;
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            if (System.currentTimeMillis() > deadline) fail("our turn never came back");
            Thread.sleep(20);
        }
    }

    /** Wait for the ship to reach the high seas, then for the selection to settle. */
    private void awaitShipAtSea() throws InterruptedException {
        final long deadline = System.currentTimeMillis() + 20_000;
        while (!ship.isAtSea()) {
            if (System.currentTimeMillis() > deadline) fail("the ship never reached the high seas");
            Thread.sleep(20);
        }
        Thread.sleep(500);
    }

    @Test
    @Timeout(240)
    void theLastUnitDoneSailsTheShipButDoesNotSelectIt() throws Exception {
        endTurnAndWait();
        assertTrue(ship.hasTile(), "the ship waits for the goto orders");
        sentryTheRest();
        awaitShipAtSea();
        assertFalse(active() == ship, "the ship on the high seas is not the active unit");
    }

    @Test
    @Timeout(240)
    void aTurnWithNoUnitToMoveSailsTheShipButDoesNotSelectIt() throws Exception {
        sentryTheRest();
        endTurnAndWait();
        awaitShipAtSea();
        assertFalse(active() == ship, "the ship on the high seas is not the active unit");
    }
}
