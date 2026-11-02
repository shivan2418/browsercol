package online.freecol.web;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.gui.panel.report.LabourData;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.FreeColObject;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;


/**
 * The reports of FreeCol's Report menu as the Browser UI shows them, with
 * the information of the Swing panels: the classic colony report
 * (ReportClassicColonyPanel), the labour report (ReportLabourPanel and
 * ReportLabourDetailPanel) and the compact labour report
 * (CompactLabourReport, on LabourData) and the military, naval and cargo
 * reports (ReportUnitPanel and its three subclasses). Every payload is one
 * object of the {@code report} event, told apart by its {@code report}
 * field: colony, labour, labourDetail, compactLabour, military, naval or
 * cargo. Each has title, ok (the button's
 * label) and back, the report the button returns to (or null).
 *
 * <p>To add a report: write its builder here, giving it a new {@code report}
 * name; add its show method to the WebGUI (it sends the event) and its name
 * to Commands.showReport; give the Browser UI its component and menu
 * entry (ui/src/reports.tsx).
 */
final class Reports {

    private Reports() {}

    /** The start of every report: its kind and the labels of its window. */
    private static Json head(String kind, String titleKey, String back) {
        return new Json().put("report", kind)
            .put("title", Messages.message(Messages.nameKey(titleKey)))
            .put("ok", Messages.message("ok"))
            .put("back", back);
    }

    /** A unit type: {id, name, keys}. */
    private static Json type(UnitType t) {
        return new Json().put("id", t.getId())
            .put("name", Messages.getName(t))
            .putRaw("keys", ObjectImages.json(t));
    }

    private static final Comparator<Building> BUILDINGS
        = Comparator.<Building>comparingInt(b -> b.getType().getIndex())
            .thenComparing(FreeColObject.fcoComparator);

    /**
     * The classic colony report: for each colony {id, name, building
     * ({name, keys, unit}, the buildable, or null), colonists (the units in
     * the colony), outside (the units on its tile), goods ({type, name,
     * keys, amount (the net production), stock, max (the most its work
     * locations could make)} for goods that are made, used up or stored),
     * buildings ({id, name, keys}, those that are not built automatically)}.
     */
    static String colony(Player player) {
        final Specification spec = player.getSpecification();
        final List<String> colonies = new ArrayList<>();
        for (Colony colony : player.getColonyList()) {
            // The production is cached; the report is read after the server's updates, as ColonyJson is.
            colony.invalidateCache();
            final BuildableType now = colony.getCurrentlyBuilding();
            final boolean unit = now != null && spec.getUnitTypeList().contains(now);
            final List<Unit> colonists = new ArrayList<>(colony.getUnitList());
            colonists.sort(Unit.typeRoleComparator);
            final List<Unit> outside = new ArrayList<>(colony.getTile().getUnitList());
            outside.sort(Unit.typeRoleComparator);
            final List<GoodsType> kinds = new ArrayList<>(spec.getGoodsTypeList());
            kinds.sort(GoodsType.goodsTypeComparator);
            final List<String> goods = new ArrayList<>();
            for (GoodsType gt : kinds) {
                final int net = colony.getNetProductionOf(gt);
                final int stock = colony.getGoodsCount(gt);
                if (net == 0 && stock <= 0) continue;
                int max = 0;
                for (WorkLocation wl : colony.getWorkLocationsForProducing(gt)) {
                    max += wl.getMaximumProductionOf(gt);
                }
                goods.add(ColonyJson.goods(gt, net)
                    .put("stock", stock).put("max", max).toString());
            }
            final List<Building> built = new ArrayList<>(colony.getBuildings());
            built.sort(BUILDINGS);
            final List<String> buildings = new ArrayList<>();
            for (Building b : built) {
                if (b.getType().isAutomaticBuild()) continue;
                buildings.add(new Json().put("id", b.getId())
                    .put("name", Messages.getName(b))
                    .putRaw("keys", ObjectImages.json(b.getType()))
                    .toString());
            }
            colonies.add(new Json().put("id", colony.getId())
                .put("name", colony.getName())
                .putRaw("building", (now == null) ? "null" : new Json()
                    .put("name", Messages.message(now.getCurrentlyBuildingLabel()))
                    .putRaw("keys", ObjectImages.json(now))
                    .put("unit", unit).toString())
                .putRaw("colonists", ColonyJson.unitList(colonists))
                .putRaw("outside", ColonyJson.unitList(outside))
                .putRaw("goods", Json.array(goods))
                .putRaw("buildings", Json.array(buildings))
                .toString());
        }
        return head("colony", "reportColonyAction", null)
            .putRaw("colonies", Json.array(colonies)).toString();
    }

