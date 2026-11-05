package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.debug.DebugUtils;
import net.sf.freecol.common.debug.FreeColDebugger;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.ProductionType;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.UnitType;


/** A tile as data for the Browser UI: what FreeCol's TilePanel shows. */
final class TileJson {

    private TileJson() {}

    /**
     * What TilePanel shows of a tile.
     *
     * @param tile The tile.
     * @param player The player looking at it.
     * @return {title, type, keys, forest, rows, production, colopedia, ok}
     *     as JSON: rows are the {label, value} lines (region, owner,
     *     settlement, defence bonus, movement cost; those the tile has),
     *     production the goods {type, name, keys, amount, expert} a
     *     colonist makes there, expert being what an expert would make.
     */
    static String of(Tile tile, Player player) {
        final TileType type = tile.getType();
        final Specification spec = tile.getGame().getSpecification();
        final List<String> rows = new ArrayList<>();
        if (tile.getRegion() != null) {
            rows.add(row("tilePanel.region", Messages.message(tile.getRegion().getLabel())));
        }
        if (tile.getOwner() != null) {
            final StringTemplate owner = tile.getOwner().getNationLabel();
            if (owner != null) rows.add(row("tilePanel.owner", Messages.message(owner)));
        }
        if (tile.getOwningSettlement() != null) {
            final StringTemplate settlement = tile.getOwningSettlement().getLocationLabelFor(player);
            if (settlement != null) rows.add(row("tilePanel.settlement", Messages.message(settlement)));
        }
        final int defence = tile.getDefenceBonusPercentage();
        if (defence != 0) rows.add(row("tilePanel.defenseBonus", defence + "%"));
        rows.add(row("tilePanel.movementCost", String.valueOf(type.getBasicMoveCost() / 3)));

        final UnitType colonist = spec.getDefaultUnitType();
        final List<String> production = new ArrayList<>();
        for (ProductionType pt : type.getAvailableProductionTypes(false)) {
            for (AbstractGoods output : (Iterable<AbstractGoods>)pt.getOutputs()::iterator) {
                final GoodsType gt = output.getType();
                int amount = output.getAmount();
                if (tile.getTileItemContainer() != null) {
                    amount = tile.getTileItemContainer()
                        .getTotalBonusPotential(gt, colonist, amount, true);
                }
                int expertAmount = amount;
                final UnitType expert = spec.getExpertForProducing(gt);
                if (expert != null) {
                    expertAmount = (int)expert.apply(amount, tile.getGame().getTurn(), gt.getId());
                }
                if (amount <= 0 && expertAmount <= 0) continue;
                production.add(ColonyJson.goods(gt, amount).put("expert", expertAmount).toString());
            }
        }
        return new Json()
            .putRaw("colonyValue", Json.array(colonyValue(tile)))
            .put("title", Messages.message(StringTemplate.template("tilePanel.label")
                .addStringTemplate("%label%", tile.getLabel())
                .addAmount("%x%", tile.getX())
                .addAmount("%y%", tile.getY())))
            .put("type", type.getId())
            .putRaw("keys", MapJson.terrainKeyJson(type))
            .putRaw("forest", MapJson.forestKeyJson(type))
            .putRaw("rows", Json.array(rows))
            .putRaw("production", Json.array(production))
            .put("colopedia", Messages.message("colopedia"))
            .put("ok", Messages.message("ok"))
            .toString();
    }

    /**
     * TilePanel's debug lines: what the player chosen in the debug menu
     * (FreeColDebugger.debugDisplayColonyValuePlayer) would think of a colony
     * on the tile, by category, or why they would not found one. Each line is a
     * JSON string; none when no player is chosen.
     */
    static List<String> colonyValue(Tile tile) {
        final List<String> lines = new ArrayList<>();
        final Player debugPlayer = FreeColDebugger.debugDisplayColonyValuePlayer();
        if (debugPlayer == null) return lines;
        final List<Double> values = debugPlayer.getAllColonyValues(tile);
        final int result = debugPlayer.getColonyValue(tile);
        if (result < 0) {
            lines.add(Json.quote(DebugUtils.getColonyValue(tile)));
            return lines;
        }
        for (Player.ColonyValueCategory c : Player.ColonyValueCategory.values()) {
            lines.add(Json.quote(c + " " + values.get(c.ordinal())));
        }
        for (int a = Player.ColonyValueCategory.A_GOODS.ordinal(); a < values.size(); a++) {
            lines.add(Json.quote("... " + values.get(a)));
        }
        lines.add(Json.quote("Result " + result));
        return lines;
    }

    private static String row(String labelKey, String value) {
        return new Json().put("label", Messages.message(labelKey)).put("value", value).toString();
    }
}
