package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.util.HexFormat;
import java.util.Random;

import org.junit.jupiter.api.Test;

import net.sf.freecol.common.util.Utils;


/**
 * The patched Utils writes and reads a Random's state without Java
 * serialization, in the bytes desktop FreeCol writes and reads with it.
 */
class RandomStateTest {

    /** From a save written by desktop FreeCol 1.2.0 on Java 21. */
    private static final String DESKTOP_STATE = "ACED0005737200106A6176612E7574696C2E52616E646F6D363296344BF00A530300035A0014686176654E6578744E657874476175737369616E4400106E6578744E657874476175737369616E4A0004736565647870000000000000000000000079F5ADFCB2ED78";

    private static String serialize(Random random) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ObjectOutputStream oos = new ObjectOutputStream(bos)) {
            oos.writeObject(random);
        }
        return HexFormat.of().withUpperCase().formatHex(bos.toByteArray());
    }

    private static Random deserialize(String state) throws Exception {
        byte[] bytes = HexFormat.of().parseHex(state);
        try (ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(bytes))) {
            return (Random) ois.readObject();
        }
    }

    private static void assertSameSequence(Random expected, Random actual) {
        for (int i = 0; i < 100; i++) {
            assertEquals(expected.nextInt(1000), actual.nextInt(1000), "draw " + i);
        }
        assertEquals(expected.nextLong(), actual.nextLong());
        assertEquals(expected.nextDouble(), actual.nextDouble());
    }

    @Test
    void theStateIsWhatJavaSerializationWritesForTheSameGenerator() throws Exception {
        for (long seed : new long[] { 0, 1, -1, 42, 0x7FFF_FFFF_FFFF_FFFFL, System.nanoTime() }) {
            Random random = new Random(seed);
            random.nextInt();
            String state = Utils.getRandomState(random);
            // getRandomState reseeds the generator, so serializing it
            // now gives the bytes desktop FreeCol would have written.
            assertEquals(serialize(random), state, "seed " + seed);
        }
    }

    @Test
    void desktopFreeColReadsTheStateAndGoesOnAsTheGameDoes() throws Exception {
        Random random = new Random(1234);
        String state = Utils.getRandomState(random);
        assertSameSequence(random, deserialize(state));
    }

    @Test
    void theStateDesktopFreeColWritesIsRead() throws Exception {
        Random desktop = deserialize(DESKTOP_STATE);
        Random restored = Utils.restoreRandomState(DESKTOP_STATE);
        assertNotNull(restored);
        assertSameSequence(desktop, restored);

        Random other = new Random(99);
        other.nextInt();
        Random copy = Utils.restoreRandomState(serialize(other));
        assertSameSequence(other, copy);
    }

    @Test
    void aWrittenStateReadsBack() throws Exception {
        Random random = new Random(5);
        String state = Utils.getRandomState(random);
        assertSameSequence(random, Utils.restoreRandomState(state.toLowerCase()));
    }

    @Test
    void aBrokenStateReadsAsNone() {
        assertNull(Utils.restoreRandomState(null));
        assertNull(Utils.restoreRandomState(""));
        assertNull(Utils.restoreRandomState("ACED0005"));
        assertNull(Utils.restoreRandomState(DESKTOP_STATE.replace("ED78", "EZ78")));
    }
}
