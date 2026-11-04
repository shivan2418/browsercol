package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import net.sf.freecol.common.debug.FreeColDebugger;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.common.model.GoodsContainer;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.server.ai.AIMain;
import net.sf.freecol.server.control.InGameController;
import net.sf.freecol.server.ai.AIUnit;
import net.sf.freecol.server.ai.mission.Mission;
import net.sf.freecol.server.ai.mission.TransportMission;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;
import net.sf.freecol.server.model.ServerUnit;


/**
 * FreeCol's debug actions (common.debug.DebugUtils), as the server Engine
 * runs them. DebugUtils is written for desktop FreeCol, where the client
 * reaches into the server's game through {@code getFreeColServer()}; in the
 * browser the server is in a Worker, so the Browser UI sends a request
 * (JSON) and the server Engine changes its game as DebugUtils does, then
 * sends the human player the change the way the server sends any: a
 * {@link ChangeSet}. DebugUtils reconnects the client instead, which the
 * browser client does not support.
 *
 * <pre>
 * { "action": "revealMap", "reveal": true }
 * { "action": "addGold", "amount": 1000 }
 * { "action": "addUnit", "type": "model.unit.freeColonist", "x": 3, "y": 4 }
 * { "action": "addGoods", "type": "model.goods.food", "amount": 100, "x": 3, "y": 4 }
 * { "action": "addGoods", "type": "model.goods.food", "amount": 20, "unit": "unit:123" }
 * { "action": "aiView" }
 * </pre>
 *
 * Goods go to the colony on the tile, or to the unit with the id. Every
 * action answers with a JSON object naming it ("action"), so the Browser UI
 * and the client Engine can tell what was done; an action that fails
 * throws {@link IllegalArgumentException} naming what was wrong.
 */
final class DebugActions {

    private final Game game;
    private final ServerGame sGame;
    private final Player human;
    private final AIMain aiMain;
    private final InGameController igc;
    /** The tile the last colony or request named: where a request with no x and y acts. */
    private Tile focus = null;

    /**
     * @param game The server's game.
     * @param human The human player, or null if there is none.
     * @param aiMain The server's AI, to show what it plans.
     * @param igc The server's in-game controller, to found colonies as it does.
     */
    DebugActions(Game game, Player human, AIMain aiMain, InGameController igc) {
        this.igc = igc;
        this.game = game;
        this.sGame = (ServerGame)game;
        this.human = human;
        this.aiMain = aiMain;
    }

    /** Run a request; see the class comment. */
    String run(String request) {
        Object top = JsonReader.read(request);
        if (!(top instanceof Map)) throw bad("a request is a JSON object");
        return run((Map<?, ?>)top);
    }

    /** Run a request already read. */
    String run(Map<?, ?> r) {
        Object action = r.get("action");
        if (!(action instanceof String)) throw bad("a request has an \"action\"");
        switch ((String)action) {
        case "revealMap": return revealMap(!Boolean.FALSE.equals(r.get("reveal")));
        case "addGold": return addGold(integer(r, "amount"));
        case "addColony": return addColony(r);
        case "addBuilding": return addBuilding(string(r, "type"), r);
        case "addUnit": return addUnit(string(r, "type"), at(r),
            Boolean.TRUE.equals(r.get("inColony")), r);
        case "addGoods": return addGoods(string(r, "type"), integer(r, "amount"), r);
        case "aiView": return aiView();
        default:
            throw bad("unknown action \"" + action + "\" (known: revealMap, addGold,"
                + " addColony, addBuilding, addUnit, addGoods, aiView)");
        }
    }

    private static IllegalArgumentException bad(String why) {
        return new IllegalArgumentException("Debug: " + why);
    }

    private static String string(Map<?, ?> r, String key) {
        Object v = r.get(key);
        if (!(v instanceof String)) throw bad("\"" + key + "\" is a string");
        return (String)v;
    }

    private static int integer(Map<?, ?> r, String key) {
        Object v = r.get(key);
        if (!(v instanceof Long)) throw bad("\"" + key + "\" is a whole number");
        return ((Long)v).intValue();
    }

    private ServerPlayer me() {
        if (this.human == null) throw bad("there is no human player");
        return (ServerPlayer)this.human;
    }

    /**
     * The tile a request names by x and y, else the one the last colony or
     * request named.
     */
    private Tile at(Map<?, ?> r) {
        if (r.get("x") != null || r.get("y") != null) {
            this.focus = tile(integer(r, "x"), integer(r, "y"));
        }
        if (this.focus == null) throw bad("name a tile with \"x\" and \"y\"");
        return this.focus;
    }

    private Tile tile(int x, int y) {
        Tile t = this.game.getMap().getTile(x, y);
        if (t == null) throw bad("no tile at " + x + "," + y);
        return t;
    }

