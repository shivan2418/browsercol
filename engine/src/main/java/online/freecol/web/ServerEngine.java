package online.freecol.web;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.io.FreeColSavegameFile;
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

    /**
     * Save the game as desktop FreeCol does: a zipped savegame (.fsg)
     * written through the file system, here TeaVM's in-memory one.
     * Prototype for #67: no client options, no active unit, no
     * thumbnail.
     *
     * @return The bytes of the savegame file.
     * @exception IOException if the save fails.
     */
    public byte[] saveGame() throws IOException {
        File file = savegameFile();
        try {
            this.server.saveGame(file, null, null);
            return readAll(file);
        } finally {
            file.delete();
        }
    }

    /**
     * Replace the server with one loaded from a savegame, as desktop
     * FreeCol starts a saved game. A client must connect afterwards.
     *
     * @param savegame The bytes of a savegame file.
     * @exception Exception if the savegame does not load.
     */
    public void loadGame(byte[] savegame) throws Exception {
        Messages.loadMessageBundle(Locale.US);
        FreeColRules.loadRules();
        File file = savegameFile();
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(savegame);
        }
        try {
            if (this.server != null) this.server.shutdown();
            this.connection = null;
            this.server = new FreeColServer(new FreeColSavegameFile(file),
                null, null, 0, "browser");
        } finally {
            file.delete();
        }
    }

    /**
     * Where a savegame passes through the file system. In the browser
     * that is TeaVM's in-memory file system, so the directory is
     * relative; the JVM tests set one they can write to.
     */
    static File saveDirectory = new File("saves");

    private static File savegameFile() {
        saveDirectory.mkdirs();
        return new File(saveDirectory, "browser.fsg");
    }

    private static byte[] readAll(File file) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0;) out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    /**
     * A one-line summary of the game, to compare a game with its load.
     *
     * @return The turn and, per live player by nation, its settlements
     *     and units.
     */
    public String describe() {
        Game game = getGame();
        java.util.TreeMap<String, String> players = new java.util.TreeMap<>();
        for (net.sf.freecol.common.model.Player p : game.getLivePlayerList()) {
            players.put(p.getNationId().replace("model.nation.", ""),
                p.getSettlementCount() + "/" + p.getUnitCount());
        }
        StringBuilder sb = new StringBuilder();
        sb.append(game.getTurn());
        players.forEach((k, v) -> sb.append(' ').append(k).append('=').append(v));
        return sb.toString();
    }

    public FreeColServer getServer() {
        return this.server;
    }

    public Game getGame() {
        return this.server.getGame();
    }
}
