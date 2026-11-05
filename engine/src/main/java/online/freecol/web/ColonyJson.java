package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.FeatureContainer;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.ProductionInfo;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.option.GameOptions;


/**
 * A colony as FreeCol's ColonyPanel shows it, as JSON, for the Browser UI's
 * colony panel (and later the colony report). Images are resource keys,
 * best first, so a Tileset can replace them; text is localized. Fields:
 * <ul>
 * <li>id, name, at ([x, y]), ok (the close button's label);
 * <li>population: {total, rebels, royalists, bonus (PopulationPanel's
 *     labels), rebelPercent, rebelShield and royalistShield (keys), tip
 *     (RebelToolTip as [label, value] lines)};
 * <li>buildings: {id, type, name, keys, site, capacity, builds (it has Ability.BUILD, so a click opens the build queue), workers,
 *     production, upkeep}, in the specification's order, without the
 *     defences and the docks, which Swing's BuildingsPanel leaves to the
 *     background; a kind not built yet is an empty plot (site true, id
 *     null). production is what BuildingPanel shows, {type, name, keys,
 *     amount, max}, or null; upkeep its UpkeepLabel's number, or null when
 *     the upkeep game option is off or the building has none; tip what
 *     BuildingToolTip shows, see {@link #tip};
 * <li>tiles: the 3x3 of TilesPanel, {id, pos ([x, y] in TilesPanel's
 *     grid: north at [0, 0], south at [2, 2]), at (the tile on the map),
 *     name, terrain (keys), forest (keys, or null), centre, ours (the
 *     colony owns the tile), taken and natives (whether TileViewer draws
 *     the tile taken and the native land images over it), workers (each
 *     with occupation, the text of TileViewer's chip), production:
 *     [{type, name, keys, amount}]}; production is the centre tile's and
 *     the worked tiles';
 * <li>production: the net production of each goods type, non-zero only;
 * <li>warehouse: {title, capacity, goods: [{type, name, keys, amount,
 *     over}]}, the storable goods at or over the display threshold, over
 *     being whether the amount exceeds the capacity (Swing's red);
 * <li>outside: {title, units}, the units on the colony's tile that are
 *     not carriers, each unit also with occupation (UnitLabel's chip text),
 *     occupationFull, the chip's colours rgb and fg and, when damaged, repair; the units in port have them
 *     too;
 * <li>inPort: {title, units, selected, cargo}, the carriers on the tile,
 *     each unit with cargo: {title, units, goods} as ColonyCargoPanel
 *     shows it; selected is the carrier chosen at first (or null), cargo
 *     the cargo box's title with none chosen;
 * <li>construction: {type, name (as ConstructionPanel labels it), keys,
 *     turns (text, or null), required: [{type, name, keys, needed,
 *     available, produced}]}, or null when nothing is being built, with
 *     nothing, ConstructionPanel's text for that.
 * <li>queue: the build queue panel, see {@link BuildQueues#json}.
 * </ul>
 * A unit is {id, name, keys}; one working in a building or on a tile
 * also has work (the goods type it works at, or null) and choices (the
 * goods it could make there, with the amount it would make).
 */
final class ColonyJson {

    private ColonyJson() {}

    /**
     * @param colony The colony.
     * @param threshold The least amount of goods the warehouse shows
     *     (the minimum number for displaying goods client option).
     */
    static String of(Colony colony, int threshold) {
        colony.invalidateCache();
        final Specification spec = colony.getSpecification();
        final Tile tile = colony.getTile();
        return new Json().put("id", colony.getId())
            .put("name", colony.getName())
            .putRaw("at", MapJson.xy(tile))
            .put("ok", Messages.message("ok"))
            .putRaw("population", population(colony))
            .putRaw("buildings", buildings(colony))
            .putRaw("tiles", tiles(colony))
            .putRaw("production", netProduction(colony, spec))
            .putRaw("warehouse", warehouse(colony, spec, threshold))
            .putRaw("outside", outside(colony))
            .putRaw("inPort", inPort(colony))
            .putRaw("construction", construction(colony))
            .putRaw("queue", BuildQueues.json(colony))
            .put("nothing", Messages.message(StringTemplate
                    .template("constructionPanel.clickToBuild")))
            .toString();
    }

