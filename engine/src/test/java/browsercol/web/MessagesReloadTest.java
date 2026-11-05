package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import net.sf.freecol.common.i18n.Messages;

/** Reloading the static bundle must never show a reader an empty or half-filled one (#228). */
class MessagesReloadTest {

    @Test
    void aReaderNeverSeesTheBundleCleared() throws Exception {
        Messages.loadMessageBundle(Locale.US);
        AtomicReference<String> miss = new AtomicReference<>();
        Thread reader = new Thread(() -> {
            long end = System.nanoTime() + 3_000_000_000L;
            while (System.nanoTime() < end && miss.get() == null) {
                if (!Messages.containsKey("model.option.languageOption.name")) {
                    miss.set("key missing during reload");
                }
            }
        });
        reader.start();
        for (int i = 0; i < 15 && reader.isAlive(); i++) Messages.loadMessageBundle(Locale.US);
        reader.join();
        assertNull(miss.get());
    }
}
