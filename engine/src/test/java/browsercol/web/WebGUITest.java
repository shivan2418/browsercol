package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.ClientOptions;
import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.client.gui.ChoiceItem;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.DiplomaticTrade;
import net.sf.freecol.common.model.DiplomaticTrade.TradeContext;
import net.sf.freecol.common.model.DiplomaticTrade.TradeStatus;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileType;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerPlayer;


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
    /** While true the fake Browser UI leaves questions unanswered, in held. */
    private volatile boolean hold = false;
    private final List<Integer> held = Collections.synchronizedList(new ArrayList<>());
    /** The server Engine of the game startGame started. */
    private ServerEngine server;

    /**
     * What the fake Browser UI saw, as a copy: the client thread appends to
     * shown while the tests read it, and a synchronized list's stream is
     * not locked, so the live list must not be streamed.
     */
    private List<String> shown() {
        return new ArrayList<>(shown);
    }

    /** Wait for a deferred dialog's handler to have answered n times. */
    private static void awaitCount(List<?> got, int n) throws Exception {
        for (int i = 0; i < 3000 && got.size() < n; i++) Thread.sleep(10);
        assertEquals(n, got.size());
    }

    /** Wait for a deferred dialog's handler to give its answer. */
    private static <T> T await(CompletableFuture<T> future) throws Exception {
        return future.get(30, TimeUnit.SECONDS);
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /** The player name client option to log in with, or null for FreeCol's default. */
    private String playerName = null;

    /** Start a Classic game and return the client once it is our turn. */
    private ClientEngine startGame() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        final ClientEngine[] client = new ClientEngine[1];
        this.server = new ServerEngine(
            xml -> toClient.execute(() -> client[0].receive(xml)));
        client[0] = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { WebGUITest.this.server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> WebGUITest.this.server.receive(xml));
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
                    if (hold) {
                        held.add(id);
                    } else {
                        ui.execute(() -> client[0].answer(id, answer));
                    }
                }
            });
        this.server.startGame("classic");
        if (this.playerName != null) client[0].setClientOption(ClientOptions.NAME, this.playerName);
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
                + "\",\"object\":null,\"tile\":null,\"at\":null,\"images\":[],\"ok\":\"OK\"}"),
            shown().stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void soundsGoToTheBrowserUIAsTheirResourceKeys() throws Exception {
        final GUI gui = startGame().getClient().getGUI();

        shown.clear();
        gui.playSound("sound.event.loadCargo");
        gui.playSound(null);
        assertEquals(List.of("sound {\"key\":\"sound.event.loadCargo\"}", "sound {\"key\":null}"),
            shown().stream().filter(e -> e.startsWith("sound ")).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void anInformationPanelPlaysTheAlertSoundWhenAudioAlertsAreOn() throws Exception {
        final FreeColClient client = startGame().getClient();
        final GUI gui = client.getGUI();
        final List<String> kinds = new ArrayList<>();

        shown.clear();
        gui.showInformationPanel("info.enterSomeText");
        client.getClientOptions().setBoolean(ClientOptions.AUDIO_ALERTS, true);
        gui.showInformationPanel("info.enterSomeText");
        for (String e : shown()) {
            if (e.startsWith("sound ") || e.startsWith("information ")) kinds.add(e.substring(0, e.indexOf(" {")));
        }
        assertEquals(List.of("information", "sound", "information"), kinds);
        assertTrue(shown().contains("sound {\"key\":\"sound.event.alertSound\"}"), shown().toString());
    }

    @Test
    @Timeout(120)
    void theMenuBarUpdateSendsARefresh() throws Exception {
        final GUI gui = startGame().getClient().getGUI();

        shown.clear();
        gui.updateMenuBar();
        assertEquals(List.of("refresh {}"),
            shown().stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
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
        final List<String> view = shown().stream()
            .filter(e -> e.startsWith("activeUnit ") || e.startsWith("focus "))
            .collect(Collectors.toList());
        final int start = view.indexOf("activeUnit {\"unit\":\"" + active.getId() + "\"," + where
            + ",\"force\":false,\"orders\":[\"fortify\",\"sentry\",\"skip\",\"disband\",\"rename\",\"goto\",\"assignRoute\",\"unload\"],\"route\":null}");
        assertTrue(start >= 0, view.toString());
        assertEquals("focus {" + where + "}", view.get(start + 1));

        shown.clear();
        final Tile other = client.getGame().getMap().getTile(1, 2);
        gui.changeView(other);
        gui.setFocus(other);
        gui.changeView();
        final String there = "\"tile\":\"" + other.getId() + "\",\"at\":[1,2]";
        assertEquals(List.of("selectedTile {" + there + "}", "focus {" + there + "}",
                "activeUnit {\"unit\":null,\"tile\":null,\"at\":null,\"force\":false,\"orders\":[],\"route\":null}"),
            shown().stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
    }

    @Test
    @Timeout(120)
    void theActiveUnitsMoveIsSentToSlide() throws Exception {
        final ClientEngine client = startGame();
        final Unit unit = client.getClient().getGUI().getActiveUnit();
        final Tile from = unit.getTile();
        net.sf.freecol.common.model.Direction way = null;
        for (net.sf.freecol.common.model.Direction d
                 : net.sf.freecol.common.model.Direction.values()) {
            if (unit.getMoveType(d) == Unit.MoveType.MOVE) { way = d; break; }
        }
        assertNotNull(way, "the active unit has somewhere to go");
        final Tile to = from.getNeighbourOrNull(way);

        shown.clear();
        client.getClient().getInGameController().moveDirection(unit, way, false);
        final String prefix = "animateMove ";
        for (int i = 0; i < 200 && shown().stream().noneMatch(e -> e.startsWith(prefix)); i++) {
            Thread.sleep(50);
        }
        final List<String> moves = shown().stream().filter(e -> e.startsWith(prefix))
            .collect(Collectors.toList());
        assertEquals(1, moves.size(), shown().toString());
        @SuppressWarnings("unchecked")
        final Map<String, Object> move
            = (Map<String, Object>)JsonReader.read(moves.get(0).substring(prefix.length()));
        assertEquals(unit.getId(), move.get("unit"));
        assertEquals(List.of((long)from.getX(), (long)from.getY()), move.get("from"));
        assertEquals(List.of((long)to.getX(), (long)to.getY()), move.get("to"));
        assertEquals(MapJson.unitKeys(unit), move.get("keys"));
        assertNull(move.get("speed"), "the player's own unit slides at the page's own speed");
    }

    @Test
    @Timeout(120)
    void anotherPlayersMoveIsSentWithTheEnemyOrFriendlySpeed() throws Exception {
        final ClientEngine client = startGame();
        final net.sf.freecol.client.FreeColClient fc = client.getClient();
        final net.sf.freecol.common.model.Player me = fc.getMyPlayer();
        // The client sees none of another player's units at the start: lend one of ours to another player.
        final Unit other = fc.getGUI().getActiveUnit();
        final net.sf.freecol.common.model.Player owner = fc.getGame().getLiveEuropeanPlayerList(me).get(0);
        other.setOwner(owner);
        final Tile from = other.getTile();
        final Tile to = from.getNeighbourOrNull(net.sf.freecol.common.model.Direction.N) != null
            ? from.getNeighbourOrNull(net.sf.freecol.common.model.Direction.N)
            : from.getNeighbourOrNull(net.sf.freecol.common.model.Direction.S);

        shown.clear();
        fc.getGUI().animateUnitMove(other, from, to);
        final String prefix = "animateMove ";
        for (int i = 0; i < 200 && shown().stream().noneMatch(e -> e.startsWith(prefix)); i++) {
            Thread.sleep(50);
        }
        final List<String> moves = shown().stream().filter(e -> e.startsWith(prefix))
            .collect(Collectors.toList());
        assertEquals(1, moves.size(), shown().toString());
        @SuppressWarnings("unchecked")
        final Map<String, Object> move
            = (Map<String, Object>)JsonReader.read(moves.get(0).substring(prefix.length()));
        assertEquals(other.getId(), move.get("unit"));
        assertEquals((long)fc.getAnimationSpeed(other.getOwner()), move.get("speed"));
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

    /**
     * The messages events shown so far that these tests caused, parsed.
     * Turn messages may arrive meanwhile, so only events of the tests'
     * own message text count.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> messageEvents() {
        final List<Map<String, Object>> events = new ArrayList<>();
        for (String e : shown()) {
            if (e.startsWith("messages ")) {
                final Map<String, Object> event
                    = (Map<String, Object>)JsonReader.read(e.substring("messages ".length()));
                if (messagesOf(event).stream().allMatch(m -> Messages.message("info.enterSomeText")
                        .equals(m.get("text")))) {
                    events.add(event);
                }
            }
        }
        return events;
    }

    /** The message shown last whose text is that of this message. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> shownMessage(ModelMessage message) {
        final String text = Messages.message(message);
        Map<String, Object> found = null;
        for (String e : shown()) {
            if (!e.startsWith("messages ")) continue;
            for (Map<String, Object> m : messagesOf(
                     (Map<String, Object>)JsonReader.read(e.substring("messages ".length())))) {
                if (text.equals(m.get("text"))) found = m;
            }
        }
        assertNotNull(found, "no message: " + text);
        return found;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> messagesOf(Map<String, Object> event) {
        return (List<Map<String, Object>>)event.get("messages");
    }

    /** The last turn report shown. */
    private Map<String, Object> lastReport() {
        Map<String, Object> last = null;
        for (Map<String, Object> e : messageEvents()) {
            if (e.get("title") != null) last = e;
        }
        return last;
    }

    /** What a report holds, as "TYPE source", then " heading" or " heading:text" if one starts there. */
    private static List<String> describe(Map<String, Object> report, boolean headingText) {
        return messagesOf(report).stream().map(m -> {
                final Object h = m.get("heading");
                return m.get("type") + " " + m.get("source")
                    + ((h == null) ? "" : headingText
                        ? " heading:" + ((Map<?, ?>)h).get("text") : " heading");
            }).collect(Collectors.toList());
    }

    @Test
    @Timeout(120)
    void modelMessagesNameTheTileAndImageOfTheirSource() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();
        final Tile at = unit.getTile();
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit));

        shown.clear();
        gui.showModelMessages(messages);
        final Map<String, Object> event = messageEvents().get(0);
        assertNull(event.get("title"));
        assertNull(event.get("groupBy"), "only the turn report has the option");
        final Map<String, Object> m = messagesOf(event).get(0);
        assertEquals(Messages.message("info.enterSomeText"), m.get("text"));
        assertEquals("DEFAULT", m.get("type"));
        assertEquals(unit.getId(), m.get("source"));
        assertEquals(at.getId(), m.get("tile"));
        assertEquals(List.of((long)at.getX(), (long)at.getY()), m.get("at"));
        assertNull(m.get("heading"));
        assertEquals(ObjectImages.keys(unit), m.get("images"));
        assertTrue(((String)((List<?>)m.get("images")).get(0))
            .startsWith("image.unit." + unit.getType().getId()), m.toString());
        assertNull(m.get("filterTip"), "a model message has no buttons");
        assertNull(m.get("ignoreTip"));
        assertNull(m.get("link"), "a unit on the map opens nothing");
    }

    @Test
    @Timeout(120)
    @SuppressWarnings("unchecked")
    void aMessageAboutEuropeLinksToEurope() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Europe europe = client.getClient().getMyPlayer().getEurope();
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.DEFAULT, "info.enterSomeText", europe));

        shown.clear();
        gui.showModelMessages(messages);
        final Map<String, Object> m = messagesOf(messageEvents().get(0)).get(0);
        assertEquals(Map.of("kind", "europe"), m.get("link"));
    }

    @Test
    @Timeout(120)
    void aMessageNamingOurColonyLinksTheNameToTheColony() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Game game = client.getGame();
        final Player me = client.getClient().getMyPlayer();
        // Only its name and owner count: the name is looked up, as in Swing.
        final Colony ours = new Colony(game, "colony:ourtown");
        ours.setName("Ourtown");
        ours.setOwner(me);
        me.addSettlement(ours);
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.WARNING, "model.colony.famineFeared", gui.getActiveUnit())
            .addName("%colony%", "Ourtown").addAmount("%number%", 3));

        shown.clear();
        gui.showReportTurnPanel(messages);
        final Map<String, Object> m = shownMessage(messages.get(0));
        final List<?> parts = (List<?>)m.get("parts");
        assertEquals(3, parts.size(), parts.toString());
        final Map<?, ?> name = (Map<?, ?>)parts.get(1);
        assertEquals("Ourtown", name.get("text"));
        assertEquals(Map.of("kind", "colony", "id", ours.getId()), name.get("link"));
        assertNull(name.get("at"));
        final Map<?, ?> before = (Map<?, ?>)parts.get(0);
        assertNull(before.get("link"));
        assertEquals(m.get("text"), before.get("text") + "Ourtown" + ((Map<?, ?>)parts.get(2)).get("text"));
    }

    @Test
    @Timeout(120)
    void aMessageNamingAnothersColonyLinksTheNameToItsTile() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Colony known = seen(client, aiColony(client));
        assertNotNull(known, "the human sees the colony");
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.DEFAULT, "model.colony.famineFeared", known)
            .addName("%colony%", known.getName()).addAmount("%number%", 3));

        shown.clear();
        gui.showModelMessages(messages);
        final List<?> parts = (List<?>)shownMessage(messages.get(0)).get("parts");
        final Map<?, ?> name = (Map<?, ?>)parts.get(1);
        assertEquals(known.getName(), name.get("text"));
        assertNull(name.get("link"));
        assertEquals(List.of((long)known.getTile().getX(), (long)known.getTile().getY()), name.get("at"));
    }

    @Test
    @Timeout(120)
    void aMessageWithNothingToLinkIsOnePlainPart() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final List<ModelMessage> messages = List.of(new ModelMessage(
                ModelMessage.MessageType.DEFAULT, "info.enterSomeText", gui.getActiveUnit()));

        shown.clear();
        gui.showModelMessages(messages);
        final Map<String, Object> m = messagesOf(messageEvents().get(0)).get(0);
        final Map<String, Object> plain = new java.util.HashMap<>();
        plain.put("text", m.get("text"));
        plain.put("link", null);
        plain.put("at", null);
        assertEquals(List.of(plain), m.get("parts"));
    }

    @Test
    @Timeout(120)
    void aMessagesImageIsThatOfItsDisplayObject() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();
        final Player me = client.getClient().getMyPlayer();
        final Specification spec = client.getGame().getSpecification();
        final GoodsType goods = spec.getGoodsTypeList().get(0);
        final BuildingType building = spec.getBuildingTypeList().get(0);
        final TileType type = spec.getTileTypeList().get(0);
        final List<ModelMessage> messages = List.of(
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit, goods),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit, building),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit, type),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit, me),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", unit, me.getEurope()));

        shown.clear();
        gui.showModelMessages(messages);
        assertEquals(List.of(
                List.of("image.icon." + goods.getId()),
                List.of("image.buildingicon." + building.getId()),
                List.of("image.tile." + type.getId() + ".center"),
                List.of("image.miscicon." + me.getNation().getId()),
                List.of()),
            messagesOf(messageEvents().get(0)).stream().map(m -> m.get("images"))
                .collect(Collectors.toList()),
            "Europe has no image, as in Swing");
    }

    @Test
    @Timeout(120)
    void theTurnReportIsGroupedAsTheClientOptionSays() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final ClientOptions options = client.getClient().getClientOptions();
        final List<Unit> units = client.getClient().getMyPlayer().getUnits()
            .filter(u -> !u.isNaval()).collect(Collectors.toList());
        final Unit first = units.get(0);
        final Unit second = units.get(1);
        // Interleaved, and a source's warning before its default message.
        final List<ModelMessage> messages = List.of(
            new ModelMessage(ModelMessage.MessageType.WARNING, "info.enterSomeText", first),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", second),
            new ModelMessage(ModelMessage.MessageType.DEFAULT, "info.enterSomeText", first));

        // Swing's default is not to group at all.
        shown.clear();
        gui.showReportTurnPanel(messages);
        assertEquals(List.of("WARNING " + first.getId(), "DEFAULT " + second.getId(),
                "DEFAULT " + first.getId()),
            describe(lastReport(), false), "as they come");
        final Map<?, ?> groupBy = (Map<?, ?>)lastReport().get("groupBy");
        assertEquals(0L, groupBy.get("value"));
        assertEquals(Messages.message("model.option.guiMessagesGroupBy.name"), groupBy.get("label"));
        assertEquals(List.of("Nothing", "Type", "Source"),
            ((List<?>)groupBy.get("choices")).stream()
                .map(c -> ((Map<?, ?>)c).get("text")).collect(Collectors.toList()));
        assertEquals(false, lastReport().get("regrouped"));

        options.setInteger(ClientOptions.MESSAGES_GROUP_BY,
                           ClientOptions.MESSAGES_GROUP_BY_SOURCE);
        gui.showReportTurnPanel(messages);
        assertEquals(List.of("DEFAULT " + first.getId() + " heading",
                "WARNING " + first.getId(), "DEFAULT " + second.getId() + " heading"),
            describe(lastReport(), false));

        options.setInteger(ClientOptions.MESSAGES_GROUP_BY,
                           ClientOptions.MESSAGES_GROUP_BY_TYPE);
        gui.showReportTurnPanel(messages);
        assertEquals(List.of("DEFAULT " + second.getId() + " heading:"
                    + Messages.getName(ModelMessage.MessageType.DEFAULT),
                "DEFAULT " + first.getId(),
                "WARNING " + first.getId() + " heading:"
                    + Messages.getName(ModelMessage.MessageType.WARNING)),
            describe(lastReport(), true));
        assertNull(((Map<?, ?>)messagesOf(lastReport()).get(0).get("heading")).get("tile"),
                   "a type has no tile to go to");
    }

    @Test
    @Timeout(120)
    void thePreferencesWindowReadsAndSetsTheClientOptions() throws Exception {
        final ClientEngine client = startGame();
        final ClientOptions options = client.getClient().getClientOptions();
        final Map<?, ?> values = (Map<?, ?>)JsonReader.read(client.clientOptionValues());
        assertEquals(true, values.get(ClientOptions.SHOW_PRECOMBAT), "a boolean, nested in its group");
        assertEquals(0L, values.get(ClientOptions.INDIAN_DEMAND_RESPONSE), "a select option");
        assertEquals(0L, values.get(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS), "an integer");
        assertEquals("Autosave", values.get(ClientOptions.AUTO_SAVE_PREFIX), "a text option");

        assertTrue(client.setClientOption(ClientOptions.SHOW_PRECOMBAT, "false"));
        assertFalse(options.getBoolean(ClientOptions.SHOW_PRECOMBAT));
        assertTrue(client.setClientOption(ClientOptions.INDIAN_DEMAND_RESPONSE,
            String.valueOf(ClientOptions.INDIAN_DEMAND_RESPONSE_REJECT)));
        assertEquals(ClientOptions.INDIAN_DEMAND_RESPONSE_REJECT,
            options.getInteger(ClientOptions.INDIAN_DEMAND_RESPONSE));
        assertTrue(client.setClientOption(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS, "40"));
        assertEquals(40, options.getInteger(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS));
        assertEquals(false, ((Map<?, ?>)JsonReader.read(client.clientOptionValues()))
            .get(ClientOptions.SHOW_PRECOMBAT), "the values follow");

        // A value that does not fit is refused and changes nothing.
        assertFalse(client.setClientOption(ClientOptions.SHOW_PRECOMBAT, "yes"));
        assertFalse(client.setClientOption(ClientOptions.INDIAN_DEMAND_RESPONSE, "7"));
        assertFalse(client.setClientOption(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS, "101"));
        assertFalse(client.setClientOption(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS, "x"));
        assertTrue(client.setClientOption(ClientOptions.AUTO_SAVE_PREFIX, "Auto"));
        assertEquals("Auto", options.getText(ClientOptions.AUTO_SAVE_PREFIX));
        assertFalse(client.setClientOption(ClientOptions.USER_MODS, "x"), "a list of mods is not set");
        assertFalse(client.setClientOption("model.option.noSuchOption", "true"));
        assertFalse(options.getBoolean(ClientOptions.SHOW_PRECOMBAT));
        assertEquals(ClientOptions.INDIAN_DEMAND_RESPONSE_REJECT,
            options.getInteger(ClientOptions.INDIAN_DEMAND_RESPONSE));
        assertEquals(40, options.getInteger(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS));
    }

    @Test
    @Timeout(120)
    void aNewGameIsPlayedUnderThePlayerNameOption() throws Exception {
        this.playerName = "Peter Stuyvesant";
        final ClientEngine client = startGame();
        assertEquals("Peter Stuyvesant", client.getClient().getMyPlayer().getName());
    }

    @Test
    @Timeout(120)
    void theTurnReportsButtonsFilterAndIgnoreMessages() throws Exception {
        final ClientEngine client = startGame();
        final WebGUI gui = (WebGUI)client.getClient().getGUI();
        final ClientOptions options = client.getClient().getClientOptions();
        final Unit unit = gui.getActiveUnit();
        final List<ModelMessage> messages = List.of(
            new ModelMessage(ModelMessage.MessageType.WARNING, "info.enterSomeText", unit),
            new ModelMessage(ModelMessage.MessageType.WAREHOUSE_CAPACITY, "info.enterSomeText", unit),
            new ModelMessage(ModelMessage.MessageType.LOST_CITY_RUMOUR, "info.enterSomeText", unit));
        final String option = ModelMessage.MessageType.WAREHOUSE_CAPACITY.getOptionName();

        shown.clear();
        gui.showReportTurnPanel(messages);
        final List<Map<String, Object>> ms = messagesOf(lastReport());
        assertEquals(true, ms.get(1).get("filter"), "the type is shown");
        assertEquals(Messages.message(StringTemplate.template("report.turn.filter")
                .addNamed("%type%", ModelMessage.MessageType.WAREHOUSE_CAPACITY)),
            ms.get(1).get("filterTip"));
        assertEquals(Messages.message(StringTemplate.copy("report.turn.ignore", messages.get(1))),
            ms.get(1).get("ignoreTip"));
        assertNull(ms.get(0).get("ignoreTip"), "only warehouse messages can be ignored");
        assertNull(ms.get(2).get("filter"), "a type with no option has no filter button");
        assertNull(ms.get(2).get("filterTip"));

        gui.reportFilter(1, false);
        assertFalse(options.getBoolean(option), "the type is filtered");
        gui.reportFilter(2, false); // no option: nothing happens
        gui.reportFilter(7, false); // no such message
        // Regrouping shows the report again, replacing the open one.
        gui.reportGroupBy(ClientOptions.MESSAGES_GROUP_BY_TYPE);
        final Map<String, Object> again = lastReport();
        assertEquals(true, again.get("regrouped"));
        assertEquals(ClientOptions.MESSAGES_GROUP_BY_TYPE,
            options.getInteger(ClientOptions.MESSAGES_GROUP_BY));
        final int index = describe(again, false).indexOf("WAREHOUSE_CAPACITY " + unit.getId()
            + " heading");
        assertEquals(false, messagesOf(again).get(index).get("filter"));
        gui.reportGroupBy(9);
        assertEquals(ClientOptions.MESSAGES_GROUP_BY_TYPE,
            options.getInteger(ClientOptions.MESSAGES_GROUP_BY), "not a way to group");
        gui.reportFilter(index, true);
        assertTrue(options.getBoolean(option));

        // The ignore button asks the controller, which then ignores the
        // message in the turns that follow.
        final java.lang.reflect.Field f = InGameController.class.getDeclaredField("messagesToIgnore");
        f.setAccessible(true);
        @SuppressWarnings("unchecked")
        final Map<String, Integer> ignored = (Map<String, Integer>)f.get(
            client.getClient().getInGameController());
        final String key = messages.get(1).getIgnoredMessageKey();
        gui.reportIgnore(index, true);
        assertTrue(ignored.containsKey(key), "ignored");
        gui.reportGroupBy(ClientOptions.MESSAGES_GROUP_BY_SOURCE);
        assertEquals(true, messagesOf(lastReport()).stream()
            .filter(m -> "WAREHOUSE_CAPACITY".equals(m.get("type"))).findFirst().get().get("ignored"),
            "regrouping keeps the message ignored");
        final int at = describe(lastReport(), false).stream()
            .map(d -> d.split(" ")[0]).collect(Collectors.toList()).indexOf("WAREHOUSE_CAPACITY");
        gui.reportIgnore(at, false);
        assertFalse(ignored.containsKey(key), "not ignored any more");
        gui.reportGroupBy(ClientOptions.MESSAGES_GROUP_BY_SOURCE);
        assertEquals(false, messagesOf(lastReport()).stream()
            .filter(m -> "WAREHOUSE_CAPACITY".equals(m.get("type"))).findFirst().get().get("ignored"));
        gui.reportIgnore(describe(lastReport(), false).stream()
            .map(d -> d.split(" ")[0]).collect(Collectors.toList()).indexOf("WARNING"), true);
        assertTrue(ignored.isEmpty(), "a warning cannot be ignored");
    }

    @Test
    @Timeout(120)
    void dialogsWithHandlersAskAndPassTheAnswerOn() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();
        CompletableFuture<Object> got = new CompletableFuture<>();

        answer = "Vinland";
        gui.showNamingDialog(StringTemplate.key("newLand.text"), "New Land",
                             unit, got::complete);
        assertEquals("Vinland", await(got));
        String question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("input {"), question);
        assertTrue(question.contains("\"value\":\"New Land\""), question);

        final List<FoundingFather> ffs = client.getGame().getSpecification()
            .getFoundingFathers().subList(0, 3);
        answer = "1";
        got = new CompletableFuture<>();
        gui.showChooseFoundingFatherDialog(ffs, got::complete);
        assertEquals(ffs.get(1), await(got));
        question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("father {"), question);
        assertTrue(question.contains("\"name\":\"" + Messages.getName(ffs.get(1)) + "\""), question);
        assertTrue(question.contains("\"description\":\""
            + Messages.getDescription(ffs.get(1)) + "\""), question);
        assertTrue(question.contains("\"kind\":\""
            + Messages.message(ffs.get(1).getTypeKey()) + "\""), question);
        assertTrue(question.contains("\"born\":\"" + Messages.message(
            ffs.get(1).getId() + ".birthAndDeath") + "\""), question);
        answer = null;
        got = new CompletableFuture<>();
        gui.showChooseFoundingFatherDialog(ffs, got::complete);
        assertNull(await(got), "closed: postponed");

        final StringTemplate tax = StringTemplate.template("unused")
            .addName("%newWorld%", "America").addAmount("%number%", 1)
            .addAmount("%amount%", 10).addName("%goods%", "furs");
        answer = "true";
        got = new CompletableFuture<>();
        gui.showMonarchDialog(MonarchAction.RAISE_TAX_ACT, tax, null, got::complete);
        assertEquals(Boolean.TRUE, await(got));
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("raising your tax to 10%"), question);
        assertTrue(question.contains("\"ok\":\"We accept\",\"cancel\":\"Give me Liberty"),
                   question);
        assertTrue(question.contains("\"help\":{\"label\":\"Help\",\"colopedia\":\"colopedia.concepts.taxes\""),
                   "a tax raise has a Help button: " + question);
        got = new CompletableFuture<>();
        gui.showMonarchDialog(MonarchAction.DISPLEASURE, null, null, got::complete);
        await(got);
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("\"ok\":null,\"cancel\":\"Done\""), question);
        assertTrue(question.endsWith("\"header\":\"A message from the Crown\"}"), question);
        got = new CompletableFuture<>();
        gui.showMonarchDialog(MonarchAction.HESSIAN_MERCENARIES, null, null, got::complete);
        await(got);
        question = asked.get(asked.size() - 1);
        assertTrue(question.endsWith("\"header\":\"Foreign Correspondence\"}"), question);

        // The end turn dialog asks, and cancel keeps the turn.
        answer = "cancel";
        final int before = asked.size();
        gui.showEndTurnDialog(List.of(unit));
        while (asked.size() == before) Thread.sleep(10);
        question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("endTurn {\"header\":\"End turn\",\"text\":\"The following unit is still waiting"),
                   question);
        assertTrue(question.contains("\"units\":[{\"id\":\"" + unit.getId() + "\",\"name\":\""
                                     + unit.getDescription(Unit.UnitLabelType.NATIONAL) + "\",\"location\":\""),
                   question);
        Thread.sleep(200);
        assertTrue(client.getClient().currentPlayerIsMyPlayer(), "cancel keeps the turn");
    }

    @Test
    @Timeout(120)
    void pickingAWaitingUnitInTheEndTurnDialogMakesItActiveAndLeavesTheDialogOpen() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit active = gui.getActiveUnit();
        final Unit other = client.getClient().getMyPlayer().getUnits()
            .filter(u -> u != active && !u.isNaval()).findFirst().get();

        // The dialog is held open: the pick is a command, not its answer.
        hold = true;
        final int heldBefore = held.size();
        gui.showEndTurnDialog(List.of(active, other));
        while (held.size() == heldBefore) Thread.sleep(10);
        shown.clear();
        assertTrue(client.getCommands().menuEntry("waiting:" + other.getId()));
        while (shown().stream().noneMatch(e -> e.startsWith("activeUnit {\"unit\":\""
                + other.getId() + "\""))) Thread.sleep(10);
        assertEquals(other, gui.getActiveUnit());
        assertTrue(client.getClient().currentPlayerIsMyPlayer(), "picking keeps the turn");
        assertFalse(client.getCommands().menuEntry("waiting:model.noSuch"));
        hold = false;
    }

    @Test
    @Timeout(120)
    void thePreCombatDialogListsBothSidesModifiersAndTheFinalResults() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final List<Unit> mine = client.getClient().getMyPlayer().getUnits()
            .filter(u -> !u.isNaval()).collect(Collectors.toList());
        final Unit attacker = mine.get(0);
        final Unit defender = mine.get(1);

        answer = "true";
        assertTrue(gui.showPreCombatDialog(attacker, defender, defender.getTile()));
        final String question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("preCombat {\"attacker\":\""
                + attacker.getDescription(Unit.UnitLabelType.NATIONAL) + "\",\"defender\":\""
                + defender.getDescription(Unit.UnitLabelType.NATIONAL) + "\",\"offence\":[{\"source\":\""),
            question);
        // A colonist's base offence, 0 here, as ModifierFormat writes it: a sign and two decimals.
        assertTrue(question.contains("\"value\":\"+") || question.contains("\"value\":\"\u00D7"), question);
        assertTrue(question.contains("\"defence\":[{\"source\":\""), question);
        assertTrue(question.contains("\"finalResult\":\"" + Messages.message("finalResult") + "\""), question);
        assertTrue(question.matches(".*\"offenceResult\":\"-?\\d+\\.\\d\\d\",\"defenceResult\":\"-?\\d+\\.\\d\\d\".*"),
            question);

        answer = "false";
        assertFalse(gui.showPreCombatDialog(attacker, defender, defender.getTile()));
        answer = null;
        assertFalse(gui.showPreCombatDialog(attacker, defender, defender.getTile()), "closed");
    }

    @Test
    @Timeout(120)
    void aDialogWithAHandlerReturnsBeforeTheAnswerComes() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final CompletableFuture<Boolean> got = new CompletableFuture<>();

        hold = true;
        final int before = held.size();
        gui.showMonarchDialog(MonarchAction.DISPLEASURE, null, null, got::complete);
        // Returned with the question out and unanswered: a message handler
        // calling this must not wait for the player.
        while (held.size() == before) Thread.sleep(10);
        assertFalse(got.isDone());

        // A second end turn while one waits is not asked again.
        final Unit unit = gui.getActiveUnit();
        final int askedBefore = asked.size();
        gui.showEndTurnDialog(List.of(unit));
        while (asked.size() == askedBefore) Thread.sleep(10);
        gui.showEndTurnDialog(List.of(unit));
        Thread.sleep(200);
        assertEquals(askedBefore + 1, asked.size());

        hold = false;
        for (int id : new ArrayList<>(held)) client.answer(id, "true");
        assertEquals(Boolean.TRUE, await(got));
    }

    /**
     * The select amount dialog asks for an amount of goods, offering the
     * amounts SelectGoodsAmountDialog lists, and returns the one chosen,
     * or -1 when the player cancels.
     */
    @Test
    @Timeout(120)
    void theSelectAmountDialogReturnsTheChosenAmountOrCancels() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final GoodsType furs = client.getGame().getSpecification()
            .getGoodsType("model.goods.furs");

        shown.clear();
        answer = "35";
        assertEquals(35, gui.showSelectAmountDialog(furs, 45, 40, false));
        final String question = asked.get(asked.size() - 1);
        assertEquals("amount {\"text\":\"" + Messages.message("selectAmountDialog.text")
            + "\",\"type\":\"model.goods.furs\",\"name\":\"" + Messages.getName(furs)
            + "\",\"keys\":[\"image.icon.model.goods.furs\"],\"values\":[20,40,45],"
            + "\"value\":40,\"max\":45,\"ok\":\"" + Messages.message("ok")
            + "\",\"cancel\":\"" + Messages.message("cancel") + "\"}", question);
        assertFalse(shown().stream().anyMatch(e -> e.startsWith("unasked ")), shown.toString());

        answer = null;
        assertEquals(-1, gui.showSelectAmountDialog(furs, 45, 40, false), "closed");
        answer = "46";
        assertEquals(-1, gui.showSelectAmountDialog(furs, 45, 40, false), "more than there is");

        // Paying, the most is what the gold buys.
        final Player player = client.getClient().getMyPlayer();
        final int buys = player.getGold() / player.getMarket().getCostToBuy(furs);
        answer = "1";
        gui.showSelectAmountDialog(furs, buys + 50, -1, true);
        assertTrue(asked.get(asked.size() - 1).contains("\"max\":" + buys + ","),
            asked.get(asked.size() - 1));
    }

    @Test
    @Timeout(120)
    void thePanelsTheBaseGUIDropsAreReported() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Unit unit = gui.getActiveUnit();

        shown.clear();
        assertNull(gui.showColonyPanel(null, unit), "no colony: nothing to show");
        gui.showClientOptionsDialog();
        assertFalse(gui.showEditOptionDialog(null), "the base GUI's default");
        assertNull(gui.showEditSettlementDialog(null));
        assertEquals(List.of(
                "showClientOptionsDialog", "showEditOptionDialog",
                "showEditSettlementDialog").stream()
                .map(m -> "unasked {\"method\":\"" + m + "\"}").collect(Collectors.toList()),
            shown().stream().filter(e -> !e.startsWith("messages ")).collect(Collectors.toList()));
        assertTrue(asked.isEmpty(), asked.toString());
    }

    /**
     * The in-game menu's difficulty and game options entries show the
     * game's own option groups, read-only: every option type the groups
     * hold comes with its value, and the values are the game's.
     */
    @Test
    @Timeout(120)
    @SuppressWarnings("unchecked")
    void theOptionEntriesShowTheGamesOptionGroups() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Specification spec = client.getGame().getSpecification();

        shown.clear();
        gui.showDifficultyDialog();
        gui.showGameOptionsDialog(false, null);
        gui.showMapGeneratorOptionsDialog(false, null);
        final List<String> events = shown().stream().filter(e -> e.startsWith("options "))
            .collect(Collectors.toList());
        assertEquals(3, events.size(), shown.toString());
        final Map<String, Object> mapGenerator
            = (Map<String, Object>)JsonReader.read(events.get(2).substring("options ".length()));
        assertEquals("mapGenerator", mapGenerator.get("kind"));
        assertEquals("Map Generator Options", mapGenerator.get("title"));
        assertNotNull(mapGenerator.get("root"));
        final Map<String, Object> difficulty
            = (Map<String, Object>)JsonReader.read(events.get(0).substring("options ".length()));
        final Map<String, Object> game
            = (Map<String, Object>)JsonReader.read(events.get(1).substring("options ".length()));
        assertEquals("difficulty", difficulty.get("kind"));
        assertEquals("game", game.get("kind"));
        assertEquals("Game Options", game.get("title"));

        final Map<String, Map<String, Object>> byId = new java.util.HashMap<>();
        collect((Map<String, Object>)difficulty.get("root"), byId);
        collect((Map<String, Object>)game.get("root"), byId);
        // One of each kind, with the game's own value.
        assertEquals((long)spec.getInteger("model.option.landPriceFactor"),
            byId.get("model.option.landPriceFactor").get("value"));
        assertEquals("integer", byId.get("model.option.landPriceFactor").get("kind"));
        assertEquals("boolean", byId.get("model.option.fogOfWar").get("kind"));
        assertEquals(spec.getBoolean("model.option.fogOfWar"), byId.get("model.option.fogOfWar").get("value"));
        assertEquals("percentage", byId.get("model.option.giftProbability").get("kind"));
        assertEquals("select", byId.get("model.option.startingPositions").get("kind"));
        assertEquals(List.of("Classic", "Random", "Historical"),
            ((List<Map<String, Object>>)byId.get("model.option.startingPositions").get("choices"))
                .stream().map(c -> c.get("label")).collect(Collectors.toList()));
        assertEquals("select", byId.get("model.option.settlementNumber").get("kind"));
        assertEquals("string", byId.get("model.option.buildOnNativeLand").get("kind"));
        assertEquals(List.of(spec.getOption("model.option.buildOnNativeLand",
                net.sf.freecol.common.option.StringOption.class).getValue()),
            ((List<Map<String, Object>>)byId.get("model.option.buildOnNativeLand").get("choices"))
                .stream().map(c -> c.get("value")).collect(Collectors.toList()));
        assertEquals("units", byId.get("model.option.immigrants").get("kind"));
        assertEquals(spec.getOption("model.option.immigrants",
                net.sf.freecol.common.option.UnitListOption.class).getOptionValues().size(),
            ((List<?>)byId.get("model.option.immigrants").get("value")).size());
        assertTrue(asked.isEmpty(), asked.toString());
    }

    @SuppressWarnings("unchecked")
    private static void collect(Map<String, Object> node, Map<String, Map<String, Object>> into) {
        into.put((String)node.get("id"), node);
        final Object children = node.get("children");
        if (children != null) {
            for (Object c : (List<?>)children) collect((Map<String, Object>)c, into);
        }
    }

    /**
     * The Europe panel lists what FreeCol's does: with the game just
     * started the player's ship is not in port, and the market lists
     * every storable goods type; the active unit's cargo is not asked
     * about when no ship is in port.
     */
    @Test
    @Timeout(120)
    @SuppressWarnings("unchecked")
    void theEuropePanelHasTheShipsDocksAndMarket() throws Exception {
        final ClientEngine client = startGame();
        final GUI gui = client.getClient().getGUI();
        final Player me = client.getClient().getMyPlayer();

        shown.clear();
        assertNull(gui.showEuropePanel());
        final List<String> events = shown().stream().filter(e -> e.startsWith("europe "))
            .collect(Collectors.toList());
        assertEquals(1, events.size(), shown.toString());
        final Map<String, Object> panel
            = (Map<String, Object>)JsonReader.read(events.get(0).substring("europe ".length()));
        assertEquals(Messages.getName(me.getEurope()), panel.get("title"));
        assertEquals(Messages.message("close"), panel.get("ok"));
        final Map<String, Object> headings = (Map<String, Object>)panel.get("headings");
        assertEquals(Messages.message("sailingToAmerica"), headings.get("toAmerica"));
        assertEquals(Messages.message("docks"), headings.get("docks"));
        // The unit lists are those of the model.
        final List<String> docks = me.getEurope().getUnitList().stream()
            .filter(u -> !u.isNaval()).map(Unit::getId).collect(Collectors.toList());
        assertEquals(docks, ((List<Map<String, Object>>)panel.get("docks")).stream()
            .map(u -> (String)u.get("id")).collect(Collectors.toList()));
        final List<Map<String, Object>> market = (List<Map<String, Object>>)panel.get("market");
        assertFalse(market.isEmpty());
        final Map<String, Object> first = market.get(0);
        final GoodsType type = client.getGame().getSpecification()
            .getGoodsType((String)first.get("id"));
        assertEquals((long)me.getMarket().getPaidForSale(type), first.get("sell"));
        assertEquals((long)me.getMarket().getCostToBuy(type), first.get("buy"));
        assertEquals(Messages.getName(type), first.get("name"));
        assertEquals(ObjectImages.keys(type), first.get("images"));
    }

    /**
     * Naming the new land brings up the first landing panel; once the
     * Browser UI closes it, the build colony tutorial message is added.
     * Upstream calls addClosingCallback on what showEventPanel returns.
     */
    @Test
    @Timeout(120)
    void namingTheNewLandShowsTheLandingPanelAndClosingItAddsTheTutorial() throws Exception {
        final ClientEngine client = startGame();
        final Player me = client.getClient().getMyPlayer();
        final ServerGame game = (ServerGame)this.server.getGame();
        final ServerPlayer human = (ServerPlayer)game.getFreeColGameObject(me.getId(), Player.class);
        final Tile land = game.getMap().getTileList(
            t -> t.isLand() && t.getOwner() == null && t.getSettlement() == null
                && t.getUnitCount() == 0 && t.isCoastland()).get(0);
        final Unit ship = human.getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile sea = land.getSurroundingTiles(1, 1).stream()
            .filter(t -> !t.isLand()).findFirst().get();
        ship.setLocation(sea);
        final Unit passenger = ship.getUnits().collect(Collectors.toList()).get(0);
        passenger.setLocation(land);
        human.invalidateCanSeeTiles();
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(human), human.exploreForUnit(ship));
        cs.add(See.only(human), ship, passenger);
        game.sendTo(human, cs);
        Unit unit = null;
        for (int i = 0; i < 500 && (unit == null || !unit.hasTile()); i++) {
            unit = me.getOurFreeColGameObject(passenger.getId(), Unit.class);
            Thread.sleep(10);
        }
        assertNotNull(unit);
        assertTrue(unit.hasTile(), "the passenger is ashore");

        shown.clear();
        asked.clear();
        held.clear();
        hold = true;
        client.getClient().getInGameController().newLandNameHandler(unit, "New Land");
        while (held.isEmpty()) Thread.sleep(10);
        assertTrue(asked.get(0).startsWith("input {"), asked.get(0));
        client.answer(held.remove(0), "Vinland");

        // The panel is asked, not just shown, and has the land's name.
        while (held.isEmpty()) Thread.sleep(10);
        final String panel = asked.get(1);
        assertTrue(panel.startsWith("event {"), panel);
        assertTrue(panel.contains("Vinland"), "the landing panel names the land: " + panel);
        assertTrue(panel.contains("\"image\":\"image.flavor.event.firstLanding\""), panel);
        Thread.sleep(200);
        assertFalse(tutorial(), "the tutorial waits for the panel to close");

        // Closing the panel adds the tutorial message.
        client.answer(held.remove(0), "closed");
        for (int i = 0; i < 3000 && !tutorial(); i++) Thread.sleep(10);
        assertTrue(tutorial(), "closing the panel adds the tutorial message: " + shown);
        hold = false;
    }

    private boolean tutorial() {
        return shown().stream().anyMatch(e -> e.startsWith("messages ")
                                       && e.contains("Try building a Colony"));
    }

    @Test
    @Timeout(120)
    void theTributeAmountIsWhatWasEnteredOrMinusOne() throws Exception {
        final GUI gui = startGame().getClient().getGUI();
        final StringTemplate demand = StringTemplate.key("info.enterSomeText");

        answer = "7";
        assertEquals(7, gui.showSelectTributeAmountDialog(demand, 10));
        final String question = asked.get(0);
        assertTrue(question.startsWith("input {"), question);
        assertTrue(question.contains("\"value\":\"10\""), "suggests the most: " + question);

        answer = " 10 ";
        assertEquals(10, gui.showSelectTributeAmountDialog(demand, 10));
        for (String bad : new String[] { "0", "-3", "11", "lots", "" }) {
            answer = bad;
            assertEquals(-1, gui.showSelectTributeAmountDialog(demand, 10), bad);
        }
        answer = null;
        assertEquals(-1, gui.showSelectTributeAmountDialog(demand, 10), "cancel");
    }

    /**
     * Give an AI European player a colony on the server, and sail the
     * human's ship to its coast, so that the human sees the colony, with a
     * scout aboard to negotiate with it.
     */
    private Colony aiColony(ClientEngine client) {
        final ServerGame game = (ServerGame)this.server.getGame();
        final ServerPlayer human = (ServerPlayer)game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final ServerPlayer ai = (ServerPlayer)game.getLiveEuropeanPlayerList(human).get(0);
        final Tile tile = game.getMap().getTileList(
            t -> t.isLand() && t.getOwner() == null && t.getSettlement() == null
                && t.getUnitCount() == 0 && t.isCoastland()).get(0);
        final ServerColony colony = new ServerColony(game, ai, "Testville", tile);
        ai.addSettlement(colony);
        colony.placeSettlement(true);

        final Tile sea = tile.getSurroundingTiles(1, 1).stream()
            .filter(t -> !t.isLand()).findFirst().get();
        final Unit ship = human.getUnits().filter(Unit::isNaval).findFirst().get();
        ship.setLocation(sea);
        human.invalidateCanSeeTiles();
        final Unit scout = ship.getUnits().collect(Collectors.toList()).get(0);
        scout.changeRole(game.getSpecification().getRole("model.role.scout"), 1);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(human), human.exploreForUnit(ship));
        cs.add(See.only(human), ship, scout);
        game.sendTo(human, cs);
        return colony;
    }

    /** The scout aiColony made, once the update has arrived. */
    private static Unit scout(Player me) throws Exception {
        for (int i = 0; i < 500; i++) {
            final Unit u = me.getUnits().filter(x -> x.hasAbility(Ability.NEGOTIATE))
                .findFirst().orElse(null);
            if (u != null) return u;
            Thread.sleep(10);
        }
        throw new AssertionError("no scout");
    }

    /** The client's colony for a server's, once the update has arrived. */
    private static Colony seen(ClientEngine client, Colony server) throws Exception {
        for (int i = 0; i < 500; i++) {
            final Colony c = client.getGame().getFreeColGameObject(server.getId(), Colony.class);
            if (c != null) return c;
            Thread.sleep(10);
        }
        return null;
    }

    @Test
    @Timeout(120)
    void aPlayerProposesPeaceToAnAINationAndSeesItsReply() throws Exception {
        final ClientEngine client = startGame();
        final FreeColClient fc = client.getClient();
        final Player me = fc.getMyPlayer();
        final Colony theirs = aiColony(client);
        final Player ai = client.getGame().getPlayerByNationId(theirs.getOwner().getNationId());
        final Colony known = seen(client, theirs);
        assertNotNull(known, "the human sees the colony");
        final Unit unit = scout(me);

        final DiplomaticTrade offer = new DiplomaticTrade(client.getGame(),
            TradeContext.DIPLOMATIC, me, ai, null, 0);
        // The player picks the peace stance and nothing else.
        answer = "propose\nstance\t\tPEACE\t0";
        final List<DiplomaticTrade> sent = Collections.synchronizedList(new ArrayList<>());
        fc.getGUI().showNegotiationDialog(unit, known, offer,
            offer.getSendMessage(me, known), dt -> {
                sent.add(dt);
                fc.askServer().diplomacy(unit, known, dt);
            });
        awaitCount(sent, 1);

        final String question = asked.get(0);
        assertTrue(question.startsWith("negotiation {"), question);
        assertTrue(question.contains("\"accept\":null"), "a new offer cannot be accepted: " + question);
        assertTrue(question.contains("\"tutorial\":null,"), "no tutorial text outside tutorial mode: " + question);
        assertTrue(question.contains("\"clear\":\"Clear\""), question);
        assertTrue(question.contains("\"kind\":\"stance\",\"side\":null,\"label\":\"Stance\""), question);
        assertTrue(question.contains("{\"key\":\"PEACE\",\"amount\":0,\"text\":\"Peace\"}"), question);
        assertEquals(TradeStatus.PROPOSE_TRADE, sent.get(0).getStatus());
        assertEquals(Stance.PEACE, sent.get(0).getStance());

        // The AI answers: an acceptance, a rejection or a counter offer.
        final long end = System.currentTimeMillis() + 20000;
        boolean replied = false;
        while (!replied && System.currentTimeMillis() < end) {
            Thread.sleep(50);
            replied = shown().stream().anyMatch(e -> e.startsWith("information ")
                && e.contains(Messages.message(StringTemplate
                    .template("diplomacy.offerRejected")
                    .addStringTemplate("%nation%", ai.getNationLabel()))));
            replied |= asked.size() > 1 && asked.get(1).startsWith("negotiation {");
            replied |= me.getStance(ai) == Stance.PEACE;
        }
        assertTrue(replied, "no reply: " + shown + asked);
    }

    @Test
    @Timeout(120)
    void aClosedNegotiationGivesTheHandlerNullAndAnEditedOneRebuildsTheAgreement()
            throws Exception {
        final ClientEngine client = startGame();
        final FreeColClient fc = client.getClient();
        final Player me = fc.getMyPlayer();
        final Colony known = seen(client, aiColony(client));
        assertNotNull(known, "the human sees the colony");
        final Player ai = known.getOwner();
        final Unit unit = scout(me);
        final DiplomaticTrade offer = new DiplomaticTrade(client.getGame(),
            TradeContext.DIPLOMATIC, me, ai, null, 0);
        final List<DiplomaticTrade> got = Collections.synchronizedList(new ArrayList<>());
        final List<Boolean> closed = Collections.synchronizedList(new ArrayList<>());

        answer = null;
        fc.getGUI().showNegotiationDialog(unit, known, offer, null,
            dt -> closed.add(dt == null));
        awaitCount(closed, 1);
        assertEquals(List.of(true), closed);

        answer = "propose\ngold\toffer\t\t30\nstance\t\tPEACE\t0\ngold\tdemand\t\t5\n";
        fc.getGUI().showNegotiationDialog(unit, known, offer, null, got::add);
        awaitCount(got, 1);
        assertSame(offer, got.get(0));
        assertEquals(TradeStatus.PROPOSE_TRADE, offer.getStatus());
        // Gold is unique: the later item replaces the earlier.
        assertEquals(-1, offer.getGoldGivenBy(me));
        assertEquals(5, offer.getGoldGivenBy(ai));
        assertEquals(Stance.PEACE, offer.getStance());

        // The other kinds: a colony the other player gives, goods, a unit.
        got.clear();
        answer = "propose\ncolony\tdemand\t" + known.getId() + "\t0\n"
            + "goods\tdemand\tmodel.goods.food\t40\n"
            + "unit\toffer\t" + unit.getId() + "\t0\nbogus\toffer\tx\t0";
        fc.getGUI().showNegotiationDialog(unit, known, offer, null, got::add);
        awaitCount(got, 1);
        assertEquals(List.of(known), offer.getColoniesGivenBy(ai));
        assertEquals(1, offer.getGoodsGivenBy(ai).size());
        assertEquals(40, offer.getGoodsGivenBy(ai).get(0).getAmount());
        assertEquals(List.of(unit), offer.getUnitsGivenBy(me));
        assertEquals(3, offer.getItems().size(), "the bogus line is dropped");

        got.clear();
        answer = "reject";
        fc.getGUI().showNegotiationDialog(unit, known, offer, null, got::add);
        awaitCount(got, 1);
        assertEquals(TradeStatus.REJECT_TRADE, offer.getStatus());
        assertEquals(3, offer.getItems().size(), "reject keeps the agreement");
        // The question lists the agreement's items.
        assertTrue(asked.get(asked.size() - 1).contains(
            "\"kind\":\"goods\",\"side\":\"demand\",\"key\":\"model.goods.food\",\"amount\":40"),
            asked.get(asked.size() - 1));
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

        final List<List<Goods>> got = Collections.synchronizedList(new ArrayList<>());
        answer = "[2,0]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        awaitCount(got, 1);
        assertEquals(List.of(List.of(loot.get(2), loot.get(0))), got);
        String question = asked.get(asked.size() - 1);
        assertTrue(question.startsWith("goods {"), question);
        assertTrue(question.contains("\"max\":" + space), question);
        assertTrue(question.contains("\"icon\":\"image.icon.model.goods.sugar\""), question);
        assertTrue(question.contains("\"amount\":40"), question);

        got.clear();
        answer = "[]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        awaitCount(got, 1);
        assertEquals(List.of(List.<Goods>of()), got);

        got.clear();
        answer = null;
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        awaitCount(got, 1);
        assertEquals(List.of(List.<Goods>of()), got, "closed: nothing");

        // More than the free holds cannot be taken.
        got.clear();
        answer = "[0,1,2]";
        gui.showCaptureGoodsDialog(ship, loot, got::add);
        awaitCount(got, 1);
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
        awaitCount(got, 1);
        assertEquals(List.of(List.of(cargo.get(1))), got);
        question = asked.get(asked.size() - 1);
        assertTrue(question.contains("\"checked\":true"), question);

        got.clear();
        answer = null;
        gui.showDumpCargoDialog(ship, got::add);
        awaitCount(got, 1);
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

        // Not shown.get(0): a tutorial message the game sends at its start can
        // arrive after the clear.
        final String e = waitFor(shown, "highScores ");
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

    /**
     * Clicking a native settlement on the map opens its panel, as SwingGUI
     * does, instead of sending the active unit there; the panel is the
     * settlement's JSON as the player knows it.
     */
    @Test
    @Timeout(120)
    void clickingANativeSettlementShowsItsPanel() throws Exception {
        final ClientEngine client = startGame();
        client.debugApplied(this.server.debug("{\"action\":\"revealMap\"}"));
        final net.sf.freecol.common.model.Map map = client.getClient().getGame().getMap();
        Tile at = null;
        for (int i = 0; i < 3000 && at == null; i++) {
            at = map.getTileSet(t -> t.isExplored() && t.getIndianSettlement() != null)
                .stream().findFirst().orElse(null);
            if (at == null) Thread.sleep(10);
        }
        assertNotNull(at, "the client knows a native settlement");

        shown.clear();
        assertTrue(client.getCommands().click(at.getX(), at.getY()));
        final String panel = shown().stream()
            .filter(e -> e.startsWith("indianSettlement ")).findFirst().orElse("");
        final net.sf.freecol.common.model.IndianSettlement is = at.getIndianSettlement();
        assertTrue(panel.contains("\"tile\":\"" + at.getId() + "\",\"at\":["
                + at.getX() + "," + at.getY() + "]"), panel);
        assertTrue(panel.contains(Messages.message(is.getLocationLabelFor(
                client.getClient().getMyPlayer()))), panel);
        assertTrue(panel.endsWith("\"ok\":\"OK\"}"), panel);
        assertFalse(shown().stream().anyMatch(e -> e.startsWith("unasked ")), shown.toString());
    }

    /**
     * A click on a tile with no unit of ours, an unexplored one or an empty
     * one, centres the map on it (the focus event), as SwingGUI.clickAt's
     * setFocus does; a double click on an empty tile selects it in terrain view.
     */
    @Test
    @Timeout(120)
    void clickingAnEmptyTileCentresTheMapAndDoubleClickingSelectsIt() throws Exception {
        final ClientEngine client = startGame();
        final net.sf.freecol.common.model.Map map = client.getClient().getGame().getMap();
        final Tile empty = map.getTileSet(t -> t.isExplored() && t.isEmpty()
            && t.getSettlement() == null).stream().findFirst().orElse(null);
        assertNotNull(empty, "the client knows an empty tile");
        shown.clear();
        assertFalse(client.getCommands().click(empty.getX(), empty.getY()));
        assertTrue(shown().stream().anyMatch(e -> e.startsWith("focus ")
            && e.contains("[" + empty.getX() + "," + empty.getY() + "]")), shown.toString());
        assertFalse(shown().stream().anyMatch(e -> e.startsWith("selectedTile ")), shown.toString());
        shown.clear();
        assertFalse(client.getCommands().click(empty.getX(), empty.getY(), 2));
        assertTrue(shown().stream().anyMatch(e -> e.startsWith("selectedTile ")), shown.toString());
        final Tile unseen = map.getTileSet(t -> !t.isExplored()).stream().findFirst().orElse(null);
        if (unseen != null) {
            shown.clear();
            assertFalse(client.getCommands().click(unseen.getX(), unseen.getY()));
            assertTrue(shown().stream().anyMatch(e -> e.startsWith("focus ")), shown.toString());
        }
    }

    /** The tile entry of the right-click menu opens the Colopedia on the tile's terrain. */
    @Test
    @Timeout(180)
    void theTileEntryShowsTheTilePanel() throws Exception {
        final ClientEngine client = startGame();
        final Tile at = client.getClient().getMyPlayer().getUnits()
            .filter(Unit::isNaval).findFirst().get().getTile();
        shown.clear();
        assertTrue(client.getCommands().menuEntry("tile:" + at.getX() + "," + at.getY()));
        final String panel = shown().stream()
            .filter(e -> e.startsWith("tilePanel ")).findFirst().orElse("");
        assertTrue(panel.contains("\"type\":\"" + at.getType().getId() + "\""), panel);
        assertTrue(panel.contains("\"rows\":["), panel);
        assertTrue(panel.contains("\"production\":["), panel);
        assertTrue(panel.endsWith("\"ok\":\"OK\"}"), panel);
    }

    @Test
    @Timeout(180)
    void theColopediaOpensOnATerrainType() throws Exception {
        final ClientEngine client = startGame();
        final Tile at = client.getClient().getMyPlayer().getUnits()
            .filter(Unit::isNaval).findFirst().get().getTile();
        final String id = at.getType().getId();
        shown.clear();
        assertTrue(client.getCommands().menuEntry("colopedia:" + id));
        final String panel = shown().stream()
            .filter(e -> e.startsWith("report ") && e.contains("\"report\":\"colopedia\""))
            .findFirst().orElse("");
        assertTrue(panel.contains("\"select\":\"" + id + "\""), panel);
        assertTrue(panel.contains("\"sections\":["), panel);
    }

    /** The Colopedia opens on a goods type, a unit type and a founding father, not only terrain. */
    @Test
    @Timeout(180)
    void theColopediaOpensOnAnyEntry() throws Exception {
        final ClientEngine client = startGame();
        for (String id : new String[] {"model.goods.furs", "model.unit.freeColonist",
            "model.building.stockade", "model.foundingFather.thomasJefferson", "model.nation.dutch",
            "model.nationType.trade"}) {
            shown.clear();
            assertTrue(client.getCommands().menuEntry("colopedia:" + id), id);
            final String panel = shown().stream()
                .filter(e -> e.startsWith("report ") && e.contains("\"report\":\"colopedia\""))
                .findFirst().orElse("");
            assertTrue(panel.contains("\"select\":\"" + id + "\""), panel);
        }
        assertFalse(client.getCommands().menuEntry("colopedia:model.noSuch"), "no such entry");
        assertFalse(client.getCommands().menuEntry("colopedia:model.ability.build"), "not an entry");
    }
}
