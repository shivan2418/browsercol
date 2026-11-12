package browsercol.web;

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
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.ExportData;
import net.sf.freecol.common.model.FreeColObject;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Feature;
import net.sf.freecol.common.model.FreeColSpecObjectType;
import net.sf.freecol.common.model.EuropeanNationType;
import net.sf.freecol.common.model.IndianNationType;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.NationType;
import net.sf.freecol.common.model.Scope;
import net.sf.freecol.common.model.ResourceType;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.HistoryEvent;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.NationSummary;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Region;
import net.sf.freecol.common.model.SettlementType;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TypeCountMap;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;


/**
 * The reports of FreeCol's Report menu as the Browser UI shows them, with
 * the information of the Swing panels: the classic colony report
 * (ReportClassicColonyPanel) and the compact one (ReportCompactColonyPanel,
 * in CompactColonyReport), the labour report (ReportLabourPanel and
 * ReportLabourDetailPanel) and the compact labour report
 * (CompactLabourReport, on LabourData), the military, naval and cargo
 * reports (ReportUnitPanel and its three subclasses), and the religion,
 * education, exploration, history, trade, production and requirements
 * reports, and the foreign affairs, native (indian) and Continental
 * Congress reports. Every payload is one object of the {@code report}
 * event, told apart by its {@code report} field: colony, compactColony, labour,
 * labourDetail, compactLabour, military, naval, cargo, religion,
 * education, exploration, history, trade, production, requirements,
 * foreign, indian or congress. Each has title, ok (the button's label)
 * and back, the report the button returns to (or null).
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

    /** A building: {id, name, keys}. */
    private static Json building(Building b) {
        return new Json().put("id", b.getId())
            .put("name", Messages.getName(b))
            .putRaw("keys", ObjectImages.json(b.getType()));
    }

    /**
     * The religion report (ReportReligiousPanel): for each kind of
     * immigration goods {type, name, keys, immigration, required,
     * production (all colonies' and Europe's), colonies: [{id, name,
     * building ({id, name, keys}), workers (the units in it)}]}, the
     * colonies whose building makes that goods.
     */
    static String religion(Player player) {
        final Specification spec = player.getSpecification();
        final List<String> kinds = new ArrayList<>();
        for (GoodsType gt : spec.getImmigrationGoodsTypeList()) {
            final List<String> colonies = new ArrayList<>();
            for (Colony colony : player.getColonyList()) {
                final List<WorkLocation> wls = colony.getWorkLocationsForProducing(gt);
                final WorkLocation wl = wls.isEmpty() ? null : wls.get(0);
                if (!(wl instanceof Building)) continue;
                final Building b = (Building)wl;
                colonies.add(new Json().put("id", colony.getId())
                    .put("name", colony.getName())
                    .putRaw("building", building(b).toString())
                    // BuildingPanel's ProductionLabel: what the building makes, and could.
                    .putRaw("production", ColonyJson.buildingProduction(colony, b))
                    .putRaw("workers", ColonyJson.unitList(b.getUnitList()))
                    .toString());
            }
            kinds.add(ColonyJson.goods(gt, 0)
                .put("immigration", player.getImmigration())
                .put("required", player.getImmigrationRequired())
                .put("production", player.getTotalImmigrationProduction())
                // ReportReligiousPanel's FreeColProgressBar: the crosses so far and next turn's towards the next migrant.
                .putRaw("bar", ColonyJson.progress(gt, player.getImmigrationRequired(),
                        player.getImmigration(), player.getTotalImmigrationProduction()).toString())
                .putRaw("colonies", Json.array(colonies))
                .toString());
        }
        return head("religion", "reportReligionAction", null)
            .putRaw("goods", Json.array(kinds)).toString();
    }

    /**
     * The education report (ReportEducationPanel): {headers: {teachers,
     * students}, colonies: [{id, name, building ({id, name, keys}), teachers
     * (the units that could teach there, least skilled first), students
     * (colonists who could learn from one of them, each with learns: what
     * they would become)}]}, one entry for each school.
     */
    static String education(Player player) {
        final List<String> colonies = new ArrayList<>();
        for (Colony colony : player.getColonyList()) {
            for (Building b : colony.getBuildings()) {
                if (!b.canTeach()) continue;
                final List<Unit> teachers = new ArrayList<>();
                for (Unit u : colony.getUnitList()) if (b.canAdd(u)) teachers.add(u);
                teachers.sort(Unit.increasingSkillComparator);
                final List<String> students = new ArrayList<>();
                for (Unit u : colony.getUnitList()) {
                    Unit teacher = null;
                    for (Unit t : teachers) {
                        if (u.canBeStudent(t)) { teacher = t; break; }
                    }
                    if (teacher == null) continue;
                    students.add(ColonyJson.unit(u).put("learns", Messages.message(
                        StringTemplate.template("report.education.tooltip")
                            .addNamed("%skill%", u.getTeachingType(teacher)))).toString());
                }
                colonies.add(new Json().put("id", colony.getId())
                    .put("name", colony.getName())
                    .putRaw("building", building(b).toString())
                    .putRaw("teachers", ColonyJson.unitList(teachers))
                    .putRaw("students", Json.array(students))
                    .toString());
            }
        }
        return head("education", "reportEducationAction", null)
            .putRaw("headers", new Json()
                .put("teachers", Messages.message("report.education.teachers"))
                .put("students", Messages.message("report.education.students"))
                .toString())
            .putRaw("colonies", Json.array(colonies)).toString();
    }

    /**
     * Discovered regions as ReportExplorationPanel sorts them: the earliest
     * turn first (its comparator is reversed twice), the most valuable first
     * within a turn.
     */
    private static final Comparator<Region> REGIONS
        = Comparator.comparingInt((Region r) -> r.getDiscoveredIn().getNumber()).reversed()
            .thenComparingInt(Region::getScoreValue).reversed();

    /**
     * The exploration report (ReportExplorationPanel): {headers: {name, type,
     * discoveredIn, discoveredBy, value}, regions: [{name, type, turn, by,
     * value}]}, the regions anyone has discovered.
     */
    static String exploration(Player player) {
        final List<Region> found = new ArrayList<>();
        for (Region r : player.getGame().getMap().getRegions()) {
            if (r.getDiscoveredIn() != null) found.add(r);
        }
        found.sort(REGIONS);
        final List<String> regions = new ArrayList<>();
        for (Region r : found) {
            regions.add(new Json().put("name", r.getName())
                .put("type", Messages.message(r.getType().getNameKey()))
                .put("turn", Messages.message(r.getDiscoveredIn().getLabel()))
                .put("by", Messages.message(r.getDiscoveredBy().getCountryLabel()))
                .put("value", r.getScoreValue()).toString());
        }
        return head("exploration", "reportExplorationAction", null)
            .putRaw("headers", new Json()
                .put("name", Messages.message("report.exploration.nameOfRegion"))
                .put("type", Messages.message("report.exploration.typeOfRegion"))
                .put("discoveredIn", Messages.message("report.exploration.discoveredIn"))
                .put("discoveredBy", Messages.message("report.exploration.discoveredBy"))
                .put("value", Messages.message("report.exploration.valueOfRegion"))
                .toString())
            .putRaw("regions", Json.array(regions)).toString();
    }

    /**
     * The history report (ReportHistoryPanel): {events: [{turn, text}]},
     * the player's history in the order it happened.
     */
    static String history(Player player) {
        final List<String> events = new ArrayList<>();
        for (HistoryEvent e : player.getHistory()) {
            events.add(new Json().put("turn", Messages.message(e.getTurn().getLabel()))
                .put("text", Messages.message(e)).toString());
        }
        return head("history", "reportHistoryAction", null)
            .putRaw("events", Json.array(events)).toString();
    }

    /**
     * The trade report (ReportTradePanel): {goods: [{type, name, keys, buy,
     * sell (the market's prices, or null)}] (the storable goods, whose
     * order every list below follows), labels: {unitsSold, beforeTaxes,
     * afterTaxes, cargoUnits, totalUnits, totalDelta, hasCustomHouse},
     * sold, beforeTaxes, afterTaxes (what the player has sold and earned of
     * each), cargo (in the player's ships), total (in ships and colonies),
     * delta (the colonies' net production), colonies: [{id, name, export
     * (it has a custom house), cells: [{amount (in store), production (net),
     * exported (the level it is exported at, or null), warning (why its
     * production is a problem, or null)}]}]}.
     */
    static String trade(Player player) {
        final Specification spec = player.getSpecification();
        final List<GoodsType> storable = spec.getStorableGoodsTypeList();
        final Market market = player.getMarket();
        final TypeCountMap<GoodsType> total = new TypeCountMap<>();
        final TypeCountMap<GoodsType> delta = new TypeCountMap<>();
        final TypeCountMap<GoodsType> cargo = new TypeCountMap<>();
        for (Unit unit : player.getUnitSet()) {
            if (!unit.isCarrier()) continue;
            for (Goods g : unit.getCompactGoodsList()) {
                cargo.incrementCount(g.getType(), g.getAmount());
                total.incrementCount(g.getType(), g.getAmount());
            }
        }
        final List<String> colonies = new ArrayList<>();
        for (Colony colony : player.getColonyList()) {
            // The production is cached; the report is read after the server's updates.
            colony.invalidateCache();
            for (GoodsType gt : spec.getGoodsTypeList()) {
                delta.incrementCount(gt, colony.getNetProductionOf(gt));
            }
            for (Goods g : colony.getCompactGoodsList()) {
                total.incrementCount(g.getType(), g.getAmount());
            }
            final List<String> cells = new ArrayList<>();
            for (GoodsType gt : storable) {
                final ExportData ed = colony.getExportData(gt);
                final List<String> warnings = new ArrayList<>();
                for (StringTemplate w : colony.getProductionWarnings(gt)) {
                    warnings.add(Messages.message(w));
                }
                cells.add(new Json().put("amount", colony.getGoodsCount(gt))
                    .put("production", colony.getNetProductionOf(gt))
                    .putRaw("exported", ed.getExported()
                        ? String.valueOf(ed.getExportLevel()) : "null")
                    .put("warning", warnings.isEmpty() ? null : String.join(" ", warnings))
                    .toString());
            }
            colonies.add(new Json().put("id", colony.getId())
                .put("name", colony.getName())
                .put("export", colony.hasAbility(Ability.EXPORT))
                .putRaw("cells", Json.array(cells)).toString());
        }
        final List<String> goods = new ArrayList<>();
        final List<String> sold = new ArrayList<>();
        final List<String> before = new ArrayList<>();
        final List<String> after = new ArrayList<>();
        final List<String> cargos = new ArrayList<>();
        final List<String> totals = new ArrayList<>();
        final List<String> deltas = new ArrayList<>();
        for (GoodsType gt : storable) {
            goods.add(new Json().put("type", gt.getId())
                .put("name", Messages.getName(gt))
                .putRaw("keys", ObjectImages.json(gt))
                .putRaw("buy", (market == null) ? "null"
                    : String.valueOf(market.getCostToBuy(gt)))
                .putRaw("sell", (market == null) ? "null"
                    : String.valueOf(market.getPaidForSale(gt)))
                .toString());
            sold.add(String.valueOf(player.getSales(gt)));
            before.add(String.valueOf(player.getIncomeBeforeTaxes(gt)));
            after.add(String.valueOf(player.getIncomeAfterTaxes(gt)));
            cargos.add(String.valueOf(cargo.getCount(gt)));
            totals.add(String.valueOf(total.getCount(gt)));
            deltas.add(String.valueOf(delta.getCount(gt)));
        }
        return head("trade", "reportTradeAction", null)
            .putRaw("goods", Json.array(goods))
            .putRaw("labels", new Json()
                .put("unitsSold", Messages.message("report.trade.unitsSold"))
                .put("beforeTaxes", Messages.message("report.trade.beforeTaxes"))
                .put("afterTaxes", Messages.message("report.trade.afterTaxes"))
                .put("cargoUnits", Messages.message("report.trade.cargoUnits"))
                .put("totalUnits", Messages.message("report.trade.totalUnits"))
                .put("totalDelta", Messages.message("report.trade.totalDelta"))
                .put("hasCustomHouse", Messages.message("report.trade.hasCustomHouse"))
                .toString())
            .putRaw("sold", Json.array(sold))
            .putRaw("beforeTaxes", Json.array(before))
            .putRaw("afterTaxes", Json.array(after))
            .putRaw("cargo", Json.array(cargos))
            .putRaw("total", Json.array(totals))
            .putRaw("delta", Json.array(deltas))
            .putRaw("colonies", Json.array(colonies)).toString();
    }

    /**
     * The production report (ReportProductionPanel): {labels: {selectGoods,
     * nothing, colony}, goods: [{type, name, keys, buildings: [{id, name,
     * keys}]}] (the goods that are not farmed, and the first level of each
     * building that makes them or has a modifier for them), colonies: [{id,
     * name, cells: [{amount (the colony's net production), buildings:
     * [workers or null, one for each building above: the units in the
     * colony's building, null if it has none]}]}], one cell for each goods
     * above}. The player picks the goods to show; the Browser UI does that.
     */
    static String production(Player player) {
        final Specification spec = player.getSpecification();
        final List<GoodsType> kinds = new ArrayList<>();
        final List<List<BuildingType>> makers = new ArrayList<>();
        final List<String> goods = new ArrayList<>();
        for (GoodsType gt : spec.getGoodsTypeList()) {
            if (gt.isFarmed()) continue;
            final List<BuildingType> bts = new ArrayList<>();
            for (BuildingType bt : spec.getBuildingTypeList()) {
                if (gt == bt.getProducedGoodsType() || bt.hasModifier(gt.getId())) {
                    final BuildingType first = bt.getFirstLevel();
                    if (!bts.contains(first)) bts.add(first);
                }
            }
            kinds.add(gt);
            makers.add(bts);
            final List<String> buildings = new ArrayList<>();
            for (BuildingType bt : bts) {
                buildings.add(new Json().put("id", bt.getId())
                    .put("name", Messages.getName(bt))
                    .putRaw("keys", ObjectImages.json(bt)).toString());
            }
            goods.add(new Json().put("type", gt.getId())
                .put("name", Messages.getName(gt))
                .putRaw("keys", ObjectImages.json(gt))
                .putRaw("buildings", Json.array(buildings)).toString());
        }
        final List<String> colonies = new ArrayList<>();
        for (Colony colony : player.getColonyList()) {
            colony.invalidateCache();
            final List<String> cells = new ArrayList<>();
            for (int i = 0; i < kinds.size(); i++) {
                final List<String> in = new ArrayList<>();
                for (BuildingType bt : makers.get(i)) {
                    final Building b = colony.getBuilding(bt);
                    in.add((b == null) ? "null" : ColonyJson.unitList(b.getUnitList()));
                }
                cells.add(new Json().put("amount", colony.getNetProductionOf(kinds.get(i)))
                    .putRaw("buildings", Json.array(in)).toString());
            }
            colonies.add(new Json().put("id", colony.getId())
                .put("name", colony.getName())
                .putRaw("cells", Json.array(cells)).toString());
        }
        return head("production", "reportProductionAction", null)
            .putRaw("labels", new Json()
                .put("selectGoods", Messages.message("report.production.selectGoods"))
                .put("nothing", Messages.message("nothing"))
                .put("colony", Messages.message("Colony"))
                .toString())
            .putRaw("goods", Json.array(goods))
            .putRaw("colonies", Json.array(colonies)).toString();
    }

    /**
     * The requirements report (ReportRequirementsPanel), as {@link
     * Requirements} describes: {colonies: [{id, name, items, met}]}.
     */
    static String requirements(Player player) {
        return head("requirements", "reportRequirementsAction", null)
            .putRaw("colonies", Requirements.of(player)).toString();
    }

    /** The concepts of the Colopedia (ConceptDetailPanel), in its order. */
    private static final String[] CONCEPTS = {"taxes", "efficiency", "education",
        "fortification", "independence", "ref", "interventionForce"};

    /**
     * A message's text without its HTML: paragraphs and breaks become new
     * lines and a link to an entry becomes {@code [[id|text]]}, which the
     * Browser UI shows as a link. A link to an action ({@code http:///action/NAME}, as the
     * efficiency concept has to the difficulty report) becomes {@code [[action/NAME|text]]}.
     */
    static String plain(String html) {
        return html.replaceAll("(?is)<a\\s+href=\"http:///id/([^\"]+)\"[^>]*>(.*?)</a>", "[[$1|$2]]")
            .replaceAll("(?is)<a\\s+href=\"http:///action/([^\"]+)\"[^>]*>(.*?)</a>", "[[action/$1|$2]]")
            .replaceAll("(?i)</p>|<br\\s*/?>", "\n")
            .replaceAll("<[^>]*>", "")
            .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
            .replaceAll("\n{3,}", "\n\n").trim();
    }

    private static String array(List<Json> items) {
        final List<String> list = new ArrayList<>();
        for (Json j : items) list.add(j.toString());
        return Json.array(list);
    }

    /** A fact of an entry: its label and value, and the entries it links to ({@link #ref}). */
    private static Json fact(String labelKey, String value, List<Json> refs) {
        return new Json().put("label", Messages.message(labelKey)).put("value", value)
            .putRaw("refs", array(refs));
    }

    private static Json fact(String labelKey, String value) {
        return fact(labelKey, value, List.of());
    }

    /** A link to an entry: {id, name, keys, note}; the note is e.g. an amount. */
    private static Json ref(FreeColObject o, String note) {
        return new Json().put("id", o.getId()).put("name", Messages.getName(o.getId()))
            .putRaw("keys", ObjectImages.json(o)).put("note", note);
    }

    private static List<Json> goodsRefs(List<AbstractGoods> goods) {
        final List<Json> refs = new ArrayList<>();
        for (AbstractGoods g : goods) refs.add(ref(g.getType(), String.valueOf(g.getAmount())));
        return refs;
    }

    private static Json entry(FreeColObject o, String group, List<Json> facts) {
        return new Json().put("id", o.getId()).put("name", Messages.getName(o.getId()))
            .put("group", group)
            .putRaw("keys", ObjectImages.json(o))
            .put("text", describe(o))
            .putRaw("facts", array(facts));
    }

    /**
     * An entry's description, plain: empty if the entry has none, as for a nation or a
     * nation type, which Swing shows no description for (the message key must not show).
     */
    private static String describe(FreeColObject o) {
        final String key = Messages.descriptionKey(o.getId());
        return Messages.containsKey(key) ? plain(Messages.message(key)) : "";
    }

    private static Json section(String id, List<Json> entries) {
        return new Json().put("id", id)
            .put("name", Messages.message("colopediaAction." + id + ".name"))
            .putRaw("entries", array(entries));
    }

    /** A modifier's value, as ModifierFormat shows it (+25.00%, ×2.00, +3.00). */
    private static String modifier(Modifier m) {
        return WebGUI.modifierValue(m, null);
    }

    /**
     * A feature's name and, in brackets, its scopes: the label ModifierFormat.getFeatureAsString
     * gives a nation type's ability or modifier, without its stray colon.
     */
    static String feature(Feature f) {
        final List<String> scopes = new ArrayList<>();
        if (f.hasScope()) {
            for (Scope sc : f.getScopes().toArray(Scope[]::new)) {
                if (sc != null) scopes.add(sc.getFeatureString());
            }
        }
        return Messages.getName(f.getId())
            + (scopes.isEmpty() ? "" : " (" + String.join(", ", scopes) + ")");
    }

    private static List<Json> terrain(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (TileType t : spec.getTileTypeList()) {
            final List<Json> facts = new ArrayList<>();
            facts.add(fact("colopedia.terrain.movementCost", String.valueOf(t.getBasicMoveCost() / 3)));
            final List<String> defence = new ArrayList<>();
            t.getDefenceModifiers().forEach(m -> defence.add(modifier(m)));
            facts.add(fact("colopedia.terrain.defenseBonus",
                defence.isEmpty() ? Messages.message("none") : String.join(", ", defence)));
            final List<Json> resources = new ArrayList<>();
            for (ResourceType r : t.getResourceTypeValues()) resources.add(ref(r, null));
            if (!resources.isEmpty()) facts.add(fact("colopedia.terrain.resource", "", resources));
            final List<Json> unattended = new ArrayList<>();
            t.getPossibleProduction(true).filter(AbstractGoods::isPositive)
                .forEach(g -> unattended.add(ref(g.getType(), String.valueOf(g.getAmount()))));
            if (!unattended.isEmpty()) facts.add(fact("colopedia.terrain.unattendedProduction", "", unattended));
            final List<Json> colonist = new ArrayList<>();
            t.getPossibleProduction(false).filter(AbstractGoods::isPositive)
                .forEach(g -> colonist.add(ref(g.getType(), String.valueOf(g.getAmount()))));
            if (!colonist.isEmpty()) facts.add(fact("colopedia.terrain.colonistProduction", "", colonist));
            out.add(entry(t, null, facts));
        }
        return out;
    }

    private static GoodsType goodsOrNull(Specification spec, String id) {
        for (GoodsType g : spec.getGoodsTypeList()) if (g.getId().equals(id)) return g;
        return null;
    }

    private static List<Json> resources(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (ResourceType r : spec.getResourceTypeList()) {
            final List<Json> bonus = new ArrayList<>();
            for (Modifier m : r.getSortedModifiers()) {
                final GoodsType g = goodsOrNull(spec, m.getId());
                if (g == null) continue;
                // As ResourcesDetailPanel: the scopes (the tiles the bonus is for) follow the value.
                String note = modifier(m);
                if (m.hasScope()) {
                    final List<String> scopes = new ArrayList<>();
                    for (Scope sc : m.getScopes().toArray(Scope[]::new)) {
                        if (sc.getType() == null) continue;
                        final FreeColSpecObjectType t = spec.getType(sc.getType());
                        if (t != null) scopes.add(Messages.getName(t));
                    }
                    if (!scopes.isEmpty()) note += " (" + String.join(", ", scopes) + ")";
                }
                bonus.add(ref(g, note));
            }
            out.add(entry(r, null, bonus.isEmpty() ? List.of()
                : List.of(fact("colopedia.resource.bonusProduction", "", bonus))));
        }
        return out;
    }

    private static List<Json> goods(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (GoodsType g : spec.getGoodsTypeList()) {
            final List<Json> facts = new ArrayList<>();
            if (g.isFarmed()) facts.add(fact("colopedia.goods.isFarmed", Messages.message("yes")));
            if (g.getInputType() != null) {
                facts.add(fact("colopedia.goods.madeFrom", "", List.of(ref(g.getInputType(), null))));
            }
            final List<Json> makes = new ArrayList<>();
            for (GoodsType other : spec.getGoodsTypeList()) {
                if (other.getInputType() == g) makes.add(ref(other, null));
            }
            if (!makes.isEmpty()) facts.add(fact("colopedia.goods.makes", "", makes));
            if (g.isBreedable()) {
                facts.add(fact("colopedia.goods.breedingNumber", String.valueOf(g.getBreedingNumber())));
            }
            out.add(entry(g, null, facts));
        }
        return out;
    }

    private static List<Json> units(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (UnitType u : spec.getUnitTypeList()) {
            final List<Json> facts = new ArrayList<>();
            facts.add(fact("colopedia.unit.offensivePower", String.valueOf((int)u.getOffence())));
            facts.add(fact("colopedia.unit.defensivePower", String.valueOf((int)u.getDefence())));
            facts.add(fact("colopedia.unit.movement", String.valueOf(u.getMovement() / 3)));
            if (u.getSpace() > 0) facts.add(fact("colopedia.unit.capacity", String.valueOf(u.getSpace())));
            if (u.getPrice() > 0) facts.add(fact("colopedia.unit.price", String.valueOf(u.getPrice())));
            if (u.getSkill() > 0) facts.add(fact("colopedia.unit.skill", String.valueOf(u.getSkill())));
            if (!u.getRequiredGoodsList().isEmpty()) {
                facts.add(fact("colopedia.unit.goodsRequired", "", goodsRefs(u.getRequiredGoodsList())));
            }
            final List<Json> teaches = new ArrayList<>();
            for (BuildingType b : spec.getBuildingTypeList()) {
                if (b.hasAbility(net.sf.freecol.common.model.Ability.TEACH)
                    && b.getMinimumSkill() <= u.getSkill() && u.getSkill() <= b.getMaximumSkill()) {
                    teaches.add(ref(b, null));
                }
            }
            if (!teaches.isEmpty()) facts.add(fact("colopedia.unit.school", "", teaches));
            // As UnitDetailPanel: the natives that teach the skill, what the unit requires
            // and its production bonuses.
            if (u.getSkill() > 0) {
                final List<Json> natives = new ArrayList<>();
                for (IndianNationType nt : spec.getIndianNationTypes()) {
                    for (net.sf.freecol.common.util.RandomChoice<UnitType> c : nt.getSkills()) {
                        if (c.getObject() == u) {
                            natives.add(ref(nt, null));
                            break;
                        }
                    }
                }
                if (!natives.isEmpty()) facts.add(fact("colopedia.unit.natives", "", natives));
            }
            final List<String> required = new ArrayList<>();
            final List<Json> providers = new ArrayList<>();
            for (Map.Entry<String, Boolean> a : u.getRequiredAbilities().entrySet()) {
                required.add(Messages.getName(a.getKey()));
                for (FreeColSpecObjectType t : spec.getTypesProviding(a.getKey(), a.getValue())) {
                    providers.add(ref(t, null));
                }
            }
            if (!required.isEmpty()) {
                facts.add(fact("colopedia.unit.requirements", String.join(", ", required), providers));
            }
            final List<Modifier> bonuses = new ArrayList<>();
            for (GoodsType g : spec.getGoodsTypeList()) u.getModifiers(g.getId()).forEach(bonuses::add);
            bonuses.sort(Modifier.ascendingModifierIndexComparator);
            if (!bonuses.isEmpty()) {
                final List<Json> bonusRefs = new ArrayList<>();
                for (Modifier m : bonuses) bonusRefs.add(ref(goodsOrNull(spec, m.getId()), modifier(m)));
                facts.add(new Json().put("label", Messages.message(StringTemplate
                        .template("colopedia.unit.productionBonus").addAmount("%number%", bonuses.size())))
                    .put("value", "").putRaw("refs", array(bonusRefs)));
            }
            out.add(entry(u, u.isNaval() ? Messages.message("model.ability.navalUnit.name") : "Land unit", facts));
        }
        return out;
    }

    private static List<Json> buildings(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (BuildingType b : spec.getBuildingTypeList()) {
            final List<Json> facts = new ArrayList<>();
            if (b.getRequiredPopulation() > 0) {
                facts.add(fact("colopedia.buildings.requires", Messages.message(StringTemplate
                    .template("colopedia.buildings.requiredPopulation")
                    .addAmount("%number%", b.getRequiredPopulation()))));
            }
            if (b.getUpgradesFrom() != null) {
                facts.add(fact("colopedia.buildings.requires", "", List.of(ref(b.getUpgradesFrom(), null))));
            }
            if (!b.getRequiredGoodsList().isEmpty()) {
                facts.add(fact("colopedia.buildings.cost", "", goodsRefs(b.getRequiredGoodsList())));
            }
            final List<Json> made = new ArrayList<>();
            for (net.sf.freecol.common.model.ProductionType pt : b.getAvailableProductionTypes(false)) {
                for (AbstractGoods g : pt.getOutputList()) made.add(ref(g.getType(), String.valueOf(g.getAmount())));
            }
            if (!made.isEmpty()) facts.add(fact("colopedia.buildings.production", "", made));
            if (b.getWorkPlaces() > 0) {
                facts.add(fact("colopedia.buildings.workplaces", String.valueOf(b.getWorkPlaces())));
            }
            if (b.isAutomaticBuild()) {
                facts.add(fact("colopedia.buildings.notes", Messages.message("colopedia.buildings.autoBuilt")));
            }
            out.add(entry(b, null, facts));
        }
        return out;
    }

    private static List<Json> fathers(Specification spec) {
        final List<Json> out = new ArrayList<>();
        for (FoundingFather f : spec.getFoundingFathers()) {
            out.add(entry(f, null, List.of(fact("colopedia.type", Messages.message(f.getTypeKey())))));
        }
        return out;
    }

    private static List<Json> nations(Specification spec, Game game) {
        final List<Json> out = new ArrayList<>();
        final List<Nation> shown = new ArrayList<>(spec.getEuropeanNations());
        shown.addAll(spec.getIndianNations());
        for (Nation n : shown) {
            final List<Json> facts = new ArrayList<>();
            facts.add(fact("colopedia.nation.ruler", n.getRulerName()));
            if (n.getType() != null) {
                facts.add(fact("colopedia.nation.defaultAdvantage", "", List.of(ref(n.getType(), null))));
                // As NationDetailPanel: the type its player has in the game, else the default.
                NationType current = n.getType();
                if (game != null) {
                    for (Player p : game.getLivePlayers().toArray(Player[]::new)) {
                        if (p.getNation() == n && p.getNationType() != null) current = p.getNationType();
                    }
                }
                facts.add(fact("colopedia.nation.currentAdvantage", "", List.of(ref(current, null))));
            }
            out.add(entry(n, null, facts));
        }
        return out;
    }

    /**
     * The nation types, as NationTypeDetailPanel lists them: the European ones
     * (not the one only the options use), the Royal Expeditionary Force and the native ones.
     * A European type has its starting units, abilities and modifiers; a native
     * one its aggression, settlements, regions and skills.
     */
    private static List<Json> nationTypes(Specification spec) {
        final List<Json> out = new ArrayList<>();
        final List<EuropeanNationType> european = new ArrayList<>(spec.getVisibleEuropeanNationTypes());
        european.addAll(spec.getREFNationTypes());
        for (EuropeanNationType t : european) {
            final List<Json> facts = new ArrayList<>();
            final List<Json> start = new ArrayList<>();
            for (AbstractUnit a : t.getStartingUnits()) {
                start.add(ref(a.getType(spec), String.valueOf(a.getNumber())));
            }
            if (!start.isEmpty()) facts.add(fact("colopedia.nationType.units", "", start));
            final List<String> abilities = new ArrayList<>();
            for (Ability a : t.getSortedAbilities()) {
                if (a.getValue()) abilities.add(feature(a));
            }
            if (!abilities.isEmpty()) facts.add(fact("abilities", String.join("; ", abilities)));
            final List<String> modifiers = new ArrayList<>();
            final List<Json> production = new ArrayList<>();
            for (Modifier m : t.getSortedModifiers()) {
                final GoodsType g = goodsOrNull(spec, m.getId());
                if (g != null) production.add(ref(g, modifier(m)));
                else modifiers.add(feature(m) + ": " + modifier(m));
            }
            if (!modifiers.isEmpty() || !production.isEmpty()) {
                facts.add(fact("modifiers", String.join("; ", modifiers), production));
            }
            out.add(entry(t, Messages.message("colopedia.europeanNationTypes"), facts));
        }
        for (IndianNationType t : spec.getIndianNationTypes()) {
            final List<Json> facts = new ArrayList<>();
            facts.add(fact("colopedia.nationType.aggression",
                Messages.message("colopedia.nationType." + t.getAggression().getKey())));
            facts.add(fact("colopedia.nationType.settlementNumber",
                Messages.message("colopedia.nationType." + t.getNumberOfSettlements().getKey())));
            if (t.getCapitalType() != null) {
                facts.add(fact("colopedia.nationType.typeOfSettlements", Messages.getName(t.getCapitalType())));
            }
            final List<String> regions = new ArrayList<>();
            for (String r : t.getRegions()) regions.add(Messages.getName(r));
            facts.add(fact("colopedia.nationType.regions", String.join(", ", regions)));
            final List<Json> skills = new ArrayList<>();
            for (net.sf.freecol.common.util.RandomChoice<UnitType> c : t.getSkills()) {
                skills.add(ref(c.getObject(), null));
            }
            if (!skills.isEmpty()) facts.add(fact("colopedia.nationType.skills", "", skills));
            out.add(entry(t, Messages.message("colopedia.nativeNationTypes"), facts));
        }
        return out;
    }

    private static List<Json> concepts() {
        final List<Json> out = new ArrayList<>();
        for (String c : CONCEPTS) {
            final String id = "colopedia.concepts." + c;
            out.add(new Json().put("id", id).put("name", Messages.message(id + ".name"))
                .put("group", (String)null).putRaw("keys", "[]")
                .put("text", plain(Messages.message(id + ".description")))
                .putRaw("facts", "[]"));
        }
        return out;
    }

    /**
     * The Colopedia (ColopediaPanel): {select (the entry to open on, or
     * null), sections: [{id, name, entries: [{id, name, group (the
     * sub-category's label or null), keys, text (the description, plain, with
     * {@code [[id|text]]} for a link), facts: [{label, value, refs: [{id,
     * name, keys, note}]}]}]}]}, in FreeCol's order: terrain, resources,
     * goods, units, buildings, fathers, nations, nationTypes and concepts.
     * It is read from the specification and does not depend on the game.
     *
     * @param spec The specification.
     * @param select The id of the entry to open on, or null.
     */
    static String colopedia(Specification spec, String select) {
        return colopedia(spec, select, null);
    }

    /**
     * The Colopedia in a game: as {@link #colopedia(Specification, String)}, with
     * each nation's current advantage that its player has in the game.
     *
     * @param game The game, or null before one.
     */
    static String colopedia(Specification spec, String select, Game game) {
        final List<Json> sections = new ArrayList<>();
        sections.add(section("terrain", terrain(spec)));
        sections.add(section("resources", resources(spec)));
        sections.add(section("goods", goods(spec)));
        sections.add(section("units", units(spec)));
        sections.add(section("buildings", buildings(spec)));
        sections.add(section("fathers", fathers(spec)));
        sections.add(section("nations", nations(spec, game)));
        sections.add(section("nationTypes", nationTypes(spec)));
        sections.add(section("concepts", concepts()));
        return new Json().put("report", "colopedia")
            .put("title", Messages.message("colopedia"))
            .put("ok", Messages.message("ok"))
            .put("back", (String)null)
            .put("select", select)
            .putRaw("sections", array(sections)).toString();
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
                        goods.add(Boycotts.mark(ColonyJson.goods(g.getType(), g.getAmount()), u, g.getType(), g.getAmount()).toString());
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

    /**
     * The foreign affairs report (ReportForeignAffairPanel): {labels,
     * notice, nations: [{id, name, keys, stance, stanceKind (war, cease_fire,
     * peace, alliance or uncontacted, for the colour), colonies, units, military,
     * naval, gold, fathers, tax, sol}]} for each European nation the
     * server gives a summary of (as the panel skips the rest). The
     * fathers, tax and sol are null where the summary gives -1: what we
     * have not learnt of the nation.
     */
    static String foreign(FreeColClient client) {
        final Player player = client.getMyPlayer();
        final List<String> nations = new ArrayList<>();
        for (Player enemy : player.getGame().getLiveEuropeanPlayerList()) {
            final NationSummary ns = client.getInGameController().nationSummary(enemy);
            if (ns == null) continue;
            nations.add(new Json().put("id", enemy.getId())
                .put("name", Messages.message(enemy.getCountryLabel()))
                .putRaw("keys", ObjectImages.json(enemy.getNation()))
                .put("stance", Messages.message(ns.getStance().getNameKey()))
                .put("stanceKind", ns.getStance().toString().toLowerCase(java.util.Locale.ROOT))
                .put("colonies", ns.getNumberOfSettlements())
                .put("units", ns.getNumberOfUnits())
                .put("military", ns.getMilitaryStrength())
                .put("naval", ns.getNavalStrength())
                .put("gold", ns.getGold())
                .putRaw("fathers", optional(ns.getFoundingFathers()))
                .putRaw("tax", optional(ns.getTax()))
                .putRaw("sol", optional(ns.getSoL()))
                .toString());
        }
        return head("foreign", "reportForeignAction", null)
            .putRaw("labels", new Json()
                .put("stance", Messages.message("report.foreignAffair.stance"))
                .put("colonies", Messages.message("report.foreignAffair.numberOfColonies"))
                .put("units", Messages.message("report.foreignAffair.numberOfUnits"))
                .put("military", Messages.message("report.foreignAffair.militaryStrength"))
                .put("naval", Messages.message("report.foreignAffair.navalStrength"))
                .put("gold", Messages.message("gold"))
                .put("fathers", Messages.message("report.foreignAffair.congress"))
                .put("tax", Messages.message("tax"))
                .put("sol", Messages.message("report.foreignAffair.sonsOfLiberty"))
                .toString())
            .put("notice", Messages.message("report.foreignAffair.notice"))
            .putRaw("nations", Json.array(nations)).toString();
    }

    /** A summary figure the panel shows only when it is not negative. */
    private static String optional(int n) {
        return (n >= 0) ? Integer.toString(n) : "null";
    }

    /** A label and its image keys: {text, keys} (keys null for text only). */
    private static String labelled(String text, FreeColObject display) {
        return new Json().put("text", text)
            .putRaw("keys", (display == null) ? "null" : ObjectImages.json(display))
            .toString();
    }

    /**
     * The native affairs report (ReportIndianPanel): {labels, none, tribes:
     * [{id, name, keys (the capital's settlement), chieftain, kind,
     * settlements ("known / all"), tension, rows: [{id (the tile), at, name,
     * mission (the missionary's label and image, or null), alarm, skill
     * ({text, keys}), hated, wanted ([{text, keys}])}]}]} for each live
     * tribe we have contacted; a tribe with no known settlement has no
     * rows. A settlement's skill and wanted goods are shown only once it is
     * visited, as the panel does.
     */
    static String indian(FreeColClient client) {
        final Player player = client.getMyPlayer();
        final List<String> tribes = new ArrayList<>();
        for (Player opponent : player.getGame().getLiveNativePlayerList()) {
            if (!player.hasContacted(opponent)) continue;
            final NationSummary ns = client.getInGameController().nationSummary(opponent);
            final List<IndianSettlement> known = opponent.getIndianSettlementList();
            final List<IndianSettlement> ordered = new ArrayList<>();
            for (IndianSettlement is : known) {
                if (is.isCapital()) ordered.add(0, is); else ordered.add(is);
            }
            final List<String> rows = new ArrayList<>();
            for (IndianSettlement is : ordered) {
                // The client's copy of a settlement it has not seen may have no tile (#459).
                if (is.getTile() == null) continue;
                final boolean visited = is.hasVisited(player);
                final boolean contacted = is.hasContacted(player);
                // FreeCol appends "*" for a capital and "$" for a settlement worth scouting to the name; the
                // page shows them as labelled tags instead, so they are sent as flags.
                final String name = Messages.message(is.getLocationLabelFor(player));
                final boolean capital = is.getTile().isExplored() && is.isCapital();
                final boolean scout = is.worthScouting(player);
                final Unit missionary = is.getMissionary();
                final UnitType skill = is.getLearnableSkill();
                final List<String> wanted = new ArrayList<>();
                final int n = visited ? is.getWantedGoodsCount() : 1;
                for (int i = 0; i < n; i++) {
                    final GoodsType gt = visited ? is.getWantedGoods(i) : null;
                    wanted.add(labelled(Messages.message(is.getWantedGoodsLabel(i, player).get(0)), gt));
                }
                rows.add(new Json().put("id", is.getTile().getId())
                    .putRaw("at", MapJson.xy(is.getTile()))
                    .put("name", name)
                    .put("capital", capital)
                    .put("scout", scout)
                    .putRaw("mission", (missionary == null) ? "null"
                        : labelled(Messages.message(missionary.getLabel(Unit.UnitLabelType.NATIONAL)),
                            missionary.getType()))
                    .put("alarm", Messages.message(StringTemplate.key(is.getAlarmLevelKey(player))))
                    .putRaw("skill", labelled(Messages.message(is.getLearnableSkillLabel(visited)),
                        (visited && skill != null) ? skill : null))
                    .put("hated", Messages.message(is.getMostHatedLabel(contacted)))
                    .putRaw("wanted", Json.array(wanted))
                    .toString());
            }
            final SettlementType capital = opponent.getNationType().getCapitalType();
            tribes.add(new Json().put("id", opponent.getId())
                .put("name", Messages.message(opponent.getNationLabel()))
                .putRaw("keys", Json.array(List.of(Json.quote("image.tileitem." + capital.getId()))))
                .put("chieftain", opponent.getName())
                .put("kind", Messages.getName(capital))
                .put("settlements", known.size() + " / "
                    + ((ns == null) ? "?" : String.valueOf(ns.getNumberOfSettlements())))
                .put("tension", Messages.message(StringTemplate.template("report.indian.tensionStance")
                    .addNamed("%tension%", opponent.getTension(player))
                    .addNamed("%stance%", opponent.getStance(player))))
                .putRaw("rows", Json.array(rows))
                .toString());
        }
        return head("indian", "reportIndianAction", null)
            .putRaw("labels", new Json()
                .put("chieftain", Messages.message("report.indian.chieftain"))
                .put("kind", Messages.message("report.indian.typeOfSettlements"))
                .put("settlements", Messages.message("report.indian.numberOfSettlements"))
                .put("tension", Messages.message("report.indian.tribeTension"))
                .put("none", Messages.message("report.indian.noKnownSettlements"))
                .put("capital", Messages.message("capital"))
                // No FreeCol string says this; FreeCol shows only a "$".
                .put("scout", "Not yet visited by a scout")
                .putRaw("columns", Json.array(List.of(
                    Json.quote(Messages.message("settlement")),
                    Json.quote(Messages.message("mission")),
                    Json.quote(Messages.message("report.indian.tension")),
                    Json.quote(Messages.message("skillTaught")),
                    Json.quote(Messages.message("report.indian.mostHated")),
                    Json.quote(Messages.message("report.indian.tradeInterests")))))
                .toString())
            .putRaw("tribes", Json.array(tribes)).toString();
    }

    /**
     * The Continental Congress report (ReportContinentalCongressPanel):
     * {labels, current, fathers}. Current is the father being recruited,
     * with its liberty progress ({id, name, description, keys, cost,
     * liberty, bars: [{type, name, keys, needed, available, produced, turns}]},
     * a FreeColProgressBar for each liberty goods, whose produced is the
     * colonies' net production, next turn's gain), or null. Each of
     * the fathers is {id, name, description, keys, kind (the type's name),
     * state: elected, recruiting or available, status (localized), turn
     * (when elected, or null)}, grouped by kind in the specification's order.
     */
    static String congress(Player player) {
        final Specification spec = player.getSpecification();
        final FoundingFather now = player.getCurrentFather();
        final Map<String, Turn> elected = player.getElectionTurns();
        final List<String> libertyGoods = new ArrayList<>();
        for (GoodsType gt : spec.getLibertyGoodsTypeList()) {
            int total = 0;
            for (Colony c : player.getColonyList()) total += c.getNetProductionOf(gt);
            libertyGoods.add(ColonyJson.progress(gt, player.getTotalFoundingFatherCost(),
                player.getLiberty(), total).toString());
        }
        final List<String> fathers = new ArrayList<>();
        for (FoundingFather.FoundingFatherType type : FoundingFather.FoundingFatherType.values()) {
            for (FoundingFather f : spec.getFoundingFathers()) {
                if (f.getType() != type) continue;
                final boolean has = player.hasFather(f);
                final Turn turn = has ? elected.get(Messages.nameKey(f)) : null;
                final String state = has ? "elected" : (f == now) ? "recruiting" : "available";
                final String status = (turn != null)
                    ? Messages.message(StringTemplate.template("report.continentalCongress.elected")
                        .addStringTemplate("%turn%", turn.getLabel()))
                    : Messages.message((f == now) ? "report.continentalCongress.recruiting"
                        : "report.continentalCongress.available");
                fathers.add(new Json().put("id", f.getId())
                    .put("name", Messages.getName(f))
                    .put("description", Messages.getDescription(f))
                    .putRaw("keys", Json.array(List.of(Json.quote("image.flavor." + f.getId()))))
                    .put("kind", Messages.message(type.getTypeKey()))
                    .put("state", state)
                    .put("status", status)
                    .putRaw("turn", (turn == null) ? "null" : Json.quote(Messages.message(turn.getLabel())))
                    .toString());
            }
        }
        return head("congress", "reportCongressAction", null)
            .putRaw("labels", new Json()
                .put("recruiting", Messages.message("report.continentalCongress.recruiting"))
                .put("none", Messages.message("report.continentalCongress.none"))
                .toString())
            .putRaw("current", (now == null) ? "null" : new Json().put("id", now.getId())
                .put("name", Messages.getName(now))
                .put("description", Messages.getDescription(now))
                .putRaw("keys", Json.array(List.of(Json.quote("image.flavor." + now.getId()))))
                .put("cost", player.getTotalFoundingFatherCost())
                .put("liberty", player.getLiberty())
                .putRaw("bars", Json.array(libertyGoods)).toString())
            .putRaw("fathers", Json.array(fathers)).toString();
    }
}
