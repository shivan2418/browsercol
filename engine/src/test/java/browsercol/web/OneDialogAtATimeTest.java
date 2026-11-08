package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * One dialog at a time, as in Swing (#401): while a unit's question is
 * open, no other unit moves on its Go To orders, and no other question is
 * asked. What came meanwhile runs once the question is answered.
 *
 * In each game a colonist stands beside a Lost City Rumour, and a second
 * colonist beside another rumour has a Go To order onto it. The first
 * colonist's move asks whether to explore, and the fake Browser UI keeps
 * that question open while the Go To orders are carried out.
 */
class OneDialogAtATimeTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService answers = Executors.newCachedThreadPool();
    private ServerEngine server;
    private ClientEngine client;

    /** What the fake Browser UI saw: "open <object>" and "closed <object>", in order. */
    private final List<String> log = new CopyOnWriteArrayList<>();
    /** The questions open now, and the most ever open at once. */
    private final AtomicInteger open = new AtomicInteger();
    private final AtomicInteger mostOpen = new AtomicInteger();
    /** The question about this object stays open until {@link #release} counts down. */
    private volatile String keepOpen = null;
    private final CountDownLatch release = new CountDownLatch(1);

    @AfterEach
    void stop() {
        release.countDown();
        toClient.shutdownNow();
        toServer.shutdownNow();
        answers.shutdownNow();
    }

    /** The two colonists and their rumours. */
    private Unit asker, walker;
    private Tile askerRumour, walkerStart;

    @Test
    @Timeout(240)
    void aGoToUnitWaitsForAnotherUnitsQuestion() throws Exception {
        setUp();
        // The asker's move is a command, run as ClientMain runs one: a job.
        final Thread command = moveTheAsker(true);

        // Meanwhile a handler updates the GUI (as after a server message): with
        // no unit left to select, that carries out the Go To orders.
        asker.setMovesLeft(0);
        assertTrue(client.getClient().getInGameController().nextActiveUnit(), "our turn");
        Thread.sleep(1500);
        assertSame(walkerStart, walker.getTile(), () -> "the walker waits for the open question: " + log);
        assertEquals(List.of("open " + asker.getId()), log, "no other question is asked meanwhile");

        release.countDown();
        command.join(30_000);
        eventually(() -> log.contains("open " + walker.getId()),
            () -> "the walker goes on once the question is answered, and asks of its rumour: " + log);
        eventually(() -> open.get() == 0, () -> "all questions are answered: " + log);
        assertEquals(1, mostOpen.get(), () -> "one question at a time: " + log);
        assertTrue(log.indexOf("closed " + asker.getId()) < log.indexOf("open " + walker.getId()),
            () -> "the walker asks after the asker's question closed: " + log);
    }

    @Test
    @Timeout(240)
    void twoUnitsQuestionsAreNeverOpenAtOnce() throws Exception {
        setUp();
        // Here the move runs on a thread with no job: its dialog is modal until answered.
        final Thread command = moveTheAsker(false);

        // Another thread carries out the Go To orders at the same time.
        asker.setMovesLeft(0);
        final InGameController igc = client.getClient().getInGameController();
        final Thread gotos = new Thread(igc::executeGotoOrders, "gotos");
        gotos.start();
        Thread.sleep(1500);
        assertEquals(List.of("open " + asker.getId()), log,
            "the walker's question waits for the asker's");

        release.countDown();
        command.join(30_000);
        gotos.join(30_000);
        eventually(() -> log.contains("open " + walker.getId()),
            () -> "the walker asks of its rumour once the asker's question is answered: " + log);
        eventually(() -> open.get() == 0, () -> "all questions are answered: " + log);
        assertEquals(1, mostOpen.get(), () -> "one question at a time: " + log);
    }

    /**
     * Move the asker onto its rumour on a thread of its own, and wait for its question.
     *
     * @param job Run the move as a job, as ClientMain runs a command.
     */
    private Thread moveTheAsker(boolean job) throws Exception {
        keepOpen = asker.getId();
        final Direction d = asker.getTile().getDirection(askerRumour);
        final Runnable move = () -> client.getCommands().move(d.toString());
        final Thread command = new Thread(job ? () -> client.job(move) : move, "command");
        command.start();
        eventually(() -> log.contains("open " + asker.getId()),
            () -> "the asker is asked whether to explore: " + log);
        return command;
    }

    /** Start a game and place the two colonists, the walker with its Go To order. */
    private void setUp() throws Exception {
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
                    final String object = objectOf(json);
                    synchronized (open) {
                        mostOpen.set(Math.max(mostOpen.get(), open.incrementAndGet()));
                        log.add("open " + object);
                    }
                    answers.execute(() -> {
                            if (object != null && object.equals(keepOpen)) {
                                try {
                                    release.await(120, TimeUnit.SECONDS);
                                } catch (InterruptedException e) {
                                    return;
                                }
                            }
                            synchronized (open) {
                                open.decrementAndGet();
                                log.add("closed " + object);
                            }
                            // No: neither colonist explores, so nothing else comes of it.
                            client.answer(id, kind.equals("confirm") ? "false" : null);
                        });
                }
            });
        server.startGame("classic", GamePreset.parse("{\"seed\":1,\"options\":{\"model.option.fogOfWar\":false}}"));
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(finished);
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));

        // Two rumours, each with free land beside it, apart from each other.
        final Map map = server.getGame().getMap();
        final List<Tile[]> spots = new ArrayList<>();
        for (Tile r : map.getTileSet(Tile::hasLostCityRumour)) {
            if (spots.stream().anyMatch(s -> s[0].getDistanceTo(r) < 6)) continue;
            for (Tile n : r.getSurroundingTiles(1, 1)) {
                if (n.isLand() && !n.hasSettlement() && n.getUnitCount() == 0
                    && !n.hasLostCityRumour()) {
                    spots.add(new Tile[] { r, n });
                    break;
                }
            }
            if (spots.size() == 2) break;
        }
        assertEquals(2, spots.size(), "two rumours with land beside them");
        final String askerId = addColonist(spots.get(0)[1]);
        final String walkerId = addColonist(spots.get(1)[1]);
        final Game game = client.getGame();
        eventually(() -> game.getFreeColGameObject(askerId, Unit.class) != null
            && game.getFreeColGameObject(walkerId, Unit.class) != null, () -> "the client has the colonists");
        asker = game.getFreeColGameObject(askerId, Unit.class);
        walker = game.getFreeColGameObject(walkerId, Unit.class);
        askerRumour = game.getMap().getTile(spots.get(0)[0].getX(), spots.get(0)[0].getY());
        final Tile walkerRumour = game.getMap().getTile(spots.get(1)[0].getX(), spots.get(1)[0].getY());
        assertTrue(askerRumour.hasLostCityRumour() && walkerRumour.hasLostCityRumour(),
            "the client sees the rumours");
        walkerStart = walker.getTile();

        // No one else is left to move: only the walker, on its Go To order.
        client.getClient().getMyPlayer().getUnits()
            .filter(u -> u != asker && u != walker).forEach(u -> u.setMovesLeft(0));
        assertNotNull(walker.findPath(walkerRumour), "the walker has a path");
        walker.setDestination(walkerRumour);
        final java.lang.reflect.Field mode = InGameController.class.getDeclaredField("moveMode");
        mode.setAccessible(true);
        for (Object c : mode.getType().getEnumConstants()) {
            if (c.toString().equals("NEXT_ACTIVE_UNIT")) mode.set(client.getClient().getInGameController(), c);
        }
        for (int i = 0; i < 10 && client.getClient().getGUI().getActiveUnit() != asker; i++) {
            client.getCommands().click(asker.getTile().getX(), asker.getTile().getY());
        }
        assertSame(asker, client.getClient().getGUI().getActiveUnit(), "the asker is selected");
    }

    private String addColonist(Tile at) {
        final Object reply = JsonReader.read(server.debug("{\"action\":\"addUnit\",\"type\":"
            + "\"model.unit.freeColonist\",\"x\":" + at.getX() + ",\"y\":" + at.getY() + "}"));
        return (String)((java.util.Map<?, ?>)reply).get("unit");
    }

    /** The object a question is about, as the WebGUI names it. */
    private static String objectOf(String json) {
        final java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("\"object\":\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static void eventually(BooleanSupplier ok, Supplier<String> what) throws InterruptedException {
        for (int i = 0; i < 1500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }
}