    /** Where ReportLabourPanel counts a unit: its settlement, Europe, else its tile. */
    private static Location placeOf(Player player, Unit unit) {
        final Location location = unit.getLocation();
        if (location == null) return null;
        if (location.getSettlement() != null) return location.getSettlement();
        if (unit.isInEurope()) return player.getEurope();
        if (location.getTile() != null) return location.getTile();
        return location;
    }

    /**
     * The labour report: {types: [{id, name, keys, count}]}, the kinds of
     * people the player can have, with how many it has of each.
     */
    static String labour(Player player) {
        final Map<UnitType, Integer> count = new LinkedHashMap<>();
        for (UnitType t : player.getSpecification().getUnitTypeList()) {
            if (t.isPerson() && t.isAvailableTo(player)) count.put(t, 0);
        }
        for (Unit u : player.getUnitSet()) count.computeIfPresent(u.getType(), (t, n) -> n + 1);
        final List<String> types = new ArrayList<>();
        for (Map.Entry<UnitType, Integer> e : count.entrySet()) {
            types.add(type(e.getKey()).put("count", e.getValue()).toString());
        }
        return head("labour", "reportLabourAction", null)
            .putRaw("types", Json.array(types)).toString();
    }

    /**
     * The labour report's details for one kind of unit: {unit, total,
     * colonies: [{id, name, count, canTrain}], places: [{label, count, europe,
     * at}] (Europe and the tiles on land), atSea: [{label, count}], canTrain
     * (the note on the * after a colony's name, or null)}.
     */
    static String labourDetail(Player player, UnitType unitType) {
        final Map<Location, Integer> where = new LinkedHashMap<>();
        int total = 0;
        for (Unit u : player.getUnitSet()) {
            if (u.getType() != unitType) continue;
            total++;
            final Location place = placeOf(player, u);
            if (place != null) where.merge(place, 1, Integer::sum);
        }
        boolean canTrain = false;
        final List<String> colonies = new ArrayList<>();
        for (Colony colony : player.getColonyList()) {
            final Integer n = where.get(colony);
            if (n == null) continue;
            final boolean train = colony.canTrain(unitType);
            canTrain |= train;
            colonies.add(new Json().put("id", colony.getId())
                .put("name", colony.getName()).put("count", n)
                .put("canTrain", train).toString());
        }
        final List<String> places = new ArrayList<>();
        final List<String> atSea = new ArrayList<>();
        for (Map.Entry<Location, Integer> e : where.entrySet()) {
            final Location l = e.getKey();
            if (l instanceof Colony) continue;
            final String label = Messages.message(l.getLocationLabel());
            if (l.getRank() == Location.LOCATION_RANK_HIGHSEAS) {
                atSea.add(new Json().put("label", label).put("count", e.getValue()).toString());
                continue;
            }
            final Tile tile = l.getTile();
            places.add(new Json().put("label", label).put("count", e.getValue())
                .put("europe", l instanceof Europe)
                .putRaw("at", (l instanceof Europe || tile == null) ? "null" : MapJson.xy(tile))
                .toString());
        }
        return head("labourDetail", "report.labour.details", "labour")
            .putRaw("unit", type(unitType).toString())
            .put("total", total)
            .putRaw("colonies", Json.array(colonies))
            .putRaw("places", Json.array(places))
            .putRaw("atSea", Json.array(atSea))
            .put("canTrain", canTrain ? Messages.message("report.labour.canTrain") : null)
            .toString();
    }

