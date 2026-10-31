package online.freecol.web;

import java.util.Locale;

import net.sf.freecol.FreeCol;
import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.networking.UserServerAPI;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Specification;


/**
 * The client Engine: FreeCol's client controllers with a {@link WebGUI},
 * talking to the server Engine through a {@link PostMessageConnection}
 * and to the Browser UI through the WebGUI.
 * In the browser it runs on the main thread.
 *
 * A game may start with autoplay: the human ends its turn for a given
 * number of AI rounds (one round is from our end of turn to our next
 * turn), then play passes to the human, through {@link Commands}.
 */
public final class ClientEngine {

    /** How the client reaches the server Engine. */
    public interface ServerLink {
        /** Ask the server to accept a new connection. */
        void connect();
        /** Send protocol XML on that connection. */
        void post(String xml);
    }

    /** What the client reports. */
    public interface Listener {
        void gameStarted(Game game);
        /** An AI round ended: our turn again, millis after we ended ours. */
        void roundDone(int round, long millis);
        /** The autoplay rounds are done: play passes to the human. */
        void finished(Game game);
    }

    private final ServerLink link;
    private final Listener listener;
    private final FreeColClient client;
    private final Commands commands;
    private WebGUI gui = null;
    private volatile PostMessageConnection connection = null;

    private int roundsWanted = 0;
    private int rounds = 0;
    private int lastEndedTurn = -1;
    private long roundStart = 0;
    private boolean finished = false;


    public ClientEngine(ServerLink link, Listener listener, WebGUI.BrowserUI ui) {
        this.link = link;
        this.listener = listener;
        MessageReaders.install();
        Messages.loadMessageBundle(Locale.US);
        UserServerAPI.connectionFactory = (name, host, port) -> {
            PostMessageConnection c = new PostMessageConnection(name, link::post);
            this.connection = c;
            link.connect();
            return c;
        };
        this.client = new FreeColClient(fcc -> this.gui = new WebGUI(fcc, this, ui));
        this.commands = new Commands(this.client);
    }

    /**
     * Log in to the server Engine's waiting game and launch it, then end
     * our turn until the AI has played the given number of rounds, and
     * hand play to the human. Blocks until the login is answered.
     *
     * @param rounds How many AI rounds to autoplay first; 0 for none.
     * @return True if the login succeeded.
     */
    public boolean startGame(int rounds) {
        return startGame(rounds, null);
    }

    /**
     * Like startGame(int), logging in under a name: that of a loaded
     * game's owner, whoever made the save.
     *
     * @param rounds How many AI rounds to autoplay first; 0 for none.
     * @param name The player's name, or null or empty for FreeCol's default.
     * @return True if the login succeeded.
     */
    public boolean startGame(int rounds, String name) {
        this.roundsWanted = rounds;
        if (!this.client.getConnectController()
            .requestLogin((name == null || name.isEmpty()) ? FreeCol.getName() : name,
                null, "worker", -1)) return false;
        // What StartGamePanel's start button does in a single-player game.
        if (!this.client.isInGame()) {
            this.client.getMyPlayer().setReady(true);
            this.client.getPreGameController().requestLaunch();
        }
        return true;
    }

    /**
     * Skip turns with the AI playing: end our turn until the AI has played
     * the given number of rounds, as a game's autoplay does, then play
     * passes back to the human. Does nothing while a skip is on.
     *
     * @param rounds How many AI rounds.
     */
    public synchronized void skipTurns(int rounds) {
        if (!this.finished && this.roundsWanted > 0) return;
        this.finished = false;
        this.rounds = 0;
        this.roundsWanted = rounds;
        this.lastEndedTurn = -1;
        checkTurn();
    }

    /**
     * The server has done a debug action: take the part of it that is the
     * client's own. Revealing the map also turns off the client's fog of
     * war, as DebugUtils.revealMap does for the client's game, and the
     * tiles the client can see follow from that.
     *
     * @param answer What ServerEngine.debug answered.
     */
    public void debugApplied(String answer) {
        Object top = JsonReader.read(answer);
        if (!(top instanceof java.util.Map)) return;
        java.util.Map<?, ?> r = (java.util.Map<?, ?>)top;
        if (!"revealMap".equals(r.get("action"))) return;
        Specification spec = getGame().getSpecification();
        DebugActions.setFogOfWar(spec, Boolean.TRUE.equals(r.get("reveal")));
        this.client.getMyPlayer().invalidateCanSeeTiles();
    }

    /** Accept protocol XML from the server. */
    public void receive(String xml) {
        this.connection.receive(xml);
    }

    /**
     * Accept the Browser UI's answer to a WebGUI question.
     *
     * @param id The question's id.
     * @param answer The answer, or null if the player closed the dialog.
     */
    public void answer(int id, String answer) {
        this.gui.answer(id, answer);
    }

    /** What the human player can do on their turn. */
    public Commands getCommands() {
        return this.commands;
    }

    /** Group the turn report by this, as the group by client option. */
    public void reportGroupBy(int value) {
        this.gui.reportGroupBy(value);
    }

    /** Show or filter out the type of the report's message at this index. */
    public void reportFilter(int index, boolean shown) {
        this.gui.reportFilter(index, shown);
    }

    /** Ignore the report's message at this index, or stop ignoring it. */
    public void reportIgnore(int index, boolean ignore) {
        this.gui.reportIgnore(index, ignore);
    }

    FreeColClient getClient() {
        return this.client;
    }

    public Game getGame() {
        return this.client.getGame();
    }

    void gameStarted() {
        this.listener.gameStarted(getGame());
        checkTurn();
    }

    /** If it is newly our turn, count the round and end the turn. */
    synchronized void checkTurn() {
        if (this.finished || !this.client.currentPlayerIsMyPlayer()) return;
        final int turn = getGame().getTurn().getNumber();
        if (turn <= this.lastEndedTurn) return;
        if (this.lastEndedTurn >= 0) {
            this.rounds++;
            this.listener.roundDone(this.rounds,
                System.currentTimeMillis() - this.roundStart);
        }
        if (this.rounds >= this.roundsWanted) {
            this.finished = true;
            this.listener.finished(getGame());
            return;
        }
        this.lastEndedTurn = turn;
        this.roundStart = System.currentTimeMillis();
        new Thread(() -> this.client.getInGameController().endTurn(false),
                   "web-endTurn").start();
    }
}
