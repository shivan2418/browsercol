package online.freecol.web;

import static net.sf.freecol.common.model.Constants.INFINITY;
import static net.sf.freecol.common.util.CollectionUtils.flatten;
import static net.sf.freecol.common.util.CollectionUtils.toList;
import static net.sf.freecol.common.util.CollectionUtils.transform;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map.Entry;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Stream;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.pathfinding.GoalDeciders.MultipleAdjacentDecider;


/**
 * The destinations a unit may sail to, as FreeCol's
 * {@code SelectDestinationDialog} lists them: Europe, the New World
 * (the map), the player's colonies and the other settlements the unit
 * may reach.
 *
 * The list is built in
 * {@code net.sf.freecol.client.gui.dialog.SelectDestinationDialog}, a
 * Swing dialog that TeaVM cannot load, so its logic is copied here:
 * the {@code loadDestinations} and {@code Destination} of that class,
 * without the Swing parts (the list, the "only my colonies" check box
 * and the sort box). The Swing dialog also adds the turns to sail and
 * the prices of the goods carried to each of its entries; those are
 * left out, as the Browser UI shows the label of each destination.
 */
final class Destinations {

    /**
     * One destination: where to sail, and the name the player knows it
     * by.
     */
    static final class Destination {

        /** The location to sail to. */
        final Location location;

        /** The number of turns to sail there. */
        final int turns;

        /** The name of the location, for the player. */
        final String name;

        /** A magic score, for the comparator. */
        private final int score;


        /**
         * Create a destination.
         *
         * @param location The {@code Location} to sail to.
         * @param turns The number of turns to sail there.
         * @param unit The {@code Unit} that sails.
         */
        Destination(Location location, int turns, Unit unit) {
            this.location = location;
            this.turns = turns;
            this.name = Messages.message(
                location.getLocationLabelFor(unit.getOwner()));
            this.score = calculateScore(location, unit);
        }

        /**
         * The score of the destination, as the Swing dialog's
         * {@code Destination} calculates it: Europe and the New World
         * come first, then our colonies, then the others.
         *
         * @param location The location of the destination.
         * @param unit The {@code Unit} that sails.
         * @return The score.
         */
        private static int calculateScore(Location location, Unit unit) {
            return (location instanceof Europe || location instanceof Map)
                ? 10
                : (location instanceof Colony)
                ? (unit.getOwner().owns((Colony)location)) ? 20 : 30
                : (location instanceof IndianSettlement)
                ? 40
                : 100;
        }

        /**
         * The score of the destination.
         *
         * @return The score.
         */
        int getScore() {
            return this.score;
        }
    }

    /** Sort by name, as the Swing dialog's name comparator does. */
    private static final Comparator<Destination> NAME_COMPARATOR
        = (d1, d2) -> {
            if (!(d1.location instanceof Settlement)) return -1;
            if (!(d2.location instanceof Settlement)) return 1;
            return d1.name.compareTo(d2.name);
        };

    /** Sort by owner, the Swing dialog's default: the score, then the name. */
    private static final Comparator<Destination> OWNER_COMPARATOR
        = Comparator.comparingInt(Destination::getScore)
            .thenComparing(NAME_COMPARATOR);


    private Destinations() {}

    /**
     * The destinations of the unit, as the Swing dialog lists them.
     *
     * @param unit The {@code Unit} to sail.
     * @return The destinations, in the order the Swing dialog shows them.
     */
    static List<Destination> of(Unit unit) {
        final List<Destination> destinations = new ArrayList<>();
        if (unit.isInEurope() && !unit.getType().canMoveToHighSeas()) {
            return destinations;
        }

        final Player player = unit.getOwner();
        final Settlement inSettlement = unit.getSettlement();
        final boolean canTrade
            = player.hasAbility(Ability.TRADE_WITH_FOREIGN_COLONIES);
        final Europe europe = player.getEurope();
        final Game game = unit.getGame();
        final Map map = game.getMap();
        // Quick check for whether a settlement is reachable by the unit.
        // Used to knock out obviously impossible candidates before
        // invoking the expensive full path search.
        final Predicate<Settlement> canReach = s ->
            (unit.isNaval()) ? s.isConnectedPort()
                : Map.isSameContiguity(unit.getLocation(), s.getTile());
        // Add Europe or "New World" (the map) depending where the unit is.
        final List<Destination> td = new ArrayList<>();
        if (unit.isInEurope()) {
            td.add(new Destination(map, unit.getSailTurns(), unit));
        } else if (europe != null
            && player.canMoveToEurope()
            && unit.getType().canMoveToHighSeas()) {
            final int turns = unit.getTurnsToReach(europe);
            if (turns < Unit.MANY_TURNS) {
                td.add(new Destination(europe, turns, unit));
            }
        }

        // Find all the player accessible settlements except the current one.
        td.addAll(transform(player.getSettlements(),
            s -> s != inSettlement && canReach.test(s),
            s -> new Destination(s, unit.getTurnsToReach(s), unit)));

        // Find all other player accessible settlements.  Build a list
        // of accessible settlement locations and do a bulk path search
        // to determine the travel times, and create Destinations from
        // the results.
        final Predicate<Player> tradePred = p ->
            p.hasContacted(player) && (canTrade || !p.isEuropean());
        final Function<Player, Stream<Location>> settlementTileMapper = p ->
            transform(p.getSettlements(),
                      s -> canReach.test(s) && s.hasContacted(p),
                      s -> (Location)s.getTile()).stream();
        final List<Location> locs = toList(flatten(game.getLivePlayers(player),
                                                    tradePred, settlementTileMapper));
        final MultipleAdjacentDecider md = new MultipleAdjacentDecider(locs);
        unit.search(unit.getLocation(), md.getGoalDecider(), null,
                    INFINITY, null);
        final Function<Entry<Location, PathNode>, Destination> dmapper = e -> {
            final Settlement s = e.getKey().getTile().getSettlement();
            final PathNode p = e.getValue();
            int turns = p.getTotalTurns();
            if (unit.isInEurope()) turns += unit.getSailTurns();
            if (p.getMovesLeft() < unit.getInitialMovesLeft()) turns++;
            return new Destination(s, turns, unit);
        };
        // A location whose settlement has gone is no destination (BR#3149).
        td.addAll(transform(md.getResults().entrySet(),
            e -> e.getKey().getTile().getSettlement() != null, dmapper));

        // Drop inaccessible destinations and sort as specified.
        destinations.addAll(transform(td,
            d -> d.turns < Unit.MANY_TURNS,
            Function.<Destination>identity(), OWNER_COMPARATOR));
        return destinations;
    }
}