    /**
     * The compact labour report. With no unit type, the overview: groups
     * for all colonists and each kind of labour. With one, its details:
     * the summary, each colony, Europe, and on land and at sea. A group is
     * {label, keys (a unit type's, or null), link ({kind: "unit", id} in the
     * overview, {kind: "colony", id} or {kind: "europe"} in the details, or
     * null), summary ({colonists, production, net, hasNet}), rows: [{unit,
     * doing, count, production, counted}]}. showProduction and showNet say
     * whether the report has those columns, and goods is the image of the
     * goods type the expert makes, or null.
     */
    static String compactLabour(FreeColClient client, UnitType unitType) {
        final Player player = client.getMyPlayer();
        final LabourData data = new LabourData(client);
        final boolean overview = unitType == null;
        final LabourData.UnitData one = overview ? null : data.getUnitData(unitType);
        final List<String> groups = new ArrayList<>();
        if (overview) {
            groups.add(group(Messages.message("report.labour.allColonists"), null,
                link("unit", ""), data.getSummary().getTotal(), null));
            for (UnitType t : LabourData.getLabourTypes(player)) {
                final LabourData.UnitData u = data.getUnitData(t);
                groups.add(group(u.getUnitName(), t,
                    u.hasDetails() ? link("unit", t.getId()) : "null",
                    u.getTotal(), null));
            }
        } else {
            groups.add(group(Messages.message("report.labour.summary"), null, "null",
                one.getTotal(), null));
            for (Colony colony : player.getColonyList()) {
                final LabourData.LocationData d = one.getDetails().get(colony);
                if (d == null) continue;
                final String name = colony.getName() + (colony.canTrain(unitType) ? "*" : "");
                groups.add(group(name, null, link("colony", colony.getId()), d, colony));
            }
            if (one.getUnitsInEurope().getRowCount() > 0) {
                groups.add(group(Messages.getName(player.getEurope()), null,
                    link("europe", ""), one.getUnitsInEurope(), null));
            }
            if (one.getUnitsOnLand().getRowCount() > 0) {
                groups.add(group(Messages.message("report.labour.onLand"), null, "null",
                    one.getUnitsOnLand(), null));
            }
            if (one.getUnitsAtSea().getRowCount() > 0) {
                groups.add(group(Messages.message("report.labour.atSea"), null, "null",
                    one.getUnitsAtSea(), null));
            }
        }
        final GoodsType expert = overview ? null : unitType.getExpertProduction();
        return head("compactLabour", overview ? "reportLabourAction" : "report.labour.details",
                overview ? null : "compactLabour")
            .putRaw("unit", overview ? "null" : type(unitType).toString())
            .put("canTrain", overview ? null : Messages.message("report.labour.canTrain"))
            .put("showProduction", overview || one.showProduction())
            .put("showNet", overview || one.showNetProduction())
            .putRaw("goods", (expert == null) ? "null" : ObjectImages.json(expert))
            .putRaw("storedAs", (expert == null || !expert.isStoredAs()) ? "null"
                : ObjectImages.json(expert.getStoredAs()))
            .putRaw("headers", new Json()
                .put("unitType", Messages.message("unitType"))
                .put("workingAs", Messages.message("report.labour.workingAs"))
                .put("colonists", Messages.message("colonists"))
                .put("production", Messages.message("report.labour.production"))
                .toString())
            .putRaw("groups", Json.array(groups))
            .toString();
    }

