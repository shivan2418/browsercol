package browsercol.web;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.Unit.MoveType;
import net.sf.freecol.common.model.Unit.UnitState;


/**
 * The last step of a Go To that ends in a foreign settlement (#400).
 *
 * FreeCol's path to a foreign settlement already runs to the best tile next
 * to it and steps in (Map.searchMap lets the goal be a move that enters it:
 * a scout's, a missionary's, a colonist's going to learn, a carrier's with
 * goods to trade), and the step in opens the usual dialog. But a unit only
 * takes that step while the client runs its goto orders: at the end of the
 * turn, or once no other unit waits for orders. A unit that stops next to
 * the settlement (out of moves, or its goto broken off by a discovered
 * region) stands there in the meantime, and the player steps in by hand.
 *
 * Here such a unit steps in as soon as it can: after each command, and at
 * the start of our turn, as the player's own move into the settlement
 * (InGameController.moveUnit), which asks what it does there. The order is
 * the unit's destination, so a save keeps it. A unit the player has just
 * sent also goes on past the regions it discovers on the way
 * ({@link #goOn}), as its goto would only at the end of the turn.
 */
final class SettlementGoTo {

    /** The moves into a foreign settlement that are no attack. */
    private static final Set<MoveType> ENTERS = EnumSet.of(
        MoveType.ENTER_INDIAN_SETTLEMENT_WITH_FREE_COLONIST,
        MoveType.ENTER_INDIAN_SETTLEMENT_WITH_SCOUT,
        MoveType.ENTER_INDIAN_SETTLEMENT_WITH_MISSIONARY,
        MoveType.ENTER_FOREIGN_COLONY_WITH_SCOUT,
        MoveType.ENTER_SETTLEMENT_WITH_CARRIER_AND_GOODS);

    private final FreeColClient client;

    SettlementGoTo(FreeColClient client) {
        this.client = client;
    }

    /**
     * The tile of the foreign settlement a unit's Go To ends in, if its step
     * in from where it stands would be one of {@link #ENTERS} (the move type
     * does not ask that the tile be next to it); else null.
     */
    static Tile settlementAhead(Unit unit) {
        final Location destination = unit.getDestination();
        if (destination == null || unit.isDisposed() || unit.getTradeRoute() != null
            || !unit.hasTile()) return null;
        // The Go To is for the settlement's tile or the settlement itself.
        if (!(destination instanceof Tile || destination instanceof Settlement)) return null;
        final Tile target = destination.getTile();
        final Settlement settlement = (target == null) ? null : target.getSettlement();
        if (settlement == null || unit.getOwner().owns(settlement)) return null;
        return ENTERS.contains(unit.getSimpleMoveType(unit.getTile(), target)) ? target : null;
    }

    /** As {@link #settlementAhead}, for a unit that stands next to the settlement. */
    static Tile settlementNextTo(Unit unit) {
        final Tile target = settlementAhead(unit);
        return (target == null || unit.getTile().getDistanceTo(target) != 1) ? null : target;
    }

    /**
     * A unit just sent into a foreign settlement goes on while it has moves
     * left and is not next to it yet: its goto stops at each region it
     * discovers (InGameController.moveTile, for the naming dialog), which a
     * scout does all the time, and would otherwise wait for the end of the
     * turn while the player sees it stand still.
     *
     * @param unit The unit.
     */
    void goOn(Unit unit) {
        for (int i = 0; i < 8; i++) {
            final Tile target = settlementAhead(unit);
            if (target == null || unit.getMovesLeft() <= 0 || unit.getState() != UnitState.ACTIVE
                || unit.getTile().getDistanceTo(target) <= 1) return;
            final Tile before = unit.getTile();
            final PathNode path = unit.findPath(unit.getDestination());
            if (path == null || !this.client.getInGameController().goToTile(unit, path)
                || unit.isDisposed() || unit.getTile() == before) return;
        }
    }

    /**
     * Our units that stand next to the foreign settlement their Go To ends
     * in, waiting to step in.
     *
     * @param withMoves Only those with moves left, which can step in now.
     */
    List<Unit> waiting(boolean withMoves) {
        final List<Unit> units = new ArrayList<>();
        final Player player = this.client.getMyPlayer();
        if (player == null) return units;
        for (Unit u : player.getUnitSet()) {
            if (withMoves && u.getMovesLeft() <= 0) continue;
            if (u.getState() != UnitState.ACTIVE && u.getState() != UnitState.SKIPPED) continue;
            if (settlementNextTo(u) != null) units.add(u);
        }
        return units;
    }

    /**
     * Each unit next to the foreign settlement its Go To ends in, with moves
     * left on our turn, steps in, as the player's move would, which asks what
     * it does there.
     */
    void enterArrived() {
        if (!this.client.currentPlayerIsMyPlayer()) return;
        for (Unit u : waiting(true)) {
            // A dialog before may have changed it.
            final Tile target = settlementNextTo(u);
            if (target == null || u.getMovesLeft() <= 0) continue;
            final Direction d = u.getTile().getDirection(target);
            this.client.getGUI().changeView(u, false);
            this.client.getInGameController().moveUnit(u, d);
        }
    }
}
