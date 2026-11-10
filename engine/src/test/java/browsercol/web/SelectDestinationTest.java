package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;


/**
 * The player asks where a ship sails, and the ship sails to Europe and
 * back; the player also buys units in Europe and sails a loaded ship to the New World,
 * in a Classic game between the two Engines. The fake Browser UI
 * answers the destination question with the destination it is told to.
 */
class SelectDestinationTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    /** The choices of a choice question, as they reach the Browser UI. */
    private static final Pattern CHOICES = Pattern.compile("\"choices\":\\[(.*)]");
    private static final Pattern TEXT = Pattern.compile("\"text\":\"((?:[^\"\\\\]|\\\\.)*)\"");

    /** The questions the fake Browser UI saw, as "kind json". */
    private final List<String> asked = new java.util.concurrent.CopyOnWriteArrayList<>();
    /** The events the fake Browser UI saw, as "kind json". */
    private final List<String> shown = new java.util.concurrent.CopyOnWriteArrayList<>();

    /** The label of the destination the fake Browser UI picks. */
    private volatile String wanted = null;
    /** What the fake Browser UI answers to the select amount dialog. */
    private volatile String amount = null;
    /** Whether the fake Browser UI agrees to sail and leave colonists on the docks. */
    private volatile boolean leaveBehind = true;
    /** Whether the fake Browser UI pays the Crown's arrears when asked. */
    private volatile boolean payArrears = false;

    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /**
     * The fake Browser UI picks the destination it is told to, closes the
     * dialog when there is none to pick, and accepts every confirmation
     * but the one that would sail to Europe on its own. The Crown's
     * arrears are paid only when {@link #payArrears} says so.
     */
    private String answer(String kind, String json) {
        switch (kind) {
        case "choice":
            if (wanted == null) return null;
            final List<String> texts = choiceTexts(json);
            final int i = texts.indexOf(wanted);
            if (i < 0) fail("no choice " + wanted + " in " + texts);
            return String.valueOf(i);
        case "endTurn":
            return "ok";
        case "confirm":
            if (json.contains("boycotting these goods")) return String.valueOf(payArrears);
            if (json.contains("leave the colonists")) return String.valueOf(leaveBehind);
            return json.contains("high seas") ? "false" : "true";
        case "amount":
            return amount;
        default:
            return null;
        }
    }

    /** Start a Classic game and return once it is our turn. */
    private void startGame() throws Exception {
        final CountDownLatch ourTurn = new CountDownLatch(1);
        server = new ServerEngine(
            xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
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
                    ui.execute(() -> client.answer(id, answer(kind, json)));
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(ourTurn);
    }

    /** End our turn and wait until the AI hands play back. */
    private void endTurnAndWait() throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(client.getCommands().endTurn(), "end turn");
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            Thread.sleep(20);
        }
    }

    /** The ship's unit in the server's game, which is the truth here. */
    private Unit serverShip(Unit ship) {
        final Unit s = server.getGame()
            .getFreeColGameObject(ship.getId(), Unit.class);
        assertNotNull(s, "the server knows the ship");
        return s;
    }

    /** The player's ship, the only one there is at the start. */
    private Unit ship() {
        final Player player = client.getClient().getMyPlayer();
        return player.getUnits().filter(Unit::isNaval).findFirst().get();
    }

    /** The active unit of the client. */
    private Unit active() {
        return client.getClient().getGUI().getActiveUnit();
    }

    /** Click a tile until the wanted unit is the active one. */
    private void select(Unit unit) {
        final Tile tile = unit.getTile();
        for (int i = 0; i < 10 && active() != unit; i++) {
            assertTrue(client.getCommands().click(tile.getX(), tile.getY()),
                "click selects");
        }
        assertSame(unit, active());
    }

    /**
     * Move the ship onto the high seas, where it can sail to Europe. It
     * starts there, but the map is made afresh for every game.
     */
    private void sailOntoHighSeas(Unit ship) throws InterruptedException {
        if (ship.getTile().isDirectlyHighSeasConnected()) return;
        final Map known = server.getGame().getMap();
        final Tile from = known.getTile(ship.getTile().getX(),
                                        ship.getTile().getY());
        final Tile highSeas = known.getTileSet(
            t -> t.isDirectlyHighSeasConnected() && t.getUnitCount() == 0)
            .stream().min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .orElse(null);
        assertNotNull(highSeas, "the map has high seas");
        select(ship);
        assertTrue(client.getCommands().goTo(highSeas.getX(), highSeas.getY()),
            "the ship sets off for the high seas");
        int turns = 0;
        while (!ship.getTile().isDirectlyHighSeasConnected()) {
            endTurnAndWait();
            assertTrue(++turns < 8,
                "the ship reaches the high seas within 8 turns; asked " + asked);
        }
    }

    @SuppressWarnings("unchecked")
    private static java.util.Map<String, Object> parse(String json) {
        return (java.util.Map<String, Object>)JsonReader.read(json);
    }

    /** The JSON of the last Europe panel the WebGUI sent; fails if none. */
    private String lastEurope() {
        String found = null;
        for (String e : new ArrayList<>(shown)) {
            if (e.startsWith("europe ")) found = e.substring("europe ".length());
        }
        assertNotNull(found, "no Europe panel was sent: " + shown);
        return found;
    }

    /** The Europe panel as the client describes it now. */
    private java.util.Map<String, Object> europePanel(Player player) {
        return parse(EuropeJson.of(player, active(), List.of()));
    }

    @SuppressWarnings("unchecked")
    private static List<java.util.Map<String, Object>> marketOf(java.util.Map<String, Object> panel) {
        final List<java.util.Map<String, Object>> goods = new ArrayList<>();
        for (Object g : (List<Object>)panel.get("market")) {
            goods.add((java.util.Map<String, Object>)g);
        }
        return goods;
    }

    /** The ids of the units a Europe panel lists under a heading. */
    @SuppressWarnings("unchecked")
    private static List<String> unitIds(java.util.Map<String, Object> panel, String list) {
        final List<String> ids = new ArrayList<>();
        for (Object u : (List<Object>)panel.get(list)) {
            ids.add((String)((java.util.Map<String, Object>)u).get("id"));
        }
        return ids;
    }

    /** The labels of the choices of a choice question. */
    private static List<String> choiceTexts(String json) {
        final Matcher c = CHOICES.matcher(json);
        assertTrue(c.find(), json);
        final List<String> texts = new ArrayList<>();
        final Matcher t = TEXT.matcher(c.group(1));
        while (t.find()) texts.add(unescape(t.group(1)));
        return texts;
    }

    /** The text of a JSON string, as the Browser UI reads it. */
    private static String unescape(String s) {
        final StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            final char ch = s.charAt(i);
            if (ch != '\\' || i + 1 >= s.length()) {
                sb.append(ch);
                continue;
            }
            final char next = s.charAt(++i);
            switch (next) {
            case 'n': sb.append('\n'); break;
            case 'r': sb.append('\r'); break;
            case 't': sb.append('\t'); break;
            case 'u':
                sb.append((char)Integer.parseInt(s.substring(i + 1, i + 5), 16));
                i += 4;
                break;
            default: sb.append(next);
            }
        }
        return sb.toString();
    }

    /** The last question of its kind the fake Browser UI saw. */
    private String lastQuestion(String kind) {
        String found = null;
        for (String q : asked) {
            if (q.startsWith(kind + " ")) found = q;
        }
        assertNotNull(found, "no " + kind + " question in " + asked);
        return found;
    }

    @Test
    @Timeout(300)
    void theShipSailsToEuropeAndBack() throws Exception {
        startGame();
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = ship();

        // The ship is on the high seas, where it can sail to Europe.
        sailOntoHighSeas(ship);

        // Ask where to sail, and answer Europe.
        final String europe = Messages.message(
            player.getEurope().getLocationLabelFor(player));
        wanted = europe;
        assertTrue(client.getClient().getInGameController()
            .selectDestination(ship), "the ship sails to Europe");
        String question = lastQuestion("choice");
        assertTrue(question.contains("\"text\":\"Select destination\""), question);
        assertTrue(question.contains("\"cancel\":\"Remain where you are\""), question);
        assertTrue(choiceTexts(question).contains(europe), question);
        // The ship sails: the server has it at sea, on its way.
        assertTrue(serverShip(ship).isAtSea(), "the server has the ship at sea");
        // The Europe panel lists it sailing to Europe, and not yet in port.
        final java.util.Map<String, Object> sailing = europePanel(player);
        assertEquals(List.of(ship.getId()), unitIds(sailing, "toEurope"));
        assertEquals(List.of(), unitIds(sailing, "inPort"));
        shown.clear();
        int turns = 0;
        while (!serverShip(ship).isInEurope()) {
            endTurnAndWait();
            assertTrue(++turns < 12,
                "the ship reaches Europe within 12 turns; asked " + asked);
        }
        assertTrue(ship.isInEurope(), "the client has the ship in Europe");

        // The panel opens when the ship arrives, with the ship in port.
        java.util.Map<String, Object> panel = null;
        for (int i = 0; i < 500 && panel == null; i++) {
            for (String e : new ArrayList<>(shown)) {
                if (e.startsWith("europe ")) panel = parse(e.substring("europe ".length()));
            }
            if (panel == null) Thread.sleep(10);
        }
        assertNotNull(panel, "the Europe panel is shown on arrival; saw " + shown);
        assertEquals(List.of(ship.getId()), unitIds(panel, "inPort"));
        assertEquals(List.of(), unitIds(panel, "toEurope"));
        assertEquals(ship.getId(), panel.get("selected"));
        // The market lists every storable goods type with its prices.
        final List<java.util.Map<String, Object>> market = marketOf(panel);
        final List<GoodsType> storable = client.getGame().getSpecification()
            .getStorableGoodsTypeList();
        assertEquals(storable.stream().map(GoodsType::getId).collect(Collectors.toList()),
            market.stream().map(g -> (String)g.get("id")).collect(Collectors.toList()));
        for (int g = 0; g < storable.size(); g++) {
            assertEquals((long)player.getMarket().getPaidForSale(storable.get(g)),
                market.get(g).get("sell"), storable.get(g).getId());
            assertEquals((long)player.getMarket().getCostToBuy(storable.get(g)),
                market.get(g).get("buy"), storable.get(g).getId());
        }

        // Now sail back to the New World.
        final String newWorld = Messages.message(
            client.getGame().getMap().getLocationLabelFor(player));
        wanted = newWorld;
        assertTrue(client.getClient().getInGameController()
            .selectDestination(ship), "the ship sails home");
        question = lastQuestion("choice");
        assertTrue(choiceTexts(question).contains(newWorld), question);

        turns = 0;
        while (serverShip(ship).getTile() == null) {
            endTurnAndWait();
            assertTrue(++turns < 12,
                "the ship reaches the New World within 12 turns; asked " + asked);
        }
        final Tile landed = serverShip(ship).getTile();
        assertSame(server.getGame().getMap(), landed.getMap(),
            "the ship is on a tile of the map");
    }

    /** Sail the ship to Europe, and wait until it is in port. */
    private void sailToEurope(Unit ship) throws InterruptedException {
        final Player player = client.getClient().getMyPlayer();
        sailOntoHighSeas(ship);
        wanted = Messages.message(player.getEurope().getLocationLabelFor(player));
        assertTrue(client.getClient().getInGameController()
            .selectDestination(ship), "the ship sails to Europe");
        wanted = null;
        int turns = 0;
        while (!serverShip(ship).isInEurope() || !ship.isInEurope()) {
            endTurnAndWait();
            assertTrue(++turns < 12, "the ship reaches Europe; asked " + asked);
        }
    }

    /** Wait until the client has this much gold. */
    private void awaitGold(int gold) throws InterruptedException {
        final Player player = client.getClient().getMyPlayer();
        for (int i = 0; i < 500 && player.getGold() != gold; i++) Thread.sleep(10);
        assertEquals(gold, player.getGold());
    }

    /** The offers of the panel's train or purchase list, by unit type id. */
    @SuppressWarnings("unchecked")
    private static java.util.Map<String, java.util.Map<String, Object>> offers(
            java.util.Map<String, Object> panel, String list) {
        final java.util.Map<String, java.util.Map<String, Object>> byId
            = new java.util.LinkedHashMap<>();
        for (Object o : (List<Object>)((java.util.Map<String, Object>)panel.get(list))
                 .get("units")) {
            final java.util.Map<String, Object> offer = (java.util.Map<String, Object>)o;
            byId.put((String)offer.get("id"), offer);
        }
        return byId;
    }

    private UnitType serverType(String id) {
        return server.getGame().getSpecification().getUnitType(id);
    }

    @Test
    @Timeout(300)
    void unitsAreRecruitedTrainedAndBoughtAndALoadedShipSails() throws Exception {
        startGame();
        final Player player = client.getClient().getMyPlayer();
        final Player serverPlayer = server.getGame()
            .getFreeColGameObject(player.getId(), Player.class);
        final Europe serverEurope = serverPlayer.getEurope();
        final Unit ship = ship();
        sailToEurope(ship);
        // A purse for the whole shopping.
        client.debugApplied(server.debug("{\"action\":\"addGold\",\"amount\":5000}"));
        awaitGold(serverPlayer.getGold());
        java.util.Map<String, Object> panel = europePanel(player);

        // The prices shown are the server's.
        @SuppressWarnings("unchecked")
        final java.util.Map<String, Object> recruit
            = (java.util.Map<String, Object>)panel.get("recruit");
        assertEquals((long)serverPlayer.getEuropeanRecruitPrice(), recruit.get("price"));
        assertEquals(3, ((List<?>)recruit.get("units")).size(),
            "three in the recruit pool");
        for (String list : List.of("train", "purchase")) {
            final java.util.Map<String, java.util.Map<String, Object>> offers
                = offers(panel, list);
            assertFalse(offers.isEmpty(), list + " offers units");
            for (java.util.Map.Entry<String, java.util.Map<String, Object>> o
                     : offers.entrySet()) {
                assertEquals((long)serverEurope.getUnitPrice(serverType(o.getKey())),
                    o.getValue().get("price"), list + " " + o.getKey());
                assertEquals(true, o.getValue().get("enabled"));
            }
        }

        // Recruit the first of the pool.
        final int docks = unitIds(panel, "docks").size();
        int gold = serverPlayer.getGold();
        final int recruitPrice = serverPlayer.getEuropeanRecruitPrice();
        assertTrue(client.getCommands().recruitUnit(0), "a unit is recruited");
        assertEquals(gold - recruitPrice, serverPlayer.getGold());
        awaitGold(gold - recruitPrice);
        panel = europePanel(player);
        assertEquals(docks + 1, unitIds(panel, "docks").size());

        // The recruit's menu commissions it as a missionary, free in
        // Europe, and the Europe panel is sent again with its new picture.
        final List<String> before = new ArrayList<>(unitIds(europePanel(player), "docks"));
        final String recruitId = before.stream()
            .filter(id -> client.getGame().getFreeColGameObject(id, Unit.class)
                .getRole().isDefaultRole())
            .findFirst().orElseThrow();
        final Unit dressed = client.getGame().getFreeColGameObject(recruitId, Unit.class);
        final Menus menus = client.getMenus();
        final String commission = "role:" + recruitId + ",model.role.missionary,1";
        assertTrue(menus.unit(recruitId).contains("\"id\":\"" + commission + "\""),
            menus.unit(recruitId));
        shown.clear();
        assertTrue(client.getCommands().menuEntry(commission), "commissioned");
        assertEquals("model.role.missionary", server.getGame()
            .getFreeColGameObject(recruitId, Unit.class).getRole().getId());
        assertEquals("model.role.missionary", dressed.getRole().getId(),
            "the client knows it");
        String missionaryKey = "image.unit." + dressed.getType().getId() + ".missionary";
        assertTrue(lastEurope().contains(missionaryKey),
            "the panel is sent again with the missionary's picture: " + shown);
        // ... and cancelling the commission makes it a colonist again.
        final String cancel = "role:" + recruitId + ",model.role.default,0";
        assertTrue(menus.unit(recruitId).contains("\"id\":\"" + cancel + "\""),
            menus.unit(recruitId));
        shown.clear();
        assertTrue(client.getCommands().menuEntry(cancel), "commission cancelled");
        assertTrue(dressed.getRole().isDefaultRole());
        assertFalse(lastEurope().contains(missionaryKey),
            "the panel is sent again without it: " + shown);

        // Train a specialist.
        final String trained = offers(panel, "train").keySet().iterator().next();
        gold = serverPlayer.getGold();
        final int trainPrice = serverEurope.getUnitPrice(serverType(trained));
        assertTrue(client.getCommands().trainUnit(trained), "a unit is trained");
        assertEquals(gold - trainPrice, serverPlayer.getGold());
        awaitGold(gold - trainPrice);
        panel = europePanel(player);
        assertEquals(docks + 2, unitIds(panel, "docks").size());

        // Buy a ship.
        final String bought = offers(panel, "purchase").keySet().stream()
            .filter(id -> serverType(id).isNaval()).findFirst().get();
        gold = serverPlayer.getGold();
        final int shipPrice = serverEurope.getUnitPrice(serverType(bought));
        assertTrue(client.getCommands().trainUnit(bought), "a ship is bought");
        assertEquals(gold - shipPrice, serverPlayer.getGold());
        awaitGold(gold - shipPrice);
        panel = europePanel(player);
        assertEquals(2, unitIds(panel, "inPort").size(), "two ships in port");

        // Load the recruit onto the first ship and sail it.
        final String passenger = unitIds(panel, "docks").get(0);
        assertTrue(client.getCommands().boardShip(passenger, ship.getId()),
            "the unit boards");
        assertSame(serverShip(ship), server.getGame()
            .getFreeColGameObject(passenger, Unit.class).getLocation());
        // Aboard, its menu takes it back onto the docks, as Swing's does,
        // and the Europe panel is sent again.
        final String leave = "leaveShip:" + passenger;
        assertTrue(menus.unit(passenger).contains("\"id\":\"" + leave + "\""),
            menus.unit(passenger));
        shown.clear();
        assertTrue(client.getCommands().menuEntry(leave), "goes ashore");
        assertTrue(unitIds(parse(lastEurope()), "docks").contains(passenger),
            "the panel has it on the docks: " + shown);
        assertTrue(client.getCommands().boardShip(passenger, ship.getId()),
            "the unit boards again");
        // The player is asked where: a closed dialog keeps the ship in port.
        wanted = null;
        assertFalse(client.getCommands().sailToNewWorld(ship.getId()),
            "a closed destination dialog keeps the ship in port");
        assertTrue(serverShip(ship).isInEurope(), "the ship is still in Europe");
        // With room to spare and colonists waiting on the docks, the player is
        // warned that they are left behind, and may cancel.
        wanted = Messages.message(
            client.getGame().getMap().getLocationLabelFor(player));
        leaveBehind = false;
        asked.clear();
        assertFalse(client.getCommands().sailToNewWorld(ship.getId()),
            "cancelling the warning keeps the ship in port");
        assertTrue(lastQuestion("confirm").contains("leave the colonists"),
            "the player was warned: " + asked);
        assertTrue(serverShip(ship).isInEurope(), "still in Europe");
        leaveBehind = true;
        assertTrue(client.getCommands().sailToNewWorld(ship.getId()),
            "the loaded ship sails");
        assertFalse(serverShip(ship).isInEurope(), "the ship has left Europe");
        panel = europePanel(player);
        assertEquals(List.of(ship.getId()), unitIds(panel, "toAmerica"));
        // A ship on the high seas is turned around, and back again.
        assertTrue(client.getCommands().redirectShip(ship.getId(), true),
            "the ship turns toward Europe");
        panel = europePanel(player);
        assertEquals(List.of(ship.getId()), unitIds(panel, "toEurope"));
        assertTrue(client.getCommands().redirectShip(ship.getId(), false),
            "the ship turns toward the New World");
        panel = europePanel(player);
        assertEquals(List.of(ship.getId()), unitIds(panel, "toAmerica"));
        int turns = 0;
        while (serverShip(ship).getTile() == null) {
            endTurnAndWait();
            assertTrue(++turns < 12, "the ship reaches the New World; asked " + asked);
        }
        assertSame(server.getGame().getMap(), serverShip(ship).getTile().getMap());
        assertSame(serverShip(ship), server.getGame()
            .getFreeColGameObject(passenger, Unit.class).getLocation(),
            "the passenger is still aboard");
    }

    @Test
    @Timeout(300)
    void aClosedDialogCancelsTheMove() throws Exception {
        startGame();
        final Unit ship = ship();
        final Tile at = ship.getTile();

        // The player closes the dialog: the ship stays where it is.
        wanted = null;
        assertFalse(client.getClient().getInGameController()
            .selectDestination(ship), "a closed dialog cancels the move");
        assertTrue(lastQuestion("choice").contains("Select destination"),
            "the destination was asked");
        assertNull(ship.getDestination(), "the ship has no destination");
        assertEquals(at, ship.getTile(), "the ship stays where it was");
        assertEquals(at.getId(), serverShip(ship).getTile().getId(),
            "the server has the ship where it was");
        assertNull(serverShip(ship).getDestination(),
            "the server has the ship with no destination");
    }

    /**
     * The player buys goods in Europe onto the ship in port and sells them
     * again: the gold and the ship's cargo follow, on the server. A
     * boycotted goods cannot be traded, and the panel says why.
     */
    @Test
    @Timeout(300)
    void goodsAreBoughtAndSoldInEurope() throws Exception {
        startGame();
        final Player player = client.getClient().getMyPlayer();
        final Player serverPlayer = server.getGame()
            .getFreeColGameObject(player.getId(), Player.class);
        final Unit ship = ship();
        sailToEurope(ship);
        // A purse for the shopping.
        client.debugApplied(server.debug("{\"action\":\"addGold\",\"amount\":5000}"));
        awaitGold(serverPlayer.getGold());

        final GoodsType cloth = client.getGame().getSpecification()
            .getGoodsType("model.goods.cloth");
        final int price = serverPlayer.getMarket().getCostToBuy(cloth);
        assertEquals(player.getMarket().getCostToBuy(cloth), price,
            "the client and the server have the same price");
        assertTrue(price > 0, "the market has a price for cloth");

        // Buy: the player is asked how much, and the most is what the gold
        // buys and the ship has room for.
        final int most = Math.min(ship.getLoadableAmount(cloth),
                                  player.getGold() / price);
        int gold = serverPlayer.getGold();
        amount = "20";
        assertTrue(client.getCommands().buyGoods(ship.getId(), cloth.getId()),
            "goods are bought");
        assertTrue(lastQuestion("amount").contains("\"max\":" + most + ","),
            lastQuestion("amount"));
        assertEquals(20, serverShip(ship).getGoodsCount(cloth),
            "the ship has the cloth");
        assertEquals(20, ship.getGoodsCount(cloth), "and the client knows it");
        assertEquals(gold - 20 * price, serverPlayer.getGold(), "the gold is spent");
        awaitGold(gold - 20 * price);
        // The sales log of the next Europe panel has the purchase.
        List<List<String>> log = logOf(parse(lastEurope()));
        assertEquals(1, log.size(), "one entry: " + log);
        assertTrue(log.get(0).get(0).contains("20")
            && log.get(0).get(0).contains(Messages.getName(cloth)),
            "the purchase of 20 cloth: " + log);
        assertEquals(2, log.get(0).size(), "what and the price: " + log);

        // Sell: the player is asked how much of the stack to sell, and gets
        // the market's price for it, less the tax (none yet).
        final int sellPrice = serverPlayer.getMarket().getPaidForSale(cloth);
        gold = serverPlayer.getGold();
        amount = "10";
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId()),
            "goods are sold");
        assertTrue(lastQuestion("amount").contains("\"max\":20,"),
            lastQuestion("amount"));
        assertEquals(10, serverShip(ship).getGoodsCount(cloth), "the cloth is sold");
        assertEquals(10, ship.getGoodsCount(cloth), "and the client knows it");
        assertEquals(gold + 10 * sellPrice, serverPlayer.getGold(),
            "the gold is paid");
        awaitGold(gold + 10 * sellPrice);
        // And then the sale, after the purchase, with the tax and net.
        log = logOf(parse(lastEurope()));
        assertEquals(2, log.size(), "two entries: " + log);
        assertTrue(log.get(1).get(0).contains("10")
            && log.get(1).get(0).contains(Messages.getName(cloth)),
            "the sale of 10 cloth: " + log);
        assertEquals(4, log.get(1).size(), "what, price, tax and net: " + log);

        // Not asking (a plain drag): the dialog would give nothing, yet all
        // of the stack is sold.
        amount = null;
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId(), false),
            "the whole stack is sold without asking");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "all the cloth is sold");
        // A stack of 5 of the ten is sold alone when dragged, all with stack 0.
        amount = "10";
        assertTrue(client.getCommands().buyGoods(ship.getId(), cloth.getId(), true),
            "ten again");
        amount = null;
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId(), false, 4),
            "a stack is sold");
        assertEquals(6, serverShip(ship).getGoodsCount(cloth), "only the stack is sold");
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId(), false, 0),
            "all of the type is sold");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "all the cloth is sold");
        // A plain drag of the market's goods buys one hold, 100, as Swing's MarketLabel carries,
        // not all the ship has room for and the gold buys.
        assertTrue(ship.getLoadableAmount(cloth) > 100, "the ship has room for more than a hold");
        assertTrue(player.getGold() / price > 100, "and the gold buys more");
        assertTrue(client.getCommands().buyGoods(ship.getId(), cloth.getId(), false),
            "a hold is bought without asking");
        assertEquals(100, serverShip(ship).getGoodsCount(cloth), "one hold of cloth");
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId(), false, 0),
            "and sold again");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "no cloth");
        // Put the ten back, asked, for what follows.
        amount = "10";
        assertTrue(client.getCommands().buyGoods(ship.getId(), cloth.getId(), true),
            "the ten are bought again");
        assertEquals(10, serverShip(ship).getGoodsCount(cloth), "ten again");
        awaitGold(serverPlayer.getGold());

        // The right-click menus of the Europe panel: the market's goods buy
        // onto the ship, its cargo sells, and the ship has no field orders to give.
        final Menus menus = client.getMenus();
        final String market = menus.goods("europe", cloth.getId(), 100);
        assertTrue(market.contains("\"id\":\"buy:" + ship.getId() + "," + cloth.getId() + "\""), market);
        final String cargo = menus.goods(ship.getId(), cloth.getId(), 20);
        assertTrue(cargo.contains("\"id\":\"sell:" + ship.getId() + "," + cloth.getId() + "\""), cargo);
        final String orders = menus.unit(ship.getId());
        assertFalse(orders.contains("FORTIFYING"), "nothing to fortify in Europe: " + orders);
        // QuickActionMenu lists Activate, Sentry and Clear orders in Europe too.
        assertTrue(orders.contains("state:ACTIVE:" + ship.getId()), "activate in Europe: " + orders);
        assertTrue(orders.contains("state:SENTRY:" + ship.getId()), "sentry in Europe: " + orders);
        assertTrue(orders.contains("clear:" + ship.getId()), "clear orders in Europe: " + orders);
        // A shift-click asks how many; a plain click sells the stack.
        amount = "5";
        assertTrue(client.getCommands().menuEntry("sell:" + ship.getId() + "," + cloth.getId() + ",ask"),
            "the menu's entry sells");
        assertEquals(5, ship.getGoodsCount(cloth));
        // The drag's sale, the purchase again and the menu's sale are logged.
        assertEquals(10, logOf(parse(lastEurope())).size(),
            "ten trades this turn: " + lastEurope());

        // The Europe panel shows the cargo of the ship in port.
        java.util.Map<String, Object> panel = europePanel(player);
        assertEquals(5, cargoOf(panel, ship.getId(), cloth.getId()),
            "the panel lists the cargo");

        // A boycotted goods cannot be traded, and the panel says why.
        serverPlayer.getMarket().setArrears(cloth, 100);
        player.getMarket().setArrears(cloth, 100);
        assertFalse(player.canTrade(cloth), "the cloth is boycotted");
        panel = europePanel(player);
        final java.util.Map<String, Object> entry = marketOf(panel).stream()
            .filter(g -> cloth.getId().equals(g.get("id"))).findFirst().get();
        assertEquals(false, entry.get("enabled"), "the goods cannot be traded");
        assertEquals(Messages.message(Boycotts.reason(player, cloth)),
            entry.get("reason"), "the panel says why");

        // The trade is refused: the player is asked to pay the arrears, and
        // the fake Browser UI does not.
        amount = null;
        gold = serverPlayer.getGold();
        assertFalse(client.getCommands().buyGoods(ship.getId(), cloth.getId()),
            "a boycotted goods cannot be bought");
        assertTrue(lastQuestion("confirm").contains("boycotting these goods"),
            "the player is asked to pay the arrears");
        // The stack dropped on the market asks first: pay the arrears or
        // dump the goods. Cancelled, nothing happens.
        wanted = null;
        assertFalse(client.getCommands().sellGoods(ship.getId(), cloth.getId()),
            "a boycotted goods cannot be sold");
        assertTrue(lastQuestion("choice").contains(Messages.message("boycottedGoods.dumpGoods")),
            "the player may dump the goods: " + lastQuestion("choice"));
        // Paying is chosen, and then declined by the fake Browser UI.
        wanted = Messages.message("payArrears");
        assertFalse(client.getCommands().sellGoods(ship.getId(), cloth.getId()),
            "paying the arrears sells nothing");
        assertTrue(lastQuestion("confirm").contains("boycotting these goods"),
            "the player is asked to pay the arrears");
        assertEquals(5, serverShip(ship).getGoodsCount(cloth),
            "nothing bought or sold");
        assertEquals(gold, serverPlayer.getGold(), "nothing paid");
        assertEquals(10, logOf(parse(lastEurope())).size(),
            "a refused trade is not logged: " + lastEurope());

        // The market's menu offers to pay the arrears, ship or none, and
        // the cargo's menu too.
        assertTrue(client.getMenus().goods("europe", cloth.getId(), 100)
            .contains("\"id\":\"payArrears:" + cloth.getId() + "\""),
            client.getMenus().goods("europe", cloth.getId(), 100));

        // Asked again, the player pays the arrears: the boycott is lifted
        // and the panel offers the goods again, but nothing is traded yet,
        // as in Swing.
        payArrears = true;
        wanted = Messages.message("payArrears");
        final int arrears = serverPlayer.getArrears(cloth);
        assertFalse(client.getCommands().sellGoods(ship.getId(), cloth.getId()),
            "paying the arrears sells nothing");
        assertTrue(serverPlayer.canTrade(cloth), "the boycott is lifted on the server");
        assertTrue(player.canTrade(cloth), "the boycott is lifted on the client");
        assertEquals(gold - arrears, serverPlayer.getGold(), "the arrears are paid");
        assertEquals(5, serverShip(ship).getGoodsCount(cloth), "nothing sold");
        client.getClient().getGUI().showEuropePanel();
        final java.util.Map<String, Object> lifted = marketOf(parse(lastEurope())).stream()
            .filter(g -> cloth.getId().equals(g.get("id"))).findFirst().get();
        assertEquals(true, lifted.get("enabled"), "the goods can be traded again");

        // Goods go from one ship in port to another, from its cargo menu or by
        // a drop on the other ship's icon.
        final String bought = offers(europePanel(player), "purchase").keySet().stream()
            .filter(id -> serverType(id).isNaval()).findFirst().get();
        assertTrue(client.getCommands().trainUnit(bought), "a second ship is bought");
        awaitGold(serverPlayer.getGold());
        final String other = unitIds(europePanel(player), "inPort").stream()
            .filter(id -> !id.equals(ship.getId())).findFirst().get();
        final String menu = client.getMenus().goods(ship.getId(), cloth.getId(), 5);
        assertTrue(menu.contains("\"id\":\"transfer:" + ship.getId() + "," + other
            + "," + cloth.getId() + ",5\""), menu);
        assertTrue(client.getCommands().menuEntry(
            "transfer:" + ship.getId() + "," + other + "," + cloth.getId() + ",5"),
            "the goods move to the other ship");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "none left aboard");
        assertEquals(5, server.getGame().getFreeColGameObject(other, Unit.class)
            .getGoodsCount(cloth), "the other ship has it");
        assertTrue(client.getCommands().menuEntry(
            "transfer:" + other + "," + ship.getId() + "," + cloth.getId() + ",5"),
            "and back again");

        // Boycotted again: the cargo menu offers Dump cargo beside paying
        // the arrears, and a stack dropped on the market can be dumped.
        serverPlayer.getMarket().setArrears(cloth, 100);
        player.getMarket().setArrears(cloth, 100);
        final String boycottedMenu = menus.goods(ship.getId(), cloth.getId(), 5);
        assertTrue(boycottedMenu.contains("\"id\":\"dump:" + ship.getId() + "," + cloth.getId() + ",5\""),
            boycottedMenu);
        assertTrue(boycottedMenu.contains("\"id\":\"sell:" + ship.getId() + "," + cloth.getId() + "\""),
            "paying the arrears stays: " + boycottedMenu);
        gold = serverPlayer.getGold();
        wanted = Messages.message("boycottedGoods.dumpGoods");
        final int loggedBefore = logOf(parse(lastEurope())).size();
        shown.clear();
        assertTrue(client.getCommands().sellGoods(ship.getId(), cloth.getId()),
            "the stack is dumped");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "the cloth is gone");
        assertEquals(gold, serverPlayer.getGold(), "and not paid for");
        // A dump is not a sale: no entry in the log and no sale sound (#441).
        client.getClient().getGUI().showEuropePanel();
        assertEquals(loggedBefore, logOf(parse(lastEurope())).size(),
            "a dump is not logged as a sale: " + lastEurope());
        assertFalse(shown.stream().anyMatch(e -> e.startsWith("sound ")
            && e.contains("sellCargo")), "no sale sound for a dump: " + shown);

        // The Europe panel's Unload button sells every stack the Crown
        // trades, and takes the units ashore.
        serverPlayer.getMarket().setArrears(cloth, 0);
        player.getMarket().setArrears(cloth, 0);
        amount = "10";
        assertTrue(client.getCommands().buyGoods(ship.getId(), cloth.getId(), true), "ten bought");
        awaitGold(serverPlayer.getGold());
        gold = serverPlayer.getGold();
        assertTrue(client.getCommands().menuEntry("unloadEurope:" + ship.getId()), "unloaded");
        assertEquals(0, serverShip(ship).getGoodsCount(cloth), "the cloth is sold");
        assertTrue(serverPlayer.getGold() > gold, "and paid for");
        assertEquals(loggedBefore + 2, logOf(parse(lastEurope())).size(),
            "the purchase and the real sale are logged: " + lastEurope());
        assertTrue(shown.stream().anyMatch(e -> e.startsWith("sound ")
            && e.contains("sellCargo")), "a real sale sounds: " + shown);

        // A new turn starts with an empty log.
        endTurnAndWait();
        shown.clear();
        client.getClient().getGUI().showEuropePanel();
        assertEquals(List.of(), logOf(parse(lastEurope())),
            "the log is cleared on a new turn");
    }

    /** The entries of a Europe panel's sales log, each its lines. */
    @SuppressWarnings("unchecked")
    private static List<List<String>> logOf(java.util.Map<String, Object> panel) {
        final java.util.Map<String, Object> log
            = (java.util.Map<String, Object>)panel.get("log");
        assertEquals("Sales", log.get("heading"));
        final List<List<String>> entries = new ArrayList<>();
        for (Object e : (List<Object>)log.get("entries")) {
            entries.add((List<String>)e);
        }
        return entries;
    }

    /**
     * The amount of a goods type in the cargo of a ship, as the Europe panel
     * shows it.
     *
     * @param panel The Europe panel.
     * @param shipId The id of the ship.
     * @param goodsId The id of the goods type.
     * @return The amount, or 0 for none.
     */
    @SuppressWarnings("unchecked")
    private static int cargoOf(java.util.Map<String, Object> panel, String shipId,
                               String goodsId) {
        for (Object o : (List<Object>)panel.get("inPort")) {
            final java.util.Map<String, Object> unit
                = (java.util.Map<String, Object>)o;
            if (!shipId.equals(unit.get("id"))) continue;
            for (Object c : (List<Object>)unit.get("cargo")) {
                final java.util.Map<String, Object> cargo
                    = (java.util.Map<String, Object>)c;
                if (goodsId.equals(cargo.get("id"))) {
                    return ((Number)cargo.get("amount")).intValue();
                }
            }
        }
        return 0;
    }
}