    /**
     * DebugUtils.revealMap: explore (or forget) the whole map for every
     * player, and turn fog of war off (or restore it). DebugUtils then makes
     * every client reconnect; here the human gets the tiles that changed.
     * The client turns its own fog of war off too, from the answer
     * ({@link ClientEngine#debugApplied}).
     */
    private String revealMap(boolean reveal) {
        final Specification spec = this.game.getSpecification();
        // As FreeColServer.exploreMapForAllPlayers, less its reconnect.
        Set<Tile> changed = null;
        for (Player p : this.game.getLiveEuropeanPlayerList()) {
            Set<Tile> tiles = ((ServerPlayer)p).exploreMap(reveal);
            if (p == this.human) changed = tiles;
        }
        setFogOfWar(spec, reveal);
        if (this.human != null && changed != null) {
            ChangeSet cs = new ChangeSet();
            cs.add(See.only(this.human), changed);
            this.sGame.sendTo(this.human, cs);
        }
        return new Json().put("action", "revealMap").put("reveal", reveal).toString();
    }

    /**
     * Fog of war off while the map is revealed, back to what it was when
     * it is hidden again (as DebugUtils.revealMap does). Each side's game
     * has its own specification, so each side calls this.
     */
    static void setFogOfWar(Specification spec, boolean reveal) {
        if (reveal) {
            FreeColDebugger.setNormalGameFogOfWar(spec.getBoolean(GameOptions.FOG_OF_WAR));
            spec.setBoolean(GameOptions.FOG_OF_WAR, false);
        } else {
            spec.setBoolean(GameOptions.FOG_OF_WAR, FreeColDebugger.getNormalGameFogOfWar());
        }
    }

    /** DebugUtils.addGold, for the human player. */
    private String addGold(int amount) {
        ServerPlayer p = me();
        p.modifyGold(amount);
        ChangeSet cs = new ChangeSet();
        cs.add(See.only(p), p);
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addGold").toString();
    }

