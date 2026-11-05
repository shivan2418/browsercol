package browsercol.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Colony.TileImprovementSuggestion;
import net.sf.freecol.common.model.Constants;
import net.sf.freecol.common.model.ExportData;
import net.sf.freecol.common.model.GoodsContainer;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.ProductionInfo;
import net.sf.freecol.common.model.Region;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.model.WorkLocation.Suggestion;
import net.sf.freecol.common.resources.ResourceManager;


/**
 * The compact colony report (ReportCompactColonyPanel) as the Browser UI
 * shows it: a table with a row for each colony, the colonies of each
 * continent together, followed by a summary row when there are several.
 *
 * <p>The payload is the {@code compactColony} report: columns: [{label, tip,
 * keys (an image, or null), left, dim}], one for each column of the table,
 * in order: the colony, its size, the units it can add and remove, the
 * tiles to explore, the tiles each improvement would help, the net
 * production of each goods type, the turns to a new colonist, what it is
 * making, and the units it could use. groups: [{rows: [{id, cells}],
 * summary: cells or null}], where cells is one {items} for each column and
 * an item is {text, tone (alarm, warn, plain, export or good), tip, bold,
 * keys (or null), link (a colony's id, or null)}.
 */
final class CompactColonyReport {

    private CompactColonyReport() {}

    /** The status of a colony's production of one goods type. */
    private enum Status {
        FAIL,        // Negative production and below low alarm level
        BAD,         // Negative production
        NONE,        // No production at all
        ZERO,        // Production == consumption
        GOOD,        // Positive production
        EXPORT,      // Positive production and exporting
        EXCESS,      // Positive production and above high alarm level
        OVERFLOW,    // Positive production and above capacity
        PRODUCTION,  // Positive production but could produce more
        CONSUMPTION  // Positive production but could consume more
    }

    /** What a colony makes of a goods type, how it is doing, and a number for the tip. */
    private static final class Production {
        int amount;
        Status status;
        int extra;

        Production(int amount, Status status, int extra) {
            this.amount = amount;
            this.status = status;
            this.extra = extra;
        }

        void accumulate(Production other) {
            this.amount += other.amount;
            this.status = (this.status == Status.NONE && other.status == Status.NONE) ? Status.NONE
                : (this.amount < 0) ? Status.BAD
                : (this.amount > 0) ? Status.GOOD
                : Status.ZERO;
            this.extra = 0;
        }
    }

    /** What the report says of one colony. */
    private static final class Summary {
        final Colony colony;
        final List<TileImprovementSuggestion> tiles;
        final boolean famine;
        /** Turns to a new colonist if positive, none if zero, -turns-1 to starvation if negative. */
        final int newColonist;
        final int bonus;
        final int unitCount;
        final int unitsToAdd;
        final int unitsToRemove;
        final Map<GoodsType, Production> production = new HashMap<>();
        /** Teacher units, in the order found, and the turns they take to complete. */
        final Map<Unit, Integer> teachers = new LinkedHashMap<>();
        /** The types of units that are idle, or not at their speciality. */
        final List<UnitType> couldWork = new ArrayList<>();
        final Map<UnitType, Suggestion> improve = new HashMap<>();
        final Map<UnitType, Suggestion> want = new HashMap<>();
        final BuildableType build;
        final int completeTurns;
        final AbstractGoods needed;

