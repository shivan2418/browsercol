package online.freecol.web;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.FeatureContainer;
import net.sf.freecol.common.model.FreeColSpecObjectType;
import net.sf.freecol.common.model.Limit;
import net.sf.freecol.common.model.Named;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.option.GameOptions;


/**
 * What BuildQueuePanel knows of a colony's build queue, without Swing: what
 * the colony can queue and the reasons it cannot queue the rest, as the
 * panel's lock icons give them, the checks on a queue the player sets, and
 * the queue's JSON for the Browser UI's colony panel.
 */
final class BuildQueues {

    private BuildQueues() {}

    /**
     * The reasons a buildable cannot be queued after the others, as
     * BuildQueuePanel's updateBuildingList and updateUnitList find them,
     * with the queued buildables' abilities counted as the colony's.
     *
     * @param colony The colony.
     * @param type The buildable.
     * @param before The queue ahead of it.
     * @param blocked The buildables found unbuildable already, which the
     *     lists fill in order (may be null).
     * @return The reasons, localized, none when it can be queued.
     */
    static List<String> reasons(Colony colony, BuildableType type,
                                List<BuildableType> before, Set<BuildableType> blocked) {
        final Specification spec = colony.getSpecification();
        final List<String> reasons = new ArrayList<>();
        final FeatureContainer queued = new FeatureContainer();
        for (BuildableType b : before) queued.addFeatures(b);
        final Set<BuildableType> unbuildable = (blocked == null) ? new HashSet<>() : blocked;
        if (type instanceof BuildingType) {
            final BuildingType bt = (BuildingType)type;
            if (bt.hasAbility(Ability.COASTAL_ONLY) && !colony.getTile().isCoastland()) {
                reasons.add(Messages.message(StringTemplate
                        .template("buildQueuePanel.coastalOnly")));
            }
        }
        if (type.getRequiredPopulation() > colony.getUnitCount()) {
            reasons.add(Messages.message(StringTemplate
                    .template("buildQueuePanel.populationTooSmall")
                    .addAmount("%number%", type.getRequiredPopulation())));
        }
        for (Limit limit : type.getLimits()) {
            if (!limit.evaluate(colony)) reasons.add(Messages.getDescription(limit));
        }
        if (!checkAbilities(colony, queued, type, reasons)) unbuildable.add(type);
        if (type instanceof BuildingType) {
            final BuildingType bt = (BuildingType)type;
            final Building built = colony.getBuilding(bt);
            final BuildingType up = bt.getUpgradesFrom();
            if (up != null && !before.contains(up)
                && (built == null || built.getType() != up)) {
                reasons.add(Messages.getName(up));
            }
        } else if (type instanceof UnitType) {
            final UnitType ut = (UnitType)type;
            if (!queued.hasAbility(Ability.BUILD, ut, null)
                && !colony.hasAbility(Ability.BUILD, ut, colony.getGame().getTurn())) {
                final Ability found = spec.getAbilities(Ability.BUILD)
                    .filter(a -> a.appliesTo(ut) && a.getValue() && a.getSource() != null
                        && !unbuildable.contains(a.getSource()))
                    .findFirst().orElse(null);
                reasons.add((found != null)
                    ? ((found.getSource() instanceof Named)
                        ? Messages.getName((Named)found.getSource())
                        : Messages.getName(found))
                    : Messages.getName(ut));
            }
        }
        return reasons;
    }

    /** BuildQueuePanel.checkAbilities. */
    private static boolean checkAbilities(Colony colony, FeatureContainer queued,
                                          BuildableType type, List<String> reasons) {
        final int old = reasons.size();
        for (java.util.Map.Entry<String, Boolean> e : type.getRequiredAbilities().entrySet()) {
            final String id = e.getKey();
            final boolean value = e.getValue();
            if (queued.hasAbility(id, null, null) != value && colony.hasAbility(id) != value) {
                final FreeColSpecObjectType source = first(
                    colony.getSpecification().getTypesProviding(id, value));
                reasons.add((source != null) ? Messages.getName(source) : Messages.getName(type));
            }
        }
        return reasons.size() == old;
    }

    private static <T> T first(List<T> list) {
        return (list == null || list.isEmpty()) ? null : list.get(0);
    }

    /** The panel's lock text for reasons, or null for none. */
    static String requires(List<String> reasons) {
        return reasons.isEmpty() ? null : Messages.message(StringTemplate
            .template("buildQueuePanel.requires")
            .addName("%string%", String.join("/", reasons)));
    }

    /** Whether the colony has the building type already (BuildQueuePanel.hasBuildingType). */
    private static boolean hasBuildingType(Colony colony, BuildingType type) {
        while (true) {
            final Building b = colony.getBuilding(type);
            if (b == null) return false;
            if (b.getType() == type) return true;
            if (type.getUpgradesTo() == null) return false;
            type = type.getUpgradesTo();
        }
    }

