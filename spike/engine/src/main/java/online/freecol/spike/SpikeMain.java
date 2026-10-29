package online.freecol.spike;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;

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
        System.out.println("[spike " + (System.currentTimeMillis() - t0) + "ms] " + s);
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
        try {
            run(args);
        } catch (Throwable t) {
            log("FAILED: " + t);
            t.printStackTrace();
        }
    }

    private static void run(String[] args) throws Exception {
        t0 = System.currentTimeMillis();
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
        human.done.await();
        log("finished at " + game.getTurn());
        // TeaVM has no System.exit: stop the server thread instead.
        server.getController().shutdown();
    }

    /** The human seat: ends its turn whenever it becomes current. */
    private static final class HumanStub implements MessageHandler {
        final FreeColServer server;
        final int turns;
        final CountDownLatch done = new CountDownLatch(1);
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
                        done.countDown();
                    }
            }, "human-endTurn").start();
        }

        @Override
        public synchronized Message handle(Connection c, Message message) {
            // The server batches setCurrentPlayer into MultipleMessages,
            // so check the shared game state instead of the message type.
            if (message instanceof GameEndedMessage) {
                log("game ended");
                done.countDown();
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
                if (rounds >= turns) done.countDown(); else endTurnSoon();
            }
            return null;
        }

        @Override
        public Message read(Connection c) {
            throw new UnsupportedOperationException("objects only");
        }
    }
}
