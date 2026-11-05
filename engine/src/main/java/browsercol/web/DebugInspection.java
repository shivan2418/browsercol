package browsercol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.util.LogBuilder;
import net.sf.freecol.server.ai.AIMain;
import net.sf.freecol.server.ai.AIUnit;
import net.sf.freecol.server.ai.EuropeanAIPlayer;
import net.sf.freecol.server.ai.AIObject;
import net.sf.freecol.server.ai.military.DefensiveMap;
import net.sf.freecol.server.ai.military.DefensiveZone;
import net.sf.freecol.server.model.ServerPlayer;


/**
 * The inspection tools of FreeCol's Debug menu (common.debug.DebugUtils and
 * the debug drawing of the map viewer) that read the server's game: the
 * players, Europe, the statistics, the comparison of the client's map with
 * the server's, and the overlays that the map viewer draws from the server's
 * AI (the colony value, the AI's missions and its defence map). Each is a
 * request of {@link DebugActions}.
 *
 * Swing shows what these find in an information panel, with the server's game
 * at hand through {@code getFreeColServer()}. Here the answer carries the
 * text as "info", and the client Engine shows it (ClientEngine.debugApplied).
 */
final class DebugInspection {

    private final Game game;
    private final Player human;
    private final AIMain aiMain;

    DebugInspection(Game game, Player human, AIMain aiMain) {
        this.game = game;
        this.human = human;
        this.aiMain = aiMain;
    }

    /** An answer that the client shows as an information panel. */
    private static String info(String action, String text) {
        return new Json().put("action", action).put("info", text).toString();
    }

    /**
     * The live European players, for the Debug menu's choices of a player:
     * {"players": [{"id", "nation", "name", "ai"}]}.
     */
    String players() {
        final List<String> out = new ArrayList<>();
        for (Player p : this.game.getLiveEuropeanPlayerList()) {
            out.add(new Json().put("id", p.getId()).put("nation", p.getNationId())
                .put("name", Messages.message(p.getCountryLabel()))
                .put("ai", p.isAI()).toString());
        }
        return new Json().put("action", "players").putRaw("players", Json.array(out)).toString();
    }

    /**
     * DebugUtils.displayEurope: for each European player, the units in
     * Europe, sailing to it and sailing to America with what the AI has them
     * do, and who is waiting to be recruited.
     */
    String displayEurope() {
        final LogBuilder lb = new LogBuilder(256);
        for (Player p : this.game.getLiveEuropeanPlayerList()) {
            if (p.getEurope() == null) continue;
            final List<Unit> inEurope = new ArrayList<>();
            final List<Unit> toEurope = new ArrayList<>();
            final List<Unit> toAmerica = new ArrayList<>();
            lb.add("\n==", Messages.message(p.getCountryLabel()), "==\n");
            for (Unit u : p.getEurope().getUnitList()) {
                if (u.getDestination() instanceof net.sf.freecol.common.model.Map) {
                    toAmerica.add(u);
                } else if (u.getDestination() instanceof Europe) {
                    toEurope.add(u);
                } else {
                    inEurope.add(u);
                }
            }
            europe(lb, Messages.message("sailingToEurope"), toEurope);
            europe(lb, Messages.getName(p.getEurope()), inEurope);
            europe(lb, Messages.message("sailingToAmerica"), toAmerica);
            lb.add("\n->", Messages.message("immigrants"), "\n\n");
            for (AbstractUnit au : p.getEurope().getExpandedRecruitables(false)) {
                lb.add(Messages.message(au.getSingleLabel()), "\n");
            }
            lb.add("\n");
        }
        return info("displayEurope", lb.toString());
    }

    /** DebugUtils.logEurope. */
    private void europe(LogBuilder lb, String label, List<Unit> units) {
        if (units.isEmpty()) return;
        lb.add("\n->", label, "\n");
        for (Unit u : units) {
            lb.add("\n", u.getDescription(Unit.UnitLabelType.NATIONAL));
            if (u.isDamagedAndUnderForcedRepair()) {
                lb.add(" (", Messages.message(u.getRepairLabel()), ")");
            } else {
                lb.add("    ");
                final AIUnit aiu = this.aiMain.getAIUnit(u);
                if (aiu == null || !aiu.hasMission()) {
                    lb.add(" (", Messages.message("none"), ")");
                } else {
                    lb.add(aiu.getMission().toString().replaceAll("\n", "    \n"));
                }
            }
        }
        lb.add("\n");
    }