        Summary(Colony colony, List<GoodsType> goodsTypes) {
            this.colony = colony;
            final Specification spec = colony.getSpecification();
            this.tiles = colony.getTileImprovementSuggestions();
            final int starve = colony.getStarvationTurns();
            if (starve < 0) {
                this.famine = false;
                this.newColonist = colony.getNewColonistTurns();
            } else {
                this.famine = starve <= Colony.FAMINE_TURNS;
                this.newColonist = -starve - 1;
            }
            this.bonus = colony.getProductionBonus();
            this.unitCount = colony.getUnitCount();
            this.unitsToAdd = colony.getUnitsToAdd();
            this.unitsToRemove = colony.getUnitsToRemove();
            for (GoodsType gt : goodsTypes) produce(gt);

            // The units that are not working: those standing on the colony's tile, and those in a
            // work location with no work.
            final List<Unit> notWorking = new ArrayList<>();
            for (Unit u : colony.getTile().getUnitList()) {
                if (u.getState() != Unit.UnitState.FORTIFIED && u.getState() != Unit.UnitState.SENTRY) {
                    notWorking.add(u);
                }
            }
            for (WorkLocation wl : (Iterable<WorkLocation>)colony.getAvailableWorkLocations()::iterator) {
                if (!wl.canBeWorked()) continue;
                if (wl.canTeach()) {
                    for (Unit u : wl.getUnitList()) {
                        teachers.put(u, u.getNeededTurnsOfTraining() - u.getTurnsOfTraining());
                    }
                    continue;
                }
                for (Unit u : wl.getUnitList()) {
                    if (u.getTeacher() == null && u.getWorkType() == null) notWorking.add(u);
                }
                for (Map.Entry<Unit, Suggestion> e : wl.getSuggestions().entrySet()) {
                    final Suggestion s = e.getValue();
                    add((e.getKey() == null) ? this.want : this.improve,
                        spec.getExpertForProducing(s.goodsType), s);
                }
            }
            for (Unit u : notWorking) {
                final WorkLocation wl = u.getWorkLocation();
                if (wl != null && (wl.getWorkFor(u) == null || wl.getWorkFor(u) != u.getWorkType())) {
                    couldWork.add(u.getType());
                }
            }
            this.build = colony.getCurrentlyBuilding();
            if (this.build == null) {
                this.completeTurns = -1;
                this.needed = null;
            } else {
                final AbstractGoods need = new AbstractGoods();
                this.completeTurns = colony.getTurnsToComplete(build, need);
                this.needed = (this.completeTurns < 0) ? need : null;
            }
        }

        private static void add(Map<UnitType, Suggestion> into, UnitType expert, Suggestion s) {
            if (s == null || expert == null) return;
            final Suggestion now = into.get(expert);
            if (now == null || now.amount < s.amount) into.put(expert, s);
        }

        private void produce(GoodsType goodsType) {
            final ExportData exportData = colony.getExportData(goodsType);
            final int adjustment = colony.getWarehouseCapacity() / GoodsContainer.CARGO_SIZE;
            final int low = exportData.getLowLevel() * adjustment;
            final int high = exportData.getHighLevel() * adjustment;
            final int amount = colony.getGoodsCount(goodsType);
            final int p = colony.getAdjustedNetProductionOf(goodsType);

            Status status;
            int extra = 0;
            if (p < 0) {
                status = (amount < low) ? Status.FAIL : Status.BAD;
                extra = -amount / p + 1;
            } else if (p == 0 && !colony.isProducing(goodsType)) {
                status = colony.isConsuming(goodsType) ? Status.FAIL : Status.NONE;
            } else if (p == 0) {
                status = Status.ZERO;
                for (WorkLocation wl : colony.getWorkLocationsForProducing(goodsType)) {
                    final ProductionInfo pi = colony.getProductionInfo(wl);
                    if (pi == null) continue;
                    final AbstractGoods deficit = find(pi.getConsumptionDeficit(), goodsType);
                    if (deficit != null) {
                        status = Status.CONSUMPTION;
                        extra = deficit.getAmount();
                        break;
                    }
                }
            } else if (exportData.getExported()) {
                status = Status.EXPORT;
                extra = exportData.getExportLevel();
            } else if (goodsType.limitIgnored()) {
                status = Status.GOOD;
            } else if (amount + p > colony.getWarehouseCapacity()) {
                status = Status.OVERFLOW;
                extra = amount + p - colony.getWarehouseCapacity();
            } else if (amount >= high) {
                status = Status.EXCESS;
                extra = (colony.getWarehouseCapacity() - amount) / p;
            } else {
                status = Status.GOOD;
                for (WorkLocation wl : colony.getWorkLocationsForProducing(goodsType)) {
                    final ProductionInfo pi = colony.getProductionInfo(wl);
                    if (pi == null) continue;
                    final AbstractGoods deficit = find(pi.getProductionDeficit(), goodsType);
                    if (deficit != null) {
                        status = Status.PRODUCTION;
                        extra = deficit.getAmount();
                        break;
                    }
                }
            }
            this.production.put(goodsType, new Production(p, status, extra));
        }