    /** PopulationPanel. */
    private static String population(Colony colony) {
        final int uc = colony.getUnitCount();
        final int sol = colony.getSonsOfLiberty();
        final int rebels = Colony.calculateRebelCount(uc, sol);
        final int grow = colony.getPreferredSizeChange();
        final String growth = (grow == 0) ? ""
            : "(" + ((grow >= Colony.CHANGE_UPPER_BOUND)
                ? Messages.message("many") : String.valueOf(grow)) + ")";
        final Nation nation = colony.getOwner().getNation();
        final Nation other = colony.getOwner().isREF()
            ? nation.getRebelNation() : nation.getREFNation();
        return new Json()
            .put("total", Messages.message(StringTemplate
                    .template("colonyPanel.populationLabel").addAmount("%number%", uc)))
            .put("rebels", Messages.message(StringTemplate
                    .template("colonyPanel.rebelLabel").addAmount("%number%", rebels)))
            .put("royalists", Messages.message(StringTemplate
                    .template("colonyPanel.royalistLabel")
                    .addAmount("%number%", uc - rebels)))
            .put("bonus", Messages.message(StringTemplate
                    .template("colonyPanel.bonusLabel")
                    .addAmount("%number%", colony.getProductionBonus())
                    .addName("%extra%", growth)))
            .put("rebelPercent", sol)
            .putRaw("tip", rebelTip(colony))
            .putRaw("rebelShield", ObjectImages.json(nation))
            .putRaw("royalistShield", (other == null) ? "[]" : ObjectImages.json(other))
            .toString();
    }

    /**
     * RebelToolTip as lines of [label, value]: the rebels and royalists with
     * their shares, the liberty each liberty goods makes and in all, the
     * progress to the next rebel, and the turns until the next member, 50%
     * and 100%, then how many colonists can be added or removed at the
     * current bonus.
     */
    private static String rebelTip(Colony colony) {
        final Specification spec = colony.getSpecification();
        final int population = colony.getUnitCount();
        final int sol = colony.getSonsOfLiberty();
        final int rebels = Colony.calculateRebelCount(population, sol);
        final Turn turn = colony.getGame().getTurn();
        final List<String> rows = new ArrayList<>();
        rows.add(row(Messages.message(StringTemplate.template("rebelToolTip.rebelLabel")
                    .addName("%number%", "")).trim(), rebels + "  " + sol + "%"));
        rows.add(row(Messages.message(StringTemplate.template("rebelToolTip.royalistLabel")
                    .addName("%number%", "")).trim(),
                (population - rebels) + "  " + (100 - sol) + "%"));
        int liberty = 0;
        for (GoodsType type : spec.getLibertyGoodsTypeList()) {
            final int production = colony.getNetProductionOf(type);
            liberty += production;
            rows.add(row(Messages.getName(type), String.valueOf(production)));
        }
        liberty = (int)FeatureContainer.applyModifiers((float)liberty, turn,
            colony.getOwner().getModifiers(Modifier.LIBERTY));
        final boolean capped = spec.getBoolean(GameOptions.BELL_ACCUMULATION_CAPPED)
            && sol >= 100;
        rows.add(row(Messages.getName(spec.getLibertyGoodsTypeList().get(0)),
                (colony.getLiberty() % Colony.LIBERTY_PER_REBEL) + "/"
                + Colony.LIBERTY_PER_REBEL + " ("
                + (capped ? 0 : liberty) + ")"));
        int next = -1, half = -1, all = -1;
        // An empty colony (its last colonist put outside, before the panel asks to abandon it) has
        // no membership to grow: Colony.rebelHelper never ends for one, so it is not asked.
        if (liberty > 0 && !capped && population > 0) {
            final List<Integer> bonus = colony.rebelHelper(liberty);
            next = bonus.get(0);
            half = bonus.get(1);
            all = bonus.get(2);
        }
        rows.add(row(Messages.message("rebelToolTip.nextMember"),
                (next < 0) ? Messages.message("notApplicable") : String.valueOf(next)));
        if (half > 0) rows.add(row(Messages.message("rebelToolTip.50percent"), String.valueOf(half)));
        if (all > 0) rows.add(row(Messages.message("rebelToolTip.100percent"), String.valueOf(all)));
        final int grow = colony.getPreferredSizeChange();
        if (grow >= Colony.CHANGE_UPPER_BOUND) {
            rows.add(row(Messages.message("rebelToolTip.changeMore"), Messages.message("many")));
        } else if (grow >= 0) {
            rows.add(row(Messages.message("rebelToolTip.changeMore"), String.valueOf(grow)));
        } else {
            rows.add(row(Messages.message("rebelToolTip.changeLess"), String.valueOf(-grow)));
        }
        return Json.array(rows);
    }

