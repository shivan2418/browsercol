package browsercol.web;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.stream.XMLStreamException;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.io.FreeColXMLReader;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.NativeTrade;
import net.sf.freecol.common.model.NativeTrade.NativeTradeAction;
import net.sf.freecol.common.networking.ErrorMessage;
import net.sf.freecol.common.networking.Message;
import net.sf.freecol.common.networking.NativeTradeMessage;


/**
 * Makes a native trade modal, as Swing's trade dialogs are: while a trade
 * is open, no other unit moves and nothing else asks the player anything.
 * What would have run meanwhile runs after the trade, in the order it came.
 *
 * In Swing everything the controllers do on the GUI's behalf runs on the
 * one event thread: a trade round's dialogs run there, and the work that
 * comes while one is open waits for it. Here a trade round runs on the
 * thread that handles the server's answer, and the controllers' deferred
 * work runs at once on whatever thread asks for it (WebGUI.invokeNowOrLater).
 * A trade is a session of rounds: each answer from the natives (an ACK)
 * starts a round of questions, and the round ends by asking the server to
 * buy, sell or give, or by closing the trade. After each round the
 * controller updates the GUI (our patch to nativeTradeHandler, #299), and
 * with no unit left to select that carries out the goto orders, so other
 * units moved, and asked their questions, between two rounds of a trade
 * (#393).
 *
 * The gate follows the trade from its messages: an answer from the natives
 * opens the trade and starts a round on the thread that handles it
 * ({@link #arrived}); the server's reply to a buy, sell or gift ends the
 * round, and the trade waits for the next answer ({@link #replied}); the
 * reply to a close, a failed request, or a closing answer from the natives
 * ends the trade once the round's handler is done ({@link #handled}).
 * While the trade is open, the threads that run no round of it wait:
 * their deferred work is queued ({@link #invoke}) and their questions wait
 * ({@link #awaitTurn}). The player's commands are held too, and a trade
 * that opens waits for the command running then to finish first, as Swing
 * shows the trade's dialog after the action that began it.
 *
 * If the natives never answer, the trade gives up waiting after
 * {@link #WAIT_MS}, so that the game goes on.
 */
final class NativeTradeGate {

    /** Holds the player's commands while a trade is open. */
    interface Hold {
        /** Wait for the command that is running, if any, and run no more until release. */
        void hold();
        /** Run the commands again. Must not block. */
        void release();
    }

    /** How long a trade waits for the natives' next answer before it gives up. */
    static final long WAIT_MS = 10_000;

    private enum State {
        /** No trade is open. */
        CLOSED,
        /** A trade is about to open, once the command that is running is done. */
        OPENING,
        /** A trade is open. */
        OPEN,
        /** The trade is over: its last round finishes, then the work it held runs. */
        CLOSING
    }

    private final Hold hold;
    private State state = State.CLOSED;
    /** The id of the unit trading, while a trade is open. */
    private String unit = null;
    /** The threads running a round of the trade, or the work it held. */
    private final Set<Thread> trading = new HashSet<>();
    /** The work that came while the trade was open, to run after it. */
    private final ArrayDeque<Runnable> held = new ArrayDeque<>();
    /** Counts the rounds and trades, so a wait for an answer knows when one came. */
    private int round = 0;


    NativeTradeGate(Hold hold) {
        this.hold = hold;
    }

    /**
     * The natives' answer about a trade arrived, and is about to be handled
     * on this thread: it opens the trade, if it is not open, and starts a
     * round. Another unit's trade waits until this one is over.
     *
     * @param unitId The id of the unit trading.
     * @param action The natives' answer.
     */
    void arrived(String unitId, NativeTradeAction action) {
        boolean open = false;
        synchronized (this) {
            while (this.state == State.OPENING || this.state == State.CLOSING
                   || (this.state == State.OPEN && !unitId.equals(this.unit))) {
                waitHere();
            }
            if (this.state == State.CLOSED) {
                this.state = State.OPENING;
                open = true;
            }
        }
        if (open) this.hold.hold();
        synchronized (this) {
            if (open) {
                this.state = State.OPEN;
                this.unit = unitId;
                notifyAll();
            }
            this.round++;
            this.trading.add(Thread.currentThread());
            // A closing answer (the natives will not trade or haggle more)
            // has no round: its handler tells the player, and the trade is over.
            if (action.isClosing()) this.state = State.CLOSING;
        }
    }

    /**
     * This thread asked the server about the trade and has its reply. A
     * reply to a buy, sell or gift ends the round, and the trade waits for
     * the natives' answer. A reply to a close, or an error, ends the trade
     * once the round's handler is done.
     *
     * @param action What was asked.
     * @param error True if the server refused it.
     */
    void replied(NativeTradeAction action, boolean error) {
        final int waiting;
        synchronized (this) {
            final Thread me = Thread.currentThread();
            if (this.state != State.OPEN || !this.trading.contains(me)) return;
            if (action == NativeTradeAction.CLOSE || error) {
                this.state = State.CLOSING;
                return;
            }
            if (action != NativeTradeAction.BUY && action != NativeTradeAction.SELL
                && action != NativeTradeAction.GIFT) return;
            this.trading.remove(me);
            waiting = this.round;
        }
        final Thread watch = new Thread(() -> giveUp(waiting), "native-trade-wait");
        watch.start();
    }

