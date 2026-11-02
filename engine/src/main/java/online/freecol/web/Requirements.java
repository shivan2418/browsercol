package online.freecol.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Colony.TileImprovementSuggestion;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.ProductionInfo;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TypeCountMap;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;


/**
 * The requirements report, as ReportRequirementsPanel checks each colony:
 * {colonies: [{id, name, items, met}]}. An item is one paragraph of advice,
 * {text, colonies: [{id, name, info}] (colonies it links, info being
 * "(3)" or "")}, the lines Swing shows one under another; met is the
 * text that says the colony's requirements are met, or null if it has any
 * item.
 *
 * <p>Where Swing's surplus line gives the colony being checked its own
 * surplus for every colony it lists, this gives each listed colony its own.
 */
final class Requirements {

    private final Specification spec;
    private final List<Colony> colonies;
    private final Map<Colony, TypeCountMap<UnitType>> unitCount = new HashMap<>();
    private final Map<Colony, Set<UnitType>> canTrain = new HashMap<>();

    private Requirements(Player player) {
        this.spec = player.getSpecification();
        this.colonies = player.getColonyList();
        for (Colony colony : this.colonies) {
            // The production is cached; the report is read after the server's updates.
            colony.invalidateCache();
            final TypeCountMap<UnitType> count = new TypeCountMap<>();
            final Set<UnitType> train = new HashSet<>();
            for (Unit unit : colony.getUnitList()) {
                count.incrementCount(unit.getType(), 1);
                if (colony.canTrain(unit.getType())) train.add(unit.getType());
            }
            this.unitCount.put(colony, count);
            this.canTrain.put(colony, train);
        }
    }

    static String of(Player player) {
        final Requirements r = new Requirements(player);
        final List<String> out = new ArrayList<>();
        for (Colony colony : r.colonies) out.add(r.check(colony));
        return Json.array(out);
    }

    private static String item(String text, List<String> links) {
        return new Json().put("text", text)
            .putRaw("colonies", Json.array(links)).toString();
    }

    private static String link(Colony colony, String info) {
        return new Json().put("id", colony.getId()).put("name", colony.getName())
            .put("info", info).toString();
    }

    private List<String> links(List<Colony> list) {
        final List<String> out = new ArrayList<>();
        for (Colony c : list) out.add(link(c, ""));
        return out;
    }

    private String check(Colony colony) {
        final List<String> items = new ArrayList<>();
        final Set<UnitType> missingExpertWarning = new HashSet<>();
        final Set<UnitType> badAssignmentWarning = new HashSet<>();
        final Set<GoodsType> productionWarning = new HashSet<>();

        for (Unit expert : colony.getUnitList()) {
            if (expert.getSkillLevel() <= 0) continue;
            final Unit better = colony.getBetterExpert(expert);
            if (better != null && !badAssignmentWarning.contains(expert.getType())) {
                items.add(badAssignment(colony, expert, better));
                badAssignmentWarning.add(expert.getType());
            }
        }
        for (ColonyTile colonyTile : colony.getColonyTiles()) {
            for (Unit unit : colonyTile.getUnitList()) {
                final GoodsType workType = unit.getWorkType();
                final UnitType expert = this.spec.getExpertForProducing(workType);
                if (this.unitCount.get(colony).getCount(expert) == 0
                    && missingExpertWarning.add(expert)) {
                    expertWarning(items, colony, workType, expert);
                }
            }
        }
        for (Building building : colony.getBuildings()) {
            for (AbstractGoods output : building.getOutputs().collect(java.util.stream.Collectors.toList())) {
                final GoodsType goodsType = output.getType();
                final UnitType expert = this.spec.getExpertForProducing(goodsType);
                if (goodsType != null && expert != null
                    && !building.getUnitList().isEmpty()
                    && !missingExpertWarning.contains(expert)
                    && this.unitCount.get(colony).getCount(expert) == 0) {
                    // Post-independence, special goods requirements diminish.
                    if (!colony.goodsUseful(goodsType)) continue;
                    expertWarning(items, colony, goodsType, expert);
                    missingExpertWarning.add(expert);
                }
                final ProductionInfo info = building.getProductionInfo();
                if (goodsType != null && info != null && !info.atMaximumProduction()
                    && productionWarning.add(goodsType)) {
                    for (AbstractGoods in : building.getInputs().collect(java.util.stream.Collectors.toList())) {
                        productionWarning(items, colony, goodsType, in.getType());
                    }
                }
            }
        }
        final List<TileImprovementSuggestion> suggestions = colony.getTileImprovementSuggestions();
        for (TileImprovementSuggestion tis : suggestions) {
            if (tis.tileImprovementType == null) {
                tileWarning(items, colony, "report.requirements.exploreTile", tis.tile);
            } else {
                final String key = "report.requirements.tile."
                    + tis.tileImprovementType.getSuffix();
                if (Messages.containsKey(key)) tileWarning(items, colony, key, tis.tile);
            }
        }
        final boolean met = suggestions.isEmpty() && missingExpertWarning.isEmpty()
            && badAssignmentWarning.isEmpty() && productionWarning.isEmpty();
        return new Json().put("id", colony.getId()).put("name", colony.getName())
            .putRaw("items", Json.array(items))
            .put("met", met ? Messages.message("report.requirements.met") : null)
            .toString();
    }