    private static String group(String label, UnitType unit, String link,
                                LabourData.LocationData d, Colony colony) {
        final LabourData.UnitData ud = d.getUnitData();
        final boolean all = ud.isSummary();
        final String name = ud.getUnitName();
        final String as = all ? null : Messages.message(ud.getUnitType().getWorkingAsKey());
        // Swing shows production only for a kind that makes goods (addRow, addLocationSummary).
        final boolean makes = ud.showProduction();
        final List<String> rows = new ArrayList<>();
        if (!all && d.getOtherWorkingAmateurs().getColonists() > 0) {
            rows.add(row(Messages.message("report.labour.otherUnitType"), as,
                d.getOtherWorkingAmateurs().getColonists(),
                makes ? d.getOtherWorkingAmateurs().getProduction() : 0, false));
        }
        if (d.getWorkingProfessionals().getColonists() > 0) {
            rows.add(row(name, all ? Messages.message("report.labour.expertsWorking") : as,
                d.getWorkingProfessionals().getColonists(),
                makes ? d.getWorkingProfessionals().getProduction() : 0, true));
        }
        if (d.getWorkingAmateurs() > 0) {
            rows.add(row(name, Messages.message(all ? "report.labour.amateursWorking"
                    : "report.labour.workingAsOther"), d.getWorkingAmateurs(), 0, true));
        }
        if (d.getNotWorking() > 0) {
            rows.add(row(name, Messages.message("report.labour.notWorking"),
                d.getNotWorking(), 0, true));
        }
        if (d.getTeachers() > 0) {
            rows.add(row(name, Messages.message("report.labour.teacher"),
                d.getTeachers(), 0, true));
        }
        if (!all && d.getOtherStudents() > 0) {
            rows.add(row(d.getOtherStudentsName(), Messages.message(StringTemplate
                    .template("report.labour.learning").addName("%unit%", name)),
                d.getOtherStudents(), 0, true));
        }
        if (d.getStudents() > 0) {
            if (all) {
                rows.add(row(null, Messages.message("report.labour.sutdent"),
                    d.getStudents(), 0, false));
            } else {
                rows.add(row(name, learning(ud.getUnitType(), colony),
                    -d.getStudents(), 0, true));
            }
        }
        final int net = d.getNetProduction();
        return new Json().put("label", label)
            .putRaw("keys", (unit == null) ? "null" : ObjectImages.json(unit))
            .putRaw("link", link)
            .putRaw("summary", new Json().put("colonists", d.getTotalColonists())
                .put("production", makes ? d.getTotalProduction() : 0)
                .put("net", net)
                .put("hasNet", ud.showNetProduction() && (d.isTotal() || net != 0))
                .toString())
            .putRaw("rows", Json.array(rows))
            .toString();
    }

    /** What a student of a teacher of this type is becoming, as the report words it. */
    private static String learning(UnitType teacher, Colony colony) {
        UnitType becoming = null;
        int kinds = 0;
        if (colony != null) {
            for (Unit t : colony.getTeachers().collect(java.util.stream.Collectors.toList())) {
                final Unit student = t.getStudent();
                if (student == null || student.getType() != teacher) continue;
                final UnitType result = teacher.getTeachingType(t.getType());
                if (result != becoming) kinds++;
                becoming = result;
            }
        }
        return (kinds == 1)
            ? Messages.message(StringTemplate.template("report.labour.learning")
                .addName("%unit%", becoming))
            : Messages.message("report.labour.learningOther");
    }

    /** A link to details or a place: {kind: unit, colony or europe, id}. */
    private static String link(String kind, String id) {
        return new Json().put("kind", kind).put("id", id).toString();
    }

    private static String row(String unit, String doing, int count, int production,
                              boolean counted) {
        return new Json().put("unit", unit).put("doing", doing).put("count", count)
            .put("production", production).put("counted", counted).toString();
    }

    /** Whether a unit is in the unit report of this kind (isReportable of the three panels). */
    private static boolean reportable(String kind, Unit u) {
        switch (kind) {
        case "military":
            return !u.isNaval() && (u.hasAbility(Ability.EXPERT_SOLDIER) || u.isOffensiveUnit());
        case "naval": return u.isNaval();
        default: return u.isCarrier() || u.canCarryTreasure();
        }
    }

    /** Whether a REF unit is in the unit report of this kind (isReportableREF). */
    private static boolean reportableREF(String kind, AbstractUnit au, Specification spec) {
        switch (kind) {
        case "military": return !au.getType(spec).isNaval();
        case "naval": return au.getType(spec).isNaval();
        default: return false;
        }
    }

    private static final Comparator<AbstractUnit> MOST_COMMON
        = Comparator.comparingInt(AbstractUnit::getNumber).reversed();

    /** An abstract unit: {type, name, keys, count, text}, the text being its tooltip. */
    private static String abstractUnit(AbstractUnit au, Specification spec) {
        final UnitType t = au.getType(spec);
        return new Json().put("type", t.getId()).put("name", Messages.getName(t))
            .putRaw("keys", "[" + Json.quote(ObjectImages.unitKey(t, au.getRoleId())) + "]")
            .put("count", au.getNumber()).put("text", au.getDescription()).toString();
    }