        private static AbstractGoods find(List<AbstractGoods> goods, GoodsType type) {
            for (AbstractGoods g : goods) if (g.getType() == type) return g;
            return null;
        }
    }

    /** The goods the report is of: those that are stored and not trade goods, and liberty. */
    private static boolean reported(GoodsType gt) {
        return (gt.isStorable() && !gt.isTradeGoods()) || gt.isLibertyType();
    }

    /** The template of a message id, or null if there is none. */
    private static StringTemplate template(String id) {
        return Messages.containsKey(id) ? StringTemplate.template(id) : null;
    }

    /** The template of a message's description, or null. */
    private static StringTemplate describe(String id) {
        return template(Messages.descriptionKey(id));
    }

    private static String say(StringTemplate t) {
        return (t == null) ? "" : Messages.message(t);
    }

    /** A message if the id is one, as a label; the id itself if not. */
    private static String label(String id) {
        return Messages.containsKey(id) ? Messages.message(id) : id;
    }

    /** One item of a cell. */
    private static final class Item {
        final String text;
        final String tone;
        final String tip;
        boolean bold;
        String keys = "null";
        String link = null;

        Item(String text, String tone, StringTemplate tip) {
            this(text, tone, say(tip));
        }

        Item(String text, String tone, String tip) {
            this.text = text;
            this.tone = tone;
            this.tip = tip;
        }

        Item bold(boolean b) { this.bold = b; return this; }
        Item keys(String k) { this.keys = k; return this; }
        Item link(String id) { this.link = id; return this; }

        String json() {
            return new Json().put("text", text).put("tone", tone).put("tip", tip)
                .put("bold", bold).putRaw("keys", keys).put("link", link).toString();
        }
    }

    private static String cell(List<Item> items) {
        final List<String> out = new ArrayList<>();
        for (Item i : items) out.add(i.json());
        return new Json().putRaw("items", Json.array(out)).toString();
    }

    private static String cell(Item item) {
        return cell((item == null) ? new ArrayList<Item>() : List.of(item));
    }

    private static String column(String label, StringTemplate tip, String keys, boolean left, boolean dim) {
        return new Json().put("label", label).put("tip", say(tip)).putRaw("keys", keys)
            .put("left", left).put("dim", dim).toString();
    }

