package browsercol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.util.LogBuilder;


/**
 * The parts of FreeCol's Debug menu (common.debug.DebugUtils, client.gui.menu.DebugMenu)
 * that are the client's own: they read or show what the client Engine has,
 * not the server's game. The Browser UI asks for them by name
 * ({@link ClientMain#debugClient}); each answers with JSON. The panels they
 * show are the WebGUI's, as Swing's debug actions show the GUI's.
 *
 * <pre>
 * { "action": "displayUnits" }       the units of the player, as DebugUtils.displayUnits
 * { "action": "digest" }             what compareMaps sends the server
 * { "action": "monarchPanel" }       the monarch dialog (Display Panels)
 * { "action": "errorPanel" }         the error dialog with a long message (Display Panels)
 * </pre>
 */
final class DebugClientTools {

    /** DebugMenu.ERROR_MESSAGE, which the Display Error Message entry shows. */
    static final String ERROR_MESSAGE
        = "This is a long error message, indicating that some error has occurred. "
        + "This is a long error message, indicating that some error has occurred. "
        + "This is a long error message, indicating that some error has occurred. "
        + "This is a long error message, indicating that some error has occurred. "
        + "This is a long error message, indicating that some error has occurred.";

    private final FreeColClient client;

    DebugClientTools(FreeColClient client) {
        this.client = client;
    }

    /** Run a request; see the class comment. */
    String run(String request) {
        final Object top = JsonReader.read(request);
        if (!(top instanceof Map)) throw new IllegalArgumentException("Debug: a request is a JSON object");
        final Object action = ((Map<?, ?>)top).get("action");
        if ("displayUnits".equals(action)) return displayUnits();
        if ("digest".equals(action)) return digest();
        if ("monarchPanel".equals(action)) return monarchPanel();
        if ("errorPanel".equals(action)) return errorPanel();
        throw new IllegalArgumentException("Debug: unknown client action \"" + action + "\"");
    }

    private Player me() {
        final Player p = this.client.getMyPlayer();
        if (p == null) throw new IllegalArgumentException("Debug: there is no player yet");
        return p;
    }

    /**
     * DebugUtils.displayUnits: the player's units in the order the client
     * would offer them to move, then those going somewhere, then the rest.
     */
    private String displayUnits() {
        final Player player = me();
        final Set<Unit> all = player.getUnitSet();
        final LogBuilder lb = new LogBuilder(256);
        lb.add("\nActive units:\n");
        Unit u;
        Unit first = player.getNextActiveUnit();
        if (first != null) {
            lb.add(first.toString(), "\nat ", first.getLocation(), "\n");
            all.remove(first);
            while (player.hasNextActiveUnit()
                && (u = player.getNextActiveUnit()) != first) {
                lb.add(u, "\nat ", u.getLocation(), "\n");
                all.remove(u);
            }
        }
        lb.add("Going-to units:\n");
        first = player.getNextGoingToUnit();
        if (first != null) {
            all.remove(first);
            lb.add(first, "\nat ", first.getLocation(), "\n");
            while (player.hasNextGoingToUnit()
                && (u = player.getNextGoingToUnit()) != first) {
                lb.add(u, "\nat ", u.getLocation(), "\n");
                all.remove(u);
            }
        }
        lb.add("Remaining units:\n");
        for (Unit x : all) {
            lb.add(x, "\nat ", x.getLocation(), "\n");
        }
        this.client.getGUI().showInformationPanel(StringTemplate.name(lb.toString()));
        return new Json().put("action", "displayUnits").toString();
    }

    /**
     * What the server's DebugInspection.compareMaps checks of the client's
     * game: where each unit is, each settlement, and the market's prices.
     */
    private String digest() {
        final Game game = this.client.getGame();
        final List<String> units = new ArrayList<>();
        final List<String> settlements = new ArrayList<>();
        game.getMap().forEachTile(t -> {
            for (Unit u : t.getUnitList()) {
                units.add(Json.quote(u.getId()) + ":" + Json.quote(t.getId()));
            }
            if (t.getSettlement() != null) {
                settlements.add(Json.quote(t.getId()) + ":" + Json.quote(t.getSettlement().getId()));
            }
        });
        // Units the client has that are not on the map (aboard, in Europe) are in their own place.
        for (Unit u : me().getUnitSet()) {
            if (u.getTile() == null) units.add(Json.quote(u.getId()) + ":\"\"");
        }
        final Map<String, String> prices = new TreeMap<>();
        final Market market = me().getMarket();
        if (market != null) {
            for (GoodsType g : game.getSpecification().getGoodsTypeList()) {
                prices.put(g.getId(), Integer.toString(market.getBidPrice(g, 1)));
            }
        }
        final List<String> priceJson = new ArrayList<>();
        for (Map.Entry<String, String> e : prices.entrySet()) {
            priceJson.add(Json.quote(e.getKey()) + ":" + e.getValue());
        }
        return new Json().put("action", "digest")
            .putRaw("units", "{" + String.join(",", units) + "}")
            .putRaw("settlements", "{" + String.join(",", settlements) + "}")
            .putRaw("prices", "{" + String.join(",", priceJson) + "}").toString();
    }

    /**
     * DebugMenu's Display Panels, Monarch Panel: the dialog of a tax raise
     * in a war, which Yes and No answer to the server as they do for a real one.
     */
    private String monarchPanel() {
        final Player player = me();
        this.client.getGUI().showMonarchDialog(MonarchAction.RAISE_TAX_WAR, null,
            player.getNationId(),
            (Boolean b) -> this.client.getInGameController()
                .monarchAction(MonarchAction.RAISE_TAX_WAR, b));
        return new Json().put("action", "monarchPanel").toString();
    }

    /** DebugMenu's Display Panels, Error Message. */
    private String errorPanel() {
        this.client.getGUI().showErrorPanel(StringTemplate.name(ERROR_MESSAGE));
        return new Json().put("action", "errorPanel").toString();
    }

    /**
     * DebugUtils.statistics, the client's half with the server's: both as
     * one text for an information panel.
     *
     * @param server The server's statistics, from its answer.
     */
    String statistics(Map<?, ?> server) {
        final StringBuilder sb = new StringBuilder("Server\n");
        table(sb, server);
        sb.append("\nClient\n");
        table(sb, DebugInspection.gameStatistics(this.client.getGame()));
        return sb.toString();
    }

    private static void table(StringBuilder sb, Map<?, ?> stats) {
        for (Map.Entry<?, ?> e : new TreeMap<Object, Object>(stats).entrySet()) {
            sb.append("  ").append(e.getKey()).append(": ").append(e.getValue()).append('\n');
        }
    }
}
