package browsercol.web;

import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Ownable;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.i18n.Messages;


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

    /**
     * Whether GoodsLabel draws a stack of goods greyed out: its owner may not
     * trade the type, unless it is not storable, or the stack is in a colony
     * whose custom house ignores boycotts (CUSTOM_IGNORE_BOYCOTT).
     *
     * @param where The location the stack is in (a colony or a unit).
     * @param type The goods type.
     * @return True if it is drawn greyed out.
     */
    static boolean greyed(Location where, GoodsType type) {
        final Player player = (where instanceof Ownable) ? ((Ownable)where).getOwner() : null;
        if (player == null || !type.isStorable() || player.canTrade(type)) return false;
        final Specification spec = type.getSpecification();
        return !(where instanceof Colony
            && spec.getBoolean(GameOptions.CUSTOM_IGNORE_BOYCOTT)
            && ((Colony)where).hasAbility(Ability.EXPORT));
    }

    /**
     * Mark a stack of goods as GoodsLabel does when it is boycotted:
     * boycotted true and label, goods.getLabel(false) ("20 Rum (boycotted)"),
     * the hint. Nothing is added to a stack that is not.
     *
     * @return The same json.
     */
    static Json mark(Json json, Location where, GoodsType type, int amount) {
        if (!greyed(where, type)) return json;
        return json.put("boycotted", true)
            .put("label", Messages.message(new AbstractGoods(type, amount).getLabel(false)));
    }
}
