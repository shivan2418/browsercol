package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.gui.ChoiceItem;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * FreeCol's client controllers ask the player through the WebGUI, and a
 * fake Browser UI answers, in a Classic game between the two Engines.
 */
class WebGUITest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    /** The fake Browser UI answers on its own thread, after the ask returns. */
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    /** What the fake Browser UI saw, as "kind json". */
    private final List<String> shown = Collections.synchronizedList(new ArrayList<>());
    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());
    /** The answer the fake Browser UI gives to every question. */
    private volatile String answer = null;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /** Start a Classic game and return the client once it is our turn. */
    private ClientEngine startGame() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        ServerEngine server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) {}
                public void roundDone(int round, long millis) {}
                public void finished(Game game) { ourTurn.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    shown.add(kind + " " + json);
                }
                public void ask(int id, String kind, String json) {
                    asked.add(kind + " " + json);
                    ui.execute(() -> client[0].answer(id, answer));
                }
            });
        server.startGame("classic");
        assertTrue(client[0].startGame(0), "login");
        ourTurn.await();
        return client[0];
    }

    @Test
    @Timeout(120)
    void disbandingAUnitWaitsForTheBrowserUIsConfirmation() throws Exception {
        final ClientEngine client = startGame();
        final Unit unit = client.getClient().getMyPlayer().getUnits()
            .filter(u -> !u.isNaval()).findFirst().get();

        answer = "false";
        assertFalse(client.getClient().getInGameController().disbandUnit(unit));
        assertFalse(unit.isDisposed(), "cancel keeps the unit");
        assertEquals(1, asked.size());
        String question = asked.get(0);
        assertTrue(question.startsWith("confirm {"), question);
        assertTrue(question.contains("\"text\":\"Are you sure you want to disband this unit?\""), question);
        assertTrue(question.contains("\"object\":\"" + unit.getId() + "\""), question);
        assertTrue(question.contains("\"tile\":\"" + unit.getTile().getId() + "\""), question);

        answer = "true";
        assertTrue(client.getClient().getInGameController().disbandUnit(unit));
        assertTrue(unit.isDisposed(), "ok disbands the unit");
        assertEquals(2, asked.size());
    }

    @Test
    @Timeout(120)
    void showCallsBecomeEvents() throws Exception {
        final ClientEngine client = startGame();

        // Turn messages may arrive meanwhile; look only at what we caused.
        shown.clear();
        client.getClient().getGUI().refresh();
        client.getClient().getGUI().showInformationPanel("info.enterSomeText");

        assertEquals(List.of("refresh {}",
                "information {\"text\":\"" + Messages.message("info.enterSomeText")
                + "\",\"object\":null,\"tile\":null,\"at\":null,\"ok\":\"OK\"}"),
            shown.stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void theViewFollowsTheActiveUnitAndTheFocus() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit active = gui.getActiveUnit();
        final Tile at = active.getTile();
        final String where = "\"tile\":\"" + at.getId() + "\",\"at\":["
            + at.getX() + "," + at.getY() + "]";

        // reconnectGUI, as SwingGUI's: the active unit, then the focus on it.
        final List<String> view = shown.stream()
            .filter(e -> e.startsWith("activeUnit ") || e.startsWith("focus "))
            .collect(Collectors.toList());
        final int start = view.indexOf("activeUnit {\"unit\":\"" + active.getId() + "\"," + where
            + ",\"force\":false,\"orders\":[\"fortify\",\"sentry\",\"skip\",\"disband\",\"goto\"]}");
        assertTrue(start >= 0, view.toString());
        assertEquals("focus {" + where + "}", view.get(start + 1));

        shown.clear();
        final Tile other = client.getGame().getMap().getTile(1, 2);
        gui.changeView(other);
        gui.setFocus(other);
        gui.changeView();
        final String there = "\"tile\":\"" + other.getId() + "\",\"at\":[1,2]";
        assertEquals(List.of("selectedTile {" + there + "}", "focus {" + there + "}",
                "activeUnit {\"unit\":null,\"tile\":null,\"at\":null,\"force\":false,\"orders\":[]}"),
            shown.stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void choiceAndInputAnswersBecomeWhatTheControllersExpect() throws Exception {
        final GUI gui = startGame().getClient().getGUI();
        final List<ChoiceItem<String>> choices = List.of(
            new ChoiceItem<>("First", "a"),
            new ChoiceItem<>("Second", "b", false),
            new ChoiceItem<>("Third", "c"));
        final StringTemplate explain = StringTemplate.key("info.enterSomeText");

        answer = "2";
        assertEquals("c", gui.modalChoiceDialog(explain, "cancel", choices));
        assertTrue(asked.get(0).contains("{\"text\":\"Second\",\"enabled\":false,"),
                   asked.get(0));
        answer = "1";
        assertNull(gui.modalChoiceDialog(explain, "cancel", choices), "disabled");
        answer = null;
        assertNull(gui.modalChoiceDialog(explain, "cancel", choices), "closed");

        answer = "New Amsterdam";
        assertEquals("New Amsterdam", gui.modalInputDialog(null, explain, "Jamestown", "ok", "cancel"));
        assertTrue(asked.get(3).startsWith("input {"), asked.get(3));
        assertTrue(asked.get(3).contains("\"value\":\"Jamestown\""), asked.get(3));
        answer = null;
        assertNull(gui.modalInputDialog(null, explain, "Jamestown", "ok", "cancel"), "closed");
    }

    @Test
    @Timeout(120)
    void modelMessagesNameTheTileOfTheirSource() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();
        final Tile at = unit.getTile();
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit));
        final String message = "{\"text\":\"" + Messages.message("info.enterSomeText")
            + "\",\"type\":\"DEFAULT\",\"source\":\"" + unit.getId()
            + "\",\"tile\":\"" + at.getId() + "\",\"at\":[" + at.getX() + ","
            + at.getY() + "]}";

        shown.clear();
        gui.showModelMessages(messages);
        gui.showReportTurnPanel(messages);
        assertEquals(List.of(
                "messages {\"title\":null,\"messages\":[" + message + "],\"ok\":\"OK\"}",
                "messages {\"title\":\"" + Messages.message("reportTurnAction.name")
                + "\",\"messages\":[" + message + "],\"ok\":\"OK\"}"),
            shown.stream().filter(e -> e.contains(message)).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void dialogsWithHandlersAskAndPassTheAnswerOn() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();
        final Object[] got = new Object[1];

        answer = "Vinland";
        gui.showNamingDialog(StringTemplate.key("newLand.text"), "New Land",
                             unit, name -> got[0] = name);
        assertEquals("Vinland", got[0]);
        String question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("input {"), question);
        assertTrue(question.contains("\"value\":\"New Land\""), question);

        final List<FoundingFather> ffs = client.getGame().getSpecification()
            .getFoundingFathers().subList(0, 3);
        answer = "1";
        gui.showChooseFoundingFatherDialog(ffs, ff -> got[0] = ff);
        assertEquals(ffs.get(1), got[0]);
        question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("choice {"), question);
        assertTrue(question.contains(Messages.getName(ffs.get(1))), question);
        answer = null;
        gui.showChooseFoundingFatherDialog(ffs, ff -> got[0] = ff);
        assertNull(got[0], "closed: postponed");

        final StringTemplate tax = StringTemplate.template("unused")
            .addName("%newWorld%", "America").addAmount("%number%", 1)
            .addAmount("%amount%", 10).addName("%goods%", "furs");
        answer = "true";
        gui.showMonarchDialog(MonarchAction.RAISE_TAX_ACT, tax, null,
                              b -> got[0] = b);
        assertEquals(Boolean.TRUE, got[0]);
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("raising your tax to 10%"), question);
        assertTrue(question.contains("\"ok\":\"We accept\",\"cancel\":\"Give me Liberty"),
                   question);
        gui.showMonarchDialog(MonarchAction.DISPLEASURE, null, null,
                              b -> got[0] = b);
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("\"ok\":null,\"cancel\":\"Done\""), question);

        answer = "false";
        gui.showEndTurnDialog(List.of(unit));
        question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("confirm {\"text\":\"The following unit is still waiting"),
                   question);
        assertTrue(client.getClient().currentPlayerIsMyPlayer(), "cancel keeps the turn");
    }

    @Test
    @Timeout(120)
    void aDialogWithNoBrowserUIYetIsReportedAndGetsTheDefault() throws Exception {
        final GUI gui = startGame().getClient().getGUI();

        shown.clear();
        assertEquals(-1, gui.showSelectTributeAmountDialog(
            StringTemplate.key("unused"), 10));
        assertEquals(List.of("unasked {\"method\":\"showSelectTributeAmountDialog\"}"),
            shown.stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
        assertTrue(asked.isEmpty(), asked.toString());
    }

    @Test
    @Timeout(120)
    void capturingAndDumpingGoodsGetTheChosenGoods() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Game game = client.getClient().getGame();
        final Unit ship = client.getClient().getMyPlayer().getUnits()
            .filter(Unit::isNaval).findFirst().get();
        final List<Goods> loot = new ArrayList<>();
        final String[] ids = { "model.goods.food", "model.goods.sugar",
                               "model.goods.tobacco" };
        for (String id : ids) {
            loot.add(new Goods(game, null, game.getSpecification().getGoodsType(id), 40));
        }
        final int space = ship.getSpaceLeft();
        assertTrue(space >= 2, "room for the loot");

        final List<List<Goods>> got = new ArrayList<>();
        answer = "[2,0]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        assertEquals(List.of(List.of(loot.get(2), loot.get(0))), got);
        String question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("goods {"), question);
        assertTrue(question.contains("\"max\":" + space), question);
        assertTrue(question.contains("\"icon\":\"image.icon.model.goods.sugar\""), question);
        assertTrue(question.contains("\"amount\":40"), question);

        got.clear();
        answer = "[]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        assertEquals(List.of(List.<Goods>of()), got);

        got.clear();
        answer = null;
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        assertEquals(List.of(List.<Goods>of()), got, "closed: nothing");

        // More than the free holds cannot be taken.
        got.clear();
        answer = "[0,1,2]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        assertEquals(1, got.size());
        assertEquals(Math.min(3, space), got.get(0).size());

        // Dump: the unit's own goods.
        ship.add(new Goods(game, ship, game.getSpecification()
            .getGoodsType("model.goods.rum"), 100));
        ship.add(new Goods(game, ship, game.getSpecification()
            .getGoodsType("model.goods.cotton"), 100));
        final List<Goods> cargo = ship.getGoodsList();
        assertTrue(cargo.size() >= 2, cargo.toString());
        got.clear();
        answer = "[1]";
        gui.showDumpCargoDialog(ship, got::add);
        assertEquals(List.of(List.of(cargo.get(1))), got);
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("\"checked\":true"), question);

        got.clear();
        answer = null;
        gui.showDumpCargoDialog(ship, got::add);
        assertEquals(List.of(List.<Goods>of()), got, "closed: Swing's empty list");
    }

    /** Wait up to a few seconds for the fake Browser UI to have seen a "kind " entry. */
    private String waitFor(List<String> seen, String kindPrefix) throws Exception {
        for (int i = 0; i < 100; i++) {
            synchronized (seen) {
                for (String e : seen) if (e.startsWith(kindPrefix)) return e;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("no " + kindPrefix + " in " + seen);
    }

    @Test
    @Timeout(120)
    void victoryAsksTheServerForTheScoresAndShowsThem() throws Exception {
        final ClientEngine client = startGame();
        final String me = client.getClient().getMyPlayer().getId();
        answer = "false";
        shown.clear();
        client.receive("<gameEnded winner=\"" + me + "\" highScore=\"true\"/>");

        final String scores = waitFor(shown, "highScores ");
        assertTrue(scores.startsWith("highScores {\"text\":\""
            + Messages.message("highscores.yes") + "\",\"scores\":["), scores);
        assertTrue(scores.endsWith("],\"ok\":\"OK\"}"), scores);
        final String victory = waitFor(asked, "confirm ");
        assertTrue(victory.contains("\"text\":\"" + Messages.message("victory.text")), victory);
    }

    @Test
    @Timeout(120)
    void highScoresShowTheFieldsOfFreeColsPanel() throws Exception {
        final ClientEngine client = startGame();
        client.getClient().getMyPlayer().setNewLandName("New Albion");
        final net.sf.freecol.common.model.HighScore h
            = new net.sf.freecol.common.model.HighScore(client.getClient().getMyPlayer());
        shown.clear();
        client.getClient().getGUI().showHighScoresPanel(null, List.of(h));

        final String e = shown.get(0);
        final String name = client.getClient().getMyPlayer().getName();
        assertTrue(e.startsWith("highScores {\"text\":null,\"scores\":[{\"score\":"
            + h.getScore() + ",\"headline\":\"" + Messages.message(StringTemplate
                .template("report.highScores.governor").addName("%name%", name)
                .addName("%nation%", h.getNewLandName())) + "\","), e);
        assertTrue(e.contains("{\"label\":\"" + Messages.message("report.highScores.colonies")
            + "\",\"value\":\"" + h.getColonyCount() + "\"}"), e);
        assertTrue(e.contains("{\"label\":\"" + Messages.message("report.highScores.independence")
            + "\",\"value\":\"" + Messages.message("no") + "\"}"), e);
        assertTrue(e.contains("{\"label\":\"" + Messages.message("report.highScores.units")
            + "\",\"value\":\"" + h.getUnitCount() + "\"}"), e);

        shown.clear();
        client.getClient().getGUI().showHighScoresPanel("highscores.no", null);
        assertEquals("highScores {\"text\":\"" + Messages.message("highscores.no")
            + "\",\"scores\":[],\"ok\":\"OK\"}", shown.get(0));
    }

    @Test
    @Timeout(120)
    void defeatAsksFreeColsGameOverQuestion() throws Exception {
        final ClientEngine client = startGame();
        // ok is "revenge"; cancel ("quit") would log the client out, ending the game.
        answer = "true";
        client.getClient().getInGameController()
            .setDeadHandler(client.getClient().getMyPlayer());
        final String q = waitFor(asked, "confirm ");
        assertTrue(q.startsWith("confirm {\"text\":\"You have been defeated!\\n"), q);
        assertTrue(q.contains("\"ok\":\"" + Messages.message("defeatedSinglePlayer.yes")
            + "\",\"cancel\":\"" + Messages.message("quit") + "\",\"defaultOk\":true"), q);
    }
}
