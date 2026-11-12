package browsercol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ExportData;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.option.GameOptions;


/**
 * What WarehouseDialog knows of a colony's custom house settings, without
 * Swing: the question the Browser UI shows, and saving its answer.
 *
 * The question is {title, ok, cancel, export, discard, discardYes, discardNo, canExport, labels:
 * {goods, low, high, import} (the column headings), tips:
 * {low, high, import, export, exported}, goods: [{type, name, keys, amount, exported,
 * low, high, import, export, max}]}. import is null unless the enhanced
 * trade routes option is on; max is what the import and export levels may
 * reach. The answer is a line for each goods type, its fields separated by
 * tabs: type, exported (true or false), low, high, import (-1 for none),
 * export.
 */
final class Warehouses {

    private Warehouses() {}

    /** The most an import or export level may be: the capacity, or 300 for goods that ignore it. */
    static int maxLevel(Colony colony, GoodsType type) {
        return type.limitIgnored() ? 300 : colony.getWarehouseCapacity();
    }

    static String question(Colony colony) {
        final boolean enhanced = colony.getSpecification()
            .getBoolean(GameOptions.ENHANCED_TRADE_ROUTES);
        final int capacity = colony.getWarehouseCapacity();
        final List<String> goods = new ArrayList<>();
        for (GoodsType type : colony.getSpecification().getStorableGoodsTypeList()) {
            final ExportData data = colony.getExportData(type);
            goods.add(new Json().put("type", type.getId())
                .put("name", Messages.getName(type))
                .putRaw("keys", ObjectImages.json(type))
                .put("amount", colony.getGoodsCount(type))
                .put("exported", data.getExported())
                .put("low", data.getLowLevel())
                .put("high", data.getHighLevel())
                .putRaw("import", enhanced
                    ? String.valueOf(data.getEffectiveImportLevel(capacity)) : "null")
                .put("export", data.getExportLevel())
                .put("max", maxLevel(colony, type))
                .toString());
        }
        return new Json().put("title", Messages.message("warehouseDialog.name"))
            .put("ok", Messages.message("ok"))
            .put("cancel", Messages.message("cancel"))
            .put("export", Messages.message("warehouseDialog.export"))
            // FreeCol cancels on close without asking; the Browser UI asks once, and only after an edit.
            .put("discard", "Discard your changes?")
            .put("discardYes", Messages.message("yes"))
            .put("discardNo", Messages.message("no"))
            .put("canExport", colony.hasAbility(Ability.EXPORT))
            .putRaw("labels", new Json()
                .put("goods", Messages.message("goods"))
                .put("low", Messages.message("low"))
                .put("high", Messages.message("high"))
                .put("import", Messages.message("mapGeneratorOptions.import.name"))
                .toString())
            .putRaw("tips", new Json()
                .put("low", Messages.message("warehouseDialog.lowLevel.shortDescription"))
                .put("high", Messages.message("warehouseDialog.highLevel.shortDescription"))
                .put("import", Messages.message("warehouseDialog.importLevel.shortDescription"))
                .put("export", Messages.message("warehouseDialog.exportLevel.shortDescription"))
                .put("exported", Messages.message("warehouseDialog.export.shortDescription"))
                .toString())
            .putRaw("goods", Json.array(goods))
            .toString();
    }

    /**
     * Save the answer, as the dialog's OK does: each goods type whose
     * settings differ from the colony's is sent to the server.
     *
     * @return True if every change was saved.
     */
    static boolean save(Commands commands, Colony colony, String answer) {
        boolean all = true;
        final int capacity = colony.getWarehouseCapacity();
        for (String line : answer.split("\n")) {
            if (line.isBlank()) continue;
            final String[] f = line.split("\t");
            if (f.length != 6) { all = false; continue; }
            final GoodsType type = colony.getSpecification().getGoodsType(f[0]);
            if (type == null) { all = false; continue; }
            final boolean exported;
            final int low, high, imp, exp;
            try {
                exported = Boolean.parseBoolean(f[1]);
                low = Integer.parseInt(f[2]);
                high = Integer.parseInt(f[3]);
                imp = Integer.parseInt(f[4]);
                exp = Integer.parseInt(f[5]);
            } catch (NumberFormatException nfe) { all = false; continue; }
            final ExportData data = colony.getExportData(type);
            if (exported == data.getExported() && low == data.getLowLevel()
                && high == data.getHighLevel() && exp == data.getExportLevel()
                && (imp < 0 || imp == data.getEffectiveImportLevel(capacity))) continue;
            all &= commands.setGoodsLevels(colony.getId(), f[0], exported, low, high, imp, exp);
        }
        return all;
    }
}
