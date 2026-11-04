package online.freecol.web;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.io.FreeColSavegameFile;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.GameStateMessage;
import net.sf.freecol.common.networking.VacantPlayersMessage;
import net.sf.freecol.server.FreeColServer;
import net.sf.freecol.server.model.Session;
import net.sf.freecol.server.FreeColServer.ServerState;


/**
 * The server Engine: FreeCol's server and AI, with one client reached
 * through a {@link PostMessageConnection}. In the browser it runs in the
 * Worker.
 */
public final class ServerEngine {

    private PostMessageConnection.Port toClient;
    private FreeColServer server = null;
    private PostMessageConnection connection = null;

    public ServerEngine(PostMessageConnection.Port toClient) {
        this.toClient = toClient;
        MessageReaders.install();
        // A single-player game's timeout is 3.6 billion ms, which TeaVM's
        // Timer and Object.wait narrow to an int: the timer fired after 1 ms
        // (Node's TimeoutNegativeWarning, -694967296) and ended every
        // native demand and diplomacy session at once. 2 million s is
        // 23 days, below 2^31 ms.
        FreeCol.setTimeout(Long.toString(MAX_TIMEOUT_S));
    }

    /** The longest timeout in seconds whose milliseconds fit an int. */
    static final long MAX_TIMEOUT_S = 2_000_000L;

    /** Where the next client's connection posts, for a test's second client. */
    void setToClient(PostMessageConnection.Port toClient) {
        this.toClient = toClient;
    }

    /**
     * Start a new single-player server game, waiting in pre-game for the
     * client to log in.
     *
     * @param rules The rules id, e.g. "classic".
     * @exception Exception if the rules or the server fail.
     */
    public void startGame(String rules) throws Exception {
        startGame(rules, GamePreset.none());
    }

    /**
     * Start a new single-player server game as a preset says, waiting in
     * pre-game for the client to log in.
     *
     * @param rules The rules id, e.g. "classic", unless the preset names
     *     its own.
     * @param preset What to set before the game is made.
     * @exception IllegalArgumentException if the preset names something
     *     the rules do not have.
     * @exception Exception if the rules or the server fail.
     */
    public void startGame(String rules, GamePreset preset) throws Exception {
        this.setup = preset.setup;
        Messages.loadMessageBundle(Language.locale());
        FreeColRules.loadRules();
        final String id = (preset.rules != null) ? preset.rules : rules;
        if (FreeColRules.getFreeColRulesFile(id) == null) {
            throw new IllegalArgumentException("Unknown rules \"" + id + "\"");
        }
        Specification spec = FreeCol.loadSpecification(
            FreeColRules.getFreeColRulesFile(id), null,
            "model.difficulty.medium");
        // Everything the preset can get wrong fails here, before a server
        // is made.
        preset.applyTo(spec);
        // FreeCol forgets the open sessions (a monarch's offer, a trade)
        // only when it loads a game; a new one in the same Worker would
        // otherwise meet the last game's, keyed by the same player ids, as
        // a "Duplicate session" error.
        Session.clearAll();
        FreeColServer made = new FreeColServer(false, true, spec, null, 0, "browser");
        preset.applyTo(made);
        this.server = made;
    }

    /** The preset's setup requests, until they have run. */
    private List<Map<?, ?>> setup = new ArrayList<>();

    /**
     * Run the preset's setup requests, once the game has started and the
     * human has joined: the scenario the preset describes.
     *
     * @return The answers, in order, each as {@link #debug} gives it.
     * @exception IllegalArgumentException if a request is bad.
     */
    public List<String> setup() {
        final List<String> answers = new ArrayList<>();
        final DebugActions actions = new DebugActions(getGame(), human(),
            this.server.getAIMain(), this.server.getInGameController());
        final List<Map<?, ?>> requests = this.setup;
        this.setup = new ArrayList<>();
        for (Map<?, ?> r : requests) answers.add(actions.run(r));
        return answers;
    }

    /**
     * Run one of FreeCol's debug actions on the server's game, as the
     * Browser UI asks in debug mode; see {@link DebugActions} for the
     * requests. The human player gets the change as any other update.
     *
     * @param request The request, JSON.
     * @return The answer, JSON: the action's name and what it found.
     * @exception IllegalArgumentException if the request is bad.
     */
    public String debug(String request) {
        return new DebugActions(getGame(), human(), this.server.getAIMain(),
            this.server.getInGameController()).run(request);
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
     * No client options and no thumbnail: the browser client's options
     * are the defaults, and only the map editor saves an image.
     *
     * @param activeUnitId The id of the client's active unit, which a
     *     load makes active again, as desktop's InGameController.saveGame
     *     passes it; null or empty for none.
     * @return The bytes of the savegame file.
     * @exception IOException if the save fails.
     */
    public byte[] saveGame(String activeUnitId) throws IOException {
        File file = savegameFile();
        Game game = getGame();
        Unit active = (activeUnitId == null || activeUnitId.isEmpty()) ? null
            : game.getFreeColGameObject(activeUnitId, Unit.class);
        try {
            this.server.saveGame(file, ownerName(), null, active, null);
            return readAll(file);
        } finally {
            // The id is for the file; a live game does not keep it.
            game.setInitialActiveUnitId(null);
            file.delete();
        }
    }

    /** Save the game with no active unit. */
    public byte[] saveGame() throws IOException {
        return saveGame(null);
    }

    /** The human player, or null if there is none. */
    private Player human() {
        for (Player p : getGame().getLiveEuropeanPlayerList()) {
            if (!p.isAI()) return p;
        }
        return null;
    }

    /**
     * The human player's name, the owner a savegame names: the client
     * logs in under it, as desktop FreeCol does for a saved game, whoever
     * made the save.
     *
     * @return The name, or null if there is no human player.
     */
    public String ownerName() {
        Player human = human();
        return (human == null) ? null : human.getName();
    }

    /**
     * What the save list shows of the game: the turn, its year and the
     * human player's nation.
     *
     * @return A JSON object: turn, year, nation, owner.
     */
    public String saveInfo() {
        Game game = getGame();
        Player human = human();
        Json json = new Json();
        json.put("turn", game.getTurn().getNumber());
        json.put("year", game.getTurn().getYear());
        json.put("nation", human == null ? "" : Messages.message(human.getNationLabel()));
        json.put("owner", human == null ? "" : human.getName());
        return json.toString();
    }

    /**
     * Replace the server with one loaded from a savegame, as desktop
     * FreeCol starts a saved game. A client must connect afterwards.
     *
     * @param savegame The bytes of a savegame file.
     * @exception Exception if the savegame does not load.
     */
    public void loadGame(byte[] savegame) throws Exception {
        Messages.loadMessageBundle(Language.locale());
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
        } catch (Exception ex) {
            // An EOFException has no message (#31): say what was loaded.
            throw new IOException("loading a save of " + savegame.length
                + " bytes, " + file.length() + " on disk, ending "
                + tail(savegame) + ": " + ex, ex);
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

    /** The last bytes of a savegame in hex: a zip ends with its directory. */
    private static String tail(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (int i = Math.max(0, bytes.length - 8); i < bytes.length; i++) {
            sb.append(Integer.toHexString(0x100 | (bytes[i] & 0xff)).substring(1));
        }
        return sb.toString();
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
