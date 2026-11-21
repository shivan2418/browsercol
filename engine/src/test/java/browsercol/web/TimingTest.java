package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;


/** The timing probes do nothing, and make nothing, until the page that times installs one. */
public class TimingTest {

    @AfterEach
    void uninstall() {
        Timing.install(null);
    }

    @Test
    void withNoProbeNothingIsReported() {
        assertFalse(Timing.on());
        assertEquals(0.0, Timing.now());
        // Nothing to call, nothing to fail.
        Timing.mark("a");
        Timing.measure("b", 0);
    }

    @Test
    void anInstalledProbeHearsOfMarksAndMeasures() {
        final List<String> heard = new ArrayList<>();
        Timing.install(new Timing.Probe() {
            public double now() { return 5; }
            public void measure(String name, double start) { heard.add("measure " + name + " " + start); }
            public void mark(String name) { heard.add("mark " + name); }
        });
        assertTrue(Timing.on());
        assertEquals(5.0, Timing.now());
        Timing.mark("a");
        Timing.measure("b", 2);
        assertEquals(List.of("mark a", "measure b 2.0"), heard);
    }
}
