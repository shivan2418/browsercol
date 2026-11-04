package online.freecol.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.common.model.Region;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Resource;
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovement;
import net.sf.freecol.common.model.TileItem;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.util.Utils;


/**
 * The client's view of the map for Tileset mode (ui/src/tileset.ts),
 * as JSON. Where FreeCol's ImageLibrary picks a resource key by checking
 * which keys exist, this sends the candidates, most specific first, and the
 * Browser UI takes the first its Tileset has. Fields:
 * <ul>
 * <li>w, h, turn, turnLabel (the season and year, e.g. Spring 1493),
 *     ourTurn, nation, statusLine, nation being the id of
 *     the player's nation (e.g. model.nation.dutch) and the last being
 *     FreeCol's status line, as InGameMenuBar paints it: the score, gold,
 *     tax and year;
 * <li>types: {id, land, forested, name} per tile type, indexed by tiles;
 * <li>tiles: one character per tile, 'A' + type index, '.' if unexplored;
 * <li>owners: one character per tile, 'A' + players index, '.' if
 *     unexplored or nobody's;
 * <li>players: {name (the nation), rgb} per tile owner, indexed by owners;
 * <li>seen: one character per tile, '1' if the player can see it now;
 * <li>fog: whether the map greys the tiles the player cannot see, as
 *     MapViewer does with the game's fog of war and the display fog of war
 *     client option on;
 * <li>regions: one character per tile, 'A' + regionNames index, '.' if
 *     unexplored or in no region; regionNames: the regions' names, as the
 *     tile text option's regions show them;
 * <li>rivers: [x, y, magnitude, style, forest mask], the style's digits
 *     being the magnitudes toward NE, SE, SW, NW;
 * <li>roads: [x, y, zIndex] per complete road;
 * <li>items: [x, y, zIndex, kind, key] per other complete tile item in
 *     zIndex order, kind "centered" (resources, rumours) or "tile"
 *     (improvement images, drawn if the key exists);
 * <li>settlements: {x, y, keys, rgb, name as the player knows it,
 *     population or -1, bonus (production), sizeChange (preferred),
 *     chips, fg (the label text's rgb on the owner's colour), own (the
 *     player's own settlement), building
 *     (for the player's own colony, what it builds and in how many turns,
 *     as the modern colony labels show it, else null)}, chips being null for a colony and for a native settlement
 *     {capital, fg, mission: {rgb, expert} or null, alarm: {fg, worthScouting}
 *     or null}, what ImageLibrary's settlement, mission and alarm chips
 *     show;
 * <li>units: {x, y, keys, rgb, chip (text), fg (the chip text's rgb),
 *     stack (units on the tile), fade}, for the unit MapViewer shows in
 *     front;
 * <li>active: the active unit's tile, [x, y], or null;
 * <li>activeUnit: {id, label, moves, cargo (labels of the units and goods
 *     aboard), path}, what FreeCol's InfoPanel shows of the active unit,
 *     or null. path is [x, y, turns] per step to the unit's destination
 *     (null for a step off the map, e.g. Europe), as
 *     SwingGUI.updateUnitPath finds it, or null without one.
 * </ul>
 */
final class MapJson {

    private MapJson() {}

    static String of(Game game, Player player, Unit active) {
        return of(game, player, active, true);
    }

