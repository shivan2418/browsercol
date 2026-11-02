package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsContainer;
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

    /** Show the game options, read-only (ShowGameOptionsAction). */
    public boolean showGameOptions() {
        gui().showGameOptionsDialog(false, null);
        return true;
    }

    /** Show the game's difficulty level, read-only (ShowDifficultyAction). */
    public boolean showDifficulty() {
        gui().showDifficultyDialog();
        return true;
    }

    /**
     * Recruit the unit at an index of Europe's docks (RecruitPanel). The
     * Europe panel is sent again.
     *
     * @param index The index in the recruit pool, [0..RECRUIT_COUNT).
     * @return True if a unit was recruited.
     */
    public boolean recruitUnit(int index) {
        final boolean done = igc().recruitUnitInEurope(index);
        gui().showEuropePanel();
        return done;
    }

    /**
     * Train or buy a unit of a type in Europe (TrainPanel, PurchasePanel:
     * both are the controller's trainUnitInEurope). The Europe panel is
     * sent again.
     *
     * @param unitTypeId The id of the unit type.
     * @return True if the unit was bought.
     */
    public boolean trainUnit(String unitTypeId) {
        final boolean done = igc().trainUnitInEurope(
            this.client.getGame().getSpecification().getUnitType(unitTypeId));
        gui().showEuropePanel();
        return done;
    }

    /**
     * Put a unit aboard a ship beside it: on Europe's docks (a drop on the
     * Europe panel's cargo) or in a colony with the ship in port (a drop
     * on the colony panel's cargo, UnitLabel.addCargo). In Europe the
     * Europe panel is sent again.
     *
     * @param unitId The id of the unit.
     * @param shipId The id of the ship.
     * @return True if the unit boarded.
     */
    public boolean boardShip(String unitId, String shipId) {
        final Player player = this.client.getMyPlayer();
        final Unit unit = player.getOurFreeColGameObject(unitId, Unit.class);
        final Unit ship = player.getOurFreeColGameObject(shipId, Unit.class);
        final boolean done = unit != null && ship != null && ship.canAdd(unit)
            && igc().boardShip(unit, ship);
        if (ship != null && ship.isInEurope()) gui().showEuropePanel();
        return done;
    }

    /**
     * Take a unit off a ship in a colony's port, onto the colony's tile
     * (dragging it out of the colony panel's cargo, UnitLabel.removeCargo).
     *
     * @param unitId The id of one of our units aboard a ship in a colony.
     * @return True if the unit left the ship.
     */
    public boolean leaveShip(String unitId) {
        final Unit unit = this.client.getMyPlayer()
            .getOurFreeColGameObject(unitId, Unit.class);
        if (unit == null || !unit.isOnCarrier()
            || unit.getCarrier().getColony() == null) return false;
        return igc().leaveShip(unit);
    }

    /**
     * Load goods of a type from a colony's warehouse onto a ship in its
     * port, as dropping the warehouse's goods on the colony panel's cargo
     * does (DefaultTransferHandler.importGoods, GoodsLabel.addCargo): a
     * plain drop takes up to a hold's worth (100); asked, the player
     * chooses up to all the warehouse has, through the select amount
     * dialog, starting from what the ship can take. Either way the ship
     * takes no more than it has room for.
     *
     * @param shipId The id of one of our ships in a colony.
     * @param goodsTypeId The id of the goods type.
     * @param ask Whether to ask the amount (FreeCol's shift-drag).
     * @return True if goods were loaded.
     */
    public boolean loadGoods(String shipId, String goodsTypeId, boolean ask) {
        final Unit ship = shipInPort(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        final Colony colony = ship.getColony();
        final int stored = colony.getGoodsCount(type);
        if (stored <= 0) return false;
        int amount = Math.min(stored, GoodsContainer.CARGO_SIZE);
        if (ask) {
            int suggested = stored;
            final int capacity = colony.getWarehouseCapacity();
            // Over capacity, favour the amount that would correct it.
            if (stored > capacity) {
                suggested = Math.min(GoodsContainer.CARGO_SIZE, stored - capacity);
            }
            final int loadable = ship.getLoadableAmount(type);
            if (loadable >= 0 && loadable < suggested) suggested = loadable;
            if (suggested <= 0) return false;
            amount = gui().showSelectAmountDialog(type, stored, suggested, false);
        }
        amount = Math.min(amount, ship.getLoadableAmount(type));
        if (amount <= 0) return false;
        return igc().loadCargo(new Goods(this.client.getGame(), colony, type, amount), ship);
    }

    /**
     * Unload goods from a ship in a colony's port into the warehouse, as
     * dragging a stack of the colony panel's cargo out does (a GoodsLabel
     * per stack of up to 100): the whole stack, or, asked, as much of it
     * as the player chooses through the select amount dialog, starting from
     * what the warehouse has room for (WarehousePanel.suggested). With no
     * room left, nothing is asked or unloaded, as in Swing.
     *
     * @param shipId The id of one of our ships in a colony.
     * @param goodsTypeId The id of the goods type.
     * @param stack The amount of the stack dragged.
     * @param ask Whether to ask the amount (FreeCol's shift-drag).
     * @return True if goods were unloaded.
     */
    public boolean unloadGoods(String shipId, String goodsTypeId, int stack,
                               boolean ask) {
        final Unit ship = shipInPort(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        int amount = Math.min(stack, ship.getGoodsCount(type));
        if (amount <= 0) return false;
        if (ask) {
            final Colony colony = ship.getColony();
            final int room = colony.getWarehouseCapacity() - colony.getGoodsCount(type);
            final int suggested = (room >= 0 && room < amount) ? room : amount;
            if (suggested <= 0) return false;
            amount = gui().showSelectAmountDialog(type, amount, suggested, false);
        }
        if (amount <= 0) return false;
        return igc().unloadCargo(new Goods(this.client.getGame(), ship, type, amount), false);
    }

    /** One of our carriers in one of our colonies, by id, else null. */
    private Unit shipInPort(String shipId) {
        final Unit ship = this.client.getMyPlayer()
            .getOurFreeColGameObject(shipId, Unit.class);
        return (ship == null || !ship.isCarrier() || ship.getColony() == null) ? null : ship;
    }

    /** The goods type with this id, else null. */
    private GoodsType goodsType(String id) {
        return this.client.getGame().getSpecification().getGoodsType(id);
    }

    /**
     * Send a ship in Europe to the New World (EuropePanel's sail button, a
     * drop on the sailing to America list). A trade route it follows is
     * cleared first, after asking. The Europe panel is sent again.
     *
     * @param shipId The id of the ship.
     * @return True if the ship set sail.
     */
    public boolean sailToNewWorld(String shipId) {
        final Player player = this.client.getMyPlayer();
        final Unit ship = player.getOurFreeColGameObject(shipId, Unit.class);
        boolean done = false;
        if (ship != null && ship.isInEurope() && ship.isNaval()
            && !ship.isDamagedAndUnderForcedRepair()
            && (ship.getTradeRoute() == null
                || (gui().confirmClearTradeRoute(ship)
                    && igc().assignTradeRoute(ship, null)))) {
            igc().moveTo(ship, this.client.getGame().getMap());
            done = !ship.isInEurope();
        }
        gui().showEuropePanel();
        return done;
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

    /**
     * Set a colony's build queue, as the build queue panel's OK does. A
     * queue with something the colony cannot build there is explained and
     * not set.
     *
     * @param colonyId The id of one of our colonies.
     * @param typeIds The ids of the buildings and units to build, in order.
     * @return True if the colony's build queue is now this.
     */
    public boolean setBuildQueue(String colonyId, List<String> typeIds) {
        final Colony colony = object(colonyId, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        final List<BuildableType> queue = new ArrayList<>();
        for (String id : typeIds) {
            final Object type = this.client.getGame().getSpecification().getType(id);
            if (!(type instanceof BuildableType)) return false;
            queue.add((BuildableType)type);
        }
        final String problem = BuildQueues.problem(colony, queue);
        if (problem != null) {
            gui().showInformationPanel(null, StringTemplate.name(problem));
            return false;
        }
        return igc().setBuildQueue(colony, queue);
    }

    /**
     * Pay for what the colony is building now (the build queue panel's buy
     * button), once the player confirms the price.
     *
     * @param colonyId The id of one of our colonies.
     * @return True if the building was paid for.
     */
    public boolean payForBuilding(String colonyId) {
        final Colony colony = object(colonyId, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        return igc().payForBuilding(colony);
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

    /**
     * Open a report of the Report menu, as its action does: colony, labour,
     * compactLabour, military, naval, cargo, religion, education, exploration,
     * history, trade, production or requirements. {@link Reports} says how to
     * add one.
     *
     * @param name The report's name.
     * @return True if there is such a report.
     */
    public boolean showReport(String name) {
        switch (name) {
        case "colony": gui().showReportColonyPanel(); return true;
        case "labour": gui().showReportLabourPanel(); return true;
        case "compactLabour": gui().showCompactLabourReport(); return true;
        case "military": gui().showReportMilitaryPanel(); return true;
        case "naval": gui().showReportNavalPanel(); return true;
        case "cargo": gui().showReportCargoPanel(); return true;
        case "religion": gui().showReportReligiousPanel(); return true;
        case "education": gui().showReportEducationPanel(); return true;
        case "exploration": gui().showReportExplorationPanel(); return true;
        case "history": gui().showReportHistoryPanel(); return true;
        case "trade": gui().showReportTradePanel(); return true;
        case "production": gui().showReportProductionPanel(); return true;
        case "requirements": gui().showReportRequirementsPanel(); return true;
        default: return false;
        }
    }

    /**
     * Open the details a report links to: labourDetail or compactLabour
     * for a unit type (compactLabour with an empty id is for all colonists).
     *
     * @param name The report's name.
     * @param id What the details are of.
     * @return True if there is such a report and thing.
     */
    public boolean showReportDetail(String name, String id) {
        final net.sf.freecol.common.model.UnitType type = id.isEmpty() ? null
            : this.client.getGame().getSpecification().getUnitType(id);
        switch (name) {
        case "labourDetail":
            if (type == null) return false;
            gui().showReportLabourDetailPanel(type, null, null, null);
            return true;
        case "compactLabour":
            final net.sf.freecol.client.gui.panel.report.LabourData data
                = new net.sf.freecol.client.gui.panel.report.LabourData(this.client);
            gui().showCompactLabourReport((type == null) ? data.getSummary()
                                          : data.getUnitData(type));
            return true;
        default: return false;
        }
    }

    /**
     * Open the panel of one of our colonies, as a link in a report does.
     *
     * @param id The colony's id.
     * @return True if it is ours.
     */
    public boolean showColony(String id) {
        final Colony colony = this.client.getGame()
            .getFreeColGameObject(id, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        gui().showColonyPanel(colony, null);
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
