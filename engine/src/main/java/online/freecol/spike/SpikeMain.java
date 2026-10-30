package online.freecol.spike;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.networking.Connection;
import net.sf.freecol.common.networking.LoginMessage;
import net.sf.freecol.common.networking.Message;
import net.sf.freecol.common.networking.MessageHandler;
import net.sf.freecol.common.networking.TrivialMessage;
import net.sf.freecol.common.networking.GameEndedMessage;
import net.sf.freecol.server.FreeColServer;
import net.sf.freecol.server.networking.DummyConnection;


/**
 * Headless spike driver: a Classic single-player game where the human
 * seat is a stub that ends its turn at once, so only the AI plays.
 * Prints timings for game setup and each round of AI turns.
 */
public final class SpikeMain {

    private static long t0;

    private static void log(String s) {
        // stderr: TeaVM prints FreeCol's log (every level) to stdout,
        // which measurement runs discard.
        System.err.println("[spike " + (System.currentTimeMillis() - t0) + "ms] " + s);
    }

    private static void writeFile(String path, String text) throws IOException {
        File f = new File(path);
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f),
                                               StandardCharsets.UTF_8)) {
            w.write(text);
        }
    }

    public static void main(String[] args) {
        // Do the work on a thread of our own and let main() return. This
        // dates from when wait() under TeaVM Wasm GC neither released the
        // monitor nor woke up (fixed by FiberSuspendFix, #11).
        new Thread(() -> {
                try {
                    run(args);
                } catch (Throwable t) {
                    log("FAILED: " + t);
                    t.printStackTrace();
                }
        }, "spike-main").start();
    }

    /** One wait/notify case on its own threads; logs what happened. */
    private static void waitCase(String name, long timeout, long notifyAfter) {
        final Object lock = new Object();
        new Thread(() -> {
              try {
                long t = System.currentTimeMillis();
                log("selftest " + name + ": waiter entering");
                synchronized (lock) {
                    log("selftest " + name + ": waiter holds lock");
                    try {
                        if (timeout > 0) lock.wait(timeout); else lock.wait();
                    } catch (InterruptedException ie) { }
                }
                log("selftest " + name + ": woke after "
                    + (System.currentTimeMillis() - t) + "ms");
              } catch (Throwable th) { log("selftest " + name + ": waiter threw " + th); }
        }, "selftest-" + name + "-waiter").start();
        if (notifyAfter >= 0) {
            new Thread(() -> {
                  try {
                    try { Thread.sleep(notifyAfter); } catch (InterruptedException ie) { }
                    log("selftest " + name + ": notifier entering");
                    synchronized (lock) { lock.notifyAll(); }
                    log("selftest " + name + ": notified");
                  } catch (Throwable th) { log("selftest " + name + ": notifier threw " + th); }
            }, "selftest-" + name + "-notifier").start();
        }
    }

    /** Which wait/notify cases work under this runtime? */
    private static void monitorSelfTest() throws InterruptedException {
        waitCase("A untimed+notify@50", 0, 50);
        waitCase("B timed100 no notify", 100, -1);
        waitCase("C timed1000+notify@50", 1000, 50);
        Thread.sleep(1500);
        log("selftest: done");
    }

    private static void run(String[] args) throws Exception {
        t0 = System.currentTimeMillis();
        if (args.length > 0 && "selftest".equals(args[0])) {
            monitorSelfTest();
            return;
        }
        final int turns = (args.length > 0) ? Integer.parseInt(args[0]) : 10;
        // In the browser the data files arrive as (path, text) argument
        // pairs and go into TeaVM's in-memory file system.
        for (int i = 1; i + 1 < args.length; i += 2) writeFile(args[i], args[i + 1]);
        if (args.length > 1) log("wrote " + (args.length - 1) / 2 + " data files");

        Messages.loadMessageBundle(Locale.US);
        FreeColRules.loadRules();
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile("classic"), null,
            "model.difficulty.medium");
        log("spec loaded");

        FreeColServer server = new FreeColServer(false, true, spec, null, 0, "spike");
        log("server created");

        HumanStub human = new HumanStub(server, turns);
        DummyConnection toHuman = new DummyConnection("Server-to-human");
        DummyConnection toServer = new DummyConnection("human-to-Server");
        toHuman.setMessageHandler(server.getUserConnectionHandler());
        toServer.setMessageHandler(human);
        toHuman.setOtherConnection(toServer);
        toServer.setOtherConnection(toHuman);
        human.connection = toServer;

        Message reply = toServer.askMessage(new LoginMessage(null, "spike",
                null, FreeCol.getVersion(), null, true, false, null),
            Connection.DEFAULT_REPLY_TIMEOUT);
        log("logged in: " + reply);

        toServer.send(TrivialMessage.requestLaunchMessage);
        Game game = server.getGame();
        log("game ready: map " + game.getMap().getWidth() + "x"
            + game.getMap().getHeight() + ", players "
            + game.getLivePlayerList().size());

        human.player = server.getPlayer(toHuman);
        human.endTurnSoon();
        // Poll. This dates from when Object.wait did not work under TeaVM
        // 0.16 Wasm GC; FiberSuspendFix fixes it (#11, see monitorSelfTest).
        while (!human.done) Thread.sleep(20);
        log("finished at " + game.getTurn());
        for (Player p : game.getLiveEuropeanPlayerList()) {
            log("  " + p.getName() + ": " + p.getColonyList().size()
                + " colonies, " + p.getUnitCount() + " units, gold "
                + p.getGold() + ", score " + p.getScore());
        }
        // TeaVM has no System.exit: stop the server thread instead.
        server.getController().shutdown();
    }

    /** The human seat: ends its turn whenever it becomes current. */
    private static final class HumanStub implements MessageHandler {
        final FreeColServer server;
        final int turns;
        volatile boolean done = false;
        Connection connection;
        Player player;
        long roundStart;
        int rounds = 0;
        boolean ending = false;

        HumanStub(FreeColServer server, int turns) {
            this.server = server;
            this.turns = turns;
        }

        void endTurnSoon() {
            ending = true;
            roundStart = System.currentTimeMillis();
            new Thread(() -> {
                    try {
                        connection.askMessage(TrivialMessage.endTurnMessage,
                            Connection.DEFAULT_REPLY_TIMEOUT);
                    } catch (Exception ex) {
                        ex.printStackTrace();
                        done = true;
                    }
            }, "human-endTurn").start();
        }

        @Override
        public synchronized Message handle(Connection c, Message message) {
            // The server batches setCurrentPlayer into MultipleMessages,
            // so check the shared game state instead of the message type.
            if (message instanceof GameEndedMessage) {
                log("game ended");
                done = true;
                return null;
            }
            Player current = server.getGame().getCurrentPlayer();
            if (current != player) {
                ending = false;
            } else if (!ending) {
                rounds++;
                log("round " + rounds + " (" + server.getGame().getTurn()
                    + ") AI took " + (System.currentTimeMillis() - roundStart)
                    + "ms");
                if (rounds >= turns) done = true; else endTurnSoon();
            }
            return null;
        }

        @Override
        public Message read(Connection c) {
            throw new UnsupportedOperationException("objects only");
        }
    }
}