    /** The compact colony report of the client's player. */
    static String of(FreeColClient client) {
        final Player player = client.getMyPlayer();
        final Specification spec = player.getSpecification();
        final Market market = player.getMarket();

        // The colonies by continent, each continent's by the colony order, and the continents by their first.
        final Map<Integer, List<Colony>> continents = new HashMap<>();
        for (Colony c : player.getColonyList()) {
            // Colonies that have been abandoned but are still on the list are left out.
            if (c.getUnitCount() > 0) {
                continents.computeIfAbsent(c.getTile().getContiguity(), k -> new ArrayList<>()).add(c);
            }
        }
        final Comparator<Colony> order = client.getClientOptions().getColonyComparator();
        final List<List<Colony>> groups = new ArrayList<>();
        for (List<Colony> l : continents.values()) {
            l.sort(order);
            groups.add(l);
        }
        groups.sort(Comparator.comparing(l -> l.get(0), order));

        final List<GoodsType> goodsTypes = new ArrayList<>();
        for (GoodsType gt : spec.getGoodsTypeList()) if (reported(gt)) goodsTypes.add(gt);
        goodsTypes.sort(GoodsType.goodsTypeComparator);
        final List<TileImprovementType> improvements = new ArrayList<>();
        for (TileImprovementType ti : spec.getTileImprovementTypeList()) if (!ti.isNatural()) improvements.add(ti);

        final List<String> columns = new ArrayList<>();
        columns.add(column(label("report.colony.name.header"), describe("report.colony.name"), "null", true, false));
        columns.add(column(label("report.colony.size.header"), describe("report.colony.size"), "null", false, false));
        columns.add(column(label("report.colony.grow.header"), describe("report.colony.grow"), "null", false, false));
        columns.add(column(label("report.colony.shrink.header"), describe("report.colony.shrink"), "null", false, false));
        columns.add(column(label("report.colony.explore.header"), describe("report.colony.explore"), "null", false, false));
        for (TileImprovementType ti : improvements) {
            final String key = "report.colony.tile." + ti.getSuffix() + ".header";
            columns.add(column(label(key), describe(key), "null", false, false));
        }
        for (GoodsType gt : goodsTypes) {
            columns.add(column("", template("report.colony.production.header").addNamed("%goods%", gt),
                ObjectImages.json(gt), false, market != null && market.getArrears(gt) > 0));
        }
        final UnitType defaultType = spec.getDefaultUnitType(player);
        columns.add(column("", describe("report.colony.birth"), ObjectImages.json(defaultType), false, false));
        columns.add(column(label("report.colony.making.header"), describe("report.colony.making"), "null", true, false));
        columns.add(column(label("report.colony.improve.header"), describe("report.colony.improve"), "null", true, false));

        final List<String> out = new ArrayList<>();
        for (List<Colony> continent : groups) {
            final List<Summary> summaries = new ArrayList<>();
            final List<String> rows = new ArrayList<>();
            for (Colony c : continent) {
                // The production is cached; the report is read after the server's updates, as ColonyJson is.
                c.invalidateCache();
                final Summary s = new Summary(c, goodsTypes);
                summaries.add(s);
                rows.add(new Json().put("id", c.getId())
                    .putRaw("cells", Json.array(colony(s, goodsTypes, improvements, defaultType)))
                    .toString());
            }
            out.add(new Json().putRaw("rows", Json.array(rows))
                .putRaw("summary", (continent.size() > 1)
                    ? Json.array(combined(summaries, goodsTypes, improvements)) : "null")
                .toString());
        }
        return new Json().put("report", "compactColony")
            .put("title", Messages.message(Messages.nameKey("reportColonyAction")))
            .put("ok", Messages.message("ok"))
            .put("back", null)
            .putRaw("columns", Json.array(columns))
            .putRaw("groups", Json.array(out)).toString();
    }

    /** One of the report's glyphs (annotation.church), or nothing if the resources have none. */
    private static String glyph(String key) {
        try {
            return (ResourceManager.getStringResource(key, false) == null) ? ""
                : ResourceManager.getString(key);
        } catch (RuntimeException e) {
            return "";
        }
    }

    private static String tone(int bonus) {
        return (bonus <= -2) ? "alarm" : (bonus == -1) ? "warn" : (bonus == 0) ? "plain"
            : (bonus == 1) ? "export" : "good";
    }

