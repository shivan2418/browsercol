package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import net.sf.freecol.common.networking.Connection;
import net.sf.freecol.common.networking.ConnectionVerificationMessage;
import net.sf.freecol.common.networking.GameStateMessage;
import net.sf.freecol.common.networking.Message;
import net.sf.freecol.common.networking.MessageHandler;
import net.sf.freecol.server.FreeColServer.ServerState;


class PostMessageConnectionTest {

    /** Delivers each side's posts to the other on its own thread, like postMessage. */
    private final ExecutorService wire = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        wire.shutdownNow();
    }

    private PostMessageConnection[] pair() {
        PostMessageConnection[] p = new PostMessageConnection[2];
        p[0] = new PostMessageConnection("a", s -> wire.execute(() -> p[1].receive(s)));
        p[1] = new PostMessageConnection("b", s -> wire.execute(() -> p[0].receive(s)));
        return p;
    }

    /** Answers every message with a fixed one; reads with no Game. */
    private static MessageHandler answering(Message answer, AtomicReference<Message> seen) {
        return new MessageHandler() {
            public Message handle(Connection c, Message m) {
                seen.set(m);
                return answer;
            }
            public Message read(Connection c) throws net.sf.freecol.common.FreeColException {
                return Message.read(null, c.getFreeColXMLReader());
            }
        };
    }

    @Test
    void askReturnsTheOtherSidesReply() throws Exception {
        PostMessageConnection[] p = pair();
        AtomicReference<Message> seen = new AtomicReference<>();
        p[0].setMessageHandler(answering(null, new AtomicReference<>()));
        p[1].setMessageHandler(answering(new ConnectionVerificationMessage(true), seen));

        Message reply = p[0].askMessage(new ConnectionVerificationMessage(false), 5000);

        assertEquals("<connectionVerification connectable=\"false\"/>", xml(seen.get()));
        assertInstanceOf(ConnectionVerificationMessage.class, reply);
        assertEquals("<connectionVerification connectable=\"true\"/>", xml(reply));
    }

    @Test
    void sendReachesTheOtherSidesHandler() throws Exception {
        PostMessageConnection[] p = pair();
        AtomicReference<Message> seen = new AtomicReference<>();
        p[0].setMessageHandler(answering(null, new AtomicReference<>()));
        p[1].setMessageHandler(answering(null, seen));

        p[0].send(new GameStateMessage(ServerState.END_GAME));

        long end = System.currentTimeMillis() + 5000;
        while (seen.get() == null && System.currentTimeMillis() < end) Thread.sleep(5);
        assertEquals("<gameState state=\"END_GAME\"/>", xml(seen.get()));
    }

    /**
     * FreeCol gives up on a reply after 30 s, and the server then sent
     * startGame ahead of the new game, so the first turn never came (#97).
     * Here a question waits as long as its reply takes.
     */
    @Test
    void aQuestionWaitsPastFreeColsTimeoutForALateReply() throws Exception {
        PostMessageConnection[] p = pair();
        p[0].setMessageHandler(answering(null, new AtomicReference<>()));
        p[1].setMessageHandler(new MessageHandler() {
                public Message handle(Connection c, Message m) {
                    try {
                        Thread.sleep(500);
                    } catch (InterruptedException ie) {}
                    return new ConnectionVerificationMessage(true);
                }
                public Message read(Connection c) throws net.sf.freecol.common.FreeColException {
                    return Message.read(null, c.getFreeColXMLReader());
                }
            });

        Message reply = p[0].askMessage(new ConnectionVerificationMessage(false), 50);

        assertEquals("<connectionVerification connectable=\"true\"/>", xml(reply));
    }

    /** With no timeout, a failed handler must still answer, or the asker waits for ever. */
    @Test
    void aQuestionWhoseHandlerFailsGetsAnEmptyReply() throws Exception {
        PostMessageConnection[] p = pair();
        p[0].setMessageHandler(answering(null, new AtomicReference<>()));
        p[1].setMessageHandler(new MessageHandler() {
                public Message handle(Connection c, Message m) {
                    throw new IllegalStateException("the handler failed");
                }
                public Message read(Connection c) throws net.sf.freecol.common.FreeColException {
                    return Message.read(null, c.getFreeColXMLReader());
                }
            });

        assertNull(p[0].askMessage(new ConnectionVerificationMessage(false), 50));
    }

    @Test
    void aQuestionOnAClosedConnectionDoesNotWait() throws Exception {
        PostMessageConnection[] p = pair();
        p[0].close();

        assertNull(p[0].askMessage(new ConnectionVerificationMessage(false), 50));
    }

    private static String xml(Message m) throws Exception {
        return PostMessageConnection.toXml(m, null);
    }
}