    /**
     * The handler of the natives' answer is done on this thread. If the trade
     * is over, or the round ended without asking the server anything more,
     * the work the trade held runs now, here, in order, and the trade closes.
     */
    void handled() {
        synchronized (this) {
            if (this.state == State.CLOSED || this.state == State.OPENING
                || !this.trading.contains(Thread.currentThread())) return;
            this.state = State.CLOSING;
        }
        flush();
    }

    /**
     * Run work now, or, while a trade is open and this thread has no part in
     * it, after the trade.
     *
     * @param task The work.
     */
    void invoke(Runnable task) {
        synchronized (this) {
            if (gated()) {
                this.held.add(task);
                return;
            }
        }
        task.run();
    }

    /**
     * As {@link #invoke}, but return only once the work has run.
     *
     * @param task The work.
     */
    void invokeAndWait(Runnable task) {
        final boolean[] done = { false };
        synchronized (this) {
            if (gated()) {
                this.held.add(() -> {
                        try {
                            task.run();
                        } finally {
                            synchronized (done) {
                                done[0] = true;
                                done.notifyAll();
                            }
                        }
                    });
            } else {
                done[0] = true;
            }
        }
        if (done[0]) {
            task.run();
            return;
        }
        synchronized (done) {
            while (!done[0]) {
                try {
                    done.wait();
                } catch (InterruptedException ie) {}
            }
        }
    }

    /** Wait, before asking the player something, until no trade is open that this thread has no part in. */
    synchronized void awaitTurn() {
        while (gated()) waitHere();
    }

    /** @return True if a trade is open. */
    synchronized boolean isOpen() {
        return this.state == State.OPEN || this.state == State.CLOSING;
    }

    /** A trade is open, and this thread runs no round of it. Hold the lock. */
    private boolean gated() {
        return (this.state == State.OPEN || this.state == State.CLOSING)
            && !this.trading.contains(Thread.currentThread());
    }

    /** The natives have not answered the round since it ended: give up the trade. */
    private void giveUp(int waiting) {
        try {
            Thread.sleep(WAIT_MS);
        } catch (InterruptedException ie) {
            return;
        }
        synchronized (this) {
            if (this.state != State.OPEN || this.round != waiting) return;
            this.state = State.CLOSING;
            this.trading.add(Thread.currentThread());
        }
        flush();
    }

    /** Run the work the trade held, here and in order, then close the trade. */
    private void flush() {
        for (;;) {
            final Runnable next;
            synchronized (this) {
                next = this.held.poll();
                if (next == null) {
                    this.state = State.CLOSED;
                    this.unit = null;
                    this.trading.clear();
                    this.round++;
                    this.hold.release();
                    notifyAll();
                    return;
                }
            }
            try {
                next.run();
            } catch (Throwable ex) {
                // Work that fails must not keep the rest, or the game, waiting.
                ex.printStackTrace();
            }
        }
    }

    /** Wait on this gate's monitor. Hold the lock. */
    private void waitHere() {
        try {
            wait();
        } catch (InterruptedException ie) {}
    }


    // The messages the gate follows the trade by.

    /** The action attribute of a native trade message's protocol XML. */
    private static final Pattern ACTION = Pattern.compile("<" + NativeTradeMessage.TAG
        + "\\b[^>]*\\baction=\"([A-Z_]+)\"");

    /**
     * The client asked the server something and has the reply: if it was
     * about a native trade, the gate hears of it.
     *
     * @param client The client.
     * @param asked What it asked.
     * @param reply The reply, or null for none.
     */
    static void replied(FreeColClient client, Message asked, Message reply) {
        if (asked == null || !asked.isType(NativeTradeMessage.TAG)) return;
        if (!(client.getGUI() instanceof WebGUI)) return;
        // The message keeps its action to itself; its protocol XML says it.
        final String xml;
        try {
            xml = PostMessageConnection.toXml(asked, null);
        } catch (Exception ex) {
            return;
        }
        final Matcher m = ACTION.matcher(xml);
        if (!m.find()) return;
        final NativeTradeAction action;
        try {
            action = NativeTradeAction.valueOf(m.group(1));
        } catch (IllegalArgumentException ex) {
            return;
        }
        ((WebGUI)client.getGUI()).nativeTradeGate()
            .replied(action, reply instanceof ErrorMessage);
    }

    /**
     * The natives' answer about a trade, as the client reads it: the gate
     * hears of it before the controller handles it, and after.
     */
    static final class Answer extends NativeTradeMessage {

        Answer(Game game, FreeColXMLReader xr) throws XMLStreamException {
            super(game, xr);
        }

        @Override
        public void clientHandler(FreeColClient freeColClient) {
            final NativeTradeAction action = getEnumAttribute("action",
                NativeTradeAction.class, (NativeTradeAction)null);
            final NativeTrade nt = getChild(0, NativeTrade.class);
            final NativeTradeGate gate = (freeColClient.getGUI() instanceof WebGUI)
                ? ((WebGUI)freeColClient.getGUI()).nativeTradeGate() : null;
            if (gate == null || action == null || nt == null || nt.getUnit() == null
                || action.isEuropean()) {
                super.clientHandler(freeColClient);
                return;
            }
            gate.arrived(nt.getUnit().getId(), action);
            try {
                super.clientHandler(freeColClient);
            } finally {
                gate.handled();
            }
        }
    }
}