    /** The cells of a colony's row. */
    private static List<String> colony(Summary s, List<GoodsType> goodsTypes,
                                       List<TileImprovementType> improvements, UnitType defaultType) {
        final Colony colony = s.colony;
        final String id = colony.getId();
        final String name = colony.getName();
        final List<String> cells = new ArrayList<>();

        // The colony, marked with what defends it, whether it is by the sea, and whether it exports.
        String marks = "";
        final StringTemplate what = StringTemplate.label(",");
        Building b = colony.getStockade();
        if (b == null) {
            marks += glyph("annotation.unfortified");
            what.add(Messages.message("report.colony.annotation.unfortified"));
        } else {
            marks += glyph("annotation." + b.getType().getSuffix());
            what.add(Messages.message(b.getLabel()));
        }
        if (!colony.getTile().isCoastland()) {
            marks += glyph("annotation.inland");
            what.add(Messages.message("report.colony.annotation.inland"));
        } else if ((b = colony.getWorkLocationWithAbility(Ability.PRODUCE_IN_WATER, Building.class)) == null) {
            marks += glyph("annotation.coastal");
            what.add(Messages.message("report.colony.annotation.coastal"));
        } else {
            marks += glyph("annotation." + b.getType().getSuffix());
            what.add(Messages.message(b.getLabel()));
        }
        if ((b = colony.getWorkLocationWithAbility(Ability.EXPORT, Building.class)) != null) {
            marks += "*";
            what.add(Messages.message(b.getLabel()));
        }
        cells.add(cell(new Item(name + marks, tone(s.bonus),
            Messages.message(StringTemplate.label(": ").add(name).add(Messages.message(what))))
            .bold(s.famine).link(id)));

        cells.add(cell(new Item(Integer.toString(s.unitCount), "good", describe("report.colony.size")).link(id)));

        cells.add(cell((s.unitsToAdd > 0)
            ? new Item(Integer.toString(s.unitsToAdd), "good", describe("report.colony.growing")
                .addName("%colony%", name).addAmount("%amount%", s.unitsToAdd)).link(id) : null));

        cells.add(cell((s.unitsToRemove > 0)
            ? new Item(Integer.toString(s.unitsToRemove), (s.bonus < 0) ? "alarm" : "good",
                describe("report.colony.shrinking").addName("%colony%", name)
                    .addAmount("%amount%", s.unitsToRemove)).link(id) : null));

        int n = 0;
        for (TileImprovementSuggestion t : s.tiles) if (t.isExploration()) n++;
        cells.add(cell((n > 0)
            ? new Item(Integer.toString(n), "alarm", describe("report.colony.exploring")
                .addName("%colony%", name).addAmount("%amount%", n)).link(id) : null));

        for (TileImprovementType ti : improvements) {
            n = 0;
            boolean center = false;
            TileImprovementSuggestion only = null;
            for (TileImprovementSuggestion t : s.tiles) {
                if (t.tileImprovementType != ti) continue;
                n++;
                if (only == null) only = t;
                if (t.tile == colony.getTile()) center = true;
            }
            if (n == 0) { cells.add(cell((Item)null)); continue; }
            String tone = "alarm";
            final StringTemplate tip;
            if (n == 1) {
                for (Unit u : only.tile.getUnitList()) {
                    if (u.getState() == Unit.UnitState.IMPROVING && u.getWorkImprovement() != null
                        && u.getWorkImprovement().getType() == only.tileImprovementType) {
                        tone = "warn"; // Work is underway
                    }
                }
                tip = describe("report.colony.tile." + ti.getSuffix() + ".specific")
                    .addName("%colony%", name)
                    .addStringTemplate("%location%", only.tile.getColonyTileLocationLabel(colony));
            } else {
                tip = describe("report.colony.tile." + ti.getSuffix())
                    .addName("%colony%", name).addAmount("%amount%", n);
            }
            cells.add(cell(new Item(Integer.toString(n), tone, tip).bold(center).link(id)));
        }

        for (GoodsType gt : goodsTypes) {
            final Production gp = s.production.get(gt);
            final String tone;
            final StringTemplate tip;
            switch (gp.status) {
            case FAIL:
                tone = "alarm";
                tip = describe("report.colony.production.low").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", -gp.amount).addAmount("%turns%", gp.extra);
                break;
            case BAD: tone = "warn"; tip = plain(name, gt, gp); break;
            case NONE: tone = null; tip = null; break;
            case ZERO: tone = "plain"; tip = plain(name, gt, gp); break;
            case GOOD: tone = "good"; tip = plain(name, gt, gp); break;
            case EXPORT:
                tone = "export";
                tip = describe("report.colony.production.export").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", gp.amount).addAmount("%export%", gp.extra);
                break;
            case EXCESS:
                tone = "warn";
                tip = describe("report.colony.production.high").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", gp.amount).addAmount("%turns%", gp.extra);
                break;
            case OVERFLOW:
                tone = "alarm";
                tip = describe("report.colony.production.waste").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", gp.amount).addAmount("%waste%", gp.extra);
                break;
            case PRODUCTION:
                tone = "warn";
                tip = describe("report.colony.production.maxProduction").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", gp.amount).addAmount("%more%", gp.extra);
                break;
            case CONSUMPTION:
                tone = "warn";
                tip = describe("report.colony.production.maxConsumption").addName("%colony%", name)
                    .addNamed("%goods%", gt).addAmount("%amount%", gp.amount).addAmount("%more%", gp.extra);
                break;
            default:
                throw new IllegalStateException("Bogus status: " + gp.status);
            }
            cells.add(cell((tone == null) ? null
                : new Item(Integer.toString(gp.amount), tone, tip).link(id)));
        }

        // A new colonist's arrival or a famine warning.
        if (s.newColonist > 0) {
            cells.add(cell(new Item(Integer.toString(s.newColonist), "good",
                describe("report.colony.arriving").addName("%colony%", name)
                    .addNamed("%unit%", defaultType).addAmount("%turns%", s.newColonist)).link(id)));
        } else if (s.newColonist < 0) {
            cells.add(cell(new Item(Integer.toString(-s.newColonist), s.famine ? "alarm" : "warn",
                describe("report.colony.starving").addName("%colony%", name)
                    .addAmount("%turns%", -s.newColonist)).bold(s.famine).link(id)));
        } else {
            cells.add(cell((Item)null));
        }

        // What it is making, and the units it teaches.
        final List<Item> making = new ArrayList<>();
        if (s.build != null) {
            final int turns = s.completeTurns;
            final String bname = Messages.getName(s.build);
            if (turns == Constants.UNDEFINED) {
                making.add(new Item(bname, "warn", describe("report.colony.making.noconstruction")
                    .addName("%colony%", name)).link(id));
            } else if (turns >= 0) {
                making.add(new Item(bname + " " + turns, "good", describe("report.colony.making.constructing")
                    .addName("%colony%", name).addNamed("%buildable%", s.build)
                    .addAmount("%turns%", turns)).link(id));
            } else {
                final int until = -(turns + 1);
                making.add(new Item(bname + " " + until, "alarm", describe("report.colony.making.blocking")
                    .addName("%colony%", name).addAmount("%amount%", s.needed.getAmount())
                    .addNamed("%goods%", s.needed.getType()).addNamed("%buildable%", s.build)
                    .addAmount("%turns%", until)).bold(until == 0).link(id));
            }
        }
        int empty = 0;
        final Building school = colony.getWorkLocationWithAbility(Ability.TEACH, Building.class);
        if (school != null) empty = school.getType().getWorkPlaces();
        final List<Map.Entry<Unit, Integer>> teachers = new ArrayList<>(s.teachers.entrySet());
        teachers.sort(Map.Entry.<Unit, Integer>comparingByValue().reversed());
        for (Map.Entry<Unit, Integer> e : teachers) {
            final Unit u = e.getKey();
            final StringTemplate who = u.getLabel(Unit.UnitLabelType.NATIONAL);
            if (e.getValue() <= 0) {
                making.add(new Item("0", "alarm", describe("report.colony.making.noteach")
                    .addName("%colony%", name).addStringTemplate("%teacher%", who))
                    .keys(ObjectImages.json(u.getType())).link(id));
            } else {
                making.add(new Item(Integer.toString(e.getValue()), "plain",
                    describe("report.colony.making.educating").addName("%colony%", name)
                        .addStringTemplate("%teacher%", who).addAmount("%turns%", e.getValue()))
                    .keys(ObjectImages.json(u.getType())).link(id));
            }
            empty--;
        }
        for (int vacant = empty; vacant > 0; vacant--) {
            making.add(new Item("", "plain", describe("report.colony.making.educationVacancy")
                .addName("%colony%", name).addAmount("%number%", empty))
                .keys(ObjectImages.json(defaultType)).link(id));
        }
        cells.add(cell(making));

        // The units that could be upgraded, followed by the units that could be added.
        final List<Item> better = new ArrayList<>();
        if (!s.improve.isEmpty() || !s.want.isEmpty()) {
            final Map<UnitType, Suggestion> want = new HashMap<>(s.want);
            // Prefer to suggest an improvement over an addition.
            for (UnitType ut : s.improve.keySet()) want.remove(ut);
            better.addAll(units(s.improve, s, id));
            better.add(new Item("/", "plain", ""));
            better.addAll(units(want, s, id));
        }
        cells.add(cell(better));
        return cells;
    }