    private void tileWarning(List<String> items, Colony colony, String key, Tile tile) {
        if (key == null || !Messages.containsKey(key)) return;
        items.add(item(Messages.message(StringTemplate.template(key)
            .addStringTemplate("%location%", tile.getColonyTileLocationLabel(colony))),
            List.of()));
    }

    private String badAssignment(Colony colony, Unit expert, Unit nonExpert) {
        return item(Messages.message(StringTemplate
            .template("report.requirements.badAssignment")
            .addName("%colony%", colony.getName())
            .addName("%expert%", Messages.getName(expert.getType()))
            .addName("%expertWork%", Messages.message(expert.getWorkType().getWorkingAsKey()))
            .addName("%nonExpert%", Messages.getName(nonExpert.getType()))
            .addName("%nonExpertWork%",
                Messages.message(nonExpert.getWorkType().getWorkingAsKey()))),
            List.of());
    }

    private void expertWarning(List<String> items, Colony c, GoodsType goodsType,
                               UnitType workType) {
        items.add(item(Messages.message(StringTemplate
            .template("report.requirements.noExpert")
            .addName("%colony%", c.getName())
            .addName("%goods%", goodsType)
            .addName("%unit%", workType)), List.of()));
        final List<Colony> misused = new ArrayList<>();
        final List<Colony> several = new ArrayList<>();
        final List<Colony> trainers = new ArrayList<>();
        for (Colony colony : this.colonies) {
            for (Unit unit : colony.getUnitList()) {
                final GoodsType expertise = unit.getType().getExpertProduction();
                if (expertise == goodsType && unit.getSkillLevel() > 0) {
                    if (unit.getLocation() instanceof Building) {
                        if (!((Building)unit.getLocation()).canProduce(goodsType, unit.getType())) {
                            misused.add(colony);
                        }
                    } else if (expertise != unit.getWorkType()) {
                        misused.add(colony);
                    }
                }
            }
            if (this.unitCount.get(colony).getCount(workType) > 1) several.add(colony);
            if (this.canTrain.get(colony).contains(workType)) trainers.add(colony);
        }
        if (!misused.isEmpty()) {
            items.add(item(Messages.message(StringTemplate
                .template("report.requirements.misusedExperts")
                .addName("%unit%", workType)
                .add("%work%", goodsType.getWorkingAsKey())), links(misused)));
        }
        if (!several.isEmpty()) {
            items.add(item(Messages.message(StringTemplate
                .template("report.requirements.severalExperts")
                .addName("%unit%", workType)), links(several)));
        }
        if (!trainers.isEmpty()) {
            items.add(item(Messages.message(StringTemplate
                .template("report.requirements.canTrainExperts")
                .addName("%unit%", workType)), links(trainers)));
        }
    }

    private void productionWarning(List<String> items, Colony colony, GoodsType output,
                                   GoodsType input) {
        items.add(item(Messages.message(StringTemplate
            .template("report.requirements.missingGoods")
            .addName("%colony%", colony.getName())
            .addNamed("%goods%", output)
            .addNamed("%input%", input)), List.of()));
        final List<String> surplus = new ArrayList<>();
        for (Colony col : this.colonies) {
            final int amount = col.getAdjustedNetProductionOf(input);
            if (amount > 0) surplus.add(link(col, " (" + amount + ")"));
        }
        if (!surplus.isEmpty()) {
            items.add(item(Messages.message(StringTemplate
                .template("report.requirements.surplus")
                .addNamed("%goods%", input)), surplus));
        }
    }
}