    private static String row(String label, String value) {
        return Json.array(List.of(Json.quote(label), Json.quote(value)));
    }

    /**
     * BuildingsPanel: per kind of building (its first level), the
     * colony's building as BuildingPanel shows it, else an empty plot.
     * The defences and the docks are left to the background, as in Swing.
     * Swing shuffles the places by a seed per colony; this keeps the
     * specification's order.
     */
    private static String buildings(Colony colony) {
        final Specification spec = colony.getSpecification();
        final boolean upkeep = spec.getBoolean(GameOptions.ENABLE_UPKEEP);
        final List<String> out = new ArrayList<>();
        for (BuildingType first : spec.getBuildingTypeList()) {
            if (first.getUpgradesFrom() != null || first.isDefenceType()
                || first.hasAbility(Ability.PRODUCE_IN_WATER)) continue;
            Building b = null;
            for (Building built : colony.getBuildings()) {
                if (built.getType().getFirstLevel() == first) b = built;
            }
            if (b == null) {
                out.add(new Json().putRaw("id", "null")
                    .put("type", first.getId())
                    .put("name", Messages.getName(first))
                    .putRaw("keys", "[" + Json.quote(BUILDING_SITE) + "]")
                    .put("site", true)
                    .put("capacity", 0)
                    .put("builds", false)
                    .putRaw("workers", "[]")
                    .putRaw("production", "null")
                    .putRaw("upkeep", "null")
                    .putRaw("tip", "null")
                    .toString());
                continue;
            }
            final BuildingType type = b.getType();
            out.add(new Json().put("id", b.getId())
                .put("type", type.getId())
                .put("name", Messages.getName(type))
                .putRaw("keys", ObjectImages.json(type))
                .put("site", false)
                .put("capacity", b.getUnitCapacity())
                .put("builds", type.hasAbility(Ability.BUILD))
                .putRaw("workers", workers(colony, b))
                .putRaw("production", buildingProduction(colony, b))
                .putRaw("upkeep", (upkeep && type.getUpkeep() > 0)
                    ? String.valueOf(type.getUpkeep()) : "null")
                .putRaw("tip", tip(colony, b))
                .toString());
        }
        return Json.array(out);
    }

    /** ImageLibrary.getScaledBuildingEmptyLandImage's key: an empty plot. */
    private static final String BUILDING_SITE = "image.buildingicon.model.building.BuildingSite";

    /** BuildingPanel.update's production label: the output, and the most it could be. */
    private static String buildingProduction(Colony colony, Building b) {
        final ProductionInfo info = b.getProductionInfo();
        if (info == null || info.getProduction().isEmpty()) return "null";
        AbstractGoods output = info.getProduction().get(0);
        if (output.getAmount() <= 0) return "null";
        if (b.hasAbility(Ability.AVOID_EXCESS_PRODUCTION)) {
            final int stored = colony.getGoodsCount(output.getType());
            final int capacity = colony.getWarehouseCapacity();
            if (output.getAmount() + stored > capacity) {
                output = new AbstractGoods(output.getType(), capacity - stored);
            }
        }
        final int max = info.getMaximumProduction().isEmpty() ? output.getAmount()
            : info.getMaximumProduction().get(0).getAmount();
        return goods(output.getType(), output.getAmount()).put("max", max).toString();
    }

