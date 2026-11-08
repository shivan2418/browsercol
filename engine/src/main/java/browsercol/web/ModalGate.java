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
 * Makes every dialog modal, as Swing's are: while a question is open, no
 * other unit moves and nothing else asks the player anything. What would
 * have run meanwhile runs after the dialog, in the order it came (#401,
 * which generalises the native trade's gate of #393).
 *
 * In Swing everything the controllers do on the GUI's behalf runs on the
 * one event thread, and a modal dialog holds it: the work that comes while
 * the dialog is open waits for it, and the dialog's own follow-up questions
 * (an amount after a choice, the pre-combat confirm after it) come in turn
 * on the same thread. Here a question blocks only the thread that asked it
 * ({@link Questions}); server messages are handled on threads of their own,
 * and the controllers' deferred work runs at once on whatever thread asks
 * for it (WebGUI.invokeNowOrLater). Updating the GUI with no unit left to
 * select carries out the Go To orders, so other units moved, and asked
 * their own questions, while one was open.
 *
 * <h2>Flows</h2>
 *
 * The gate is held by one flow at a time: the threads that make up the open
 * dialog's work. Every other thread waits:
 * <ul>
 * <li>its questions wait ({@link #enter}) until the flow is over;</li>
 * <li>its deferred work is queued ({@link #invoke}) and runs when the flow
 *     is over, on the flow's last thread, in the order it came;</li>
 * <li>the player's commands are held: none starts while a flow is open,
 *     unless the flow is the command's own, or a dialog that defers.</li>
 * </ul>
 *
 * A thread that asks a question while no flow is open opens one, and keeps
 * it until its job is done ({@link #job}): a player's command, the handling
 * of a server message, or a dialog that defers (WebGUI.defer). So a
 * command's questions come one after another, and what came meanwhile runs
 * after the command, as in Swing. A thread that runs no job (a test's own
 * thread) keeps its flow until its question is answered ({@link #leave}).
 *
 * A dialog that defers ({@link #deferred}) is one Swing shows non-modally,
 * a panel the player may act beside: its questions and the work it holds
 * wait as any flow's, but the player's commands run while it is open. The
 * end turn dialog's pick of a waiting unit is such a command.
 *
 * A native trade is the one flow of several threads: each answer from the
 * natives (an ACK) starts a round of questions on the thread that handles
 * it ({@link #arrived}); the server's reply to a buy, sell or gift ends the
 * round, and the trade waits for the next answer ({@link #replied}); the
 * reply to a close, a failed request, or a closing answer from the natives
 * ends the trade once the round's handler is done ({@link #handled}). A
 * trade that opens waits for the command running then, as Swing shows the
 * trade's dialog after the action that began it. If the natives never
 * answer, the trade gives up waiting after {@link #WAIT_MS}.
 *
 * <h2>Deadlocks</h2>
 *
 * The server sends its updates as requests and waits for each reply, so a
 * message handler must not wait for a flow that may itself wait for the
 * server. It does not: its deferred work is queued, not waited for (also
 * invokeNowOrWait's, whose tasks only show things), and the dialogs a
 * handler asks defer to threads of their own. A flow that opens on a
 * handler's thread holds only the commands that have not started; it does
 * not wait for the one running, which may be waiting for that handler's
 * reply. Work queued behind a flow runs on the flow's own thread, as part
 * of it, so a question it asks goes through. Non-modal panels (show events)
 * are not dialogs and pass the gate.
 */
final class ModalGate implements Questions.Turn {

    /** Holds the player's commands while a flow is open. */
    interface Hold {
        /** Wait for the command that is running, if any, and start no more until release. */
        void hold();
        /** Start no more commands until release; the one running goes on. Must not block. */
        void holdNext();
        /** Undo one hold or holdNext. Must not block. */
        void release();
    }

    /** How long a trade waits for the natives' next answer before it gives up. */
    static final long WAIT_MS = 10_000;

    /** The work of an open dialog. */
    private static final class Flow {
        /** The threads that run it, which pass the gate. */
        final Set<Thread> threads = new HashSet<>();
        /** The id of the unit trading, for a native trade; null for a flow of questions. */
        final String trader;
        /** The flow ends when its question is answered: the thread that asked runs no job. */
        boolean endsWithAnswer = false;
        /** The flow holds the player's commands until it closes. */
        boolean holdsCommands = true;
        /** The flow is over: the work it held runs, then it closes. */
        boolean closing = false;

        Flow(String trader) {
            this.trader = trader;
        }
    }

    private final Hold hold;
    /** The open flow, or null. */
    private Flow open = null;
    /** A trade waits for the running command before it opens. */
    private boolean opening = false;
    /** The work that came while a flow was open, to run after it. */
    private final ArrayDeque<Runnable> held = new ArrayDeque<>();
    /** The threads running a job. */
    private final Set<Thread> jobs = new HashSet<>();
    /** The threads running a dialog that defers, whose flows hold no commands. */
    private final Set<Thread> deferring = new HashSet<>();
    /** Counts the rounds and flows, so a wait for the natives' answer knows when one came. */
    private int round = 0;


    ModalGate(Hold hold) {
        this.hold = hold;
    }


    // Jobs, questions and deferred work.

    /**
     * Run a job on this thread: a flow it opens by asking a question lasts
     * until the job is done. A job within a job is part of it.
     *
     * @param work The job.
     */
    void job(Runnable work) {
        job(work, false);
    }

    /**
     * Run a dialog that defers, and its handler, as a job on this thread:
     * a flow it opens holds no commands, as Swing shows such a dialog
     * non-modally (WebGUI.defer).
     *
     * @param work The dialog and its handler.
     */
    void deferred(Runnable work) {
        job(work, true);
    }

    private void job(Runnable work, boolean deferred) {
        final Thread me = Thread.currentThread();
        final boolean outer;
        synchronized (this) {
            outer = this.jobs.add(me);
            if (outer && deferred) this.deferring.add(me);
        }
        try {
            work.run();
        } finally {
            if (outer) {
                synchronized (this) {
                    this.jobs.remove(me);
                    this.deferring.remove(me);
                }
                done();
            }
        }
    }

    /**
     * Before a question: wait until no flow is open that this thread has no
     * part in, and open one if none is.
     */
    @Override
    public synchronized void enter() {
        final Thread me = Thread.currentThread();
        for (;;) {
            if (this.open != null && this.open.threads.contains(me)) return;
            if (this.open == null) {
                final Flow f = new Flow(null);
                f.threads.add(me);
                f.endsWithAnswer = !this.jobs.contains(me);
                f.holdsCommands = !this.deferring.contains(me);
                this.open = f;
                if (f.holdsCommands) this.hold.holdNext();
                return;
            }
            waitHere();
        }
    }

    /** After a question: the flow of a thread that runs no job is over. */
    @Override
    public void leave() {
        synchronized (this) {
            final Flow f = this.open;
            if (f == null || f.trader != null || !f.endsWithAnswer || f.closing
                || !f.threads.contains(Thread.currentThread())) return;
            f.closing = true;
        }
        flush();
    }

    /**
     * Run work now, or, while a flow is open that this thread has no part
     * in, after the flow. Never waits: WebGUI.invokeNowOrWait comes here
     * too, as a message handler that waited for a flow could keep the
     * server, and so the flow, waiting for ever.
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

    /** @return True if a flow is open. */
    synchronized boolean isOpen() {
        return this.open != null;
    }

    /** A flow is open, and this thread has no part in it. Hold the lock. */
    private boolean gated() {
        return this.open != null && !this.open.threads.contains(Thread.currentThread());
    }

    /** This thread's job is done: so is the flow of questions it opened. */
    private void done() {
        synchronized (this) {
            final Flow f = this.open;
            if (f == null || f.trader != null || f.closing
                || !f.threads.contains(Thread.currentThread())) return;
            f.closing = true;
        }
        flush();
    }


    // The native trade.

    /**
     * The natives' answer about a trade arrived, and is about to be handled
     * on this thread: it opens the trade, if it is not open, and starts a
     * round. The trade waits for any other flow, and for the command that
     * is running.
     *
     * @param unitId The id of the unit trading.
     * @param action The natives' answer.
     */
    void arrived(String unitId, NativeTradeAction action) {
        for (;;) {
            synchronized (this) {
                while (!(this.open == null && !this.opening) && !ours(unitId)) waitHere();
                if (this.open != null) {
                    join(action);
                    return;
                }
                this.opening = true;
            }
            this.hold.hold();
            synchronized (this) {
                this.opening = false;
                notifyAll();
                if (this.open == null) {
                    this.open = new Flow(unitId);
                    join(action);
                    return;
                }
            }
            // A question opened a flow while the trade waited for the command: wait for it.
            this.hold.release();
        }
    }

    /** The open flow is this unit's trade, and goes on. Hold the lock. */
    private boolean ours(String unitId) {
        return this.open != null && unitId.equals(this.open.trader) && !this.open.closing;
    }

    /** This thread runs a round of the open trade. Hold the lock. */
    private void join(NativeTradeAction action) {
        this.round++;
        this.open.threads.add(Thread.currentThread());
        // A closing answer (the natives will not trade or haggle more)
        // has no round: its handler tells the player, and the trade is over.
        if (action.isClosing()) this.open.closing = true;
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
            final Flow f = this.open;
            if (f == null || f.trader == null || f.closing || !f.threads.contains(me)) return;
            if (action == NativeTradeAction.CLOSE || error) {
                f.closing = true;
                return;
            }
            if (action != NativeTradeAction.BUY && action != NativeTradeAction.SELL
                && action != NativeTradeAction.GIFT) return;
            f.threads.remove(me);
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
            final Flow f = this.open;
            if (f == null || f.trader == null
                || !f.threads.contains(Thread.currentThread())) return;
            f.closing = true;
        }
        flush();
    }

    /** The natives have not answered the round since it ended: give up the trade. */
    private void giveUp(int waiting) {
        try {
            Thread.sleep(WAIT_MS);
        } catch (InterruptedException ie) {
            return;
        }
        synchronized (this) {
            final Flow f = this.open;
            if (f == null || f.trader == null || f.closing || this.round != waiting) return;
            f.closing = true;
            f.threads.add(Thread.currentThread());
        }
        flush();
    }


    /** Run the work the flow held, here and in order, then close the flow. */
    private void flush() {
        boolean holding = false;
        for (;;) {
            final Runnable next;
            synchronized (this) {
                next = this.held.poll();
                if (next == null) {
                    holding = this.open != null && this.open.holdsCommands;
                    this.open = null;
                    this.round++;
                    notifyAll();
                    break;
                }
            }
            try {
                next.run();
            } catch (Throwable ex) {
                // Work that fails must not keep the rest, or the game, waiting.
                ex.printStackTrace();
            }
        }
        if (holding) this.hold.release();
    }

    /** Wait on this gate's monitor. Hold the lock. */
    private void waitHere() {
        try {
            wait();
        } catch (InterruptedException ie) {}
    }


    // The messages the gate follows a trade by.

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
        ((WebGUI)client.getGUI()).modalGate()
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
            final ModalGate gate = (freeColClient.getGUI() instanceof WebGUI)
                ? ((WebGUI)freeColClient.getGUI()).modalGate() : null;
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
