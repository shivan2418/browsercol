package browsercol.web;

import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.xml.stream.XMLStreamException;

import net.sf.freecol.common.FreeColException;
import net.sf.freecol.common.io.FreeColXMLReader;
import net.sf.freecol.common.io.FreeColXMLWriter;
import net.sf.freecol.common.io.FreeColXMLWriter.WriteScope;
import net.sf.freecol.common.networking.Connection;
import net.sf.freecol.common.networking.DisconnectMessage;
import net.sf.freecol.common.networking.Message;
import net.sf.freecol.common.networking.MessageHandler;
import net.sf.freecol.common.networking.QuestionMessage;
import net.sf.freecol.common.networking.ReplyMessage;
import net.sf.freecol.common.networking.TrivialMessage;


/**
 * A FreeCol {@code Connection} whose other end is reached through a
 * {@link Port}, such as a Worker's {@code postMessage}. Each message
 * crosses as one string of FreeCol protocol XML, the same text a socket
 * {@code Connection} writes, so a WebSocket can stand in for the Port.
 *
 * It replaces the socket {@code Connection}'s ReceivingThread and
 * NetworkReplyObject. A thread waiting for a reply waits on the monitor of
 * its {@code Pending}, which {@code complete} notifies. Questions and
 * updates are read in arrival order and each is handled on a thread of its own, as ReceivingThread does.
 *
 * A question waits for its reply as long as the connection is open,
 * whatever timeout FreeCol asks for (its {@code DEFAULT_REPLY_TIMEOUT} is
 * 30 s). Both ends live in one browser tab, so a late reply means a busy
 * other end, not a lost one. Giving up costs more than time: a reply that
 * comes after the asker gave up is dropped, with whatever it carried, and
 * the asker goes on as if the other end had seen its question. The server
 * sends a new game as a question and {@code startGame} after its reply;
 * a server that stopped waiting sent {@code startGame} ahead of the game,
 * the client's startGameHandler gave up after 10 s without a map, and the
 * first turn never came (#97). In return, every question gets a reply,
 * an empty one if it could not be read or its handler failed.
 */
public class PostMessageConnection extends Connection {

    private static final Logger logger = Logger.getLogger(PostMessageConnection.class.getName());

    /** The longest single wait: TeaVM narrows a wait's milliseconds to an int. */
    private static final long MAX_WAIT_MS = 1L << 30;

    /** The outgoing side of a channel. */
    public interface Port {
        void post(String data);
    }

    /** A reply being waited for. */
    private static final class Pending {
        private boolean done = false;
        private Message response = null;

        synchronized void complete(Message response) {
            this.response = response;
            this.done = true;
            notifyAll();
        }

