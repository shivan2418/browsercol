package browsercol.web;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.HighSeas;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;


/**
 * What FreeCol's EuropePanel shows, as the Browser UI's {@code europe}
 * event (WebGUI.showEuropePanel): the ships sailing to the New World and
 * to Europe, the ships in port, the units on the docks, the market's buy
 * and sell prices, and what the player can recruit, train and buy there.
 * The player's gold is not here: the status line on the map shows it.
 *
 * <pre>
 * {title, ok, headings: {toAmerica, toEurope, inPort, docks, cargo},
 *  toAmerica: [unit], toEurope: [unit], inPort: [unit], docks: [unit],
 *  selected: the id of the ship whose cargo shows first
 *  (or null), log: {heading, entries: [[line]]} (the purchases and
 *  sales of the turn, oldest first, each the lines SalesLog words),
 *  market: [{id, name, images, sell, buy, inMarket, enabled, reason}],
 *  buttons: {train, purchase, recruit, unload, sail},
 *  recruit: {heading, text, price, units: [{index, name, images,
 *  enabled}]}, train: {heading, units: [offer]},
 *  purchase: {heading, units: [offer]}}
 * offer: {id, name, images, price, priceLabel, enabled}
 * unit: {id, name, images, selected, cargo: [{kind: "unit"|"goods", id,
 *  name, images, amount}],   (cargo on a carrier only)
 *  turns, turnsLabel,        (a ship sailing either way only)
 *  repair}                   (a damaged ship only: "Repair(3)", the turns left)
 * </pre>
 *
 * A sailing ship's {@code turns} are the turns left before it arrives (its
 * work left: it arrives on the new turn that takes that to 0), and
 * {@code turnsLabel} says them as FreeCol's progress bar does. Swing shows
 * neither; each sailing list is in the order the ships arrive, soonest
 * first, and in FreeCol's order between ships that arrive together.
 *
 * The lists are those of EuropePanel's DestinationPanel, EuropeInPortPanel
 * and EuropeanDocksPanel. The market's {@code sell} is what Europe pays
 * and {@code buy} what it asks (MarketLabel's "sell/buy"), in the
 * specification's storable order; {@code enabled} is false for goods that
 * are boycotted, and {@code reason} says why, as FreeCol says it.
 *
 * The recruit, train and purchase lists are those of FreeCol's RecruitPanel,
 * TrainPanel and PurchasePanel: the docks' recruitable units at one price,
 * and the unit types of Europe by ascending price, each enabled when the
 * player can pay. The prices are the ones the server charges.
 */
final class EuropeJson {

    private EuropeJson() {}

    /**
     * The panel's JSON.
     *
     * @param player A player with a Europe.
     * @param active The active unit, whose cargo shows if it is a ship
     *     in port; may be null.
     * @param log The entries of the turn's sales log (SalesLog.entries).
     */
    static String of(Player player, Unit active, List<List<String>> log) {
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
        toAmerica.sort(Comparator.comparingInt(Unit::getWorkLeft));
        toEurope.sort(Comparator.comparingInt(Unit::getWorkLeft));

        return new Json()
            .put("title", Messages.getName(europe))
            .putRaw("log", log(log))
            .put("ok", Messages.message("close"))
            .putRaw("headings", new Json()
                .put("toAmerica", Messages.message("sailingToAmerica"))
                .put("toEurope", Messages.message("sailingToEurope"))
                .put("inPort", Messages.message("inPort"))
                .put("docks", Messages.message("docks"))
                .put("cargo", Messages.message("cargoOnCarrier"))
                .toString())
            .putRaw("toAmerica", units(toAmerica, selected, true))
            .putRaw("toEurope", units(toEurope, selected, true))
            .putRaw("inPort", units(inPort, selected, false))
            .putRaw("docks", units(docks, selected, false))
            .put("selected", (selected == null) ? null : selected.getId())
            .putRaw("market", market(player))
            .putRaw("buttons", new Json()
                .put("train", Messages.message("train"))
                .put("purchase", Messages.message("purchase"))
                .put("recruit", Messages.message("recruit"))
                .put("unload", Messages.message("unload"))
                .put("sail", Messages.message("setSail"))
                .toString())
            .putRaw("recruit", recruit(player))
            .putRaw("train", offers(player, "trainPanel.clickOn",
                player.getGame().getSpecification()
                    .getUnitTypesTrainedInEurope(player)))
            .putRaw("purchase", offers(player, "purchasePanel.clickOn",
                player.getGame().getSpecification()
                    .getUnitTypesPurchasedInEurope(player)))
            .toString();
    }

