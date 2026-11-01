package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.UnitLocation.NoAddReason;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.TradeRoute;
import net.sf.freecol.common.model.Unit;


/**
 * What the human player can do on their turn, as the Browser UI asks for
 * it: the input the Swing GUI's actions and mouse listener turn into
 * client controller calls. Each command blocks until the controller is
 * done, and returns false if it did nothing.
 */
public final class Commands {

    private final FreeColClient client;


    Commands(FreeColClient client) {
        this.client = client;
    }

    private InGameController igc() {
        return this.client.getInGameController();
    }

    private GUI gui() {
        return this.client.getGUI();
    }

    private Tile tile(int x, int y) {
        return this.client.getGame().getMap().getTile(x, y);
    }

    /**
     * Click a tile: on a native settlement, show its panel; on our colony,
     * open its panel, as SwingGUI.clickAt does. Elsewhere select our next
     * unit there, units aboard a carrier
     * included, so repeated clicks cycle through a stack. With none, send
     * the active unit there.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return True if a panel opened or a unit was selected or set off.
     */
    public boolean click(int x, int y) {
        final Tile tile = tile(x, y);
        if (tile == null) return false;
        // A native settlement opens its panel, as SwingGUI's click does.
        if (tile.isExplored() && tile.getSettlement() instanceof IndianSettlement) {
            gui().showIndianSettlementPanel((IndianSettlement)tile.getSettlement());
            return true;
        }
        final Player player = this.client.getMyPlayer();
        final Colony colony = tile.getColony();
        if (colony != null && player.owns(colony)) {
            gui().showColonyPanel(colony, null);
            return true;
        }
        final List<Unit> ours = new ArrayList<>();
        for (Unit u : tile.getUnitList()) {
            if (!player.owns(u)) continue;
            ours.add(u);
            for (Unit aboard : u.getUnitList()) ours.add(aboard);
        }
        if (ours.isEmpty()) return goTo(x, y);
        final int i = ours.indexOf(gui().getActiveUnit());
        gui().changeView(ours.get((i + 1) % ours.size()), false);
        return true;
    }