        /**
         * Wait for the reply, or for the connection to close.
         *
         * @return True if the reply came or the connection closed, false
         *     if the waiting thread was interrupted.
         */
        synchronized boolean await() {
            while (!this.done) {
                try {
                    wait(MAX_WAIT_MS);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            return true;
        }

        synchronized Message response() {
            return this.response;
        }
    }

    private final Port port;
    private volatile boolean open = true;
    private volatile WriteScope writeScope = WriteScope.toSave();
    private final AtomicInteger nextReplyId = new AtomicInteger(1);
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
    /** Arrived messages not yet read; TeaVM has no ConcurrentLinkedQueue. */
    private final ArrayDeque<String> inbox = new ArrayDeque<>();
    private final AtomicBoolean draining = new AtomicBoolean(false);
    /** Messages being handled on their own threads; they finish in no set order. */
    private final AtomicInteger handling = new AtomicInteger(0);
    /** The reader for the message being read, for MessageHandler.read. */
    private volatile FreeColXMLReader xr = null;


    public PostMessageConnection(String name, Port port) {
        super(name);
        this.port = port;
    }

    /**
     * Serialize a message as the protocol XML a socket would carry.
     *
     * @param message The {@code Message} to write.
     * @param scope The {@code WriteScope} to write it with, or null for
     *     the save scope.
     * @return The XML text.
     * @exception IOException on writer failure.
     * @exception XMLStreamException on stream failure.
     */
    public static String toXml(Message message, WriteScope scope)
        throws IOException, XMLStreamException {
        StringWriter sw = new StringWriter();
        try (FreeColXMLWriter xw = new FreeColXMLWriter(sw, scope)) {
            message.toXML(xw);
            xw.flush();
        }
        return sw.toString();
    }

    /**
     * Accept one message from the other end. Never blocks: the message is
     * queued and read on a thread of our own.
     *
     * @param data The protocol XML the other end posted.
     */
    public void receive(String data) {
        synchronized (this.inbox) {
            this.inbox.add(data);
        }
        if (this.draining.compareAndSet(false, true)) {
            new Thread(this::drain, getName() + "-receive").start();
        }
    }

    /**
     * Whether every message that has arrived has been read and handled,
     * which is how a test knows that the other end's changes are all in.
     * Messages are handled on threads of their own, so a later message can
     * be handled before an earlier one when the machine is busy.
     *
     * @return True if nothing is queued, being read or being handled.
     */
    public boolean isQuiet() {
        return this.handling.get() == 0 && !this.draining.get() && peek() == null;
    }

    private void drain() {
        for (;;) {
            String data;
            while ((data = next()) != null) dispatch(data);
            this.draining.set(false);
            // A message that arrived after the last poll but before the
            // flag dropped would otherwise wait for the next one.
            if (peek() == null || !this.draining.compareAndSet(false, true)) return;
        }
    }

    private String next() {
        synchronized (this.inbox) {
            return this.inbox.poll();
        }
    }

    private String peek() {
        synchronized (this.inbox) {
            return this.inbox.peek();
        }
    }

    private void dispatch(String data) {
        final FreeColXMLReader r;
        final String tag;
        try {
            r = new FreeColXMLReader(new StringReader(data));
            r.nextTag();
            tag = r.getLocalName();
        } catch (XMLStreamException ex) {
            logger.log(Level.WARNING, getName() + ": unreadable message: " + ex, ex);
            Failures.report(getName() + ": unreadable message", ex);
            return;
        }
        try {
            switch (tag) {
            case DisconnectMessage.TAG:
                close();   // also wakes threads waiting for replies
                handleOnThread(TrivialMessage.disconnectMessage, -1);
                break;
            case Connection.REPLY_TAG: {
                int replyId = r.getAttribute(NETWORK_REPLY_ID_TAG, -1);
                Message reply = read(r);
                Pending p = this.pending.remove(replyId);
                if (p == null) {
                    logger.warning(getName() + ": no one waits for reply " + replyId);
                } else {
                    p.complete(reply);
                }
                break;
            }
            case Connection.QUESTION_TAG: {
                int replyId = r.getAttribute(NETWORK_REPLY_ID_TAG, -1);
                Message question = null;
                try {
                    question = read(r);
                } finally {
                    // Unreadable: the asker still waits for a reply.
                    if (!(question instanceof QuestionMessage)
                        || ((QuestionMessage)question).getMessage() == null) {
                        sendMessage(new ReplyMessage(replyId, null));
                    }
                }
                if (question instanceof QuestionMessage) {
                    handleOnThread(((QuestionMessage)question).getMessage(), replyId);
                }
                break;
            }
            default:
                handleOnThread(read(r), -1);
                break;
            }
        } catch (Throwable ex) {
            logger.log(Level.WARNING, getName() + ": failed to read " + tag + ": " + ex, ex);
            Failures.report(getName() + ": reading " + tag + " failed", ex);
        } finally {
            r.close();
        }
    }

    private Message read(FreeColXMLReader r)
        throws FreeColException, XMLStreamException {
        MessageHandler mh = getMessageHandler();
        if (mh == null) throw new FreeColException("No handler for " + r.getLocalName());
        this.xr = r;
        try {
            return mh.read(this);
        } finally {
            this.xr = null;
        }
    }

    /** Run after each message from the other end has been handled; null for nothing. */
    private volatile Runnable afterHandle = null;

    /**
     * Run something after each message from the other end has been
     * handled, e.g. to tell the Browser UI that the game may have changed,
     * as Swing's panels hear of it through property change listeners.
     */
    public void setAfterHandle(Runnable afterHandle) {
        this.afterHandle = afterHandle;
    }

    /**
     * Handle a message on a new thread and send what the handler returns,
     * wrapped as the reply to a question when replyId is not negative,
     * then run the afterHandle.
     */
    private void handleOnThread(final Message message, final int replyId) {
        if (message == null) return;
        this.handling.incrementAndGet();
        new Thread(() -> {
                boolean replied = replyId < 0;
                try {
                    Message reply = handle(message);
                    replied = true;
                    sendMessage((replyId < 0) ? reply
                        : new ReplyMessage(replyId, reply));
                } catch (Throwable ex) {
                    logger.log(Level.WARNING, getName() + ": handling "
                        + message.getType() + " failed: " + ex, ex);
                    Failures.report(getName() + ": handling "
                        + message.getType() + " failed", ex);
                }
                // The asker waits for a reply, however long: give an empty one.
                if (!replied) {
                    try {
                        sendMessage(new ReplyMessage(replyId, null));
                    } catch (Throwable ex) {
                        logger.log(Level.WARNING, getName() + ": empty reply failed: " + ex, ex);
                    }
                }
                try {
                    final Runnable after = this.afterHandle;
                    if (after != null) after.run();
                } finally {
                    this.handling.decrementAndGet();
                }
        }, getName() + "-handle-" + message.getType()).start();
    }


    // Override Connection

    @Override
    public FreeColXMLReader getFreeColXMLReader() {
        return this.xr;
    }

    @Override
    public void setWriteScope(WriteScope ws) {
        this.writeScope = ws;
    }

    @Override
    public boolean isAlive() {
        return this.open;
    }

    @Override
    public void sendMessage(Message message)
        throws FreeColException, IOException, XMLStreamException {
        if (message == null || !this.open) return;
        this.port.post(toXml(message, this.writeScope));
        logMessage(message, true);
    }

    @Override
    public Message askMessage(Message message, long timeout)
        throws FreeColException, IOException, XMLStreamException, TimeoutException {
        if (message == null) return null;
        final int replyId = this.nextReplyId.getAndIncrement();
        final Pending p = new Pending();
        this.pending.put(replyId, p);
        sendMessage(new QuestionMessage(replyId, message));

        // Closed before or while sending: close() may have missed p.
        if (!this.open) p.complete(null);
        // The timeout is not used: see the class comment.
        if (!p.await()) {
            this.pending.remove(replyId);
            throw new TimeoutException("Interrupted waiting for the reply to "
                + message.getType());
        }
        final Message response = p.response();
        if (response == null && !this.open) return null;
        if (!(response instanceof ReplyMessage)) {
            throw new FreeColException("Bad response to " + replyId + "/"
                + message.getType() + ": " + response);
        }
        ReplyMessage reply = (ReplyMessage)response;
        logMessage(reply, false);
        return reply.getMessage();
    }

    @Override
    public void close() {
        this.open = false;
        for (Pending p : this.pending.values()) p.complete(null);
        this.pending.clear();
    }

    @Override
    public String toString() {
        return "[PostMessageConnection " + getName() + "]";
    }
}