    private static StringTemplate plain(String colony, GoodsType gt, Production gp) {
        return describe("report.colony.production").addName("%colony%", colony)
            .addNamed("%goods%", gt).addAmount("%amount%", gp.amount);
    }

    /** Buttons for suggested units, those with the most to gain first; bold for a unit type that is idle in the colony. */
    private static List<Item> units(Map<UnitType, Suggestion> suggestions, Summary s, String id) {
        final List<UnitType> types = new ArrayList<>(suggestions.keySet());
        types.sort(Comparator.comparing(ut -> suggestions.get(ut), Suggestion.descendingAmountComparator));
        final List<Item> out = new ArrayList<>();
        for (UnitType type : types) {
            final Suggestion g = suggestions.get(type);
            final boolean present = s.couldWork.contains(type);
            final StringTemplate tip = (g.oldType == null)
                ? describe("report.colony.wanting").addName("%colony%", s.colony.getName())
                    .addNamed("%unit%", type).addStringTemplate("%location%", g.workLocation.getLabel())
                    .addNamed("%goods%", g.goodsType).addAmount("%amount%", g.amount)
                : describe("report.colony.improving").addName("%colony%", s.colony.getName())
                    .addNamed("%oldUnit%", g.oldType).addNamed("%unit%", type)
                    .addStringTemplate("%location%", g.workLocation.getLabel())
                    .addNamed("%goods%", g.goodsType).addAmount("%amount%", g.amount);
            out.add(new Item(Integer.toString(g.amount), present ? "good" : "plain", tip)
                .bold(present).keys(ObjectImages.json(type)).link(id));
        }
        return out;
    }

