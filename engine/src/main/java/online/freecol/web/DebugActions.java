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
 * { "action": "changeOwner", "unit": "unit:123", "owner": "model.nation.french" }
 * { "action": "changeOwner", "x": 3, "y": 4, "owner": "model.nation.french" }
 * { "action": "changeRole", "unit": "unit:123", "role": "model.role.soldier" }
 * { "action": "displayMission", "unit": "unit:123" }
 * { "action": "colonyPlan", "x": 3, "y": 4 }
 * { "action": "applyDisaster", "x": 3, "y": 4, "disaster": "model.disaster.fire" }
 * { "action": "examineSettlement", "x": 3, "y": 4 }
 * { "action": "rumourType", "x": 3, "y": 4, "rumour": "LEARN" }
 * { "action": "idealColony", "x": 3, "y": 4 }
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
 * A request that needs a choice (the new owner, a role, a disaster, a
 * rumour, a unit type) and has none answers {"action": "choose", "for": the
 * action, "key": "owner", "prompt": ..., "choices": [{"id": ..., "label": ...}]},
 * as the Swing dialogs ask; the Browser UI asks the player and sends the
 * request again with the key set to the id they chose.
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
        case "addUnit":
            if (r.get("type") == null) return chooseUnitType(r);
            return addUnit(string(r, "type"), at(r), Boolean.TRUE.equals(r.get("inColony")), r);
        case "addGoods": return addGoods(string(r, "type"), integer(r, "amount"), r);
        case "aiView": return aiView();
        case "addImmigration": return addImmigration(integer(r, "amount"));
        case "addLiberty": return addLiberty(integer(r, "amount"));
        case "addFoundingFather": return addFoundingFather(string(r, "father"));
        case "traceWork": return traceWork(r);
        case "resetMoves": return resetMoves(at(r));
        case "dumpTile": return dumpTile(at(r));
        case "changeOwner": return changeOwner(r);
        case "changeRole": return changeRole(r);
        case "displayMission": return displayMission(r);
        case "colonyPlan": return colonyPlan(at(r));
        case "applyDisaster": return applyDisaster(at(r), r);
        case "examineSettlement": return examineSettlement(at(r));
        case "rumourType": return rumourType(at(r), r);
        case "idealColony": return idealColony(at(r));
        case "declareIndependence": return declareIndependence(r);
        case "clearREF": return clearREF();
        default:
            throw bad("unknown action \"" + action + "\" (known: revealMap, addGold,"
                + " addColony, addBuilding, addUnit, addGoods, aiView, addImmigration,"
                + " addLiberty, addFoundingFather, traceWork, resetMoves, dumpTile,"
                + " changeOwner, changeRole, displayMission, colonyPlan, applyDisaster,"
                + " examineSettlement, rumourType, idealColony, declareIndependence, clearREF)");
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

    /** The answer that asks for a choice (see the class comment). */
    private static String choose(String action, String key, String prompt, List<String[]> choices) {
        final List<String> items = new ArrayList<>();
        for (String[] c : choices) items.add(new Json().put("id", c[0]).put("label", c[1]).toString());
        return new Json().put("action", "choose").put("for", action).put("key", key)
            .put("prompt", prompt).putRaw("choices", Json.array(items)).toString();
    }

    /** DebugUtils.addNewUnitToTile's choice of unit type. */
    private String chooseUnitType(Map<?, ?> r) {
        final List<String[]> choices = new ArrayList<>();
        for (UnitType t : this.game.getSpecification().getUnitTypeList()) {
            choices.add(new String[] { t.getId(), Messages.getName(t) });
        }
        return choose("addUnit", "type", "Unit type", choices);
    }

    private Unit unitOf(Map<?, ?> r) {
        final String id = string(r, "unit");
        final Unit u = this.game.getFreeColGameObject(id, Unit.class);
        if (u == null || u.isDisposed()) throw bad("no unit " + id);
        return u;
    }

    /**
     * DebugUtils.changeOwnership: a unit (named by "unit") or the colony on
     * the tile goes to another player, who is "owner".
     */
    private String changeOwner(Map<?, ?> r) {
        final boolean isUnit = r.get("unit") != null;
        final Unit unit = isUnit ? unitOf(r) : null;
        final Colony colony = isUnit ? null : at(r).getColony();
        if (!isUnit && colony == null) throw bad("no colony there");
        if (r.get("owner") == null) {
            final List<String[]> choices = new ArrayList<>();
            final List<Player> players = isUnit
                ? this.game.getLivePlayerList().stream()
                    .filter(p -> unit.getType().isAvailableTo(p)).toList()
                : this.game.getLiveEuropeanPlayerList(colony.getOwner());
            for (Player p : players) choices.add(new String[] { p.getId(), Messages.message(p.getCountryLabel()) });
            return choose("changeOwner", "owner", "Select owner", choices);
        }
        final ServerPlayer to = this.game.getFreeColGameObject(string(r, "owner"), ServerPlayer.class);
        if (to == null) throw bad("no player " + r.get("owner"));
        if (isUnit) {
            if (unit.getOwner() == to) throw bad("the unit is already theirs");
            this.igc.debugChangeOwner((ServerUnit)unit, to);
        } else {
            this.igc.debugChangeOwner((net.sf.freecol.server.model.ServerColony)colony, to);
        }
        return new Json().put("action", "changeOwner").toString();
    }

    /** DebugUtils.changeRole: the unit takes the role, with as much equipment as the role holds. */
    private String changeRole(Map<?, ?> r) {
        final Unit unit = unitOf(r);
        if (!unit.isPerson()) throw bad("only a person has a role");
        if (r.get("role") == null) {
            final List<String[]> choices = new ArrayList<>();
            for (Role role : this.game.getSpecification().getRoles().toList()) {
                choices.add(new String[] { role.getId(), role.getId() });
            }
            return choose("changeRole", "role", "Select role", choices);
        }
        final Role role = this.game.getSpecification().getRole(string(r, "role"));
        if (role == null) throw bad("unknown role \"" + r.get("role") + "\"");
        unit.changeRole(role, role.getMaximumCount());
        final ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps().always((ServerPlayer)unit.getOwner()), unit);
        if (unit.getTile() != null) cs.add(See.perhaps(), unit.getTile());
        this.sGame.sendTo(me(), cs);
        return new Json().put("action", "changeRole").toString();
    }

    /** DebugUtils.displayMission: what the carrier's AI plans, as text. */
    private String displayMission(Map<?, ?> r) {
        final Unit unit = unitOf(r);
        final AIUnit ai = this.aiMain.getAIUnit(unit);
        if (ai == null) throw bad("no AI unit " + unit.getId());
        final Mission m = ai.getMission();
        final String text = (m == null) ? Messages.message("none")
            : (m instanceof TransportMission) ? ((TransportMission)m).toFullString() : m.toString();
        return new Json().put("action", "displayMission").put("text", text).toString();
    }

    /** DebugUtils.displayColonyPlan: the AI's plan for the colony on the tile, as text. */
    private String colonyPlan(Tile tile) {
        final Colony colony = tile.getColony();
        if (colony == null) throw bad("no colony there");
        final net.sf.freecol.server.ai.AIColony ai = this.aiMain.getAIColony(colony);
        if (ai == null) throw bad(colony.getName() + " is not an AI colony");
        return new Json().put("action", "colonyPlan").put("text", ai.planToString()).toString();
    }

    /** DebugUtils.applyDisaster: a disaster strikes the colony on the tile. */
    private String applyDisaster(Tile tile, Map<?, ?> r) {
        final Colony colony = tile.getColony();
        if (colony == null) throw bad("no colony there");
        if (r.get("disaster") == null) {
            final List<String[]> choices = new ArrayList<>();
            for (net.sf.freecol.common.util.RandomChoice<net.sf.freecol.common.model.Disaster> rc
                     : colony.getDisasterChoices().toList()) {
                choices.add(new String[] { rc.getObject().getId(),
                    Messages.getName(rc.getObject()) + " " + rc.getProbability() });
            }
            if (choices.isEmpty()) throw bad("no disaster can strike " + colony.getName());
            return choose("applyDisaster", "disaster", "Select disaster", choices);
        }
        final net.sf.freecol.common.model.Disaster disaster
            = this.game.getSpecification().getDisaster(string(r, "disaster"));
        if (disaster == null) throw bad("unknown disaster \"" + r.get("disaster") + "\"");
        final int messages = this.igc.debugApplyDisaster((net.sf.freecol.server.model.ServerColony)colony, disaster);
        return new Json().put("action", "applyDisaster").put("messages", messages)
            .put("avoided", messages <= 0).toString();
    }

    /** DebugUtils.summarizeSettlement: what the server knows of the native settlement on the tile, as text. */
    private String examineSettlement(Tile tile) {
        final net.sf.freecol.common.model.IndianSettlement is = tile.getIndianSettlement();
        if (is == null) throw bad("no native settlement there");
        final net.sf.freecol.common.util.LogBuilder lb = new net.sf.freecol.common.util.LogBuilder(256);
        lb.add(is.getName(), "\n\nAlarm\n");
        final Player mostHated = is.getMostHated();
        for (Player p : this.game.getLiveEuropeanPlayerList()) {
            final net.sf.freecol.common.model.Tension tension = is.getAlarm(p);
            lb.add(Messages.message(p.getNationLabel()), " ",
                (tension == null) ? "(none)" : Integer.toString(tension.getValue()),
                (mostHated == p) ? " (most hated)" : "",
                " ", Messages.message(is.getAlarmLevelKey(p)), " ", is.getContactLevel(p), "\n");
        }
        lb.add("\nGoods\n");
        for (GoodsType gt : this.game.getSpecification().getGoodsTypeList()) {
            final int amount = is.getGoodsCount(gt);
            final int prod = is.getTotalProductionOf(gt);
            if (amount > 0 || prod != 0) {
                lb.add(Messages.message(new net.sf.freecol.common.model.AbstractGoods(gt, amount).getLabel()),
                    " ", (prod > 0) ? "+" : "", prod, "\n");
            }
        }
        lb.add("\nPotential sales\n");
        for (net.sf.freecol.common.model.Goods g : is.getSellGoods(null)) {
            lb.add(Messages.getName(g.getType()), " ", g.getAmount(),
                " = ", is.getPriceToSell(g.getType(), g.getAmount()), "\n");
        }
        lb.add("\nPrices (buy 1/100 / sell 1/100)\n");
        final List<GoodsType> wanted = is.getWantedGoods();
        for (GoodsType type : this.game.getSpecification().getStorableGoodsTypeList()) {
            final int idx = wanted.indexOf(type);
            lb.add(Messages.getName(type), ": ", is.getPriceToBuy(type, 1), "/", is.getPriceToBuy(type, 100),
                " / ", is.getPriceToSell(type, 1), "/", is.getPriceToSell(type, 100),
                (idx < 0) ? "" : " wanted[" + idx + "]", "\n");
        }
        lb.add("\nUnits present\n");
        for (Unit u : is.getUnitList()) unitLine(lb, u);
        lb.add("\nUnits owned\n");
        for (Unit u : is.getOwnedUnitList()) unitLine(lb, u);
        lb.add("\nTiles\n");
        for (Tile t : is.getOwnedTiles()) lb.add(t, "\n");
        lb.add("\nConvert Progress = ", is.getConvertProgress());
        lb.add("\nLast Tribute = ", is.getLastTribute());
        return new Json().put("action", "examineSettlement").put("text", lb.toString()).toString();
    }

    private void unitLine(net.sf.freecol.common.util.LogBuilder lb, Unit u) {
        final AIUnit ai = this.aiMain.getAIUnit(u);
        final Mission m = (ai == null) ? null : ai.getMission();
        lb.add(u, " at ", u.getLocation());
        if (m != null) lb.add(" ", m.getClass(), ".");
        lb.add("\n");
    }

    /** DebugUtils.setRumourType: the lost city rumour on the tile is of another kind. */
    private String rumourType(Tile tile, Map<?, ?> r) {
        final net.sf.freecol.common.model.LostCityRumour lcr
            = (tile.getTileItemContainer() == null) ? null : tile.getTileItemContainer().getLostCityRumour();
        if (lcr == null) throw bad("no lost city rumour there");
        if (r.get("rumour") == null) {
            final List<String[]> choices = new ArrayList<>();
            for (net.sf.freecol.common.model.LostCityRumour.RumourType t
                     : net.sf.freecol.common.model.LostCityRumour.RumourType.values()) {
                if (t != net.sf.freecol.common.model.LostCityRumour.RumourType.NO_SUCH_RUMOUR) {
                    choices.add(new String[] { t.name(), t.toString() });
                }
            }
            return choose("rumourType", "rumour", "Lost City Rumour type", choices);
        }
        final net.sf.freecol.common.model.LostCityRumour.RumourType type;
        try {
            type = net.sf.freecol.common.model.LostCityRumour.RumourType.valueOf(string(r, "rumour"));
        } catch (IllegalArgumentException ex) {
            throw bad("unknown rumour \"" + r.get("rumour") + "\"");
        }
        lcr.setType(type);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.perhaps(), tile);
        this.sGame.sendTo(me(), cs);
        return new Json().put("action", "rumourType").toString();
    }

    /**
     * DebugUtils.createColonyFromAiColonyPlan: a colony of the human's on
     * the tile as the AI's colony planner would lay it out, with its
     * buildings, workers and tile improvements already there.
     */
    private String idealColony(Tile tile) {
        final ServerPlayer p = me();
        if (tile.hasSettlement()) throw bad("there is a settlement there already");
        final net.sf.freecol.server.ai.colony.ColonyPlan plan
            = new net.sf.freecol.server.ai.colony.StandardColonyPlanner().createPlan(tile);
        for (net.sf.freecol.server.ai.colony.TileImprovementPlan tip : plan.getTileImprovements()) {
            final Tile target = tip.getTarget();
            final net.sf.freecol.common.model.TileImprovement ti
                = new net.sf.freecol.common.model.TileImprovement(this.sGame, target, tip.getType(), null);
            ti.setTurnsToComplete(0);
            target.add(ti);
            final net.sf.freecol.common.model.TileType changeType = ti.getChange(target.getType());
            if (changeType != null) target.changeType(changeType);
        }
        final net.sf.freecol.server.model.ServerColony colony
            = new net.sf.freecol.server.model.ServerColony(this.sGame, p, "Debug", tile);
        tile.setSettlement(colony);
        for (net.sf.freecol.common.model.BuildableType bt : plan.getBuildables()) {
            if (!(bt instanceof BuildingType)) continue;
            colony.addBuilding(new net.sf.freecol.server.model.ServerBuilding(this.sGame, colony, (BuildingType)bt));
        }
        colony.addLiberty(10000);
        final ChangeSet cs = new ChangeSet();
        for (net.sf.freecol.server.ai.colony.WorkerPlan wp : plan.getWorkers()) {
            final net.sf.freecol.server.ai.colony.PlannedWorkLocation pwl = wp.getPlannedWorkLocation();
            final net.sf.freecol.common.model.Location where;
            if (pwl.getBuildingType() != null) {
                where = colony.getBuilding(pwl.getBuildingType());
            } else {
                p.csClaimLand(pwl.getTile(), colony, 0, cs);
                where = colony.getColonyTile(pwl.getTile());
            }
            final ServerUnit worker = new ServerUnit(this.sGame, tile, p, wp.getUnitType());
            worker.setRole(this.game.getSpecification().getDefaultRole());
            worker.setLocation(where);
            if (!wp.getProductionTypes().isEmpty()) worker.changeWorkType(wp.getProductionTypes().get(0));
        }
        p.addSettlement(colony);
        colony.placeSettlement(true);
        p.invalidateCanSeeTiles();
        cs.add(See.only(p), colony.getVisibleTileSet());
        cs.add(See.perhaps(), colony.getOwnedTiles());
        this.sGame.sendToAll(cs);
        this.focus = tile;
        return new Json().put("action", "idealColony").put("colony", colony.getId()).toString();
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
