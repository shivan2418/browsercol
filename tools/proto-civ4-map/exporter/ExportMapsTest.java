package browsercol.web;

// THROWAWAY (#405): export two generated maps as MapJson.terrain, for tools/proto-civ4-map.
// export.sh copies this into engine/src/test/java/browsercol/web/ for the run and removes it again.

import java.io.File;
import java.nio.file.Files;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.FreeCol;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.io.FreeColRules;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Specification;

class ExportMapsTest {
    private static Specification spec;

    @BeforeAll
    static void rules() {
        FreeColRules.loadRules();
        Messages.loadMessageBundle(Locale.US);
        spec = FreeCol.loadSpecification(FreeColRules.getFreeColRulesFile("classic"),
                                         null, "model.difficulty.medium");
    }

    private Game game(String preset) throws Exception {
        final ExecutorService toClient = Executors.newSingleThreadExecutor();
        final ExecutorService toServer = Executors.newSingleThreadExecutor();
        final ClientEngine[] client = new ClientEngine[1];
        final CountDownLatch finished = new CountDownLatch(1);
        final ServerEngine server = new ServerEngine(xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) { client[0].answer(id, null); }
            });
        server.startGame("classic", GamePreset.parse(preset));
        client[0].startGame(0);
        FirstTurn.await(finished);
        final Game g = server.getGame();
        toClient.shutdownNow();
        toServer.shutdownNow();
        return g;
    }

    @Test
    @Timeout(600)
    void export() throws Exception {
        final File dir = new File("/work/tools/proto-civ4-map/maps");
        dir.mkdirs();
        final String[][] maps = {
            { "topdown", "{ \"seed\": 3, \"options\": { \"model.option.mapShape\": 0 } }" },
            { "isometric", "{ \"seed\": 3, \"options\": { \"model.option.mapShape\": 1 } }" } };
        for (String[] m : maps) {
            final String json = MapJson.terrain(game(m[1]).getMap());
            Files.writeString(new File(dir, m[0] + ".json").toPath(), json);
        }
    }
}