    /**
     * The military, naval or cargo report (ReportUnitPanel): {forces:
     * {name, units: [{type, name, keys, count, text}]} (the player's
     * reportable units, most common first), ref: the same for the king's
     * expeditionary force, or null, locations: [{label, link, units}]}.
     * Locations are colonies, Europe and then the rest by id; the military
     * report lists every colony, the others only places with units. A
     * location's link is {kind: colony, europe or tile, id, at}, and each
     * unit {id, name, keys, text, goods: [{type, name, keys, amount}],
     * cargo: [{id, name, keys}]} (what a carrier holds).
     */
    static String units(FreeColClient client, String kind) {
        final Player player = client.getMyPlayer();
        final Specification spec = player.getSpecification();
        final Map<Location, List<Unit>> where = new HashMap<>();
        final List<AbstractUnit> forces = new ArrayList<>();
        for (Unit u : player.getUnitSet()) {
            if (!reportable(kind, u)) continue;
            where.computeIfAbsent(u.getLocation().up(), l -> new ArrayList<>()).add(u);
            AbstractUnit found = null;
            for (AbstractUnit au : forces) {
                if (AbstractUnit.matcher(u).test(au)) { found = au; break; }
            }
            if (found == null) forces.add(new AbstractUnit(u.getType(), u.getRole().getId(), 1));
            else found.addToNumber(1);
        }
        forces.sort(MOST_COMMON);
        final List<AbstractUnit> refUnits = new ArrayList<>();
        final List<AbstractUnit> all = player.getREFUnits();
        if (all != null) {
            for (AbstractUnit au : all) {
                if (reportableREF(kind, au, spec)) refUnits.add(au);
            }
            refUnits.sort(MOST_COMMON);
        }

        final List<Location> order = new ArrayList<>();
        for (Location l : where.keySet()) {
            if (!(l instanceof Colony || l instanceof Europe)) order.add(l);
        }
        order.sort(Comparator.comparing(Location::getId));
        if (player.getEurope() != null) order.add(0, player.getEurope());
        order.addAll(0, player.getSortedColonies(client.getClientOptions().getColonyComparator()));

        final List<String> places = new ArrayList<>();
        for (Location l : order) {
            final List<Unit> present = new ArrayList<>(where.getOrDefault(l, Collections.<Unit>emptyList()));
            if (present.isEmpty() && !kind.equals("military")) continue;
            present.sort(Unit.typeRoleComparator);
            final Tile tile = l.getTile();
            final List<String> units = new ArrayList<>();
            for (Unit u : present) {
                final List<String> goods = new ArrayList<>();
                final List<String> cargo = new ArrayList<>();
                if (u.isCarrier()) {
                    for (Goods g : u.getGoodsList()) {
                        goods.add(ColonyJson.goods(g.getType(), g.getAmount()).toString());
                    }
                    for (Unit c : u.getUnitList()) cargo.add(ColonyJson.unit(c).toString());
                }
                final String destination = (u.getDestination() == null) ? ""
                    : "\n" + Messages.message(u.getDestinationLabel());
                units.add(ColonyJson.unit(u)
                    .put("text", Messages.message(u.getLabel()) + destination)
                    .putRaw("goods", Json.array(goods))
                    .putRaw("cargo", Json.array(cargo)).toString());
            }
            final String linkKind = (l instanceof Colony) ? "colony"
                : (l instanceof Europe) ? "europe" : "tile";
            places.add(new Json().put("label", Messages.message(l.getLocationLabelFor(player)))
                .putRaw("link", new Json().put("kind", linkKind).put("id", l.getId())
                    .putRaw("at", (l instanceof Europe) ? "null" : MapJson.xy(tile)).toString())
                .putRaw("units", Json.array(units)).toString());
        }

        final List<String> mine = new ArrayList<>();
        for (AbstractUnit au : forces) {
            if (au.getNumber() > 0) mine.add(abstractUnit(au, spec));
        }
        final List<String> theirs = new ArrayList<>();
        for (AbstractUnit au : refUnits) theirs.add(abstractUnit(au, spec));
        return head(kind, "report" + Character.toUpperCase(kind.charAt(0)) + kind.substring(1) + "Action", null)
            .putRaw("forces", new Json()
                .put("name", Messages.message(player.getForcesLabel()))
                .putRaw("units", Json.array(mine)).toString())
            .putRaw("ref", theirs.isEmpty() ? "null" : new Json()
                .put("name", Messages.getName(player.getNation().getREFNation()))
                .putRaw("units", Json.array(theirs)).toString())
            .put("none", Messages.message("none"))
            .putRaw("locations", Json.array(places))
            .toString();
    }
}
