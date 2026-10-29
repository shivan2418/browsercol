package online.freecol.web;

import java.util.Locale;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.networking.GameStateMessage;
import net.sf.freecol.common.networking.VacantPlayersMessage;
import net.sf.freecol.server.FreeColServer;
import net.sf.freecol.server.FreeColServer.ServerState;


/**
 * The server Engine: FreeCol's server and AI, with one client reached
 * through a {@link PostMessageConnection}. In the browser it runs in the
 * Worker.
 */
public final class ServerEngine {

    private final PostMessageConnection.Port toClient;
    private FreeColServer server = null;
    private PostMessageConnection connection = null;

    public ServerEngine(PostMessageConnection.Port toClient) {
        this.toClient = toClient;
        MessageReaders.install();
    }

    /**
     * Start a new single-player server game, waiting in pre-game for the
     * client to log in.
     *
     * @param rules The rules id, e.g. "classic".
     * @exception Exception if the rules or the server fail.
     */
    public void startGame(String rules) throws Exception {
        Messages.loadMessageBundle(Locale.US);
        FreeColRules.loadRules();
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile(rules), null,
            "model.difficulty.medium");
        this.server = new FreeColServer(false, true, spec, null, 0, "browser");
    }

    /**
     * Accept the client, as FreeColServer.addNewUserConnection does for a
     * socket.
     */
    public void connect() {
        PostMessageConnection c = new PostMessageConnection(
            FreeCol.SERVER_THREAD + "browser", this.toClient);
        c.setMessageHandler(this.server.getUserConnectionHandler());
        this.server.getServer().addConnection(c);
        this.connection = c;
        try {
            c.send(new GameStateMessage(this.server.getServerState()));
            if (this.server.getServerState() == ServerState.IN_GAME) {
                c.send(new VacantPlayersMessage().setVacantPlayers(getGame()));
            }
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    /** Accept protocol XML from the client. */
    public void receive(String xml) {
        this.connection.receive(xml);
    }

    public Game getGame() {
        return this.server.getGame();
    }
}