    /**
     * Why a queue cannot be set, or null if it can: a buildable twice (a
     * unit may be queued more than once), or one added to the queue that
     * the colony could not build after those ahead of it. Buildables the
     * colony already queues stay, as the panel keeps them.
     *
     * @param colony The colony.
     * @param queue The queue wanted.
     * @return The problem, localized, or null.
     */
    static String problem(Colony colony, List<BuildableType> queue) {
        final List<BuildableType> have = colony.getBuildQueue();
        final List<BuildableType> before = new ArrayList<>();
        for (BuildableType type : queue) {
            if (type instanceof BuildingType
                && (before.contains(type)
                    || (!have.contains(type) && hasBuildingType(colony, (BuildingType)type)))) {
                return Messages.getName(type);
            }
            if (!have.contains(type)) {
                final String why = requires(reasons(colony, type, before, null));
                if (why != null) return Messages.getName(type) + ": " + why;
            }
            before.add(type);
        }
        return null;
    }

    /**
     * The build queue for the colony panel: {title, buildingsTitle,
     * unitsTitle, showAll (BuildQueuePanel's labels), queue: [entry], buildings:
     * [entry], units: [entry], buy}. An entry is {type, name, keys,
     * required: [{type, name, keys, amount}], reason}, reason being
     * BuildQueuePanel's "Requires: ..." text or null; buildings and units
     * list everything the panel's show all box does, in its order, those
     * with a reason being what the colony cannot queue yet. buy is the
     * buy button, {label, price, enabled}, or null with nothing queued.
     */
    static String json(Colony colony) {
        final Specification spec = colony.getSpecification();
        final List<BuildableType> queue = colony.getBuildQueue();
        final List<String> queued = new ArrayList<>();
        final List<BuildableType> ahead = new ArrayList<>();
        for (BuildableType type : queue) {
            queued.add(entry(colony, type, requires(reasons(colony, type, ahead, null))));
            ahead.add(type);
        }
        final List<String> buildings = new ArrayList<>();
        final Set<BuildableType> blocked = new HashSet<>();
        for (BuildingType bt : spec.getBuildingTypeList()) {
            if (blocked.contains(bt)) continue;
            if (bt.getUpgradesFrom() != null && blocked.contains(bt.getUpgradesFrom())) {
                blocked.add(bt);
                continue;
            }
            if (!bt.needsGoodsToBuild()) continue;
            if (queue.contains(bt) || hasBuildingType(colony, bt)) continue;
            buildings.add(entry(colony, bt, requires(reasons(colony, bt, queue, blocked))));
        }
        final List<String> units = new ArrayList<>();
        final Set<BuildableType> unitsBlocked = new HashSet<>(blocked);
        for (UnitType ut : spec.getBuildableUnitTypes()) {
            if (unitsBlocked.contains(ut)) continue;
            units.add(entry(colony, ut, requires(reasons(colony, ut, queue, unitsBlocked))));
        }
        final BuildableType current = queue.isEmpty() ? null : queue.get(0);
        final boolean pay = spec.getBoolean(GameOptions.PAY_FOR_BUILDING);
        final String buy = (!pay || current == null) ? "null"
            : new Json().put("label", Messages.message(StringTemplate
                    .template("buildQueuePanel.buyBuilding").addNamed("%buildable%", current)))
                .put("price", colony.getPriceForBuilding(current))
                .put("enabled", colony.canPayToFinishBuilding(current))
                .toString();
        return new Json().put("title", Messages.message("buildQueuePanel.buildQueue"))
            .put("buildingsTitle", Messages.message("buildQueuePanel.buildings"))
            .put("unitsTitle", Messages.message("buildQueuePanel.units"))
            .put("showAll", Messages.message("buildQueuePanel.showAll"))
            .putRaw("queue", Json.array(queued))
            .putRaw("buildings", Json.array(buildings))
            .putRaw("units", Json.array(units))
            .putRaw("buy", buy)
            .toString();
    }

    private static String entry(Colony colony, BuildableType type, String reason) {
        final List<String> required = new ArrayList<>();
        for (AbstractGoods ag : type.getRequiredGoodsList()) {
            required.add(new Json().put("type", ag.getType().getId())
                .put("name", Messages.getName(ag.getType()))
                .putRaw("keys", ObjectImages.json(ag.getType()))
                .put("amount", ag.getAmount())
                .toString());
        }
        return new Json().put("type", type.getId())
            .put("name", Messages.getName(type))
            .putRaw("keys", ObjectImages.json(type))
            .putRaw("required", Json.array(required))
            .put("reason", reason)
            .toString();
    }
}