    /**
     * BuildingToolTip: the input and the output, each {type, name, keys,
     * amount, max}, max being what it could be were nothing short (both
     * null when the building makes nothing, as Swing leaves that row
     * empty; input null when the building takes none); the workers Swing
     * lists, each a unit with made (the goods it makes, or null), progress
     * ("turns/needed", or null) and student (a unit, or null); and
     * breeding, the breeding note, or null.
     */
    private static String tip(Colony colony, Building b) {
        final ProductionInfo info = b.getProductionInfo();
        final AbstractGoods made = (info == null || info.getProduction().isEmpty())
            ? null : info.getProduction().get(0);
        final AbstractGoods used = (info == null || info.getConsumption().isEmpty())
            ? null : info.getConsumption().get(0);
        String output = "null";
        String input = "null";
        if (made != null && made.getAmount() > 0) {
            output = withMax(made, info.getMaximumProduction());
            if (used != null) input = withMax(used, info.getMaximumConsumption());
        }
        final AbstractGoods first = b.getOutputs().findFirst().orElse(null);
        final GoodsType outputType = (first == null) ? null : first.getType();
        final List<String> workers = new ArrayList<>();
        if (outputType != null) {
            for (Unit u : b.getUnitList()) {
                final int amount = b.getUnitProduction(u, outputType);
                if (amount > 0) {
                    workers.add(unit(u).putRaw("made", goods(outputType, amount).toString())
                        .putRaw("progress", "null")
                        .putRaw("student", "null").toString());
                }
            }
        } else if (b.canTeach()) {
            for (Unit u : b.getUnitList()) {
                final Unit student = u.getStudent();
                workers.add(unit(u).putRaw("made", "null")
                    .put("progress", (student == null) ? null
                        : u.getTurnsOfTraining() + "/" + u.getNeededTurnsOfTraining())
                    .putRaw("student", (student == null) ? "null" : unit(student).toString())
                    .toString());
            }
        }
        final int breed = (outputType == null || !outputType.isBreedable()) ? -1
            : outputType.getBreedingNumber();
        final String breeding = (breed > colony.getGoodsCount(outputType))
            ? Messages.message(StringTemplate.template("buildingToolTip.breeding")
                .addAmount("%number%", breed).addNamed("%goods%", outputType))
            : null;
        return new Json().putRaw("input", input).putRaw("output", output)
            .putRaw("workers", Json.array(workers)).put("breeding", breeding)
            .toString();
    }

    /** A ProductionLabel's goods: the amount, and the most of the list's same goods (else the amount). */
    private static String withMax(AbstractGoods ag, List<AbstractGoods> maxima) {
        int max = ag.getAmount();
        for (AbstractGoods m : maxima) {
            if (m.getType() == ag.getType()) max = m.getAmount();
        }
        return goods(ag.getType(), ag.getAmount()).put("max", max).toString();
    }

    /** TilesPanel's grid: Swing's tiles[x][y], from the colony tile. */
    private static final Direction[][] GRID = {
        { Direction.N, Direction.NE, Direction.E },
        { Direction.NW, null, Direction.SE },
        { Direction.W, Direction.SW, Direction.S },
    };

    private static String tiles(Colony colony) {
        final Tile centre = colony.getTile();
        final List<String> out = new ArrayList<>();
        for (int x = 0; x < 3; x++) {
            for (int y = 0; y < 3; y++) {
                final Tile t = (GRID[x][y] == null) ? centre
                    : centre.getNeighbourOrNull(GRID[x][y]);
                if (t == null) continue;
                final ColonyTile ct = colony.getColonyTile(t);
                if (ct == null) continue;
                final List<String> made = new ArrayList<>();
                if (ct.isColonyCenterTile() || !ct.isEmpty()) {
                    final ProductionInfo info = colony.getProductionInfo(ct);
                    if (info != null) {
                        for (AbstractGoods ag : info.getProduction()) {
                            if (ag.getAmount() != 0) {
                                made.add(goods(ag.getType(), ag.getAmount()).toString());
                            }
                        }
                    }
                }
                final List<String> workers = new ArrayList<>();
                for (Unit u : ct.getUnitList()) {
                    workers.add(worker(colony, ct, u)
                        .put("occupation", Messages.message(
                            u.getOccupationLabel(colony.getOwner(), false)))
                        .toString());
                }
                out.add(new Json().put("id", ct.getId())
                    .putRaw("pos", "[" + x + "," + y + "]")
                    .putRaw("at", MapJson.xy(t))
                    .put("name", Messages.message(ct.getLabel()))
                    .putRaw("terrain", MapJson.terrainKeyJson(t.getType()))
                    .putRaw("forest", MapJson.forestKeyJson(t.getType()))
                    .put("centre", ct.isColonyCenterTile())
                    .put("ours", t.getOwningSettlement() == colony)
                    .put("taken", taken(ct))
                    .put("natives", colony.getOwner().getLandPrice(t) > 0 && !t.hasSettlement())
                    .putRaw("workers", Json.array(workers))
                    .putRaw("production", Json.array(made))
                    .toString());
            }
        }
        return Json.array(out);
    }

