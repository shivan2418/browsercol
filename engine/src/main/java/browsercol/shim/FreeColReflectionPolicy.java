package browsercol.shim;

import java.util.Set;
import java.util.function.Predicate;

import org.teavm.extension.introspect.IntrospectClass;
import org.teavm.extension.spi.reflection.SimpleReflectionPolicy;

/**
 * Tells TeaVM which classes FreeCol reaches by reflection: model, AI and
 * message classes are created by name (Specification.newType,
 * Game.newInstance, Message.read) and their get/set methods are called
 * by name (Introspector). Client classes stay out so Swing is not pulled in.
 */
public class FreeColReflectionPolicy extends SimpleReflectionPolicy {

    /** Methods FreeCol's rules name for Operand and Scope to call. */
    private static final String[] SPEC_METHODS = {
        "getNationID", "getNationType", "getSoL", "isConnectedPort",
        "isForested", "isIndian", "isWater",
        "getType",  // Scope.appliesTo
    };

    /**
     * Fields the server sends as partial updates (Introspector get/set).
     * "id" is PartialMessage's own attribute, which it passes on with the
     * rest to InGameController.partialHandler; setId with the same id
     * changes nothing (FreeColObject.setId only stores it).
     */
    private static final String[] PARTIAL_FIELDS = {
        "attackedByPrivateers", "bankrupt", "dead", "experience", "gold",
        "hitPoints", "id", "immigration", "immigrationRequired",
        "independentNationName", "liberty", "movesLeft", "name",
        "newLandName", "playerType", "score", "spanishSuccession", "tax",
    };

    private static final String[] METHODS = methods();

    private static String[] methods() {
        java.util.List<String> ret = new java.util.ArrayList<>(java.util.Arrays.asList(SPEC_METHODS));
        for (String f : PARTIAL_FIELDS) {
            String cap = Character.toUpperCase(f.charAt(0)) + f.substring(1);
            ret.add("get" + cap);
            ret.add("set" + cap);
        }
        return ret.toArray(new String[0]);
    }

    /**
     * TeaVM 0.16 can call these predicates with null, and its own
     * extending() and inPackage() helpers then fail.  Like extending(),
     * which also fails with a null pointer when it meets an
     * unresolvable class name: walk the superclass chain by name.
     */
    private static Predicate<IntrospectClass<?>> subclassOf(String... names) {
        Set<String> set = Set.of(names);
        return cls -> {
            if (cls == null) return false;
            for (IntrospectClass<?> c = cls; c != null; c = c.superclass()) {
                if (set.contains(c.name())) return true;
            }
            return false;
        };
    }

    @Override
    protected void setup() {
        selectClasses(subclassOf("net.sf.freecol.common.model.FreeColObject",
                                 "net.sf.freecol.common.networking.Message")
                .and(cls -> !cls.name().startsWith("net.sf.freecol.client.")))
            .foundByName()
            .reflectableMethods(named("<init>").or(namedEither(METHODS)));
        // Introspector converts option values to and from strings.
        selectClasses(cls -> cls != null && cls.name().startsWith("java.lang.")
                && cls.name().indexOf('.', "java.lang.".length()) < 0)
            .reflectableMethods(namedEither("valueOf", "name"));
    }
}
