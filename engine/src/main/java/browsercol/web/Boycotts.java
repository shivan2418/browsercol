package browsercol.web;

import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;


/**
 * Why a goods type cannot be traded, as FreeCol says it: the Crown is
 * boycotting it until the tax arrears are paid.
 */
final class Boycotts {

    private Boycotts() {}

    /**
     * The reason a boycotted goods type cannot be traded, localized.
     *
     * @param player The player the boycott is on.
     * @param type The goods type.
     * @return The reason.
     */
    static StringTemplate reason(Player player, GoodsType type) {
        return StringTemplate.template("payArrears.text")
            .addAmount("%amount%", player.getArrears(type));
    }
}
