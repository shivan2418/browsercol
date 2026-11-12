package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * A move's pop-up is closed before the Go To orders go on (#433). The
 * owner's save from turn 92: a petty criminal next to New Amsterdam has a
 * Go To into it, and an indentured servant stands next to a Lost City
 * Rumour. With the other units sentried, the servant's move onto the
 * rumour is the last: its outcome comes as a messages pop-up, and then,
 * with no unit left to select, the client carries out the Go To orders.
 * The criminal arrived and New Amsterdam's panel opened over the pop-up.
 * In Swing the open panel keeps the orders waiting (isPanelShowing).
 */
class PopupWaitsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();
    private ClientEngine client;

    /** What the fake Browser UI was shown and asked, in order. */
    private final List<String> log = new CopyOnWriteArrayList<>();
    /** The ids of the pop-ups it was shown. */
    private final List<Integer> popups = new CopyOnWriteArrayList<>();
    private static final Pattern POPUP = Pattern.compile("\"popup\":(\\d+)");

    private Unit servant, criminal;
    private Tile rumour, besideTheColony;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    @BeforeEach
    void loadTheSave() throws Exception {
        final File save = new File(System.getProperty("engine.src"),
            "test/resources/rumour/about-to-move-into-rumour.fsg");
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client.receive(xml)));
        server.loadGame(Files.readAllBytes(save.toPath()));
        final CountDownLatch ourTurn = new CountDownLatch(1);
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    if (kind.equals("messages") || kind.equals("colony")) log.add(kind);
                    final Matcher m = POPUP.matcher(json);
                    if (m.find()) popups.add(Integer.valueOf(m.group(1)));
                }
                public void ask(int id, String kind, String json) {
                    log.add("ask " + kind);
                    // Yes, explore the rumour.
                    ui.execute(() -> client.answer(id, kind.equals("confirm") ? "true" : null));
                }
                public void command(String name, Runnable run) {
                    // As ClientMain runs a command: a job, then what follows every command.
                    new Thread(() -> client.job(() -> {
                            run.run();
                            client.getCommands().afterCommand();
                        }), "web-" + name).start();
                }
                public boolean closesPopups() {
                    return true;
                }
            });
        assertTrue(client.startGame(0, server.ownerName()), "login");
        FirstTurn.await(ourTurn);

        servant = unit("unit:6421");
        criminal = unit("unit:6324");
        rumour = client.getGame().getMap().getTile(19, 77);
        besideTheColony = criminal.getTile();
        assertTrue(rumour.hasLostCityRumour(), "the rumour beside the servant");
        assertNotNull(criminal.getDestination(), "the criminal's Go To into New Amsterdam");
        // Close the turn's own pop-ups, if any, so only the move's are open.
        for (Integer id : popups) client.popupClosed(id);
        popups.clear();
        // The servant's is the last move: the others wait for no orders.
        for (String id : new String[] { "unit:5725", "unit:6420" }) {
            select(unit(id));
            assertTrue(client.getCommands().sentry(), "sentry " + id);
        }
        select(servant);
        log.clear();
    }

    @Test
    @Timeout(240)
    void theGoToOrdersWaitForTheRumoursPopup() throws Exception {
        final Direction d = servant.getTile().getDirection(rumour);
        final Thread move = new Thread(() -> client.job(() -> {
                client.getCommands().move(d.toString());
                client.getCommands().afterCommand();
            }), "web-move");
        move.start();
        move.join(60_000);
        eventually(() -> !popups.isEmpty(), () -> "the rumour's outcome pops up: " + log);
        Thread.sleep(1500);
        assertSame(besideTheColony, criminal.getTile(),
            () -> "the criminal's Go To waits for the pop-up: " + log);
        assertFalse(log.contains("colony"), () -> "no colony panel over the pop-up: " + log);

        for (Integer id : popups) client.popupClosed(id);
        eventually(() -> criminal.getTile() != besideTheColony,
            () -> "the criminal goes on once the pop-up is closed: " + log);
        eventually(() -> log.contains("colony"), () -> "New Amsterdam's panel opens: " + log);
        assertEquals(List.of("ask confirm", "messages", "colony"), log,
            "the question, its outcome, then the arrival");
    }

    /**
     * A window the Browser UI shows that is no pop-up (the colony panel,
     * Europe, a report) keeps the Go To orders waiting too, as Swing's
     * isPanelShowing is true for any panel on the canvas (#480).
     */
    @Test
    @Timeout(240)
    void theGoToOrdersWaitWhileAnyWindowIsOpen() throws Exception {
        client.windowsChanged(true);
        final Direction d = servant.getTile().getDirection(rumour);
        final Thread move = new Thread(() -> client.job(() -> {
                client.getCommands().move(d.toString());
                client.getCommands().afterCommand();
            }), "web-move");
        move.start();
        move.join(60_000);
        eventually(() -> !popups.isEmpty(), () -> "the rumour's outcome pops up: " + log);
        for (Integer id : popups) client.popupClosed(id);
        Thread.sleep(1500);
        assertSame(besideTheColony, criminal.getTile(),
            () -> "the criminal's Go To waits for the window: " + log);
        assertFalse(log.contains("colony"), () -> "no colony panel over the window: " + log);

        client.windowsChanged(false);
        eventually(() -> criminal.getTile() != besideTheColony,
            () -> "the criminal goes on once the window is closed: " + log);
        eventually(() -> log.contains("colony"), () -> "New Amsterdam's panel opens: " + log);
    }

    private Unit unit(String id) {
        final Unit u = client.getClient().getMyPlayer().getOurFreeColGameObject(id, Unit.class);
        assertNotNull(u, id);
        return u;
    }

    private void select(Unit u) {
        for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != u; i++) {
            client.getCommands().click(u.getTile().getX(), u.getTile().getY());
        }
        assertSame(u, client.getClient().getGUI().getActiveUnit(), "selected " + u);
    }

    private static void eventually(BooleanSupplier ok, Supplier<String> what) throws InterruptedException {
        final long deadline = System.currentTimeMillis() + 20_000;
        while (!ok.getAsBoolean()) {
            if (System.currentTimeMillis() > deadline) fail(what.get());
            Thread.sleep(20);
        }
    }
}
