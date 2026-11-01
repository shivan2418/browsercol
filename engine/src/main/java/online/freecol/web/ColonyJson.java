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
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.ProductionInfo;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
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
 *     labels), rebelPercent, rebelShield and royalistShield (keys)};
 * <li>buildings: {id, type, name, keys, site, capacity, workers,
 *     production, upkeep}, in the specification's order, without the
 *     defences and the docks, which Swing's BuildingsPanel leaves to the
 *     background; a kind not built yet is an empty plot (site true, id
 *     null). production is what BuildingPanel shows, {type, name, keys,
 *     amount, max}, or null; upkeep its UpkeepLabel's number, or null when
 *     the upkeep game option is off or the building has none;
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
 *     not carriers;
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
            .putRaw("rebelShield", ObjectImages.json(nation))
            .putRaw("royalistShield", (other == null) ? "[]" : ObjectImages.json(other))
            .toString();
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
                    .putRaw("workers", "[]")
                    .putRaw("production", "null")
                    .putRaw("upkeep", "null")
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
                .putRaw("workers", workers(colony, b))
                .putRaw("production", buildingProduction(colony, b))
                .putRaw("upkeep", (upkeep && type.getUpkeep() > 0)
                    ? String.valueOf(type.getUpkeep()) : "null")
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
            .putRaw("units", unitList(units)).toString();
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
            out.add(unit(u).putRaw("cargo", new Json()
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
    private static Json goods(GoodsType type, int amount) {
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
    private static Json unit(Unit u) {
        return new Json().put("id", u.getId())
            .put("name", u.getDescription(Unit.UnitLabelType.NATIONAL))
            .putRaw("keys", MapJson.unitKeyJson(u));
    }

    private static String unitList(List<Unit> units) {
        final List<String> out = new ArrayList<>();
        for (Unit u : units) out.add(unit(u).toString());
        return Json.array(out);
    }
}
