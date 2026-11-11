package browsercol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.TradeRoute;
import net.sf.freecol.common.model.TradeRouteStop;


/**
 * The player's trade routes as the Browser UI shows them, with the
 * information of FreeCol's TradeRoutePanel (the routes, with how many
 * units follow each) and TradeRouteInputPanel (a route's name, silence,
 * and its stops with the goods to load at each, and the places a stop can
 * be at, and the name a new route starts with), and the editing of a
 * route.
 */
final class TradeRoutes {

    private TradeRoutes() {}

    /**
     * The routes panel's payload.
     *
     * @param client The client.
     * @param error The reason the last change was refused, or null.
     * @param unit The unit the panel was opened for, to assign a route to, or null.
     * @return The JSON of the {@code tradeRoutes} event.
     */
    static String json(FreeColClient client, String error,
                       net.sf.freecol.common.model.Unit unit) {
        final Player player = client.getMyPlayer();
        final List<String> routes = new ArrayList<>();
        for (TradeRoute tr : sorted(player)) {
            final List<String> stops = new ArrayList<>();
            for (TradeRouteStop s : tr.getStopList()) {
                final List<String> cargo = new ArrayList<>();
                for (GoodsType gt : s.getCargo()) cargo.add(Json.quote(gt.getId()));
                stops.add(new Json()
                    .put("place", s.getLocation().getId())
                    .put("label", label(s.getLocation()))
                    .putRaw("cargo", Json.array(cargo))
                    .toString());
            }
            routes.add(new Json()
                .put("id", tr.getId())
                .put("name", tr.getName())
                .put("silent", tr.isSilent())
                .put("units", tr.getAssignedUnits().size())
                .putRaw("stops", Json.array(stops))
                .toString());
        }
        final List<String> places = new ArrayList<>();
        if (player.getEurope() != null) places.add(place(player.getEurope()));
        for (Colony c : player.getColonyList()) places.add(place(c));
        final List<String> goods = new ArrayList<>();
        for (GoodsType gt : client.getGame().getSpecification().getGoodsTypeList()) {
            if (!gt.isStorable()) continue;
            goods.add(new Json()
                .put("id", gt.getId())
                .put("name", Messages.getName(gt))
                .put("icon", "image.icon." + gt.getId())
                .toString());
        }
        final String forUnit = (unit == null || unit.isDisposed()) ? null
            : new Json()
                .put("id", unit.getId())
                .put("name", Messages.message(
                         unit.getLabel(net.sf.freecol.common.model.Unit.UnitLabelType.NATIONAL)))
                .putRaw("images", images(unit))
                .put("location", (unit.getLocation() == null) ? null
                                 : Messages.message(unit.getLocation().getLocationLabelFor(player)))
                .put("route", (unit.getTradeRoute() == null) ? null
                                                              : unit.getTradeRoute().getId())
                .toString();
        return new Json()
            .put("title", Messages.message("tradeRoutePanel.name"))
            .putRaw("unit", (forUnit == null) ? "null" : forUnit)
            .putRaw("tooltips", new Json()
                .put("new", Messages.message("tradeRoutePanel.new.tooltip"))
                .put("edit", Messages.message("tradeRoutePanel.edit.tooltip"))
                .put("delete", Messages.message("tradeRoutePanel.delete.tooltip"))
                .put("deassign", Messages.message("tradeRoutePanel.deassign.tooltip"))
                .toString())
            .put("assign", Messages.message("assignTradeRoute"))
            .put("unassign", Messages.message("tradeRoutePanel.deassignRoute"))
            .putRaw("routes", Json.array(routes))
            .putRaw("places", Json.array(places))
            .putRaw("goods", Json.array(goods))
            .put("error", error)
            .put("newRoute", Messages.message("tradeRoutePanel.newRoute"))
            // The name the server gives a new route, which TradeRouteInputPanel starts with.
            .put("defaultName", player.getNameForTradeRoute())
            .put("editRoute", Messages.message("tradeRoutePanel.editRoute"))
            .put("deleteRoute", Messages.message("tradeRoutePanel.deleteRoute"))
            .put("nameLabel", Messages.message("tradeRouteInputPanel.nameLabel"))
            .put("destinationLabel",
                 Messages.message("tradeRouteInputPanel.destinationLabel"))
            .put("silence", Messages.message("tradeRouteInputPanel.silence"))
            .put("addStop", Messages.message("tradeRouteInputPanel.addStop"))
            .put("removeStop", Messages.message("tradeRouteInputPanel.removeStop"))
            .put("allColonies", Messages.message("tradeRouteInputPanel.allColonies"))
            .put("ok", Messages.message("ok"))
            .put("cancel", Messages.message("cancel"))
            .toString();
    }

