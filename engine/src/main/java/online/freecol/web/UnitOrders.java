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
 * <tr><td>goto</td><td>GotoAction</td><td>always</td></tr>
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
        // GotoAction has no check of its own either: it asks where the
        // unit goes, and the destinations it may go to are the question's.
        orders.add(GOTO);
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
