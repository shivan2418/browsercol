package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.NationOptions.Advantages;
import net.sf.freecol.common.model.ResourceType;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.TileType;


/**
 * The Colopedia's entries as data for the Browser UI. Only terrain so far:
 * {@link #terrain} is what TerrainDetailPanel shows for a tile type.
 */
final class Colopedia {

    private Colopedia() {}

    /** The specifications read for {@link #before}, by rules id. */
    private static final java.util.Map<String, Specification> SPECS = new java.util.HashMap<>();

    /**
     * The Colopedia before a game, as the start screen's Nation and Advantage
     * buttons open it (PlayersTable). Its pages come from the specification
     * alone, so this reads the rules' own, as the server Engine does at the
     * start of a game, without a game. The data files must already be in the
     * file system.
     *
     * @param rules The rules id, e.g. "classic".
     * @param select The entry to open on, or null.
     * @return {@link Reports#colopedia}'s JSON; null if there are no such rules.
     */
    static synchronized String before(String rules, String select) {
        Specification spec = SPECS.get(rules);
        if (spec == null) {
            Messages.loadMessageBundle(Language.locale());
            FreeColRules.loadRules();
            spec = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile(rules),
                Advantages.SELECTABLE, "model.difficulty.medium");
            if (spec == null) return null;
            SPECS.put(rules, spec);
        }
        return Reports.colopedia(spec, select);
    }

    /**
     * The terrain entry for a tile type, as TerrainDetailPanel lays it out.
     *
     * @param spec The specification.
     * @param typeId The tile type's id, e.g. model.tile.plains.
     * @return {name, keys, forest, labels, movementCost, defence, resources,
     *     unattended, colonist, description, ok} as JSON, with keys the
     *     terrain's image keys, forest those of its forest (or null),
     *     resources the possible resources as {name, keys}, and the two
     *     productions lists of goods {type, name, keys, amount}; null if
     *     there is no such tile type.
     */
    static String terrain(Specification spec, String typeId) {
        final TileType type = (typeId == null) ? null : spec.getTileType(typeId);
        if (type == null) return null;
        final List<String> resources = new ArrayList<>();
        for (ResourceType r : type.getResourceTypeValues()) {
            resources.add(new Json().put("name", Messages.getName(r))
                .putRaw("keys", Json.array(List.of(
                    Json.quote("image.tileitem." + r.getId())))).toString());
        }
        final Modifier defence = type.getDefenceModifiers().stream().findFirst().orElse(null);
        return new Json()
            .put("name", Messages.getName(type))
            .putRaw("keys", MapJson.terrainKeyJson(type))
            .putRaw("forest", MapJson.forestKeyJson(type))
            .putRaw("labels", new Json()
                .put("terrainImage", Messages.message("colopedia.terrain.terrainImage"))
                .put("resource", Messages.message("colopedia.terrain.resource"))
                .put("movementCost", Messages.message("colopedia.terrain.movementCost"))
                .put("defenseBonus", Messages.message("colopedia.terrain.defenseBonus"))
                .put("unattended", Messages.message("colopedia.terrain.unattendedProduction"))
                .put("colonist", Messages.message("colopedia.terrain.colonistProduction"))
                .put("description", Messages.message("colopedia.terrain.description"))
                .toString())
            .put("movementCost", String.valueOf(type.getBasicMoveCost() / 3))
            .put("defence", (defence == null) ? Messages.message("none")
                : WebGUI.modifierValue(defence, null))
            .putRaw("resources", Json.array(resources))
            .putRaw("unattended", production(type.getPossibleProduction(true)))
            .putRaw("colonist", production(type.getPossibleProduction(false)))
            .put("description", Messages.getDescription(type.getId()))
            .put("ok", Messages.message("ok"))
            .toString();
    }

    /** The positive production, as TerrainDetailPanel.addProduction shows it. */
    private static String production(Stream<AbstractGoods> production) {
        final List<String> out = new ArrayList<>();
        production.filter(AbstractGoods::isPositive).forEach(
            ag -> out.add(ColonyJson.goods(ag.getType(), ag.getAmount()).toString()));
        return Json.array(out);
    }
}
