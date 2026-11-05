package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

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

    private static String xml(Message m) throws Exception {
        return PostMessageConnection.toXml(m, null);
    }
}
