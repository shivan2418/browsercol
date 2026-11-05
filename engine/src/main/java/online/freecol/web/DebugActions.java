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
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.StringTemplate;
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
 * { "action": "addImmigration", "amount": 100 }
 * { "action": "addLiberty", "amount": 100 }
 * { "action": "addFoundingFather", "father": "model.foundingFather.thomasJefferson" }
 * { "action": "traceWork", "x": 3, "y": 4 }
 * { "action": "resetMoves", "x": 3, "y": 4 }
 * { "action": "dumpTile", "x": 3, "y": 4 }
 * { "action": "declareIndependence", "nation": "Free Dutch", "country": "New Holland" }
 * { "action": "clearREF" }
 * { "action": "addUnit", "type": "model.unit.kingsRegular", "role": "model.role.infantry",
 *   "owner": "ref", "dx": 2, "dy": 0 }
 * { "action": "addUnit", "type": "model.unit.artillery", "around": true }
 * </pre>
 *
 * A tile is named by "x" and "y", or by "dx" and "dy" from where the last
 * colony or request was, or else is that tile. A unit is the human's, or,
 * with "owner": "ref", their Royal Expeditionary Force's once they have
 * declared; "role" equips it; "around" puts one on each land tile next to
 * the tile that has no settlement and no other player's unit, instead of
 * on the tile.
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
        case "addImmigration": return addImmigration(integer(r, "amount"));
        case "addLiberty": return addLiberty(integer(r, "amount"));
        case "addFoundingFather": return addFoundingFather(string(r, "father"));
        case "traceWork": return traceWork(r);
        case "resetMoves": return resetMoves(at(r));
        case "dumpTile": return dumpTile(at(r));
        case "declareIndependence": return declareIndependence(r);
        case "clearREF": return clearREF();
        default:
            throw bad("unknown action \"" + action + "\" (known: revealMap, addGold,"
                + " addColony, addBuilding, addUnit, addGoods, aiView, addImmigration,"
                + " addLiberty, addFoundingFather, traceWork, resetMoves, dumpTile,"
                + " declareIndependence, clearREF)");
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
        } else if (r.get("dx") != null || r.get("dy") != null) {
            if (this.focus == null) throw bad("\"dx\" and \"dy\" count from a colony or tile named before");
            this.focus = tile(this.focus.getX() + ((r.get("dx") == null) ? 0 : integer(r, "dx")),
                              this.focus.getY() + ((r.get("dy") == null) ? 0 : integer(r, "dy")));
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
        final ServerPlayer p = owner(r);
        final UnitType type = this.game.getSpecification().getUnitType(typeId);
        if (type == null) throw bad("unknown unit type \"" + typeId + "\"");
        final Role role = (r.get("role") == null) ? type.getDefaultRole()
            : this.game.getSpecification().getRole(string(r, "role"));
        if (role == null) throw bad("unknown role \"" + r.get("role") + "\"");
        if (!Boolean.TRUE.equals(r.get("around"))) {
            final Unit unit = addUnit(p, type, role, tile, inColony, r);
            return new Json().put("action", "addUnit").put("unit", unit.getId()).toString();
        }
        final List<String> ids = new ArrayList<>();
        for (Tile t : tile.getSurroundingTiles(1, 1)) {
            if (!t.isLand() || t.hasSettlement()
                || t.getUnitList().stream().anyMatch(u -> u.getOwner() != p)) continue;
            ids.add(addUnit(p, type, role, t, false, r).getId());
        }
        if (ids.isEmpty()) throw bad("no free land next to " + tile.getX() + "," + tile.getY());
        // What stands in the middle, now in sight.
        final ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps(), tile);
        this.sGame.sendTo(me(), cs);
        return new Json().put("action", "addUnit").putRaw("units",
            "[" + String.join(",", ids.stream().map(Json::quote).toList()) + "]").toString();
    }

    /** The human, or with "owner": "ref" their REF once they have declared. */
    private ServerPlayer owner(Map<?, ?> r) {
        if (r.get("owner") == null) return me();
        if (!"ref".equals(r.get("owner"))) throw bad("\"owner\" is \"ref\" or left out");
        final ServerPlayer ref = (ServerPlayer)me().getREFPlayer();
        if (!me().isRebel() || ref == null) throw bad("the REF comes once the human has declared independence");
        return ref;
    }

    private Unit addUnit(ServerPlayer p, UnitType type, Role role, Tile tile, boolean inColony, Map<?, ?> r) {
        // A land unit at sea goes aboard a ship with room for it.
        Unit carrier = (tile.isLand() || type.isNaval()) ? null
            : tile.getUnitList().stream()
                .filter(u -> u.isNaval() && u.getOwner() == p
                    && u.getSpaceLeft() >= type.getSpaceTaken())
                .findFirst().orElse(null);
        if (!tile.isLand() && !type.isNaval() && carrier == null) {
            throw bad("a land unit cannot be put at sea without a ship of its owner's with room");
        }
        // With inColony, a unit of a colony of ours joins it, to work, as a colonist who lives there.
        final Colony colony = tile.getColony();
        if (inColony && (colony == null || colony.getOwner() != p)) {
            throw bad("no colony of yours there to join");
        }
        ServerUnit unit = new ServerUnit(this.game, (carrier != null) ? carrier
            : inColony ? colony : tile, p, type, role);
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
        this.sGame.sendTo(me(), cs);
        return unit;
    }

    /**
     * The human declares independence as the server has them declare
     * (InGameController.declareIndependence), whatever their rebels: the
     * nation and country names default to the declaration dialog's.
     */
    private String declareIndependence(Map<?, ?> r) {
        final ServerPlayer p = me();
        if (p.getPlayerType() != Player.PlayerType.COLONIAL) throw bad("the human is not a colony");
        final String nation = (r.get("nation") != null) ? string(r, "nation")
            : Messages.message(StringTemplate.template("confirmDeclarationDialog.defaultNation")
                .addStringTemplate("%nation%", p.getNationLabel()));
        final String country = (r.get("country") != null) ? string(r, "country")
            : Messages.message(StringTemplate.template("confirmDeclarationDialog.defaultCountry")
                .addStringTemplate("%nation%", p.getNationLabel()));
        this.sGame.sendTo(p, this.igc.declareIndependence(p, nation, country));
        return new Json().put("action", "declareIndependence")
            .put("ref", p.getREFPlayer().getId()).toString();
    }

    /**
     * Every unit of the human's REF goes, wherever it is (in its Europe,
     * aboard, on the map), so a scenario can give it only the units it names.
     */
    private String clearREF() {
        final ServerPlayer ref = owner(Map.of("owner", "ref"));
        final ChangeSet cs = new ChangeSet();
        for (Unit u : new ArrayList<>(ref.getUnitSet())) {
            if (u.isDisposed()) continue;
            final Tile tile = u.getTile();
            ((ServerUnit)u).csRemove(See.perhaps(), tile, cs);
            if (tile != null) cs.add(See.perhaps(), tile);
        }
        ref.invalidateCanSeeTiles();
        this.sGame.sendTo(me(), cs);
        return new Json().put("action", "clearREF").toString();
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
        // The founder did not walk here, so what the server thinks the
        // player sees is stale, and founding cached copies (without units)
        // of tiles round the colony for the player, as if unseen. With fog
        // of war off nothing refreshes them: the player's view of each tile
        // it can see is the tile itself again.
        p.invalidateCanSeeTiles();
        for (Tile t : tile.getColony().getVisibleTileSet()) {
            if (p.canSee(t)) t.seeTile(p);
        }
        // A first landing names the new land (ServerUnit.csMove); a colony
        // founded here may come first, and the Crown's messages name it.
        if (!p.isNewLandNamed()) p.setNewLandName(p.getNameForNewLand());
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

    /** DebugUtils.addImmigration: crosses for the human player (a negative amount takes them away). */
    private String addImmigration(int amount) {
        final ServerPlayer p = me();
        p.modifyImmigration(amount);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(p), p);
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addImmigration").toString();
    }

    /** DebugUtils.addLiberty: bells for each of the human player's colonies. */
    private String addLiberty(int amount) {
        final ServerPlayer p = me();
        final ChangeSet cs = new ChangeSet();
        for (Colony c : p.getColonyList()) {
            c.addLiberty(amount);
            cs.add(See.only(p), c);
        }
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "addLiberty").toString();
    }

    /** DebugUtils.addFathers: the human player gains a founding father they do not have. */
    private String addFoundingFather(String fatherId) {
        final ServerPlayer p = me();
        final net.sf.freecol.common.model.FoundingFather father =
            this.game.getSpecification().getFoundingFather(fatherId);
        if (father == null) throw bad("unknown founding father \"" + fatherId + "\"");
        if (p.hasFather(father)) throw bad("the human already has " + fatherId);
        this.igc.addFoundingFather(p, father);
        return new Json().put("action", "addFoundingFather").toString();
    }

    /**
     * ColonyPanel's "Trace work" button: turn the colony's occupation-decision
     * logging on, or off if it is on. The answer names the colony and the
     * state, for the client's copy of it ({@link ClientEngine#debugApplied}).
     */
    private String traceWork(Map<?, ?> r) {
        final Colony colony = (r.get("colony") != null)
            ? this.game.getFreeColGameObject(string(r, "colony"), Colony.class)
            : at(r).getColony();
        if (colony == null || colony.getOwner() != me()) throw bad("no colony of yours there");
        final boolean on = !colony.getOccupationTrace();
        colony.setOccupationTrace(on);
        return new Json().put("action", "traceWork").put("colony", colony.getId())
            .put("trace", on).toString();
    }

    /** The debug tile popup's "reset moves": every unit of the human's on the tile has its moves back. */
    private String resetMoves(Tile tile) {
        final ServerPlayer p = me();
        int n = 0;
        for (Unit u : tile.getUnitList()) {
            if (u.getOwner() != p) continue;
            u.setMovesLeft(u.getInitialMovesLeft());
            n++;
        }
        if (n == 0) throw bad("no unit of yours at " + tile.getX() + "," + tile.getY());
        final ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps(), tile);
        this.sGame.sendTo(p, cs);
        return new Json().put("action", "resetMoves").put("units", n).toString();
    }

    /** The debug tile popup's "dump tile": what the tile holds, as text. */
    private String dumpTile(Tile tile) {
        final List<String> lines = new ArrayList<>();
        lines.add(tile.getId() + " at " + tile.getX() + "," + tile.getY() + ": " + tile.getType().getId());
        lines.add("owner: " + ((tile.getOwner() == null) ? "none" : tile.getOwner().getId()));
        if (tile.hasSettlement()) lines.add("settlement: " + tile.getSettlement().getId());
        for (Unit u : tile.getUnitList()) {
            lines.add("unit " + u.getId() + " " + u.getType().getId() + " owner "
                + u.getOwner().getId() + " moves " + u.getMovesLeft());
        }
        return new Json().put("action", "dumpTile").put("text", String.join("\n", lines)).toString();
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