    /**
     * The map, with the fog of war shown or not.
     *
     * @param fogShown The display fog of war client option.
     */
    static String of(Game game, Player player, Unit active, boolean fogShown) {
        final boolean fog = fogShown && game.getSpecification().getBoolean(GameOptions.FOG_OF_WAR);
        final Map map = game.getMap();
        final StringBuilder regions = new StringBuilder(map.getWidth() * map.getHeight());
        final List<Region> regionList = new ArrayList<>();
        final int w = map.getWidth(), h = map.getHeight();
        final List<TileType> types = new ArrayList<>();
        final StringBuilder tiles = new StringBuilder(w * h);
        final StringBuilder seen = new StringBuilder(w * h);
        final StringBuilder owners = new StringBuilder(w * h);
        final List<Player> players = new ArrayList<>();
        final List<String> rivers = new ArrayList<>(), roads = new ArrayList<>(),
            items = new ArrayList<>(), settlements = new ArrayList<>(),
            units = new ArrayList<>();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                final Tile t = map.getTile(x, y);
                final TileType type = (t == null || !t.isExplored()) ? null : t.getType();
                seen.append(type != null && player.canSee(t) ? '1' : '0');
                if (type == null) {
                    tiles.append('.');
                    owners.append('.');
                    regions.append('.');
                    continue;
                }
                final Region region = t.getRegion();
                if (region == null) {
                    regions.append('.');
                } else {
                    int r = regionList.indexOf(region);
                    if (r < 0) { r = regionList.size(); regionList.add(region); }
                    regions.append((char)('A' + r));
                }
                final Player owner = t.getOwner();
                if (owner == null) {
                    owners.append('.');
                } else {
                    int o = players.indexOf(owner);
                    if (o < 0) { o = players.size(); players.add(owner); }
                    owners.append((char)('A' + o));
                }
                int i = types.indexOf(type);
                if (i < 0) { i = types.size(); types.add(type); }
                tiles.append((char)('A' + i));
                tileItems(t, rivers, roads, items);
                final Settlement s = t.getSettlement();
                if (s != null) settlements.add(settlement(s, player));
                final Unit u = unitInFront(t, active);
                if (u != null) units.add(unit(u, player, fog));
            }
        }
        final List<String> typeJson = new ArrayList<>();
        for (TileType type : types) {
            typeJson.add(new Json().put("id", type.getId())
                .put("land", !type.isWater())
                .put("forested", type.isForested())
                .put("name", Messages.getName(type)).toString());
        }
        final List<String> playerJson = new ArrayList<>();
        for (Player p : players) {
            playerJson.add(new Json()
                .put("name", Messages.message(p.getNationLabel()))
                .put("rgb", rgb(p)).toString());
        }
        final List<String> regionNames = new ArrayList<>();
        for (Region r : regionList) regionNames.add(Json.quote(Messages.message(r.getLabel())));
        final Tile at = (active == null) ? null : active.getTile();
        return new Json().put("w", w).put("h", h)
            .put("turn", String.valueOf(game.getTurn()))
            .put("turnLabel", Messages.message(game.getTurn().getLabel()))
            .put("ourTurn", player == game.getCurrentPlayer())
            .put("nation", player.getNationId())
            .put("statusLine", statusLine(game, player))
            .putRaw("types", Json.array(typeJson))
            .put("tiles", tiles.toString())
            .put("seen", seen.toString())
            .put("fog", fog)
            .put("regions", regions.toString())
            .putRaw("regionNames", Json.array(regionNames))
            .put("owners", owners.toString())
            .putRaw("players", Json.array(playerJson))
            .putRaw("rivers", Json.array(rivers))
            .putRaw("roads", Json.array(roads))
            .putRaw("items", Json.array(items))
            .putRaw("settlements", Json.array(settlements))
            .putRaw("units", Json.array(units))
            .putRaw("active", xy(at))
            .putRaw("activeUnit", (active == null) ? "null" : activeUnit(active))
            .toString();
    }

    /**
     * FreeCol's status line, as InGameMenuBar paints it: the score, the
     * gold, the tax and the year, separated by the stars it replaces the
     * bars of the message with.
     */
    static String statusLine(Game game, Player player) {
        return Messages.message(StringTemplate
            .template("menuBar.statusLine")
            .addAmount("%gold%", player.getGold())
            .addAmount("%tax%", player.getTax())
            .addAmount("%score%", player.getScore())
            .addStringTemplate("%year%", game.getTurn().getLabel()))
            .replace("|", "\u2727"); // ✧
    }

    /** A tile as the Browser UI's map takes it, [x, y], or null for none. */
    static String xy(Tile tile) {
        return (tile == null) ? "null" : "[" + tile.getX() + "," + tile.getY() + "]";
    }

    /** InfoPanel.fillUnitPanel's text, and the path MapViewer draws. */
    private static String activeUnit(Unit u) {
        final List<String> cargo = new ArrayList<>();
        for (Unit aboard : u.getUnitList()) {
            cargo.add(Json.quote(aboard.getDescription(Unit.UnitLabelType.NATIONAL)));
        }
        for (Goods g : u.getGoodsList()) {
            cargo.add(Json.quote(Messages.message(g.getLabel(true))));
        }
        return new Json().put("id", u.getId())
            .put("label", u.getDescription(Unit.UnitLabelType.FULL))
            .put("moves", u.getMovesAsString())
            .putRaw("cargo", Json.array(cargo))
            .putRaw("path", path(u))
            .toString();
    }

    /** SwingGUI.updateUnitPath: the way to the unit's destination, if any. */
    private static String path(Unit u) {
        final Location destination = u.getDestination();
        if (destination == null
            || ((FreeColGameObject)destination).isDisposed()
            || u.isAtLocation(destination)) return "null";
        final PathNode path;
        try {
            path = u.findPath(destination);
        } catch (RuntimeException e) {
            return "null";
        }
        return path(path);
    }

    /** A path as [x, y, turns] per step, or "null" for none. */
    static String path(PathNode path) {
        if (path == null) return "null";
        final List<String> nodes = new ArrayList<>();
        for (PathNode p = path; p != null; p = p.next) {
            final Tile t = p.getTile();
            nodes.add((t == null) ? "null"
                : "[" + t.getX() + "," + t.getY() + "," + p.getTurns() + "]");
        }
        return Json.array(nodes);
    }

    private static void tileItems(Tile t, List<String> rivers, List<String> roads,
                                  List<String> items) {
        final String xy = t.getX() + "," + t.getY();
        final List<TileItem> sorted = new ArrayList<>(t.getCompleteItems());
        sorted.sort(Comparator.comparingInt(TileItem::getZIndex));
        for (TileItem item : sorted) {
            final String z = xy + "," + item.getZIndex() + ",";
            if (item instanceof TileImprovement) {
                final TileImprovement ti = (TileImprovement)item;
                if (ti.isRiver()) {
                    if (ti.getStyle() == null) continue;
                    rivers.add("[" + xy + "," + ti.getMagnitude() + ","
                        + Json.quote(ti.getStyle().getString()) + ","
                        + Json.quote(ti.getStyle().getMask()) + "]");
                } else if (ti.isRoad()) {
                    roads.add("[" + xy + "," + item.getZIndex() + "]");
                } else {
                    items.add("[" + z + "\"tile\","
                        + Json.quote("image.tile." + ti.getType().getId()) + "]");
                }
            } else if (item instanceof LostCityRumour) {
                items.add("[" + z + "\"centered\",\"image.tileitem.lostCityRumour\"]");
            } else if (item instanceof Resource) {
                items.add("[" + z + "\"centered\","
                    + Json.quote("image.tileitem." + ((Resource)item).getType().getId()) + "]");
            }
        }
    }

    /** ImageLibrary.getSettlementKey, with and without the nation. */
    static List<String> settlementKeys(Settlement s) {
        String key = "image.tileitem." + s.getType().getId();
        final List<String> keys = new ArrayList<>();
        if (s instanceof Colony) {
            final Colony colony = (Colony)s;
            if (colony.isUndead()) {
                key += ".undead";
            } else {
                final int population = colony.getApparentUnitCount();
                key += (population <= 3) ? ".small"
                    : (population <= 7) ? ".medium" : ".large";
                final String stockade = colony.getStockadeKey();
                if (stockade != null) key += "." + stockade;
            }
            keys.add(key + "." + s.getOwner().getNationResourceKey());
        } else if (s instanceof IndianSettlement
            && ((IndianSettlement)s).hasMissionary()) {
            key += ".mission";
        }
        keys.add(key);
        return keys;
    }

    private static String settlement(Settlement s, Player player) {
        int population = -1, bonus = 0, sizeChange = 0;
        String building = null;
        String chips = "null";
        final List<String> keys = settlementKeys(s);
        if (s instanceof Colony) {
            final Colony colony = (Colony)s;
            population = colony.getApparentUnitCount();
            bonus = colony.getProductionBonus();
            sizeChange = colony.getPreferredSizeChange();
            final BuildableType buildable = colony.getCurrentlyBuilding();
            if (buildable != null && colony.getOwner() == player) {
                building = Messages.getName(buildable) + " "
                    + Turn.getTurnsText(colony.getTurnsToComplete(buildable));
            }
        } else if (s instanceof IndianSettlement) {
            chips = chips((IndianSettlement)s, player);
        }
        final Tile t = s.getTile();
        return new Json().put("x", t.getX()).put("y", t.getY())
            .putRaw("keys", keys(keys))
            .put("rgb", rgb(s.getOwner()))
            .put("fg", foreground(rgb(s.getOwner())))
            .put("own", s.getOwner() == player)
            .put("building", building)
            .put("name", Messages.message(s.getLocationLabelFor(player)))
            .put("population", population)
            .put("bonus", bonus)
            .put("sizeChange", sizeChange)
            .putRaw("chips", chips).toString();
    }

    /**
     * What ImageLibrary.getIndianSettlementChip, getMissionChip and
     * getAlarmChip draw from. The alarm chip's background is the owner's
     * colour; createChip never fills in the alarm level, as every chip is
     * made "filled", so only the most hated nation's colour shows, as the
     * text's foreground.
     */
    private static String chips(IndianSettlement is, Player player) {
        final Unit missionary = is.getMissionary();
        final Player enemy = is.getMostHated();
        return new Json().put("capital", is.getType().isCapital())
            .put("fg", foreground(rgb(is.getOwner())))
            .putRaw("mission", (missionary == null) ? "null"
                : new Json().put("rgb", rgb(missionary.getOwner()))
                    .put("expert", missionary.hasAbility(Ability.EXPERT_MISSIONARY))
                    .toString())
            .putRaw("alarm", (player == null || !is.hasContacted(player)) ? "null"
                : new Json().put("fg", foreground((enemy == null) ? 0x000000 : rgb(enemy)))
                    .put("worthScouting", is.worthScouting(player))
                    .toString())
            .toString();
    }

    /** MapViewerState.findUnitInFront, without animations. */
    private static Unit unitInFront(Tile t, Unit active) {
        if (t.isEmpty()) return null;
        if (active != null && active.getTile() == t) return active;
        if (t.hasSettlement()) return null;
        if (active != null && active.isOffensiveUnit()) return t.getDefendingUnit(active);
        Unit best = null;
        int bestScore = -1;
        for (Unit u : t.getUnitList()) {
            int score = u.getMovesLeft()
                + ((u.getState() == Unit.UnitState.ACTIVE) ? 10000 : 0);
            if (bestScore < score) {
                bestScore = score;
                best = u;
            }
        }
        return best;
    }

    /** MapViewer.displayUnit's image keys, chip and stack count. */
    private static String unit(Unit u, Player player, boolean fog) {
        final Tile t = u.getTile();
        final boolean fade = u.getState() == Unit.UnitState.SENTRY
            || (fog && !player.canSee(t));
        final int rgb = rgb(u.getOwner());
        final int fg = (u.getState() == Unit.UnitState.FORTIFIED) ? 0x808080
            : foreground(rgb);
        final String chip = Messages.message(u.getOccupationLabel(player, false));
        return new Json().put("x", t.getX()).put("y", t.getY())
            .putRaw("keys", keys(unitKeys(u)))
            .put("rgb", rgb)
            .put("chip", chip)
            .put("fg", fg)
            .put("stack", t.getTotalUnitCount())
            .put("fade", fade).toString();
    }

    /** ImageLibrary.getUnitTypeImageKey's candidates. */
    static List<String> unitKeys(Unit u) {
        final String roleId = u.getRole().getId();
        final String base = "image.unit." + u.getType().getId()
            + (Role.isDefaultRoleId(roleId) ? "" : "." + Role.getRoleIdSuffix(roleId));
        final String nation = (u.getOwner() == null) ? null
            : u.getOwner().getNationResourceKey();
        final List<String> keys = new ArrayList<>();
        if (u.hasNativeEthnicity()
            && !u.getType().hasAbility(Ability.BORN_IN_INDIAN_SETTLEMENT)) {
            if (nation != null) keys.add(base + ".native." + nation);
            keys.add(base + ".native");
        }
        if (nation != null) keys.add(base + "." + nation);
        keys.add(base);
        return keys;
    }

    /** The image keys of a tile type's terrain, as a JSON array. */
    static String terrainKeyJson(TileType type) {
        return keys(List.of("image.tile." + type.getId() + ".center"));
    }

    /** The image keys of a tile type's forest, as a JSON array; null if it has none. */
    static String forestKeyJson(TileType type) {
        return type.isForested() ? keys(List.of("image.tileforest." + type.getId())) : "null";
    }

    /** A unit's image keys, best first, as a JSON array. */
    static String unitKeyJson(Unit u) {
        return keys(unitKeys(u));
    }

    private static String keys(List<String> keys) {
        final List<String> quoted = new ArrayList<>();
        for (String k : keys) quoted.add(Json.quote(k));
        return Json.array(quoted);
    }

    private static int rgb(Player owner) {
        return (owner == null || owner.getNationColor() == null) ? 0xffffff
            : Utils.getRGB(owner.getNationColor()) & 0xffffff;
    }

    /** ImageLibrary.makeForegroundColor. */
    private static int foreground(int rgb) {
        final int r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
        return (r * 0.3 + g * 0.59 + b * 0.11 >= 126) ? 0x000000 : 0xffffff;
    }
}