    /** TileViewer.displayColonyTile: whether the tile taken image covers the tile. */
    private static boolean taken(ColonyTile ct) {
        switch (ct.getNoWorkReason()) {
        case NONE: case COLONY_CENTER: case CLAIM_REQUIRED:
            return false;
        default:
            return true;
        }
    }

    /** ColonyPanel.updateNetProductionPanel. */
    private static String netProduction(Colony colony, Specification spec) {
        final List<String> out = new ArrayList<>();
        for (GoodsType type : spec.getGoodsTypeList()) {
            final int amount = colony.getAdjustedNetProductionOf(type);
            if (amount != 0) out.add(goods(type, amount).toString());
        }
        return Json.array(out);
    }

    /** WarehousePanel, with GoodsLabel's capacity exceeded colour as over. */
    private static String warehouse(Colony colony, Specification spec, int threshold) {
        final int capacity = colony.getWarehouseCapacity();
        final List<String> out = new ArrayList<>();
        for (GoodsType type : spec.getStorableGoodsTypeList()) {
            final int count = colony.getGoodsCount(type);
            if (count < threshold) continue;
            out.add(goods(type, count)
                .put("over", !type.limitIgnored() && count > capacity).toString());
        }
        return new Json().put("title", Messages.message("colonyPanel.warehouse"))
            .put("capacity", capacity)
            .putRaw("goods", Json.array(out))
            .toString();
    }

    /** OutsideColonyPanel: the units on the colony's tile that are not carriers. */
    private static String outside(Colony colony) {
        final List<Unit> units = new ArrayList<>();
        for (Unit u : colony.getTile().getUnitList()) {
            if (!u.isCarrier()) units.add(u);
        }
        return new Json().put("title", Messages.message("colonyPanel.outsideColony"))
            .putRaw("units", Json.array(occupied(colony, units))).toString();
    }

    /**
     * Each unit with the occupation chip UnitLabel draws over a unit outside
     * the colony or in port, and for a damaged one the repair status, drawn
     * red.
     */
    private static List<String> occupied(Colony colony, List<Unit> units) {
        final List<String> out = new ArrayList<>();
        for (Unit u : units) out.add(occupied(colony, u).toString());
        return out;
    }

    private static Json occupied(Colony colony, Unit u) {
        // ImageLibrary.getOccupationIndicatorChip: the owner's colour, and
        // text that shows on it, grey for a fortified unit.
        final int rgb = MapJson.rgb(u.getOwner());
        final Json json = unit(u)
            .put("occupation", Messages.message(u.getOccupationLabel(colony.getOwner(), false)))
            .put("occupationFull", Messages.message(u.getOccupationLabel(colony.getOwner(), true)))
            .put("rgb", rgb)
            .put("fg", (u.getState() == Unit.UnitState.FORTIFIED) ? 0x808080
                 : MapJson.foreground(rgb));
        return u.isDamaged()
            ? json.put("repair", Messages.message(u.getRepairLabel()))
            : json;
    }

