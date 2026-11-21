package browsercol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.StringTemplate;


/**
 * What FreeCol's FindSettlementPanel lists, as the Browser UI's panel gets
 * it: the settlements of every living player the client knows, with the
 * three filters' labels. The panel centres the map on a picked row and
 * opens the colony or native settlement panel from it.
 */
final class FindSettlementJson {

    private FindSettlementJson() {}

    /**
     * The panel's payload.
     *
     * @param game The game.
     * @param me The player looking.
     * @return {title, filters: [all, natives, european labels], settlements:
     *     [{id, name (as the panel's renderer words it), native, open,
     *     at, images}], ok}; open is whether picking the row opens a panel
     *     (our colonies and native settlements do).
     */
    static Json of(Game game, Player me) {
        final List<String> rows = new ArrayList<>();
        for (Player player : game.getLivePlayerList()) {
            for (Settlement s : player.getSettlementList()) {
                final boolean open = (s instanceof Colony && s.getOwner() == me)
                    || s instanceof IndianSettlement;
                rows.add(new Json()
                    .put("id", s.getId())
                    .put("name", Messages.message(StringTemplate
                        .template("findSettlementPanel.settlement")
                        .addName("%name%", s.getName())
                        .addName("%capital%", s.isCapital() ? "*" : "")
                        .addStringTemplate("%nation%", s.getOwner().getNationLabel())))
                    .put("native", player.isIndian())
                    .put("open", open)
                    .putRaw("at", MapJson.xy(s.getTile()))
                    .putRaw("images", ObjectImages.json(s))
                    .toString());
            }
        }
        return new Json()
            .put("title", Messages.message("findSettlementPanel.name"))
            .putRaw("filters", Json.array(List.of(
                Json.quote(Messages.message("findSettlementPanel.displayAll")),
                Json.quote(Messages.message("findSettlementPanel.displayOnlyNatives")),
                Json.quote(Messages.message("findSettlementPanel.displayOnlyEuropean")))))
            .putRaw("settlements", Json.array(rows))
            .put("ok", Messages.message("ok"));
    }
}
