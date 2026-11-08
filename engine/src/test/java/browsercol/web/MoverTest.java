package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.Test;

import net.sf.freecol.common.model.Game;

/**
 * The page is told each time the current player changes during an AI round (the mover event), with the
 * player's nation name, whether it is native, its colour, and whether it is ours.
 */
class MoverTest {

    @Test
    void eachPlayersTurnIsToldToThePage() throws Exception {
        final ExecutorService toClient = Executors.newSingleThreadExecutor();
        final ExecutorService toServer = Executors.newSingleThreadExecutor();
        final CountDownLatch done = new CountDownLatch(1);
        final List<String> movers = new CopyOnWriteArrayList<>();
        final ServerEngine[] server = new ServerEngine[1];
        final ClientEngine[] client = new ClientEngine[1];
        try {
            server[0] = new ServerEngine(xml -> toClient.execute(() -> client[0].receive(xml)));
            client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                    public void connect() { server[0].connect(); }
                    public void post(String xml) { toServer.execute(() -> server[0].receive(xml)); }
                }, new ClientEngine.Listener() {
                    public void gameStarted(Game game) { }
                    public void roundDone(int round, long millis) { }
                    public void finished(Game game) { done.countDown(); }
                }, new WebGUI.BrowserUI() {
                    public void show(String kind, String json) {
                        if ("mover".equals(kind)) movers.add(json);
                    }
                    public void ask(int id, String kind, String json) { client[0].answer(id, null); }
                });
            server[0].startGame("classic");
            assertTrue(client[0].startGame(1), "login");
            FirstTurn.await(done);
            // The AI players' turns, then ours again.
            assertTrue(movers.size() >= 3, movers.toString());
            final String last = movers.get(movers.size() - 1);
            assertTrue(last.contains("\"ours\":true"), last);
            assertTrue(movers.stream().anyMatch(m -> m.contains("\"ours\":false") && m.contains("\"native\":false")), movers.toString());
            assertTrue(movers.stream().anyMatch(m -> m.contains("\"native\":true")), movers.toString());
            for (String m : movers) {
                assertTrue(m.contains("\"name\":\"") && !m.contains("\"name\":\"\""), m);
                assertTrue(m.contains("\"rgb\":") && m.contains("\"fg\":"), m);
            }
        } finally {
            toClient.shutdownNow();
            toServer.shutdownNow();
        }
    }
}