    /**
     * DebugUtils.addNewUnitToTile, for the human player: a unit of the
     * type on the tile, or aboard a ship of theirs there with room for it.
     */
    private String addUnit(String typeId, Tile tile, boolean inColony, Map<?, ?> r) {
        ServerPlayer p = me();
        UnitType type = this.game.getSpecification().getUnitType(typeId);
        if (type == null) throw bad("unknown unit type \"" + typeId + "\"");
        // A land unit at sea goes aboard a ship with room for it.
        Unit carrier = (tile.isLand() || type.isNaval()) ? null
            : tile.getUnitList().stream()
                .filter(u -> u.isNaval() && u.getOwner() == p
                    && u.getSpaceLeft() >= type.getSpaceTaken())
                .findFirst().orElse(null);
        if (!tile.isLand() && !type.isNaval() && carrier == null) {
            throw bad("a land unit cannot be put at sea without a ship of yours with room");
        }
        // With inColony, a unit of a colony of ours joins it, to work, as a colonist who lives there.
        final Colony colony = tile.getColony();
        if (inColony && (colony == null || colony.getOwner() != p)) {
            throw bad("no colony of yours there to join");
        }
        ServerUnit unit = new ServerUnit(this.game, (carrier != null) ? carrier
            : inColony ? colony : tile, p, type);
        p.exploreForUnit(unit);
        unit.setMovesLeft(unit.getInitialMovesLeft());
        // "experience" is what it has gained at "experienceGoods", or at what it works at.
        if (r.get("experience") != null) {
            final GoodsType gained = (r.get("experienceGoods") != null)
                ? this.game.getSpecification().getGoodsType(string(r, "experienceGoods"))
                : unit.getWorkType();
            if (gained == null) throw bad("name the goods the experience is at, or use inColony");
            unit.changeExperienceType(gained);
            unit.setExperience(integer(r, "experience"));
        }
        p.invalidateCanSeeTiles();
        ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps(), tile);
        if (inColony) cs.add(See.only(p), colony);
        if (carrier != null) cs.add(See.only(p), carrier);
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addUnit").put("unit", unit.getId()).toString();
    }

    /**
     * A colony of the human player, founded as a colonist's Build Colony
     * does: on the tile, or, with no x and y, on the nearest land the
     * human's first unit could found one on. The colonist is new, and is
     * the colony's one unit; later requests with no x and y act there.
     */
    private String addColony(Map<?, ?> r) {
        final ServerPlayer p = me();
        Tile tile = null;
        if (r.get("x") != null || r.get("y") != null) {
            tile = tile(integer(r, "x"), integer(r, "y"));
        } else {
            final Tile from = p.getUnits().filter(u -> u.getTile() != null)
                .map(Unit::getTile).findFirst().orElse(null);
            if (from == null) throw bad("the human has no unit to look from");
            int best = Integer.MAX_VALUE;
            for (int x = 0; x < this.game.getMap().getWidth(); x++) {
                for (int y = 0; y < this.game.getMap().getHeight(); y++) {
                    final Tile t = this.game.getMap().getTile(x, y);
                    if (t == null || !t.isLand() || !p.canClaimToFoundSettlement(t)) continue;
                    final int d = this.game.getMap().getDistance(from, t);
                    if (d < best) {
                        best = d;
                        tile = t;
                    }
                }
            }
            if (tile == null) throw bad("no land to found a colony on");
        }
        if (!p.canClaimToFoundSettlement(tile)) {
            throw bad("a colony cannot be founded at " + tile.getX() + "," + tile.getY());
        }
        final UnitType type = this.game.getSpecification().getUnitType("model.unit.freeColonist");
        final ServerUnit founder = new ServerUnit(this.game, tile, p, type);
        founder.setMovesLeft(founder.getInitialMovesLeft());
        p.exploreForUnit(founder);
        final ChangeSet cs = this.igc.buildSettlement(p, founder, Player.ASSIGN_SETTLEMENT_NAME);
        cs.add(See.only(p), tile);
        this.sGame.sendTo(p, cs);
        this.focus = tile;
        return new Json().put("action", "addColony").put("colony", tile.getColony().getId()).toString();
    }

    /**
     * A building in the colony on the tile, as one that is free to build
     * (ServerColony.csFreeBuilding): the upgrade of one it has replaces it.
     */
    private String addBuilding(String typeId, Map<?, ?> r) {
        final ServerPlayer p = me();
        final BuildingType type = this.game.getSpecification().getBuildingType(typeId);
        if (type == null) throw bad("unknown building type \"" + typeId + "\"");
        final Colony colony = at(r).getColony();
        if (colony == null || colony.getOwner() != p) throw bad("no colony of yours there");
        if (!colony.canBuild(type)) throw bad("the colony cannot build " + typeId);
        final ChangeSet cs = new ChangeSet();
        ((net.sf.freecol.server.model.ServerColony)colony).csFreeBuilding(type, cs);
        cs.add(See.only(p), colony);
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addBuilding").toString();
    }

    /**
     * DebugUtils.setColonyGoods and addUnitGoods, which both set an amount
     * through a dialog: here the amount is added (a negative one takes
     * away, down to none), to the colony on the tile or to the unit with
     * the id.
     */
    private String addGoods(String typeId, int amount, Map<?, ?> r) {
        ServerPlayer p = me();
        GoodsType type = this.game.getSpecification().getGoodsType(typeId);
        if (type == null) throw bad("unknown goods type \"" + typeId + "\"");
        GoodsContainer gc;
        ChangeSet cs = new ChangeSet();
        if (r.get("unit") != null) {
            Unit unit = this.game.getFreeColGameObject(string(r, "unit"), Unit.class);
            if (unit == null) throw bad("no unit " + r.get("unit"));
            gc = unit.getGoodsContainer();
            cs.add(See.only(p), unit);
        } else {
            Colony colony = at(r).getColony();
            if (colony == null) throw bad("no colony there");
            gc = colony.getGoodsContainer();
            cs.add(See.only(p), colony);
        }
        gc.setAmount(type, Math.max(0, gc.getGoodsCount(type) + amount));
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addGoods").toString();
    }

    /**
     * What each AI player has and what its units are set to do, as
     * DebugUtils.displayMission shows one unit's mission.
     *
     * @return {"action": "aiView", "text": ...} with one block per AI player.
     */
    private String aiView() {
        List<String> lines = new ArrayList<>();
        for (Player p : this.game.getLiveEuropeanPlayerList()) {
            if (!p.isAI()) continue;
            lines.add(Messages.message(p.getNationLabel()) + ": " + p.getGold() + " gold, "
                + p.getSettlementCount() + " settlements, " + p.getUnitCount() + " units");
            for (Unit u : p.getUnitSet()) {
                AIUnit ai = this.aiMain.getAIUnit(u);
                Mission m = (ai == null) ? null : ai.getMission();
                String mission = (m == null) ? "no mission"
                    : (m instanceof TransportMission) ? ((TransportMission)m).toFullString()
                    : m.toString();
                lines.add("  " + u.getType().getId().replace("model.unit.", "") + " at "
                    + ((u.getTile() == null) ? "-" : u.getTile().getX() + "," + u.getTile().getY())
                    + ": " + mission);
            }
        }
        return new Json().put("action", "aiView").put("text", String.join("\n", lines)).toString();
    }
}