    /**
     * ColonyInPortPanel: the carriers on the colony's tile, each with its
     * cargo as ColonyCargoPanel shows it, and the one InPortPanel.selectLabel
     * chooses at first, the last carrier with no trade route.
     */
    private static String inPort(Colony colony) {
        final List<String> out = new ArrayList<>();
        Unit selected = null;
        for (Unit u : colony.getTile().getUnitList()) {
            if (!u.isCarrier()) continue;
            if (u.getTradeRoute() == null) selected = u;
            final List<String> goods = new ArrayList<>();
            for (Goods g : u.getGoodsList()) {
                goods.add(goods(g.getType(), g.getAmount()).toString());
            }
            out.add(occupied(colony, u).putRaw("cargo", new Json()
                    .put("title", Messages.message(StringTemplate
                            .template("cargoPanel.cargoAndSpace")
                            .addStringTemplate("%name%", u.getLabel(Unit.UnitLabelType.NATIONAL))
                            .addAmount("%space%", u.getSpaceLeft())))
                    .putRaw("units", unitList(u.getUnitList()))
                    .putRaw("goods", Json.array(goods))
                    .toString())
                .toString());
        }
        return new Json().put("title", Messages.message("colonyPanel.inPort"))
            .putRaw("units", Json.array(out))
            .put("selected", (selected == null) ? null : selected.getId())
            .put("cargo", Messages.message("cargoOnCarrier"))
            .toString();
    }

    /** ConstructionPanel: the current build and the goods it needs. */
    private static String construction(Colony colony) {
        final BuildableType buildable = colony.getCurrentlyBuilding();
        if (buildable == null) return "null";
        final List<String> required = new ArrayList<>();
        for (AbstractGoods ag : buildable.getRequiredGoodsList()) {
            final GoodsType type = ag.getType();
            required.add(goods(type, ag.getAmount())
                .put("needed", ag.getAmount())
                .put("available", colony.getGoodsCount(type))
                .put("produced", colony.getAdjustedNetProductionOf(type))
                .toString());
        }
        final int turns = colony.getTurnsToComplete(buildable);
        return new Json().put("type", buildable.getId())
            .put("name", Messages.message(buildable.getCurrentlyBuildingLabel()))
            .putRaw("keys", ObjectImages.json(buildable))
            .put("turns", (turns < 0) ? null : Messages.message(StringTemplate
                    .template("constructionPanel.turnsToComplete")
                    .addAmount("%number%", turns)))
            .putRaw("required", Json.array(required))
            .toString();
    }

    /** Goods of a type: {type, name, keys, amount}, open for more fields. */
    static Json goods(GoodsType type, int amount) {
        return new Json().put("type", type.getId())
            .put("name", Messages.getName(type))
            .putRaw("keys", ObjectImages.json(type))
            .put("amount", amount);
    }

    /** The units working in a building, each as {@link #worker} says. */
    private static String workers(Colony colony, Building b) {
        final List<String> out = new ArrayList<>();
        for (Unit u : b.getUnitList()) out.add(worker(colony, b, u).toString());
        return Json.array(out);
    }

    /**
     * A unit working at a work location: the unit, with the goods it
     * makes there and the goods it could make there instead, each as
     * {type, name, keys, amount}, amount being what the unit would make
     * there with them (the work type menu of the colony panel, as
     * QuickActionMenu lists it for a location).
     */
    private static Json worker(Colony colony, WorkLocation wl, Unit u) {
        final List<String> choices = new ArrayList<>();
        for (GoodsType type : colony.getSpecification().getGoodsTypeList()) {
            final int amount = wl.getPotentialProduction(type, u.getType());
            if (amount > 0) choices.add(goods(type, amount).toString());
        }
        final GoodsType now = u.getWorkType();
        return unit(u).put("work", (now == null) ? null : now.getId())
            .putRaw("choices", Json.array(choices));
    }

    /** A unit: {id, name, keys}, open for more fields. */
    static Json unit(Unit u) {
        return new Json().put("id", u.getId())
            .put("name", u.getDescription(Unit.UnitLabelType.NATIONAL))
            .putRaw("keys", MapJson.unitKeyJson(u));
    }

    static String unitList(List<Unit> units) {
        final List<String> out = new ArrayList<>();
        for (Unit u : units) out.add(unit(u).toString());
        return Json.array(out);
    }
}