    /**
     * Move the active unit one step, as MoveAction does.
     *
     * @param direction A {@code Direction} name, e.g. "NE".
     * @return True if the unit moved or acted.
     */
    public boolean move(String direction) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        final Tile from = unit.getTile();
        final int moves = unit.getMovesLeft();
        igc().moveUnit(unit, Direction.valueOf(direction));
        return unit.isDisposed() || unit.getTile() != from
            || unit.getMovesLeft() != moves;
    }

    /**
     * Send the active unit to a tile along its best path, as a goto drag
     * in the Swing GUI does.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return True if the unit set off.
     */
    public boolean goTo(int x, int y) {
        final Unit unit = gui().getActiveUnit();
        final Tile tile = tile(x, y);
        if (unit == null || tile == null || unit.getTile() == tile) return false;
        final PathNode path = unit.findPath(tile);
        return path != null && igc().goToTile(unit, path);
    }

    /** Show the Europe panel (EuropeAction). */
    public boolean showEurope() {
        gui().showEuropePanel();
        return true;
    }

    /** Leave the active unit for now and select the next one (WaitAction). */
    public boolean nextUnit() {
        return igc().waitUnit();
    }

    /**
     * Declare independence (DeclareIndependenceAction): the controller
     * explains if it is not allowed yet, else asks for the new names and
     * shows the declaration, and the server hears of it when that closes.
     */
    public boolean declareIndependence() {
        return igc().declareIndependence();
    }

    /** Fortify the active unit (FortifyAction). */
    public boolean fortify() {
        return changeState(Unit.UnitState.FORTIFYING);
    }

    /** Sentry the active unit (SentryAction). */
    public boolean sentry() {
        return changeState(Unit.UnitState.SENTRY);
    }

    /**
     * Leave the active unit for this turn (SkipUnitAction): the unit is
     * done for now, and the next one is selected.
     */
    public boolean skip() {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        if (unit.getState() != Unit.UnitState.SKIPPED) {
            igc().changeState(unit, Unit.UnitState.SKIPPED);
        }
        if (unit.getState() == Unit.UnitState.SKIPPED) {
            return igc().nextActiveUnit();
        }
        return false;
    }

    /**
     * Disband the active unit (DisbandUnitAction), which asks the player
     * to confirm it first.
     */
    public boolean disband() {
        return igc().disbandUnit(gui().getActiveUnit());
    }

    /**
     * Send the active unit to a destination (GotoAction): the player is
     * asked where it goes, and the unit sails there.
     *
     * The order is named after the controller method it calls, as
     * {@code goto} is a Java keyword and {@code goTo} is already the
     * order that sends the unit to a tile of the map.
     *
     * @return True if the unit set off.
     */
    public boolean selectDestination() {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        return igc().selectDestination(unit);
    }

    /** Change the active unit's state, as FortifyAction and SentryAction do. */
    private boolean changeState(Unit.UnitState state) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        return igc().changeState(unit, state);
    }

    /** Plow the active unit's tile (the plow ImprovementAction). */
    public boolean plow() {
        return improve("model.improvement.plow");
    }

    /**
     * Clear the forest on the active unit's tile (the clearForest
     * ImprovementAction).
     */
    public boolean clearForest() {
        return improve("model.improvement.clearForest");
    }

    /** Build a road on the active unit's tile (the road ImprovementAction). */
    public boolean road() {
        return improve("model.improvement.road");
    }

    /** Work the active unit's tile, as ImprovementAction does. */
    private boolean improve(String id) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        final TileImprovementType type = this.client.getGame()
            .getSpecification().getTileImprovementType(id);
        if (type == null) return false;
        return igc().changeWorkImprovementType(unit, type);
    }

    /** Found a colony with the active unit (BuildColonyAction). */
    public boolean buildColony() {
        return igc().buildColony(gui().getActiveUnit());
    }

    /**
     * Put a colonist to work at a building or on a colony tile, as dropping
     * its label there in ColonyPanel does: the controller claims the tile
     * if needed, the unit takes the work the location suits it for best,
     * and a location that cannot take it is explained, as Swing explains it.
     *
     * @param unitId The id of one of our units, in the colony or beside it.
     * @param locationId The id of the building or colony tile.
     * @return True if the unit now works there.
     */
    public boolean work(String unitId, String locationId) {
        final Unit unit = object(unitId, Unit.class);
        final WorkLocation wl = object(locationId, WorkLocation.class);
        final Player player = this.client.getMyPlayer();
        if (unit == null || wl == null || !player.owns(unit)
            || wl.getColony() == null || !player.owns(wl.getColony())) return false;
        if (unit.getLocation() == wl) return false;
        final NoAddReason reason = wl.getNoAddReason(unit);
        if (reason != NoAddReason.NONE && reason != NoAddReason.CLAIM_REQUIRED) {
            gui().showInformationPanel(wl, StringTemplate.template(reason.getDescriptionKey()));
            return false;
        }
        final GoodsType workType = wl.getWorkFor(unit);
        igc().work(unit, wl);
        if (unit.getLocation() != wl) return false;
        // The server may have changed the unit's work, as it may upgrade it.
        if (workType != null && workType != unit.getWorkType()) {
            igc().changeWorkType(unit, workType);
        }
        return true;
    }

    /**
     * Put a colonist outside the colony, on its tile (the outside colony
     * panel, as ColonyPanel.OutsideColonyPanel.add does).
     *
     * @param unitId The id of one of our units working in a colony.
     * @return True if the unit is now on the colony's tile.
     */
    public boolean putOutsideColony(String unitId) {
        final Unit unit = object(unitId, Unit.class);
        if (unit == null || !this.client.getMyPlayer().owns(unit)
            || !(unit.getLocation() instanceof WorkLocation)) return false;
        return igc().putOutsideColony(unit);
    }

    /**
     * Change what a colonist produces where it works.
     *
     * @param unitId The id of one of our units working in a colony.
     * @param goodsTypeId The id of the goods type to produce.
     * @return True if the unit now produces it.
     */
    public boolean changeWorkType(String unitId, String goodsTypeId) {
        final Unit unit = object(unitId, Unit.class);
        final GoodsType type = this.client.getGame().getSpecification()
            .getGoodsType(goodsTypeId);
        if (unit == null || type == null || !this.client.getMyPlayer().owns(unit)
            || !(unit.getLocation() instanceof WorkLocation)) return false;
        return igc().changeWorkType(unit, type);
    }

    /** The game object with this id, if it is of the class. */
    private <T extends FreeColGameObject> T object(String id, Class<T> type) {
        return this.client.getGame().getFreeColGameObject(id, type);
    }

    /**
     * End the turn (EndTurnAction), asking first if units still wait for
     * orders and the client options say to.
     *
     * @return True if the turn was ours to end.
     */
    public boolean endTurn() {
        if (!this.client.currentPlayerIsMyPlayer()) return false;
        igc().endTurn(true);
        return true;
    }

    /** Open the trade routes panel (TradeRouteAction). */
    public boolean tradeRoutes() {
        gui().showTradeRoutePanel(null);
        return true;
    }

    private TradeRoute route(String id) {
        final Player player = this.client.getMyPlayer();
        for (TradeRoute tr : player.getTradeRoutes()) {
            if (tr.getId().equals(id)) return tr;
        }
        return null;
    }

    /**
     * Create a trade route, or change one, as TradeRoutePanel and
     * TradeRouteInputPanel do. The server is asked for a new route, which
     * is then given its name and stops and checked as FreeCol checks it. A
     * route that is not valid is not saved, and the reason is shown in the
     * trade routes panel, which is shown again.
     *
     * @param id The id of the route to change, or null for a new one.
     * @param name The route's name.
     * @param silent Whether it is to be silent.
     * @param places The ids of the places (Europe or a colony) of its stops.
     * @param cargo For each stop, the ids of the goods types to load there.
     * @return The reason the route was not saved, or null if it was.
     */
    public String saveTradeRoute(String id, String name, boolean silent,
                                 List<String> places,
                                 List<List<String>> cargo) {
        final TradeRoute existing = (id == null) ? null : route(id);
        if (id != null && existing == null) return refused("No such trade route.");
        final TradeRoute route = (existing != null) ? existing
            : igc().newTradeRoute(this.client.getMyPlayer());
        if (route == null) return refused("The server did not make a trade route.");
        final String why = TradeRoutes.edit(this.client, route, name, silent,
                                            places, cargo);
        // A new route that is not valid is dropped, as TradeRoutePanel drops it.
        if (why != null && existing == null) igc().deleteTradeRoute(route);
        return refused(why);
    }

    /**
     * Delete a trade route: the units that follow it stop, as
     * TradeRoutePanel's delete button does first.
     *
     * @param id The id of the route.
     * @return True if the route is gone.
     */
    public boolean deleteTradeRoute(String id) {
        final TradeRoute route = route(id);
        if (route == null) return false;
        for (Unit u : TradeRoutes.assigned(route)) igc().assignTradeRoute(u, null);
        final boolean done = igc().deleteTradeRoute(route);
        refused(null);
        return done;
    }

    /** Show the trade routes panel again with the reason a change was refused, if any; pass the reason on. */
    private String refused(String why) {
        if (gui() instanceof WebGUI) ((WebGUI)gui()).showTradeRoutes(why);
        return why;
    }
}
