package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;


/**
 * What FreeCol's WorkProductionPanel shows of a working colonist, as the
 * Browser UI's panel gets it: where the unit works, the base production
 * and each modifier that changes it, the final result and, for a
 * building, what it makes unattended.
 */
final class WorkProductionJson {

    private WorkProductionJson() {}

    /**
     * The panel's payload.
     *
     * @param unit A unit that works at a work location.
     * @return {title, place, unit, unitKeys, keys, forest, base, lines:
     *     [{source, value}], zero (a {label, value} or null), finalResult,
     *     result, unattended (null, or {label, place, base, lines}), ok};
     *     keys and forest the terrain or the building's image keys.
     */
    static Json of(Unit unit) {
        final UnitType unitType = unit.getType();
        final WorkLocation wl = (WorkLocation)unit.getLocation();
        final GoodsType workType = unit.getWorkType();
        final Turn turn = unit.getGame().getTurn();
        final float base = wl.getBaseProduction(wl.getProductionType(), workType, unitType);

        final Tile tile = wl.getWorkTile();
        final String place;
        final String title;
        final String keys;
        String forest = "null";
        if (tile != null) {
            place = Messages.getName(tile.getType());
            title = Messages.message(wl.getLabel());
            keys = MapJson.terrainKeyJson(tile.getType());
            forest = MapJson.forestKeyJson(tile.getType());
        } else {
            final Building building = (Building)wl;
            place = Messages.getName(building.getType());
            title = place;
            keys = ObjectImages.json(building);
        }

        float result = wl.getPotentialProduction(workType, unitType);
        Json zero = null;
        if (result < 0.0f) {
            zero = new Json()
                .put("label", Messages.message("workProductionPanel.zeroThreshold"))
                .put("value", WebGUI.decimal(-result));
            result = 0.0f;
        }

        Json unattended = null;
        final float unattendedBase = wl.getBaseProduction(null, workType, null);
        if (wl instanceof Building && unattendedBase > 0) {
            unattended = new Json()
                .put("label", Messages.message("workProductionPanel.unattendedProduction"))
                .put("place", Messages.message(wl.getLabel()))
                .put("base", WebGUI.decimal(unattendedBase))
                .putRaw("lines", lines(wl, workType, null, unitType, turn));
        }

        return new Json()
            .put("title", title)
            .put("place", place)
            .put("unit", unit.getDescription(Unit.UnitLabelType.NATIONAL))
            .putRaw("unitKeys", ObjectImages.json(unit))
            .putRaw("keys", keys)
            .putRaw("forest", forest)
            .put("base", WebGUI.decimal(base))
            .putRaw("lines", lines(wl, workType, unitType, unitType, turn))
            .putRaw("zero", (zero == null) ? "null" : zero.toString())
            .put("finalResult", Messages.message("finalResult"))
            .put("result", WebGUI.decimal(result))
            .putRaw("unattended", (unattended == null) ? "null" : unattended.toString())
            .put("ok", Messages.message("ok"));
    }

    /**
     * The production modifiers of a work location, in ModifierFormat's
     * order, each named by its source (and the unit type it applies to).
     */
    private static String lines(WorkLocation wl, GoodsType workType,
                                UnitType producer, UnitType unitType, Turn turn) {
        final List<Modifier> sorted = wl.getProductionModifiers(workType, producer)
            .sorted(Modifier.ascendingModifierIndexComparator)
            .collect(Collectors.toList());
        final List<String> out = new ArrayList<>();
        for (Modifier m : sorted) {
            String source = WebGUI.modifierSource(m.getSource());
            if (unitType != null && m.appliesTo(unitType)) {
                source += " (" + Messages.getName(unitType) + ")";
            }
            out.add(new Json().put("source", source)
                .put("value", WebGUI.modifierValue(m, turn)).toString());
        }
        return Json.array(out);
    }
}
