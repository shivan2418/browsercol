package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.FreeColObject;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.ResourceType;
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.UnitType;


/**
 * The resource keys of the image FreeCol's ImageLibrary.getObjectImage
 * shows for a game object, as the Browser UI resolves them: the object's
 * display object (a unit's type, a building's type, a player's nation),
 * and for each kind of that the key ImageLibrary uses. A key the Tileset
 * does not have is skipped by the Browser UI, so a settlement lists its
 * nation's key before the plain one, as ImageLibrary.getSettlementKey
 * chooses between them.
 */
final class ObjectImages {

    private ObjectImages() {}

    /**
     * The candidate keys for an object's image, best first; empty if
     * FreeCol has no image for it (ImageLibrary warns and shows none).
     */
    static List<String> keys(FreeColObject display) {
        final List<String> keys = new ArrayList<>();
        if (display == null) return keys;
        final FreeColObject derived = display.getDisplayObject();
        if (derived instanceof BuildingType) {
            keys.add("image.buildingicon." + derived.getId());
        } else if (derived instanceof GoodsType) {
            keys.add("image.icon." + derived.getId());
        } else if (derived instanceof LostCityRumour) {
            keys.add("image.tileitem.lostCityRumour");
        } else if (derived instanceof Nation) {
            keys.add("image.miscicon." + derived.getId());
        } else if (derived instanceof ResourceType) {
            keys.add("image.tileitem." + derived.getId());
        } else if (derived instanceof Settlement) {
            keys.addAll(MapJson.settlementKeys((Settlement)derived));
        } else if (derived instanceof TileType) {
            keys.add("image.tile." + derived.getId() + ".center");
        } else if (derived instanceof UnitType) {
            final UnitType type = (UnitType)derived;
            keys.add(unitKey(type, type.getDisplayRoleId()));
        }
        return keys;
    }

    /** The key of a unit type's image in a role. */
    static String unitKey(UnitType type, String roleId) {
        return "image.unit." + type.getId()
            + (Role.isDefaultRoleId(roleId) ? ""
                : "." + Role.getRoleIdSuffix(roleId));
    }

    /** The keys as a JSON array. */
    static String json(FreeColObject display) {
        final List<String> quoted = new ArrayList<>();
        for (String key : keys(display)) quoted.add(Json.quote(key));
        return Json.array(quoted);
    }
}