    private static String number(double d) {
        return Double.toString(Math.round(d * 10) / 10.0);
    }

    /** The cells of the summary row of the colonies of a continent. */
    private static List<String> combined(List<Summary> summaries, List<GoodsType> goodsTypes,
                                         List<TileImprovementType> improvements) {
        final Map<Region, Integer> regions = new LinkedHashMap<>();
        final List<TileImprovementSuggestion> tiles = new ArrayList<>();
        int units = 0, toAdd = 0, toRemove = 0, teacherLen = 0, improveLen = 0;
        double newColonist = 0.0;
        final Map<GoodsType, Production> production = new HashMap<>();
        final Map<UnitType, Integer> teachers = new LinkedHashMap<>();
        final Map<UnitType, Integer> improve = new LinkedHashMap<>();
        final Map<GoodsType, Double> needed = new LinkedHashMap<>();
        for (Summary s : summaries) {
            regions.merge(s.colony.getTile().getRegion(), 1, Integer::sum);
            tiles.addAll(s.tiles);
            if (s.newColonist > 0) newColonist += s.newColonist;
            units += s.unitCount;
            toAdd += s.unitsToAdd;
            if (s.bonus < 0) toRemove += s.unitsToRemove;
            for (Map.Entry<GoodsType, Production> e : s.production.entrySet()) {
                final Production p = production.get(e.getKey());
                if (p == null) {
                    production.put(e.getKey(), new Production(e.getValue().amount, e.getValue().status,
                        e.getValue().extra));
                } else {
                    p.accumulate(e.getValue());
                }
            }
            teacherLen = Math.max(teacherLen, s.teachers.size());
            for (Unit u : s.teachers.keySet()) teachers.merge(u.getType(), 1, Integer::sum);
            improveLen = Math.max(improveLen, s.improve.size() + s.want.size());
            for (UnitType ut : s.improve.keySet()) improve.merge(ut, 1, Integer::sum);
            for (UnitType ut : s.want.keySet()) improve.merge(ut, 1, Integer::sum);
            if (s.needed != null && s.needed.getType().isStorable()) {
                needed.merge(s.needed.getType(), (double)s.needed.getAmount() / s.completeTurns, Double::sum);
            }
        }
        newColonist = Math.round(newColonist / summaries.size());

        final List<String> cells = new ArrayList<>();
        // The region with most of the colonies.
        Region top = null;
        int most = -1;
        for (Map.Entry<Region, Integer> e : regions.entrySet()) {
            if (e.getValue() > most) { top = e.getKey(); most = e.getValue(); }
        }
        cells.add(cell(new Item((top == null) ? "" : Messages.message(top.getLabel()), "plain",
            describe("report.colony.name.summary"))));
        cells.add(cell(new Item(Integer.toString(units), "good", describe("report.colony.size.summary"))));
        cells.add(cell(new Item(Integer.toString(toAdd), "good", describe("report.colony.growing.summary"))));
        cells.add(cell(new Item(Integer.toString(toRemove), (toRemove > 0) ? "alarm" : "good",
            describe("report.colony.shrinking.summary"))));
        final List<Tile> explore = new ArrayList<>();
        for (TileImprovementSuggestion t : tiles) {
            if (t.isExploration() && !explore.contains(t.tile)) explore.add(t.tile);
        }
        cells.add(cell(explore.isEmpty() ? null : new Item(Integer.toString(explore.size()), "alarm",
            describe("report.colony.exploring.summary"))));
        for (TileImprovementType ti : improvements) {
            final List<Tile> helped = new ArrayList<>();
            for (TileImprovementSuggestion t : tiles) {
                if (t.tileImprovementType == ti && !helped.contains(t.tile)) helped.add(t.tile);
            }
            cells.add(cell(helped.isEmpty() ? null : new Item(Integer.toString(helped.size()), "alarm",
                describe("report.colony.tile." + ti.getSuffix() + ".summary"))));
        }
        for (GoodsType gt : goodsTypes) {
            final Production gp = production.get(gt);
            final String tone;
            switch (gp.status) {
            case BAD: tone = "warn"; break;
            case NONE: tone = null; break;
            case ZERO: tone = "plain"; break;
            // A colony's other statuses (failing, exporting) are not told apart in the sum.
            default: tone = "good"; break;
            }
            cells.add(cell((tone == null) ? null : new Item(Integer.toString(gp.amount), tone,
                describe("report.colony.production.summary").addNamed("%goods%", gt))));
        }
        cells.add(cell(new Item(Integer.toString((int)newColonist), (newColonist < 0) ? "warn" : "good",
            describe("report.colony.arriving.summary"))));

        // The goods the unsatisfied buildings need each turn, then the units to graduate.
        final List<Item> making = new ArrayList<>();
        final List<Map.Entry<GoodsType, Double>> rates = new ArrayList<>(needed.entrySet());
        rates.sort(Map.Entry.<GoodsType, Double>comparingByValue().reversed());
        for (Map.Entry<GoodsType, Double> e : rates) {
            making.add(new Item(number(e.getValue()) + " " + Messages.getName(e.getKey()), "plain",
                describe("report.colony.making.summary").addNamed("%goods%", e.getKey())));
        }
        making.addAll(types(teachers, Math.max(3, teacherLen), "report.colony.making.educating.summary"));
        cells.add(cell(making));
        cells.add(cell(types(improve, improveLen, "report.colony.improving.summary")));
        return cells;
    }

    /** The most common unit types of a count, as items, at most max of them. */
    private static List<Item> types(Map<UnitType, Integer> counts, int max, String tip) {
        final List<Map.Entry<UnitType, Integer>> entries = new ArrayList<>(counts.entrySet());
        entries.sort(Map.Entry.<UnitType, Integer>comparingByValue().reversed());
        final List<Item> out = new ArrayList<>();
        for (Map.Entry<UnitType, Integer> e : entries) {
            out.add(new Item(Integer.toString(e.getValue()), "plain", describe(tip))
                .keys(ObjectImages.json(e.getKey())));
            if (out.size() >= max) break;
        }
        return out;
    }
}