    /**
     * Game.getStatistics, less its memory figures: the runtime the browser
     * has gives no Runtime.maxMemory, so the Engines cannot say how much
     * memory they hold, only how many objects of each class the game has.
     */
    static Map<String, String> gameStatistics(Game game) {
        final Map<String, Long> counts = new TreeMap<>();
        long disposed = 0;
        for (net.sf.freecol.common.model.FreeColGameObject o : game.getFreeColGameObjectList()) {
            counts.merge(o.getClass().getSimpleName(), 1L, Long::sum);
            if (o.isDisposed()) disposed++;
        }
        final Map<String, String> stats = new TreeMap<>();
        stats.put("disposed", Long.toString(disposed));
        for (Map.Entry<String, Long> e : counts.entrySet()) stats.put(e.getKey(), Long.toString(e.getValue()));
        return stats;
    }

    /**
     * DebugUtils.statistics, the server's half: the statistics of the
     * server's game and its AI. The client adds its own half and shows both.
     */
    String statistics() {
        final java.util.Map<String, String> stats = new TreeMap<>(gameStatistics(this.game));
        stats.putAll(this.aiMain.getAIStatistics());
        final List<String> out = new ArrayList<>();
        for (Map.Entry<String, String> e : stats.entrySet()) {
            out.add(Json.quote(e.getKey()) + ":" + Json.quote(e.getValue()));
        }
        return new Json().put("action", "statistics")
            .putRaw("server", "{" + String.join(",", out) + "}").toString();
    }

    /**
     * DebugUtils.checkDesyncAction: what the human's client has of the map
     * and the market, which the page took from the client Engine
     * ({@link DebugClientTools#digest}), against what the server has of them
     * for the human to see. Swing compares the two games in one process; in
     * the browser each is in its own thread, so the client sends a digest.
     *
     * @param client The digest: "units" (unit id to its tile's id, "" for none),
     *     "settlements" (tile id to settlement id) and "prices" (goods type id
     *     to the bid price of one).
     */
    String compareMaps(Map<?, ?> client) {
        if (this.human == null) throw new IllegalArgumentException("Debug: there is no human player");
        final ServerPlayer sPlayer = (ServerPlayer)this.human;
        final Map<?, ?> units = object(client, "units");
        final Map<?, ?> settlements = object(client, "settlements");
        final Map<?, ?> prices = object(client, "prices");
        final LogBuilder lb = new LogBuilder(256);
        lb.add("Desynchronization detected\n");
        lb.mark();
        this.game.getMap().forEachTile(t -> sPlayer.canSee(t), t -> {
            for (Unit su : t.getUnitList()) {
                if (!sPlayer.canSeeUnit(su)) continue;
                final Object where = units.get(su.getId());
                if (where == null) {
                    lb.add("Unit missing on client-side.\n  Server: ",
                        su.getDescription(Unit.UnitLabelType.NATIONAL), "(", su.getId(),
                        ") from: ", su.getLocation().getId(), ".\n");
                } else if (!"".equals(where) && !where.equals(t.getId())) {
                    lb.add("Unit located on different tiles.\n  Server: ",
                        su.getDescription(Unit.UnitLabelType.NATIONAL), "(", su.getId(),
                        ") from: ", su.getLocation().getId(), "\n  Client: at ", where, "\n");
                }
            }
            final Settlement ss = t.getSettlement();
            final Object cs = settlements.get(t.getId());
            if (ss == null) {
                if (cs != null) lb.add("Settlement still present in client: ", cs, "\n");
            } else if (cs == null) {
                lb.add("Settlement not present in client: ", ss, "\n");
            } else if (!ss.getId().equals(cs)) {
                lb.add("Settlements differ.\n  Server: ", ss.getId(), "\n  Client: ", cs, "\n");
            }
        });
        boolean problem = lb.grew();
        // The goods' amounts are not checked: the server sends the client
        // changes to the market only when the price changes.
        final Market market = sPlayer.getMarket();
        boolean pricesDiffer = false;
        if (market != null) {
            for (GoodsType g : this.game.getSpecification().getGoodsTypeList()) {
                final Object c = prices.get(g.getId());
                final int s = market.getBidPrice(g, 1);
                if (c instanceof Long && ((Long)c).intValue() != s) {
                    lb.add("Goods prices for ", g, " differ: ", s, "!=", c, " ");
                    pricesDiffer = true;
                }
            }
        }
        if (pricesDiffer) problem = true;
        if (!problem) {
            return info("compareMaps", Messages.message("menuBar.debug.compareMaps.checkComplete"));
        }
        lb.shrink("\n");
        return info("compareMaps", lb.toString());
    }

