package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSExport;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.util.Utils;


/**
 * Entry point of the client module, which runs on the main thread. The
 * page script (spike/web/main.js) calls the exports and provides
 * fcToServer, fcConnect and fcClientEvent.
 */
public final class ClientMain {

    private static ClientEngine engine;

    @JSBody(params = "xml", script = "fcToServer(xml);")
    private static native void toServer(String xml);

    @JSBody(script = "fcConnect();")
    private static native void connectToServer();

    @JSBody(params = { "name", "detail" }, script = "fcClientEvent(name, detail);")
    private static native void event(String name, String detail);

    /** Load the data files, (path, text) pairs, and make the client. */
    public static void main(String[] args) {
        new Thread(() -> {
                try {
                    DataFiles.write(args);
                    engine = new ClientEngine(new ClientEngine.ServerLink() {
                            public void connect() { connectToServer(); }
                            public void post(String xml) { toServer(xml); }
                        }, new ClientEngine.Listener() {
                            public void gameStarted(Game game) {
                                event("gameStarted", mapJson(game));
                            }
                            public void roundDone(int round, long millis) {
                                event("round", round + "," + millis);
                                event("map", mapJson(engine.getGame()));
                            }
                            public void finished(Game game) {
                                event("finished", String.valueOf(game.getTurn()));
                            }
                        });
                    event("ready", "");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-client").start();
    }

    /** Log in to the Worker's game, launch it and run AI rounds. */
    @JSExport
    public static void startGame(int rounds) {
        new Thread(() -> {
                try {
                    if (!engine.startGame(rounds)) event("failed", "login");
                } catch (Throwable ex) {
                    ex.printStackTrace();
                    event("failed", String.valueOf(ex));
                }
        }, "web-login").start();
    }

    @JSExport
    public static void receive(String xml) {
        engine.receive(xml);
    }

    /**
     * The client's view of the map for the crude renderer, as JSON:
     * w, h, the tile type ids, one character per tile ('A' + type index,
     * '.' if unexplored), and settlements and units as [x, y, rgb].
     */
    static String mapJson(Game game) {
        final Map map = game.getMap();
        final List<TileType> types = new ArrayList<>();
        final StringBuilder tiles = new StringBuilder(map.getWidth() * map.getHeight());
        final StringBuilder settlements = new StringBuilder();
        final StringBuilder units = new StringBuilder();
        for (int y = 0; y < map.getHeight(); y++) {
            for (int x = 0; x < map.getWidth(); x++) {
                Tile t = map.getTile(x, y);
                TileType type = (t == null) ? null : t.getType();
                if (type == null) {
                    tiles.append('.');
                    continue;
                }
                int i = types.indexOf(type);
                if (i < 0) { i = types.size(); types.add(type); }
                tiles.append((char)('A' + i));
                Settlement s = t.getSettlement();
                if (s != null) item(settlements, x, y, s.getOwner());
                Unit u = t.getFirstUnit();
                if (u != null) item(units, x, y, u.getOwner());
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\"w\":").append(map.getWidth())
            .append(",\"h\":").append(map.getHeight())
            .append(",\"turn\":\"").append(game.getTurn()).append('"')
            .append(",\"types\":[");
        for (int i = 0; i < types.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(types.get(i).getId()).append('"');
        }
        sb.append("],\"tiles\":\"").append(tiles)
            .append("\",\"settlements\":[").append(settlements)
            .append("],\"units\":[").append(units).append("]}");
        return sb.toString();
    }

    private static void item(StringBuilder sb, int x, int y, Player owner) {
        if (sb.length() > 0) sb.append(',');
        int rgb = (owner == null || owner.getNationColor() == null) ? 0xffffff
            : Utils.getRGB(owner.getNationColor()) & 0xffffff;
        sb.append('[').append(x).append(',').append(y).append(',').append(rgb).append(']');
    }
}