    private static String images(net.sf.freecol.common.model.Unit unit) {
        final List<String> keys = new ArrayList<>();
        for (String k : MapJson.unitKeys(unit)) keys.add(Json.quote(k));
        return Json.array(keys);
    }

    /** The route's assigned units, copied, to unassign them. */
    static List<net.sf.freecol.common.model.Unit> assigned(TradeRoute route) {
        return new ArrayList<>(route.getAssignedUnits());
    }

    /** The player's routes by name, as TradeRoutePanel lists them. */
    static List<TradeRoute> sorted(Player player) {
        final List<TradeRoute> routes = new ArrayList<>(player.getTradeRoutes());
        routes.sort((a, b) -> a.getName().compareTo(b.getName()));
        return routes;
    }

    /**
     * A place a stop can be at, with what decides which carriers reach it:
     * whether ships do (Europe, or a colony that is a port connected to the
     * high seas, as FreeCol's SelectDestinationDialog asks of a ship), and
     * the landmass a colony is on (its tile's contiguity), which a wagon
     * train does not leave. Europe has no landmass.
     */
    private static String place(Location l) {
        final Colony colony = (l instanceof Colony c) ? c : null;
        return new Json()
            .put("id", l.getId())
            .put("label", label(l))
            .put("port", colony == null || colony.isConnectedPort())
            .putRaw("land", (colony == null || colony.getTile() == null) ? "null"
                            : String.valueOf(colony.getTile().getContiguity()))
            .toString();
    }

    private static String label(Location l) {
        return Messages.message(l.getLocationLabel());
    }

    /**
     * Make a route what the player edited it to, or say why it cannot be.
     * The server hears of the route only if it is valid, and a route that
     * is not is left as it was, which TradeRouteInputPanel does not quite
     * manage for the stops of one it edits.
     *
     * @param client The client.
     * @param route The route to change.
     * @param name Its new name.
     * @param silent Whether it is to be silent.
     * @param places The ids of the places of its stops, in order.
     * @param cargo For each stop, the ids of the goods types to load.
     * @return Null if the route was changed, else the reason it was not.
     */
    static String edit(FreeColClient client, TradeRoute route, String name,
                       boolean silent, List<String> places,
                       List<List<String>> cargo) {
        final String oldName = route.getName();
        final boolean oldSilent = route.isSilent();
        final List<TradeRouteStop> oldStops = new ArrayList<>(route.getStopList());
        route.setName(name);
        route.setSilent(silent);
        route.clearStops();
        for (int i = 0; i < places.size(); i++) {
            final FreeColGameObject o
                = client.getGame().getFreeColGameObject(places.get(i));
            if (!(o instanceof Location)) continue;
            final TradeRouteStop stop
                = new TradeRouteStop(client.getGame(), (Location)o);
            final List<GoodsType> goods = new ArrayList<>();
            for (String g : cargo.get(i)) {
                final GoodsType gt
                    = client.getGame().getSpecification().getGoodsType(g);
                if (gt != null && gt.isStorable()) goods.add(gt);
            }
            stop.setCargo(goods);
            route.addStop(stop);
        }
        String why = null;
        final StringTemplate invalid = (route.verify() != null)
            ? route.verify() : route.verifyUniqueName();
        if (invalid != null) {
            why = Messages.message(invalid);
        } else if (!client.getInGameController().updateTradeRoute(route)) {
            why = "The server did not accept the trade route.";
        }
        if (why != null) {
            route.setName(oldName);
            route.setSilent(oldSilent);
            route.clearStops();
            for (TradeRouteStop s : oldStops) route.addStop(s);
        }
        return why;
    }
}
