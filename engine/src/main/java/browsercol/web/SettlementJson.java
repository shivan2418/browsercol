package browsercol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tension;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;


/**
 * What FreeCol's IndianSettlementPanel shows about a native settlement to
 * a player, as the Browser UI's panel gets it. Only what the player has
 * learned is in it: the skill and the wanted goods after a visit, the
 * most hated nation after contact, as the Swing panel's own checks have it.
 * Where the panel shows an icon beside a text, an entry has the text and
 * the icon's resource keys (best first), an empty list when there is no icon.
 */
final class SettlementJson {

    private SettlementJson() {}

    private static String text(StringTemplate template) {
        return Messages.message(template);
    }

    /** A text with its icon's keys, null for no icon. */
    private static Json entry(String text, String images) {
        return new Json().put("text", text)
            .putRaw("images", (images == null) ? "[]" : images);
    }

    /**
     * The panel's payload.
     *
     * @param is The settlement.
     * @param player The player looking at it.
     * @return The JSON object, without the tile and the close button's
     *     label, which the WebGUI adds.
     */
    static Json of(IndianSettlement is, Player player) {
        final Player indian = is.getOwner();
        final boolean contacted = is.hasContacted(player);
        final boolean visited = is.hasVisited(player);

        final Tension tension = is.getAlarm(player);
        final Json json = new Json()
            .put("name", text(is.getLocationLabelFor(player)))
            .put("kind", text(StringTemplate
                .template(is.isCapital() ? "indianSettlementPanel.indianCapital"
                    : "indianSettlementPanel.indianSettlement")
                .addStringTemplate("%nation%", indian.getNationLabel())))
            .put("tension", (tension == null) ? null : Messages.getName(tension))
            .put("worthScouting", is.worthScouting(player))
            .putRaw("images", ObjectImages.json(is))
            .putRaw("labels", new Json()
                .put("learnableSkill", Messages.message("indianSettlementPanel.learnableSkill"))
                .put("hatedNation", Messages.message("indianSettlementPanel.mostHated"))
                .put("highlyWanted", Messages.message("indianSettlementPanel.highlyWanted"))
                .put("otherWanted", Messages.message("indianSettlementPanel.otherWanted"))
                .toString());

        final Unit missionary = is.getMissionary();
        json.putRaw("missionary", (missionary == null) ? "null"
            : entry(text(missionary.getLabel(Unit.UnitLabelType.NATIONAL)),
                    ObjectImages.json(missionary)).toString());

        final UnitType skill = is.getLearnableSkill();
        json.putRaw("skill", entry(text(is.getLearnableSkillLabel(visited)),
            (visited && skill != null) ? ObjectImages.json(skill) : null)
            .toString());

        final Player hated = is.getMostHated();
        json.putRaw("mostHated", entry(text(is.getMostHatedLabel(contacted)),
            (contacted && hated != null) ? ObjectImages.json(hated.getNation())
                : null).toString());

        // The first wanted goods are the highly wanted one, the rest the
        // other goods; the panel has the first line even with no goods.
        final List<String> wanted = new ArrayList<>();
        // Before a visit the goods are blank, and how many there are
        // is not sent either.
        final int n = visited ? Math.max(1, is.getWantedGoodsCount()) : 1;
        for (int i = 0; i < n; i++) {
            final List<StringTemplate> label = is.getWantedGoodsLabel(i, player);
            final GoodsType type = is.getWantedGoods(i);
            final Json w = entry(text(label.get(0)),
                (visited && type != null) ? ObjectImages.json(type) : null);
            w.put("tip", (label.size() > 1) ? text(label.get(1)) : null);
            wanted.add(w.toString());
        }
        json.putRaw("wanted", Json.array(wanted));
        return json;
    }
}
