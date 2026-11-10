package browsercol.web;

import java.lang.reflect.Field;
import java.util.Map;

import net.sf.freecol.common.i18n.NameCache;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;

/**
 * Forget the players FreeCol's NameCache keeps. It keeps each player's
 * capital, settlement and ship names in static maps keyed by the Player,
 * and a Player is equal only to one of the same game, so every game a
 * test JVM makes, the server's and the client's, stays reachable through
 * them for good: about 17 MB a game, which took a test fork past 1.3 GB
 * after GC and out of its 2 GB heap under load (#439). FreeCol has no
 * call to clear them, so this clears them as a fresh JVM has them.
 * Registered for every test through the service file and
 * junit-platform.properties.
 */
public class ClearNameCache implements AfterEachCallback {

    /** Each map and the lock NameCache takes for it. */
    private static final String[][] MAPS = {
        { "capitalNames", "settlementNameLock" },
        { "settlementNames", "settlementNameLock" },
        { "shipNames", "shipNameLock" },
    };

    @Override
    public void afterEach(ExtensionContext context) throws ReflectiveOperationException {
        for (String[] m : MAPS) {
            final Map<?, ?> map = (Map<?, ?>)field(m[0]);
            synchronized (field(m[1])) {
                map.clear();
            }
        }
    }

    private static Object field(String name) throws ReflectiveOperationException {
        Field f = NameCache.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(null);
    }
}
