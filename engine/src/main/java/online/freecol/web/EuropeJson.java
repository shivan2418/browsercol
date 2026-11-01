package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.HighSeas;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Unit;


/**
 * What FreeCol's EuropePanel shows, as the Browser UI's {@code europe}
 * event (WebGUI.showEuropePanel): the ships sailing to the New World and
 * to Europe, the ships in port, the units on the docks, the market's buy
 * and sell prices and the player's gold. Read-only.
 *
 * <pre>
 * {title, gold, goldLabel, ok, headings: {toAmerica, toEurope, inPort,
 *  docks, cargo}, toAmerica: [unit], toEurope: [unit], inPort: [unit],
 *  docks: [unit], selected: the id of the ship whose cargo shows first
 *  (or null), market: [{id, name, images, sell, buy, enabled}]}
 * unit: {id, name, images, selected, cargo: [{kind: "unit"|"goods", id,
 *  name, images, amount}]}   (cargo on a carrier only)
 * </pre>
 *
 * The lists are those of EuropePanel's DestinationPanel, EuropeInPortPanel
 * and EuropeanDocksPanel. The market's {@code sell} is what Europe pays
 * and {@code buy} what it asks (MarketLabel's "sell/buy"), in the
 * specification's storable order; {@code enabled} is false for goods that
 * are boycotted.
 */
final class EuropeJson {

    private EuropeJson() {}

    /**
     * The panel's JSON.
     *
     * @param player A player with a Europe.
     * @param active The active unit, whose cargo shows if it is a ship
     *     in port; may be null.
     */
    static String of(Player player, Unit active) {
        final Europe europe = player.getEurope();
        final Map map = europe.getGame().getMap();
        final List<Unit> inPort = new ArrayList<>();
        final List<Unit> docks = new ArrayList<>();
        for (Unit u : europe.getUnitList()) {
            if (!u.isNaval()) {
                docks.add(u);
            } else if (inPortState(u)) {
                inPort.add(u);
            }
        }
        final Unit selected = selected(inPort, active);

        final List<Unit> toAmerica = new ArrayList<>();
        final List<Unit> toEurope = new ArrayList<>();
        final HighSeas highSeas = player.getHighSeas();
        if (highSeas != null) {
            for (Unit u : highSeas.getUnitList()) {
                final Location dest = u.getDestination();
                if (dest == europe) {
                    toEurope.add(u);
                } else if (dest == map
                    || (dest != null && dest.getTile() != null
                        && dest.getTile().getMap() == map)) {
                    toAmerica.add(u);
                }
            }
        }

        return new Json()
            .put("title", Messages.getName(europe))
            .put("gold", player.getGold())
            .put("goldLabel", Messages.message("gold"))
            .put("ok", Messages.message("close"))
            .putRaw("headings", new Json()
                .put("toAmerica", Messages.message("sailingToAmerica"))
                .put("toEurope", Messages.message("sailingToEurope"))
                .put("inPort", Messages.message("inPort"))
                .put("docks", Messages.message("docks"))
                .put("cargo", Messages.message("cargo"))
                .toString())
            .putRaw("toAmerica", units(toAmerica, selected))
            .putRaw("toEurope", units(toEurope, selected))
            .putRaw("inPort", units(inPort, selected))
            .putRaw("docks", units(docks, selected))
            .put("selected", (selected == null) ? null : selected.getId())
            .putRaw("market", market(player))
            .toString();
    }

    /** EuropeInPortPanel.accepts: the states of a ship in port. */
    private static boolean inPortState(Unit u) {
        switch (u.getState()) {
        case ACTIVE: case FORTIFIED: case FORTIFYING:
        case SENTRY: case SKIPPED:
            return true;
        default:
            return false;
        }
    }

    /**
     * The ship whose cargo shows: the active unit if it is a ship in port,
     * else, as InPortPanel.selectLabel, the last carrier with no trade
     * route.
     */
    private static Unit selected(List<Unit> inPort, Unit active) {
        Unit last = null;
        for (Unit u : inPort) {
            if (u == active) return u;
            if (u.isCarrier() && u.getTradeRoute() == null) last = u;
        }
        return last;
    }

    private static String units(List<Unit> units, Unit selected) {
        final List<String> json = new ArrayList<>();
        for (Unit u : units) json.add(unit(u, u == selected));
        return Json.array(json);
    }

    private static String unit(Unit u, boolean selected) {
        final Json json = new Json()
            .put("id", u.getId())
            .put("name", u.getDescription(Unit.UnitLabelType.NATIONAL))
            .putRaw("images", quoted(MapJson.unitKeys(u)))
            .put("selected", selected);
        if (u.isCarrier()) {
            final List<String> cargo = new ArrayList<>();
            for (Unit aboard : u.getUnitList()) {
                cargo.add(new Json().put("kind", "unit")
                    .put("id", aboard.getId())
                    .put("name", aboard.getDescription(Unit.UnitLabelType.NATIONAL))
                    .putRaw("images", quoted(MapJson.unitKeys(aboard)))
                    .put("amount", 1).toString());
            }
            for (Goods g : u.getGoodsList()) {
                cargo.add(new Json().put("kind", "goods")
                    .put("id", g.getType().getId())
                    .put("name", Messages.getName(g.getType()))
                    .putRaw("images", ObjectImages.json(g.getType()))
                    .put("amount", g.getAmount()).toString());
            }
            json.putRaw("cargo", Json.array(cargo));
        }
        return json.toString();
    }

    private static String quoted(List<String> keys) {
        final List<String> q = new ArrayList<>();
        for (String k : keys) q.add(Json.quote(k));
        return Json.array(q);
    }

    private static String market(Player player) {
        final Market market = player.getMarket();
        final List<String> goods = new ArrayList<>();
        for (GoodsType type : player.getGame().getSpecification()
                 .getStorableGoodsTypeList()) {
            goods.add(new Json()
                .put("id", type.getId())
                .put("name", Messages.getName(type))
                .putRaw("images", ObjectImages.json(type))
                .put("sell", market.getPaidForSale(type))
                .put("buy", market.getCostToBuy(type))
                .put("enabled", player.canTrade(type)).toString());
        }
        return Json.array(goods);
    }
}