    private static Map<?, ?> object(Map<?, ?> from, String key) {
        final Object v = from.get(key);
        if (!(v instanceof Map)) throw new IllegalArgumentException("Debug: \"" + key + "\" is an object");
        return (Map<?, ?>)v;
    }

    /**
     * What the map viewer draws over each tile for the debug options, and
     * what it tints:
     * <ul>
     * <li>"coords": the tile's x and y, and its high seas count if it has one
     *     (TileViewer);
     * <li>"colonyValue": a player's id; that player's colony value of the
     *     tile, or why it has none (DebugUtils.getColonyValue);
     * <li>"missions": 1 for the AI units' missions, 2 with what more they
     *     tell (MapViewer's debug mission text), on the tiles the human sees;
     * <li>"defence": an AI player's id; a tint of each tile in its defensive
     *     map (MapViewer.displayDebugAiDefensiveMap).
     * </ul>
     * The answer: "labels" ([x, y, text] per tile that has text) and "tints"
     * ([x, y, rgb, alpha] per tile).
     */
    String overlay(Map<?, ?> r) {
        final int w = this.game.getMap().getWidth();
        final int h = this.game.getMap().getHeight();
        final String[][] lines = new String[h][w];
        if (Boolean.TRUE.equals(r.get("coords"))) {
            forEach(t -> {
                String pos = t.getX() + ", " + t.getY();
                if (t.getHighSeasCount() >= 0) pos += "/" + t.getHighSeasCount();
                add(lines, t, pos);
            });
        }
        if (r.get("colonyValue") != null) {
            final Player p = player(r, "colonyValue");
            forEach(t -> {
                // The map viewer paints only what is shown: what the human has explored.
                if (this.human != null && !this.human.hasExplored(t)) return;
                final int value = p.getColonyValue(t);
                add(lines, t, (value < 0) ? Player.NoValueType.fromValue(value).toString()
                    : Integer.toString(value));
            });
        }
        final Object missions = r.get("missions");
        if (missions instanceof Long && (Long)missions > 0) {
            final boolean more = (Long)missions > 1;
            forEach(t -> {
                if (t.hasSettlement()) return;
                for (Unit u : t.getUnitList()) {
                    if (this.human == null || this.human.owns(u) || !u.getOwner().isAI()
                        || !this.human.canSee(t)) continue;
                    final AIUnit au = this.aiMain.getAIUnit(u);
                    if (au == null) continue;
                    String text = (!au.hasMission()) ? "No mission"
                        : au.getMission().getClass().getSimpleName().replaceAll("Mission$", "");
                    if (more && au.hasMission()) {
                        text += "\n" + au.getMission().toStringForDebugExtraMissionInfo();
                    }
                    add(lines, t, text);
                }
            });
        }
        final List<String> labels = new ArrayList<>();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if (lines[y][x] != null) labels.add("[" + x + "," + y + "," + Json.quote(lines[y][x]) + "]");
            }
        }
        final List<String> tints = new ArrayList<>();
        if (r.get("defence") != null) {
            final Player p = player(r, "defence");
            final AIObject ai = this.aiMain.getAIObject(p.getId());
            if (!(ai instanceof EuropeanAIPlayer)) {
                throw new IllegalArgumentException("Debug: " + p.getId() + " is not an AI player");
            }
            final DefensiveMap map = DefensiveMap.createDefensiveMap((EuropeanAIPlayer)ai);
            forEach(t -> {
                final DefensiveZone zone = map.getDefensiveZone(t);
                if (zone == null) return;
                // The map viewer's colours, as rgb and an alpha of 150 of 255.
                final int rgb = (zone.getNumberOfMilitaryEnemies() > 0) ? 0xff0000
                    : zone.isEnemiesInNeighbour() ? 0xff6464
                    : zone.isExposed() ? 0xffff00 : 0x00ff00;
                tints.add("[" + t.getX() + "," + t.getY() + "," + rgb + "]");
            });
        }
        return new Json().put("action", "overlay").putRaw("labels", Json.array(labels))
            .putRaw("tints", Json.array(tints)).toString();
    }

    private Player player(Map<?, ?> r, String key) {
        final Object id = r.get(key);
        final Player p = (id instanceof String) ? this.game.getFreeColGameObject((String)id, Player.class) : null;
        if (p == null) throw new IllegalArgumentException("Debug: no player " + id);
        return p;
    }

    private void forEach(java.util.function.Consumer<Tile> each) {
        this.game.getMap().forEachTile(each);
    }

    private static void add(String[][] lines, Tile t, String text) {
        final String old = lines[t.getY()][t.getX()];
        lines[t.getY()][t.getX()] = (old == null) ? text : old + "\n" + text;
    }
}