    /** RecruitPanel: the recruitable units, all at the current price. */
    private static String recruit(Player player) {
        final Europe europe = player.getEurope();
        final int price = player.getEuropeanRecruitPrice();
        final int production = player.getTotalImmigrationProduction();
        int turns = 100;
        if (production > 0) {
            final int required = player.getImmigrationRequired()
                - player.getImmigration();
            turns = required / production;
            if (required % production > 0) turns++;
        }
        final boolean enabled = player.checkGold(price);
        final List<String> units = new ArrayList<>();
        int index = 0;
        for (AbstractUnit au : europe.getExpandedRecruitables(false)) {
            final UnitType type = au.getType(europe.getSpecification());
            final String key = ObjectImages.unitKey(type, au.getRoleId());
            units.add(new Json().put("index", index++)
                .put("name", Messages.message(au.getSingleLabel()))
                .putRaw("images", quoted(List.of(key)))
                .put("enabled", enabled).toString());
        }
        return new Json()
            .put("heading", Messages.message("recruit"))
            .put("text", Messages.message(StringTemplate
                .template("recruitPanel.clickOn")
                .addAmount("%money%", price)
                .addAmount("%number%", turns)))
            .put("price", price)
            .putRaw("units", Json.array(units))
            .toString();
    }

    /** NewUnitPanel: the unit types on offer by ascending price. */
    private static String offers(Player player, String textKey,
                                 List<UnitType> types) {
        final Europe europe = player.getEurope();
        final List<UnitType> sorted = new ArrayList<>(types);
        sorted.sort(Comparator.comparingInt(europe::getUnitPrice));
        final List<String> units = new ArrayList<>();
        for (UnitType type : sorted) {
            final int price = europe.getUnitPrice(type);
            units.add(new Json().put("id", type.getId())
                .put("name", Messages.getName(type))
                .putRaw("images", ObjectImages.json(type))
                .put("price", price)
                .put("priceLabel", Messages.message(StringTemplate
                    .template("goldAmount").addAmount("%amount%", price)))
                .put("enabled", player.checkGold(price)).toString());
        }
        return new Json()
            .put("heading", Messages.message(textKey))
            .putRaw("units", Json.array(units))
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
        // A ship alone in port shows its cargo from the start.
        return (last == null && inPort.size() == 1) ? inPort.get(0) : last;
    }

    private static String units(List<Unit> units, Unit selected, boolean sailing) {
        final List<String> json = new ArrayList<>();
        for (Unit u : units) json.add(unit(u, u == selected, sailing));
        return Json.array(json);
    }

    private static String unit(Unit u, boolean selected, boolean sailing) {
        final Json json = new Json()
            .put("id", u.getId())
            .put("name", u.getDescription(Unit.UnitLabelType.NATIONAL))
            .putRaw("images", quoted(MapJson.unitKeys(u)))
            .put("selected", selected);
        if (sailing) {
            // A ship arrives on the new turn that takes its work left to 0, so 1 is next turn.
            final int turns = Math.max(1, u.getWorkLeft());
            json.put("turns", turns)
                .put("turnsLabel", Messages.message(StringTemplate
                    .template("freeColProgressBar.turnsToComplete")
                    .addAmount("%number%", turns)));
        }
        // UnitLabel draws a damaged ship's repair status over it, in red.
        if (u.isDamaged()) json.put("repair", Messages.message(u.getRepairLabel()));
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
                cargo.add(Boycotts.mark(new Json().put("kind", "goods")
                    .put("id", g.getType().getId())
                    .put("name", Messages.getName(g.getType()))
                    .putRaw("images", ObjectImages.json(g.getType()))
                    .put("amount", g.getAmount()), u, g.getType(), g.getAmount()).toString());
            }
            json.putRaw("cargo", Json.array(cargo));
            json.put("cargoTitle", Messages.message(StringTemplate
                .template("cargoPanel.cargoAndSpace")
                .addStringTemplate("%name%", u.getLabel(Unit.UnitLabelType.NATIONAL))
                .addAmount("%space%", u.getSpaceLeft())));
        }
        return json.toString();
    }

    /** EuropePanel's transaction log, bordered "sales". */
    private static String log(List<List<String>> log) {
        final List<String> entries = new ArrayList<>();
        for (List<String> lines : log) entries.add(quoted(lines));
        return new Json()
            .put("heading", Messages.message("sales"))
            .putRaw("entries", Json.array(entries))
            .toString();
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
            final boolean tradeable = player.canTrade(type);
            goods.add(new Json()
                .put("id", type.getId())
                .put("name", Messages.getName(type))
                .putRaw("images", ObjectImages.json(type))
                .put("sell", market.getPaidForSale(type))
                .put("buy", market.getCostToBuy(type))
                .put("inMarket", market.getAmountInMarket(type))
                .put("enabled", tradeable)
                .put("reason", tradeable ? null
                    : Messages.message(Boycotts.reason(player, type)))
                .toString());
        }
        return Json.array(goods);
    }
}
