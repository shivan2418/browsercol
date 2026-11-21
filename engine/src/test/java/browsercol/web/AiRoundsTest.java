package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Game;


/**
 * A new random game plays several rounds of AI on the square grid without
 * errors (#526): the AIs explore, settle and trade over the new map with
 * its distances and rings, and no turn hangs or throws.
 */
class AiRoundsTest {

    private static final int ROUNDS = 8;

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private void playRounds(String preset) throws Exception {
        final CountDownLatch[] finished = { new CountDownLatch(1) };
        final int[] rounds = new int[1];
        final ClientEngine[] client = new ClientEngine[1];
        final ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) { toServer.execute(() -> server.receive(xml)); }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { rounds[0] = round; }
                public void finished(Game game) { finished[0].countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) { }
                public void ask(int id, String kind, String json) {
                    client[0].answer(id, null);
                }
            });
        server.startGame("classic", GamePreset.parse(preset));
        assertTrue(client[0].startGame(0), "login");
        FirstTurn.await(finished[0]);
        assertEquals(58, server.getGame().getMap().getWidth(), "the default map is 58x72");
        assertEquals(72, server.getGame().getMap().getHeight());
        final int turn = client[0].getGame().getTurn().getNumber();
        finished[0] = new CountDownLatch(1);
        client[0].skipTurns(ROUNDS);
        assertTrue(finished[0].await(240, TimeUnit.SECONDS), "play comes back after the AI's rounds");
        assertEquals(turn + ROUNDS, client[0].getGame().getTurn().getNumber());
        assertEquals(ROUNDS, rounds[0]);
        assertTrue(FirstTurn.reported().isEmpty(), "no errors: " + FirstTurn.reported());
    }

    @Test
    @Timeout(300)
    void aRandomGamePlaysSeveralAiRounds() throws Exception {
        playRounds("{ \"seed\": 11 }");
    }

    @Test
    @Timeout(300)
    void aSecondSeedDoesToo() throws Exception {
        playRounds("{ \"seed\": 12 }");
    }
}
