package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementType;
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
     * Click a tile: select our next unit there, units aboard a carrier
     * included, so repeated clicks cycle through a stack. With none, send
     * the active unit there.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return True if a unit was selected or set off.
     */
    public boolean click(int x, int y) {
        final Tile tile = tile(x, y);
        if (tile == null) return false;
        final Player player = this.client.getMyPlayer();
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
}
