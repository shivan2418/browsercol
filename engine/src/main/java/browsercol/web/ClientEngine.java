package browsercol.web;

import net.sf.freecol.FreeCol;
import net.sf.freecol.client.ClientOptions;
import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.networking.UserServerAPI;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.ExportData;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;


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
        /** A message from the server has been handled: the game may have changed. */
        default void updated() {}
    }

    private final ServerLink link;
    private final Listener listener;
    private final FreeColClient client;
    private final Commands commands;
    private final Menus menus;
    private WebGUI gui = null;
    private volatile PostMessageConnection connection = null;
    /** The last message sent to the server, for the error panel's details. */
    private volatile String lastRequest = null;

    private int roundsWanted = 0;
    private int rounds = 0;
    private int lastEndedTurn = -1;
    private long roundStart = 0;
    private boolean finished = false;


    /** @return The last message sent to the server, as XML, or null if none. */
    String lastRequest() {
        return this.lastRequest;
    }

    public ClientEngine(ServerLink link, Listener listener, WebGUI.BrowserUI ui) {
        this.link = link;
        this.listener = listener;
        MessageReaders.install();
        Messages.loadMessageBundle(Language.locale());
        UserServerAPI.connectionFactory = (name, host, port) -> {
            PostMessageConnection c = new PostMessageConnection(name, xml -> {
                this.lastRequest = xml;
                link.post(xml);
            });
            c.setAfterHandle(listener::updated);
            c.setReplyWatcher((asked, reply) -> ModalGate.replied(getClient(), asked, reply));
            // Handling a message is a job: a dialog it opens is modal until it is done (#401).
            c.setAround(this::job);
            this.connection = c;
            link.connect();
            return c;
        };
        this.client = new FreeColClient(fcc -> this.gui = new WebGUI(fcc, this, ui));
        this.commands = new Commands(this.client);
        this.menus = new Menus(this.client);
        startExportDataFromOptions();
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
        // A new game: the player name option, as NewPanel fills it in, or FreeCol's default.
        final String option = this.client.getClientOptions().getText(ClientOptions.NAME);
        if (name == null || name.isEmpty()) {
            name = (option == null || option.isEmpty()) ? FreeCol.getName() : option;
        }
        if (!this.client.getConnectController()
            .requestLogin(name,
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
        if ("statistics".equals(r.get("action")) && r.get("server") instanceof java.util.Map) {
            // DebugUtils.statistics shows the server's statistics and the client's together.
            this.client.getGUI().showInformationPanel(StringTemplate.name(
                new DebugClientTools(this.client).statistics((java.util.Map<?, ?>)r.get("server"))));
            return;
        }
        if (r.get("info") instanceof String) {
            // What an inspection found, which Swing shows in an information panel.
            this.client.getGUI().showInformationPanel(StringTemplate.name((String)r.get("info")));
            return;
        }
        if ("traceWork".equals(r.get("action"))) {
            // The client's copy of the colony traces too, as ColonyPanel's button sets it on the one colony.
            final net.sf.freecol.common.model.Colony c = getGame()
                .getFreeColGameObject((String)r.get("colony"), net.sf.freecol.common.model.Colony.class);
            if (c != null) c.setOccupationTrace(Boolean.TRUE.equals(r.get("trace")));
            return;
        }
        if (!"revealMap".equals(r.get("action"))) return;
        Specification spec = getGame().getSpecification();
        DebugActions.setFogOfWar(spec, Boolean.TRUE.equals(r.get("reveal")));
        this.client.getMyPlayer().invalidateCanSeeTiles();
    }

    /**
     * The client's own debug tools (DebugClientTools): the units' dump, the
     * digest of the client's map, and the test panels.
     *
     * @param request The request, JSON.
     * @return The answer, JSON.
     */
    public String debugClient(String request) {
        return new DebugClientTools(this.client).run(request);
    }

    /**
     * Whether every message the server has sent has been handled.
     *
     * @return True if none is waiting to be read or being handled.
     */
    public boolean isQuiet() {
        final PostMessageConnection c = this.connection;
        return c == null || c.isQuiet();
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

    /**
     * Run work as one job of the {@link ModalGate}: a player's command, or
     * the handling of a server message. A dialog it opens is modal until it
     * is done, so its questions come one after another, and what other
     * threads do meanwhile waits for it (#401).
     *
     * @param work The work.
     */
    public void job(Runnable work) {
        final WebGUI g = this.gui;
        if (g == null) {
            work.run();
        } else {
            g.modalGate().job(work);
        }
    }

    /** What the human player can do on their turn. */
    public Commands getCommands() {
        return this.commands;
    }

    /**
     * Have the tile panel show a player's colony value for the tile
     * (FreeColDebugger.setDebugDisplayColonyValuePlayer).
     *
     * @param playerId The player's id, or "" for none.
     */
    public void setColonyValuePlayer(String playerId) {
        net.sf.freecol.common.model.Player p = (playerId == null || playerId.isEmpty()) ? null
            : getGame().getFreeColGameObject(playerId, net.sf.freecol.common.model.Player.class);
        net.sf.freecol.common.debug.FreeColDebugger.setDebugDisplayColonyValuePlayer(p);
    }

    /** The right-click menus' entries. */
    Menus getMenus() {
        return this.menus;
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

    /** The values of FreeCol's client options, by id, as JSON ({@link OptionsJson#values}). */
    public String clientOptionValues() {
        return OptionsJson.values(this.client.getClientOptions()).toString();
    }

    /**
     * Set one of FreeCol's client options, as the Preferences window does.
     *
     * @param id The option's id.
     * @param value "true" or "false", or a whole number.
     * @return True if there is such an option and the value fits it.
     */
    public boolean setClientOption(String id, String value) {
        final boolean set = OptionsJson.set(this.client.getClientOptions(), id, value);
        if (set) startExportDataFromOptions();
        return set;
    }

    /** Start a colony's export settings from the warehouse options, as ExportData's defaults (#158). */
    private void startExportDataFromOptions() {
        final ClientOptions co = this.client.getClientOptions();
        ExportData.setDefaults(co.getInteger(ClientOptions.HIGH_LEVEL),
                               co.getInteger(ClientOptions.LOW_LEVEL),
                               co.getInteger(ClientOptions.CUSTOM_STOCK));
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

    /** Whether it is still our turn, the turn that was ended. */
    private boolean stillOurTurn(int turn) {
        return !this.finished && this.client.currentPlayerIsMyPlayer() && getGame().getTurn().getNumber() == turn;
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
        new Thread(() -> {
                try {
                    // A save with units on goto orders or trade routes (a desktop game's) runs those orders
                    // on the first end turn and gives the turn back to the player, who ends it again, as
                    // a player does. So does this: until the server has taken the turn.
                    for (int attempt = 0; attempt < 8; attempt++) {
                        this.client.getInGameController().endTurn(false);
                        for (int i = 0; i < 30 && stillOurTurn(turn); i++) Thread.sleep(100);
                        if (!stillOurTurn(turn)) break;
                    }
                } catch (Throwable ex) {
                    Failures.report("Ending turn " + turn, ex);
                }
        }, "web-endTurn").start();
    }
}
