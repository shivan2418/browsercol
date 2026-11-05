package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.Unit;


/**
 * The standing orders the active unit can take, and which of them it may
 * take now.
 *
 * FreeCol's Swing client has an action for each order: FortifyAction,
 * SentryAction, SkipUnitAction, DisbandUnitAction and GotoAction. Each
 * action says in its shouldBeEnabled() whether it may be used, and the
 * Browser UI must not repeat FreeCol's rules, so the Engine works the
 * orders out here and tells the Browser UI which ones the active unit can
 * take.
 *
 * <table>
 * <caption>The orders, and what the Swing actions check</caption>
 * <tr><th>Order</th><th>Action</th><th>Enabled when</th></tr>
 * <tr><td>fortify</td><td>FortifyAction</td>
 *     <td>the unit can be fortified, as Unit.checkSetState says</td></tr>
 * <tr><td>sentry</td><td>SentryAction</td><td>always</td></tr>
 * <tr><td>skip</td><td>SkipUnitAction</td><td>always</td></tr>
 * <tr><td>disband</td><td>DisbandUnitAction</td><td>always</td></tr>
 * <tr><td>goto</td><td>GotoAction</td><td>no panel is showing, which in
 *     the Browser UI is always</td></tr>
 * <tr><td>unload</td><td>UnloadAction</td>
 *     <td>the unit is a carrier with cargo aboard</td></tr>
 * <tr><td>buildColony</td><td>BuildColonyAction</td>
 *     <td>the unit can found a colony (Unit.canBuildColony: moves left, a
 *         type that can found one, and the player is not a rebel without
 *         the game option), or it has a skill and is on a colony's tile</td></tr>
 * <tr><td>the tile improvements</td><td>ImprovementAction</td>
 *     <td>the unit may work its tile, and the improvement is allowed
 *         there</td></tr>
 * </table>
 */
public final class UnitOrders {

    /** Fortify the unit, as FortifyAction does. */
    public static final String FORTIFY = "fortify";
    /** Sentry the unit, as SentryAction does. */
    public static final String SENTRY = "sentry";
    /** Leave the unit for this turn, as SkipUnitAction does. */
    public static final String SKIP = "skip";
    /** Disband the unit, as DisbandUnitAction does. */
    public static final String DISBAND = "disband";
    /**
     * Send the unit to a destination, as GotoAction does. It is not the
     * tile the player clicks on the map, which is GotoTileAction.
     */
    public static final String GOTO = "goto";

    /** Unload the carrier's cargo, as UnloadAction does. */
    public static final String UNLOAD = "unload";

    /** Found a colony with the unit, as BuildColonyAction does. */
    public static final String BUILD_COLONY = "buildColony";

    private UnitOrders() {}


    /**
     * The orders the unit can take now, as the Swing actions would allow
     * them.
     *
     * @param player The player who owns the unit.
     * @param unit The active unit.
     * @return The orders, by name; empty when there is no unit.
     */
    public static List<String> valid(Player player, Unit unit) {
        final List<String> orders = new ArrayList<>();
        // UnitAction.shouldBeEnabled: an action needs an active unit of ours.
        if (unit == null || player == null || !player.owns(unit)) return orders;
        if (unit.checkSetState(Unit.UnitState.FORTIFYING)) {
            orders.add(FORTIFY);
        }
        // SentryAction, SkipUnitAction and DisbandUnitAction have no check
        // of their own, so they are always there.
        orders.add(SENTRY);
        orders.add(SKIP);
        orders.add(DISBAND);
        // GotoAction's only check of its own is that no Swing panel is
        // showing, and the Browser UI shows none. It asks where the unit
        // goes, and the destinations it may go to are the question's.
        orders.add(GOTO);
        // UnloadAction: a carrier with something aboard.
        if (unit.isCarrier() && unit.getCargoSpaceTaken() > 0) {
            orders.add(UNLOAD);
        }
        // BuildColonyAction: the unit can found a colony, or stands in one and
        // has a skill (not artillery or a ship): the order is then offered and
        // the controller says why a unit with no moves left cannot build.
        if (unit.getTile() != null && (unit.canBuildColony()
            || (unit.getTile().getColony() != null && unit.getType().hasSkill()))) {
            orders.add(BUILD_COLONY);
        }
        // ImprovementAction: one for each improvement the rules have, named
        // as the action is, e.g. "road" for the road.
        final Tile tile = unit.getTile();
        if (tile != null && unit.checkSetState(Unit.UnitState.IMPROVING)) {
            for (TileImprovementType type
                 : unit.getSpecification().getTileImprovementTypeList()) {
                if (type.isNatural()) continue;
                if (tile.isImprovementTypeAllowed(type)
                    && type.isWorkerAllowed(unit)) {
                    orders.add(type.getSuffix());
                }
            }
        }
        return orders;
    }
}
