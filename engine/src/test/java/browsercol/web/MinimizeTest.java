package browsercol.web;

import static net.sf.freecol.common.util.CollectionUtils.maximize;
import static net.sf.freecol.common.util.CollectionUtils.minimize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;


/**
 * #352: {@code minimize} and {@code maximize} answer null when a null is
 * the best of the stream. {@code Unit.getClosestColony} puts one in as a
 * placeholder, and a ship's repair location is Europe when that placeholder
 * wins. They made an Optional of the result, which TeaVM's
 * {@code Optional.of} refuses for null: the server Engine threw a
 * NullPointerException in the browser on a ship battle whose loser's
 * player had no colony that repairs ships. {@code OptionalReducerFix}
 * mends TeaVM; this JVM test holds the behaviour it restores (the wasm
 * side is the combat scenario, which fails on an error banner).
 */
class MinimizeTest {

    /** Null is the least, as the placeholder is in getClosestColony. */
    private static final Comparator<String> BY_LENGTH
        = Comparator.comparingInt(s -> (s == null) ? -1 : s.length());

    @Test
    void aNullThatWinsGivesNull() {
        assertNull(minimize(Stream.of((String)null), BY_LENGTH));
        assertNull(minimize(Stream.of((String)null, "abc", "de"), BY_LENGTH));
        assertNull(maximize(Stream.of((String)null), BY_LENGTH));
        assertNull(maximize(Stream.of((String)null, "abc"), BY_LENGTH.reversed()));
    }

    @Test
    void theBestWinsAndTheFirstOfEqualOnesIs() {
        assertEquals("de", minimize(Stream.of("abc", "de", "fg"), BY_LENGTH));
        assertEquals("ab", maximize(List.of("ab", "cd", "e"), BY_LENGTH));
        assertSame("x", minimize(Stream.of("x", new String("x")), BY_LENGTH));
        assertSame("x", maximize(Stream.of("x", new String("x")), BY_LENGTH));
    }

    @Test
    void nothingGivesNull() {
        assertNull(minimize(Stream.<String>empty(), BY_LENGTH));
        assertNull(maximize(Stream.<String>empty(), BY_LENGTH));
    }
}
