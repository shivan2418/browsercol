package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.ClientOptions;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.BuildingType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovement;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.TradeRoute;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.common.model.UnitLocation;
import net.sf.freecol.common.model.WorkLocation;


/**
 * The human plays turns through the same {@link Commands} the Browser UI
 * calls, in a Classic game between the two Engines: sail the ship to land,
 * put a colonist ashore, found a colony and end the turn.
 */
class CommandsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final ExecutorService ui = Executors.newSingleThreadExecutor();

    private static final Pattern VALUE = Pattern.compile("\"value\":\"([^\"]*)\"");
    private static final Pattern ENABLED = Pattern.compile("\"enabled\":(true|false)");
    /** The choices of a choice question, as they reach the Browser UI. */
    private static final Pattern CHOICES = Pattern.compile("\"choices\":\\[(.*)]");
    private static final Pattern TEXT = Pattern.compile("\"text\":\"((?:[^\"\\\\]|\\\\.)*)\"");

    /** The colony panels the WebGUI showed, as their JSON. */
    private final List<String> colonies = Collections.synchronizedList(new ArrayList<>());

    /** The reports the WebGUI showed, as their JSON. */
    private final List<String> reports = Collections.synchronizedList(new ArrayList<>());
    /** The information panels the WebGUI showed, as their JSON. */
    private final List<String> informationPanels = Collections.synchronizedList(new ArrayList<>());

    /** The questions the fake Browser UI answered, with its answers. */
    private final List<String> asked = Collections.synchronizedList(new ArrayList<>());

    /** The label of the destination the fake Browser UI picks, if any. */
    private volatile String wanted = null;
    /** What the fake Browser UI answers to the names of a new nation. */
    private volatile String names = null;
    /** What the fake Browser UI answers to the select amount dialog. */
    private volatile String amount = null;
    /** The warehouse dialog's answer. */
    private volatile String warehouse = null;
    /** What the fake Browser UI answers to a confirm question, if not its usual answer. */
    private volatile Boolean confirm = null;

    /** The ids of the colonies whose panels the WebGUI closed. */
    private final List<String> closedColonies = Collections.synchronizedList(new ArrayList<>());

    /** The high score tables the fake Browser UI was shown. */
    private final List<String> highScores = Collections.synchronizedList(new ArrayList<>());

    /** The trade routes panels the fake Browser UI was shown. */
    private final List<String> routePanels = Collections.synchronizedList(new ArrayList<>());

    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
        ui.shutdownNow();
    }

    /**
     * The fake Browser UI accepts every confirmation but sailing to
     * Europe, takes the first choice it can and keeps the suggested text
     * of an input. A destination it is told to pick is the one it takes.
     */
    private String accept(String kind, String json) {
        switch (kind) {
        case "confirm":
            return String.valueOf((confirm != null) ? confirm : !json.contains("Europe"));
        // The end turn dialog's ok ends the turn; the pre-combat dialog's attacks.
        case "endTurn": return "ok";
        case "preCombat": return "true";
        case "choice":
            if (wanted != null) {
                final int i = choiceIndex(json, wanted);
                if (i < 0) fail("no choice " + wanted + " in " + json);
                return String.valueOf(i);
            }
            Matcher e = ENABLED.matcher(json);
            for (int i = 0; e.find(); i++) {
                if (e.group(1).equals("true")) return String.valueOf(i);
            }
            return null;
        default:
            Matcher m = VALUE.matcher(json);
            return m.find() ? m.group(1) : null;
        }
    }

    /**
     * The index of the choice with the wanted text, or -1 if there is no
     * such choice.
     */
    private static int choiceIndex(String json, String wanted) {
        final Matcher c = CHOICES.matcher(json);
        if (!c.find()) return -1;
        final Matcher t = TEXT.matcher(c.group(1));
        int i = 0;
        while (t.find()) {
            if (wanted.equals(unescape(t.group(1)))) return i;
            i++;
        }
        return -1;
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

    /** The text of a JSON payload, as the Browser UI reads it. */
    private static String textOf(String json) {
        final Matcher t = TEXT.matcher(json);
        assertTrue(t.find(), () -> "the payload has a text: " + json);
        return unescape(t.group(1));
    }

    /** Start a Classic game with no autoplay and return once it is our turn. */
    private void startGame() throws Exception {
        for (long seed = FIRST_SEED; seed < FIRST_SEED + MAX_SEEDS; seed++) {
            startGame(seed);
            final int nearest = landNearTheShip();
            if (nearest <= LAND_WITHIN) {
                System.out.println("CommandsTest: map seed " + seed
                    + ", land " + nearest + " tiles from the ship");
                return;
            }
            System.out.println("CommandsTest: map seed " + seed + " rejected, land "
                + nearest + " tiles from the ship");
        }
        fail("no map seed from " + FIRST_SEED + " to " + (FIRST_SEED + MAX_SEEDS - 1)
            + " puts land within " + LAND_WITHIN + " tiles of the ship");
    }

    /** Seeds are tried in order from here, so a run can be reproduced. */
    private static final long FIRST_SEED = 1;
    private static final int MAX_SEEDS = 20;
    /** The tests sail with a limit of 8 turns to sight land; this leaves margin. */
    private static final int LAND_WITHIN = 10;

    /** The distance from the human's ship to the nearest land, on the server's map. */
    private int landNearTheShip() {
        final String me = client.getClient().getMyPlayer().getId();
        final Unit ship = server.getGame().getFreeColGameObject(me, Player.class)
            .getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile from = ship.getTile();
        return server.getGame().getMap().getTileSet(Tile::isLand).stream()
            .mapToInt(t -> t.getDistanceTo(from)).min().orElse(Integer.MAX_VALUE);
    }

    /** Start a Classic game on the map a seed makes, and return once it is our turn. */
    private void startGame(long seed) throws Exception {
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
                    if (kind.equals("colony")) colonies.add(json);
                    if (kind.equals("tradeRoutes")) routePanels.add(json);
                    if (kind.equals("information")) informationPanels.add(json);
                    if (kind.equals("report")) reports.add(json);
                    if (kind.equals("highScores")) highScores.add(json);
                    if (kind.equals("closeColony")) closedColonies.add(json);
                }
                public void ask(int id, String kind, String json) {
                    ui.execute(() -> {
                            String answer = kind.equals("names") ? names
                                : kind.equals("amount") ? amount
                                : kind.equals("warehouse") ? warehouse
                                : accept(kind, json);
                            asked.add(kind + " " + json + " -> " + answer);
                            client.answer(id, answer);
                        });
                }
            });
        server.startGame("classic", new GamePreset(null, null, null,
            seed, new java.util.LinkedHashMap<>()));
        assertTrue(client.startGame(0), "login");
        ourTurn.await();
    }

    /**
     * End our turn and wait until the AI hands play back.
     *
     * The client may decline to end the turn: a unit that arrives at the
     * end of its goto with moves left is selected for the player instead
     * (Swing's player presses End Turn again). So press it again while
     * the turn stands still, and fail rather than wait for ever.
     */
    private void endTurnAndWait(Commands commands) throws InterruptedException {
        final FreeColClient fcc = client.getClient();
        final int turn = client.getGame().getTurn().getNumber();
        assertTrue(commands.endTurn(), "end turn");
        final long start = System.currentTimeMillis();
        long pressed = start;
        while (!(fcc.currentPlayerIsMyPlayer()
                 && client.getGame().getTurn().getNumber() > turn)) {
            Thread.sleep(20);
            final long now = System.currentTimeMillis();
            assertTrue(now - start < 60_000, () -> "the turn ended within 60 s; asked "
                + asked + ", units " + fcc.getMyPlayer().getUnits()
                    .map(u -> u + " " + u.getState() + " moves " + u.getMovesLeft()
                        + " to " + u.getDestination()).toList());
            if (now - pressed > 2_000) {
                commands.endTurn(); // a no-op while the AI plays
                pressed = now;
            }
        }
    }

    private Unit active() {
        return client.getClient().getGUI().getActiveUnit();
    }

    /** Click a tile until the wanted unit is the active one. */
    private void select(Commands commands, Unit unit) {
        final Tile tile = unit.getTile();
        for (int i = 0; i < 10 && active() != unit; i++) {
            assertTrue(commands.click(tile.getX(), tile.getY()), "click selects");
        }
        assertSame(unit, active());
    }

    /** The direction of the explored sea neighbour nearest a target. */
    private static Direction stepToward(Tile from, Tile target) {
        Direction best = null;
        int distance = Integer.MAX_VALUE;
        for (Direction d : Direction.values()) {
            Tile n = from.getNeighbourOrNull(d);
            if (n == null || !n.isExplored() || n.isLand()) continue;
            if (n.getDistanceTo(target) < distance) {
                distance = n.getDistanceTo(target);
                best = d;
            }
        }
        return best;
    }

    /** The server's copy of one of our units. */
    private Unit serverUnit(Unit unit) {
        return server.getGame().getFreeColGameObject(unit.getId(), Unit.class);
    }

    /** The server's copy of a tile. */
    private Tile serverTile(Tile tile) {
        return server.getGame().getMap().getTile(tile.getX(), tile.getY());
    }

    /**
     * Sail the ship to a sea tile, exploring as it goes, and wait for it
     * to arrive.
     *
     * @param commands The commands to play through.
     * @param ship The ship to sail.
     * @param sea The sea tile to reach.
     */
    private void sailTo(Commands commands, Unit ship, Tile sea)
            throws InterruptedException {
        int turns = 0;
        // Explore toward it step by step until the sea tile is in sight,
        // then go there.
        while (!sea.isExplored()) {
            if (ship.getMovesLeft() == 0) {
                endTurnAndWait(commands);
                assertTrue(++turns < 8, "land is in sight within 8 turns");
            }
            select(commands, ship);
            assertTrue(commands.move(stepToward(ship.getTile(), sea).toString()),
                       "the ship moves");
        }
        if (ship.getTile() != sea) {
            select(commands, ship);
            assertTrue(commands.goTo(sea.getX(), sea.getY()), "the ship sets off");
        }
        while (ship.getTile() != sea) {
            endTurnAndWait(commands);
            assertTrue(++turns < 12, "the ship arrives within 12 turns");
        }
    }

    /**
     * Move the ship onto the high seas, where it can sail to Europe. It
     * starts there, but the map is made afresh for every game.
     *
     * @param commands The commands to play through.
     * @param ship The ship to sail.
     */
    private void sailOntoHighSeas(Commands commands, Unit ship)
            throws InterruptedException {
        if (ship.getTile().isDirectlyHighSeasConnected()) return;
        // The server's map knows the high seas: the nearest tile that
        // touches them and has no unit on it.
        final Map known = server.getGame().getMap();
        final Tile from = known.getTile(ship.getTile().getX(), ship.getTile().getY());
        final Tile highSeas = known.getTileSet(
                t -> t.isDirectlyHighSeasConnected() && t.getUnitCount() == 0)
            .stream().min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .orElse(null);
        assertNotNull(highSeas, "the map has high seas");
        sailTo(commands, ship, client.getGame().getMap()
            .getTile(highSeas.getX(), highSeas.getY()));
        assertTrue(ship.getTile().isDirectlyHighSeasConnected(),
                   "the ship is on the high seas");
    }

    @Test
    @Timeout(180)
    void theHumanSailsToLandAndFoundsAColony() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Colony colony = foundAColony(commands);

        // The server's game agrees: our colony stands on that land.
        assertNotNull(colony, () -> "the server has the colony; asked " + asked
            + "; told " + player.getModelMessages().stream().map(Messages::message).toList());
        assertEquals(player.getId(), colony.getOwner().getId());

        // The controller opened the colony panel after founding, with the
        // founding colonist working in it.
        final Colony ours = client.getGame().getFreeColGameObject(colony.getId(), Colony.class);
        assertTrue(colonies.stream().anyMatch(json -> json.startsWith(
                    "{\"id\":\"" + colony.getId() + "\"")),
            () -> "the colony panel opened after founding: " + colonies);
        final String founder = ours.getUnitList().get(0).getId();
        assertTrue(colonies.get(0).contains("\"id\":\"" + founder + "\""),
            () -> "the founder is in the panel: " + colonies.get(0));

        // Clicking our colony on the map opens its panel, as in Swing.
        colonies.clear();
        assertTrue(commands.click(colony.getTile().getX(), colony.getTile().getY()));
        assertEquals(1, colonies.size(), colonies::toString);
        assertTrue(colonies.get(0).startsWith("{\"id\":\"" + colony.getId() + "\""));

        // The tile's popup offers to rename our colony, as TilePopup does.
        final String popup = client.getMenus().tile(colony.getTile().getX(), colony.getTile().getY());
        assertTrue(popup.contains("\"id\":\"rename:" + colony.getId() + "\""),
            () -> "the popup has Rename: " + popup);
    }

    /**
     * A unit that cannot found a colony is told so by name, and why: the
     * message names the unit's type, and not "null", as it does for a unit
     * the player never renamed, and then the cause Unit.canBuildColony
     * found: the unit's type, a rebel's game option, or no moves left.
     */
    @Test
    @Timeout(240)
    void theHumanIsToldWhichUnitCannotFoundAColonyAndWhy() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Unit colonist = landAColonist(commands);
        final Unit ship = client.getClient().getMyPlayer().getUnits()
            .filter(Unit::isNaval).findFirst().get();

        // The colonist has used its moves landing, so it cannot found a
        // colony yet, and the Browser UI is told which unit cannot.
        assertFalse(colonist.canBuildColony(), "the colonist cannot found a colony");
        assertFalse(UnitOrders.valid(client.getClient().getMyPlayer(), colonist).contains("buildColony"),
                    "so the order is not offered");
        final String text = cannotFoundMessage(commands, colonist);
        final String sentence = Messages.message("buildColony.badUnit");
        assertTrue(sentence.contains("%unit%"), () -> "the rules' sentence: " + sentence);
        final int at = sentence.indexOf("%unit%");
        assertTrue(text.startsWith(sentence.substring(0, at)),
            () -> "the message is the rules' own: " + text);
        assertTrue(text.contains(sentence.substring(at + "%unit%".length())),
            () -> "the message is the rules' own: " + text);
        assertTrue(text.contains(typeName(colonist)),
            () -> "the message names the colonist's type: " + text);
        assertFalse(text.contains("null"), () -> "the message does not say null: " + text);
        assertTrue(text.endsWith("It has no moves left this turn."),
            () -> "the message says the colonist has no moves left: " + text);

        // A ship never founds a colony, moves or not.
        final String shipText = cannotFoundMessage(commands, ship);
        assertTrue(shipText.contains(typeName(ship)), () -> "names the ship: " + shipText);
        assertTrue(shipText.endsWith("Units of its type never found colonies."),
            () -> "the message says the ship's type cannot: " + shipText);

        // A rebel founds no colony unless the game option says so; that is
        // the cause, ahead of the colonist's moves.
        client.getClient().getMyPlayer().changePlayerType(Player.PlayerType.REBEL);
        final String option = Messages.message("model.option.foundColonyDuringRebellion.name");
        final String rebelText = cannotFoundMessage(commands, colonist);
        assertTrue(rebelText.endsWith("A rebel founds no colony while the game option "
                + option + " is off."),
            () -> "the message names the game option: " + rebelText);
    }

    /** The one message the Browser UI is shown when the unit tries to found a colony and cannot. */
    private String cannotFoundMessage(Commands commands, Unit unit) {
        informationPanels.clear();
        select(commands, unit);
        assertFalse(commands.buildColony(), "no colony founded");
        assertEquals(1, informationPanels.size(), informationPanels::toString);
        return textOf(informationPanels.get(0));
    }

    /** The name of a unit's type, as the rules give it. */
    private static String typeName(Unit unit) {
        return Messages.message(StringTemplate
            .template(Messages.nameKey(unit.getType().getId()))
            .addAmount("%number%", 1));
    }

    @Test
    @Timeout(180)
    void theHumanMovesAColonistBetweenATileABuildingAndOutside() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit colonist = ours.getUnitList().get(0);
        final Unit onServer = serverColony.getGame().getFreeColGameObject(colonist.getId(), Unit.class);
        assertNotNull(onServer, "the server has the colonist");

        // Where the colonist works at first: a colony tile, not the building.
        final Building hall = ours.getBuildings().stream()
            .filter(b -> b.getNoAddReason(colonist) == UnitLocation.NoAddReason.NONE)
            .findFirst().get();
        final String tileId = colonist.getLocation().getId();
        assertTrue(colonist.getLocation() instanceof ColonyTile, "starts on a tile");
        final ColonyTile tile = (ColonyTile)colonist.getLocation();
        final String made = ColonyJson.of(ours, 0);
        assertTrue(made.contains("\"workers\":[{\"id\":\"" + colonist.getId() + "\""), made);

        // To a building and the server agrees, with the panel's JSON.
        assertTrue(commands.work(colonist.getId(), hall.getId()), "works in the building");
        assertEquals(hall.getId(), onServer.getLocation().getId());
        assertEquals(hall.getId(), colonist.getLocation().getId());
        assertEquals(1, serverColony.getBuilding(hall.getType()).getUnitList().size());
        assertTrue(serverColony.getColonyTile(
                serverColony.getGame().getFreeColGameObject(tile.getId(), ColonyTile.class)
                    .getWorkTile()).isEmpty(), "the tile is free");
        assertFalse(commands.work(colonist.getId(), hall.getId()), "already there");

        // Back to the tile.
        assertTrue(commands.work(colonist.getId(), tileId), "works the tile again");
        assertEquals(tileId, onServer.getLocation().getId());
        assertEquals(tileId, colonist.getLocation().getId());

        // What the tile makes can change.
        final GoodsType now = onServer.getWorkType();
        final GoodsType other = client.getGame().getSpecification().getGoodsTypeList().stream()
            .filter(g -> g != now && tile.getPotentialProduction(g, colonist.getType()) > 0)
            .findFirst().orElse(null);
        assertNotNull(other, "the tile makes something else too");
        assertTrue(commands.changeWorkType(colonist.getId(), other.getId()), "work type");
        assertEquals(other.getId(), onServer.getWorkType().getId());
        assertFalse(commands.changeWorkType(colonist.getId(), "model.goods.noSuch"));

        // Outside the colony: on its tile, working nothing.
        assertTrue(commands.putOutsideColony(colonist.getId()), "outside");
        assertEquals(serverColony.getTile().getId(), onServer.getLocation().getId());
        assertEquals(ours.getTile(), colonist.getLocation());
        assertFalse(commands.putOutsideColony(colonist.getId()), "already outside");
        assertTrue(commands.work(colonist.getId(), hall.getId()), "back to work from outside");
        assertEquals(hall.getId(), onServer.getLocation().getId());
    }

    @Test
    @Timeout(180)
    void goodsDroppedOnAColonistEquipItWithTheRoleTheyGive() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit colonist = ours.getUnitList().get(0);
        final GoodsType tools = client.getGame().getSpecification().getGoodsType("model.goods.tools");
        assertFalse(commands.equip(colonist.getId(), "model.goods.noSuch"));
        final int had = ours.getGoodsCount(tools);
        client.debugApplied(server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.tools\","
            + "\"amount\":100,\"x\":" + ours.getTile().getX() + ",\"y\":" + ours.getTile().getY() + "}"));
        awaitTrue(() -> ours.getGoodsCount(tools) == had + 100, "the colony has the tools");
        assertFalse(commands.equip(colonist.getId(), "model.goods.lumber"), "lumber equips no one");
        assertTrue(commands.equip(colonist.getId(), tools.getId()), "equipped");
        assertEquals("model.role.pioneer", colonist.getRole().getId());
        assertFalse(commands.equip(colonist.getId(), tools.getId()), "already as equipped as the tools allow");
    }

    @Test
    @Timeout(180)
    void anOpenColonyPanelSaysWhenAUnitChangesType() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Specification spec = client.getGame().getSpecification();
        // Founding a colony opens its panel; closed, the colony says nothing, as ColonyPanel is not listening.
        assertTrue(commands.closeColonyPanel(ours.getId()), "closes the panel");
        informationPanels.clear();
        ours.firePropertyChange(Colony.ColonyChangeEvent.UNIT_TYPE_CHANGE.toString(),
            spec.getUnitType("model.unit.freeColonist"), spec.getUnitType("model.unit.masterCarpenter"));
        assertTrue(informationPanels.isEmpty(), "nobody is told: " + informationPanels);
        assertTrue(commands.showColony(ours.getId()), "opens the panel");
        ours.firePropertyChange(Colony.ColonyChangeEvent.UNIT_TYPE_CHANGE.toString(),
            spec.getUnitType("model.unit.freeColonist"), spec.getUnitType("model.unit.masterCarpenter"));
        assertEquals(1, informationPanels.size(), "the change is told");
        assertTrue(informationPanels.get(0).contains(Messages.getName(spec.getUnitType("model.unit.masterCarpenter"))),
            informationPanels.get(0));
    }

    @Test
    @Timeout(180)
    void aColonistPutOnAPoorerTileIsToldOfTheBestOne() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit colonist = ours.getUnitList().get(0);
        final ClientOptions options = client.getClient().getClientOptions();
        final List<ColonyTile> tiles = ours.getColonyTiles().stream()
            .filter(t -> t.getNoAddReason(colonist) == UnitLocation.NoAddReason.NONE)
            .collect(Collectors.toList());

        // ColonyPanel's warning, once for each better tile in a row.
        informationPanels.clear();
        WorkLocation warned = null;
        int warnings = 0;
        for (ColonyTile t : tiles) {
            final int before = informationPanels.size();
            if (!commands.work(colonist.getId(), t.getId())) continue;
            final GoodsType made = colonist.getWorkType();
            final WorkLocation best = (made == null) ? null : ours.getWorkLocationFor(colonist, made);
            final boolean poorer = best != null && best != t
                && t.getPotentialProduction(made, colonist.getType())
                    < best.getPotentialProduction(made, colonist.getType());
            if (poorer && best != warned) {
                warned = best;
                warnings++;
                assertEquals(before + 1, informationPanels.size(), "warned on " + t);
                final String text = textOf(informationPanels.get(before));
                assertTrue(text.contains(Messages.getName(made)), text);
            } else {
                assertEquals(before, informationPanels.size(), "no warning on " + t);
            }
        }
        assertTrue(warnings > 0, "some tile is poorer than the best");

        // The option off: no warnings.
        options.setBoolean(ClientOptions.SHOW_NOT_BEST_TILE, false);
        informationPanels.clear();
        for (ColonyTile t : tiles) commands.work(colonist.getId(), t.getId());
        assertEquals(List.of(), informationPanels);
    }

    @Test
    @Timeout(180)
    void aColonistPutOnARumourTileIsToldOfTheRumourNotDocks() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit colonist = ours.getUnitList().get(0);

        // A land tile of the colony, unclaimed and with a rumour, on both sides.
        final ColonyTile ct = ours.getColonyTiles().stream()
            .filter(t -> !t.isColonyCenterTile() && t.getWorkTile().isLand() && t.isEmpty())
            .findFirst().get();
        final Tile serverTile = serverColony.getGame()
            .getFreeColGameObject(ct.getWorkTile().getId(), Tile.class);
        final LostCityRumour rumour = new LostCityRumour(serverTile.getGame(), serverTile);
        serverTile.changeOwnership(null, null);
        serverTile.addLostCityRumour(rumour);
        // The client cannot make ids, so its copy takes the server's.
        final Tile clientTile = ct.getWorkTile();
        final LostCityRumour copy = new LostCityRumour(clientTile.getGame(), rumour.getId());
        final java.lang.reflect.Field at = net.sf.freecol.common.model.TileItem.class.getDeclaredField("tile");
        at.setAccessible(true);
        at.set(copy, clientTile);
        clientTile.changeOwnership(null, null);
        clientTile.addLostCityRumour(copy);
        assertEquals(UnitLocation.NoAddReason.MISSING_ABILITY, ct.getNoAddReason(colonist));

        informationPanels.clear();
        assertFalse(commands.work(colonist.getId(), ct.getId()), "the rumour tile is refused");
        assertEquals(1, informationPanels.size());
        final String text = textOf(informationPanels.get(0));
        assertEquals(Messages.message("model.noClaimReason.rumour.description"), text);
    }

    @Test
    @Timeout(180)
    void theLabourReportIsTheKindTheClientOptionSays() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final ClientOptions options = client.getClient().getClientOptions();
        reports.clear();
        assertTrue(commands.showReport("labour"));
        assertTrue(reports.get(0).contains("\"report\":\"labour\""), reports.get(0));
        options.setInteger(ClientOptions.LABOUR_REPORT, ClientOptions.LABOUR_REPORT_COMPACT);
        assertTrue(commands.showReport("labour"));
        assertTrue(reports.get(1).contains("\"report\":\"compactLabour\""), reports.get(1));
    }

    @Test
    @Timeout(180)
    void theHumanEditsTheBuildQueueAndPaysForTheBuild() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Player us = serverColony.getOwner();

        // What the colony can queue, as the panel lists it (no reason given).
        final List<BuildableType> free = new ArrayList<>();
        BuildableType locked = null;
        for (BuildingType bt : ours.getSpecification().getBuildingTypeList()) {
            if (!bt.needsGoodsToBuild() || ours.getBuilding(bt) != null
                && ours.getBuilding(bt).getType() == bt) continue;
            if (BuildQueues.reasons(ours, bt, List.of(), null).isEmpty()) free.add(bt);
            else if (locked == null) locked = bt;
        }
        assertTrue(free.size() >= 2, "the colony can queue two buildings: " + free);
        assertNotNull(locked, "and cannot queue another");
        final BuildableType first = free.get(0);
        final BuildableType second = free.get(1);
        assertFalse(BuildQueues.reasons(ours, locked, List.of(), null).isEmpty());

        // Queue two, then reorder, then empty it: the server's colony follows.
        assertTrue(commands.setBuildQueue(ours.getId(), List.of(first.getId(), second.getId())));
        assertEquals(List.of(first, second), serverQueue(serverColony));
        assertEquals(List.of(first, second), ours.getBuildQueue());
        assertTrue(commands.setBuildQueue(ours.getId(), List.of(second.getId(), first.getId())));
        assertEquals(List.of(second, first), serverQueue(serverColony));
        assertTrue(ColonyJson.of(ours, 0).contains("\"queue\":[{\"type\":\"" + second.getId() + "\""));
        assertTrue(commands.setBuildQueue(ours.getId(), List.of()));
        assertTrue(serverQueue(serverColony).isEmpty());

        // What the colony cannot build, twice, or not at all, is refused.
        assertTrue(commands.setBuildQueue(ours.getId(), List.of(first.getId())));
        assertFalse(commands.setBuildQueue(ours.getId(), List.of(locked.getId())), "locked");
        assertFalse(commands.setBuildQueue(ours.getId(), List.of(first.getId(), first.getId())), "twice");
        assertFalse(commands.setBuildQueue(ours.getId(), List.of("model.building.noSuch")), "unknown");
        assertEquals(List.of(first), serverQueue(serverColony), "the queue stands");

        // An upgrade queued after the building it upgrades goes with it: taking the
        // building out would leave the colony unable to build the upgrade, as Swing's panel prunes.
        BuildingType upgrade = null;
        for (BuildableType up : free) {
            for (BuildingType bt : ours.getSpecification().getBuildingTypeList()) {
                if (bt.getUpgradesFrom() == up && !free.contains(bt)
                    && BuildQueues.reasons(ours, bt, List.of(up), null).isEmpty()) upgrade = bt;
            }
        }
        assertNotNull(upgrade, "some upgrade can follow a building the colony can queue");
        assertTrue(commands.setBuildQueue(ours.getId(),
            List.of(upgrade.getUpgradesFrom().getId(), upgrade.getId())));
        assertTrue(commands.setBuildQueue(ours.getId(), List.of(upgrade.getId())), "upgrade goes too");
        assertTrue(serverQueue(serverColony).isEmpty(), "both removed: " + serverQueue(serverColony));
        assertFalse(commands.setBuildQueue(ours.getId(), List.of(upgrade.getId())), "upgrade alone is new, so refused");
        assertTrue(commands.setBuildQueue(ours.getId(), List.of(first.getId())));

        // Pay for the build: the server's gold goes and nothing is left to make.
        us.modifyGold(5000);
        ours.getOwner().modifyGold(5000);
        final int price = serverColony.getPriceForBuilding();
        assertTrue(price > 0, "something is left to pay");
        final int gold = us.getGold();
        assertTrue(commands.payForBuilding(ours.getId()), "paid");
        assertEquals(0, serverColony.getPriceForBuilding());
        assertEquals(gold - price, us.getGold());
        assertEquals(0, ours.getPriceForBuilding());
    }

    @Test
    @Timeout(180)
    void theHumanSetsTheColonysExportLevelsInTheWarehouseDialog() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final GoodsType cloth = client.getGame().getSpecification().getGoodsType("model.goods.cloth");
        final String id = ours.getId();

        // An export level reaches the server's export data.
        assertFalse(serverColony.getExportData(cloth).getExportLevel() == 77);
        assertTrue(commands.setGoodsLevels(id, cloth.getId(), false, 10, 90, -1, 77));
        awaitTrue(() -> serverColony.getExportData(cloth).getExportLevel() == 77, "export level");
        assertEquals(10, serverColony.getExportData(cloth).getLowLevel());
        assertTrue(commands.setGoodsLevels(id, cloth.getId(), false, 10, 90, 33, 77));
        awaitTrue(() -> serverColony.getExportData(cloth).getImportLevel() == 33, "import level");
        assertEquals(90, serverColony.getExportData(cloth).getHighLevel());

        // Without a custom house the goods cannot be exported; levels out of range are refused.
        assertFalse(ours.hasAbility(net.sf.freecol.common.model.Ability.EXPORT));
        assertFalse(commands.setGoodsLevels(id, cloth.getId(), true, 10, 90, -1, 77), "no custom house");
        assertFalse(commands.setGoodsLevels(id, cloth.getId(), false, 101, 90, -1, 77), "low");
        assertFalse(commands.setGoodsLevels(id, cloth.getId(), false, 10, 90, -1, 100000), "export");
        assertFalse(commands.setGoodsLevels(id, "model.goods.noSuch", false, 10, 90, -1, 1), "unknown");
        assertEquals(77, serverColony.getExportData(cloth).getExportLevel());

        // The dialog: asked with every storable goods, saving only what changed.
        warehouse = cloth.getId() + "\tfalse\t20\t80\t-1\t55\n";
        asked.clear();
        assertTrue(commands.warehouse(id));
        awaitTrue(() -> !asked.isEmpty(), "the dialog is asked");
        assertTrue(lastAsked().startsWith("warehouse {\"title\":\"Warehouse\""), lastAsked());
        assertTrue(lastAsked().contains("\"type\":\"" + cloth.getId() + "\""), lastAsked());
        awaitTrue(() -> serverColony.getExportData(cloth).getExportLevel() == 55, "saved");
        assertEquals(20, serverColony.getExportData(cloth).getLowLevel());

        // Cancelled, nothing changes.
        warehouse = null;
        assertTrue(commands.warehouse(id));
        awaitTrue(() -> asked.size() == 2, "asked again");
        assertEquals(55, serverColony.getExportData(cloth).getExportLevel());
        assertFalse(commands.warehouse("nonsense"));
    }

    @Test
    @Timeout(180)
    void closingTheColonyPanelAsksToAbandonAnEmptyColony() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final String id = ours.getId();
        final String closed = "{\"id\":\"" + id + "\"}";

        // A colony that builds what its colonists can: the panel closes, nothing asked.
        asked.clear();
        assertTrue(commands.closeColonyPanel(id));
        assertTrue(askedOf("confirm").isEmpty(), () -> "nothing asked: " + asked);
        assertEquals(List.of(closed), closedColonies);

        // Building what needs more colonists than it has: asked, and cancel keeps the panel.
        final BuildableType big = ours.getSpecification().getBuildingTypeList().stream()
            .filter(bt -> bt.getRequiredPopulation() > ours.getUnitCount())
            .findFirst().orElseThrow();
        final List<BuildableType> queue = new ArrayList<>(ours.getBuildQueue());
        ours.setBuildQueue(List.of(big));
        confirm = false;
        assertFalse(commands.closeColonyPanel(id), "kept open");
        assertEquals(1, closedColonies.size());
        assertEquals(Messages.message(StringTemplate.template("colonyPanel.reducePopulation")
                .addName("%colony%", ours.getName())
                .addAmount("%number%", big.getRequiredPopulation())
                .addNamed("%buildable%", big)),
            textOf(lastAsked()));
        confirm = true;
        assertTrue(commands.closeColonyPanel(id), "closed on ok");
        assertEquals(2, closedColonies.size());
        ours.setBuildQueue(queue);

        // The last colonist steps outside: closing asks to abandon the colony.
        final Unit colonist = ours.getUnitList().get(0);
        assertTrue(commands.putOutsideColony(colonist.getId()), "the last colonist leaves");
        awaitTrue(() -> serverColony.getUnitCount() == 0, "the colony is empty");
        asked.clear();
        confirm = false;
        assertFalse(commands.closeColonyPanel(id), "no keeps the panel");
        assertEquals(2, closedColonies.size());
        assertTrue(lastAsked().startsWith("confirm "), lastAsked());
        assertEquals(Messages.message("abandonColony.text"), textOf(lastAsked()));
        assertTrue(lastAsked().contains("\"ok\":\"" + Messages.message("abandonColony.yes") + "\""),
                   lastAsked());
        assertTrue(serverColony.getTile().hasSettlement(), "the colony stands");

        // Yes abandons it: the panel closes and the colony is gone on both sides.
        confirm = true;
        assertTrue(commands.closeColonyPanel(id), "yes closes the panel");
        assertEquals(List.of(closed, closed, closed), closedColonies);
        final Tile tile = ours.getTile();
        awaitTrue(() -> !serverColony.getTile().hasSettlement(), "abandoned on the server");
        awaitTrue(() -> !tile.hasSettlement(), "abandoned on the client");
        assertSame(tile, colonist.getTile(), "the colonist stays on the tile");
    }

    /** Wait until a condition holds, as the server's changes reach the client. */
    private static void awaitTrue(java.util.function.BooleanSupplier ok, String what)
            throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(10);
        assertTrue(ok.getAsBoolean(), what);
    }

    /** The questions of one kind asked so far, in order, as "kind json -> answer". */
    private List<String> askedOf(String kind) {
        synchronized (asked) {
            return asked.stream().filter(q -> q.startsWith(kind + " ")).toList();
        }
    }

    /** The last question asked, as "kind json -> answer". */
    private String lastAsked() {
        return asked.get(asked.size() - 1);
    }

    @Test
    @Timeout(240)
    void theHumanLoadsAndUnloadsAShipInTheColony() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit serverShip = serverUnit(ship);
        final Tile land = ours.getTile();

        // Into port.
        select(commands, ship);
        assertTrue(commands.move(client.getGame().getMap()
            .getDirection(ship.getTile(), land).toString()), "the ship enters the colony");
        assertSame(land, ship.getTile());
        assertSame(serverColony.getTile(), serverShip.getTile());

        // A unit beside it (the passengers come ashore as it docks) boards it,
        // and leaves it again.
        for (Unit u : new ArrayList<>(ship.getUnitList())) {
            assertTrue(commands.leaveShip(u.getId()), "leaves the ship: " + u);
        }
        final Unit passenger = land.getUnitList().stream()
            .filter(Unit::isColonist).findFirst().orElse(null);
        assertNotNull(passenger, "a colonist stands in the colony: " + land.getUnitList());
        assertFalse(commands.leaveShip(passenger.getId()), "already ashore");
        assertTrue(commands.boardShip(passenger.getId(), ship.getId()), "boards");
        assertSame(serverShip, serverUnit(passenger).getLocation());
        assertTrue(ColonyJson.of(ours, 0).contains("\"units\":[{\"id\":\"" + passenger.getId()
            + "\""), "the cargo shows it");
        assertTrue(commands.leaveShip(passenger.getId()), "leaves the ship");
        assertSame(serverColony.getTile(), serverUnit(passenger).getLocation());

        // Goods in the warehouse to load.
        final GoodsType cloth = client.getGame().getSpecification().getGoodsType("model.goods.cloth");
        client.debugApplied(server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.cloth\","
            + "\"amount\":150,\"x\":" + land.getX() + ",\"y\":" + land.getY() + "}"));
        awaitTrue(() -> ours.getGoodsCount(cloth) == 150, "the colony has the cloth");

        // A plain load takes a hold's worth.
        asked.clear();
        assertTrue(commands.loadGoods(ship.getId(), cloth.getId(), false), "loads");
        assertEquals(100, serverShip.getGoodsCount(cloth));
        assertEquals(50, serverColony.getGoodsCount(cloth));
        assertEquals(100, ship.getGoodsCount(cloth));
        assertTrue(asked.isEmpty(), "nothing asked: " + asked);

        // Asked, the amount chosen, at most what the warehouse has.
        amount = "30";
        assertTrue(commands.loadGoods(ship.getId(), cloth.getId(), true), "loads some");
        assertTrue(lastAsked().startsWith("amount {"), lastAsked());
        assertTrue(lastAsked().contains("\"max\":50,"), lastAsked());
        assertEquals(130, serverShip.getGoodsCount(cloth));
        assertEquals(20, serverColony.getGoodsCount(cloth));

        // Cancelled, nothing moves.
        amount = null;
        assertFalse(commands.loadGoods(ship.getId(), cloth.getId(), true), "cancelled");
        assertFalse(commands.unloadGoods(ship.getId(), cloth.getId(), 100, true), "cancelled");
        assertEquals(130, serverShip.getGoodsCount(cloth));
        assertEquals(20, serverColony.getGoodsCount(cloth));

        // Unloading a stack of the cargo: the stack, or as much of it as is chosen.
        assertTrue(commands.unloadGoods(ship.getId(), cloth.getId(), 30, false), "unloads a stack");
        assertEquals(100, serverShip.getGoodsCount(cloth));
        assertEquals(50, serverColony.getGoodsCount(cloth));
        amount = "20";
        assertTrue(commands.unloadGoods(ship.getId(), cloth.getId(), 100, true), "unloads some");
        assertTrue(lastAsked().contains("\"max\":100,"), lastAsked());
        // Swing suggests what the warehouse has room for.
        final int room = serverColony.getWarehouseCapacity() - 50;
        assertTrue(lastAsked().contains("\"value\":" + Math.min(100, room) + ","), lastAsked());
        assertEquals(80, serverShip.getGoodsCount(cloth));
        assertEquals(70, serverColony.getGoodsCount(cloth));
        assertEquals(70, ours.getGoodsCount(cloth));
        assertTrue(commands.unloadGoods(ship.getId(), cloth.getId(), 80, false));
        assertEquals(0, serverShip.getGoodsCount(cloth));
        assertEquals(150, serverColony.getGoodsCount(cloth));
        assertFalse(commands.unloadGoods(ship.getId(), cloth.getId(), 80, false), "nothing aboard");
    }

    private static List<BuildableType> serverQueue(Colony serverColony) {
        return new ArrayList<>(serverColony.getBuildQueue());
    }

    /**
     * Sail to land, put a colonist ashore and found a colony, through the
     * commands, then end the turn.
     *
     * @param commands The commands to play through.
     * @return The server's colony.
     */
    private Colony foundAColony(Commands commands) throws Exception {
        final Unit colonist = landAColonist(commands);
        final Tile land = colonist.getTile();
        if (!colonist.canBuildColony()) endTurnAndWait(commands);

        assertTrue(UnitOrders.valid(client.getClient().getMyPlayer(), colonist).contains("buildColony"),
                   "a colonist with moves left is offered the order");
        select(commands, colonist);
        assertTrue(commands.buildColony(), "colony founded");
        endTurnAndWait(commands);

        return server.getGame().getMap()
            .getTile(land.getX(), land.getY()).getColony();
    }

    /**
     * Sail to land and put a colonist ashore, through the commands, as
     * {@link #foundAColony} does before it founds one.
     *
     * @param commands The commands to play through.
     * @return The colonist, on the land it landed on.
     */
    private Unit landAColonist(Commands commands) throws Exception {
        final Player player = client.getClient().getMyPlayer();
        final Map map = client.getGame().getMap();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit colonist = ship.getUnitList().stream()
            .filter(u -> u.getType().canBuildColony()).findFirst().get();

        // The script knows the whole map, from the server: the nearest
        // free land we may settle, and the sea beside it. No one owns it,
        // so founding needs no land claim (native land is only free until
        // we meet its owners), and its centre tile alone feeds the
        // colonist, who would otherwise starve on, say, arctic land.
        final Map known = server.getGame().getMap();
        final Player us = server.getGame().getFreeColGameObject(player.getId(), Player.class);
        final Tile from = known.getTile(ship.getTile().getX(), ship.getTile().getY());
        final List<GoodsType> foods = server.getGame().getSpecification().getFoodGoodsTypeList();
        final int eats = foods.stream()
            .mapToInt(f -> colonist.getType().getConsumptionOf(f)).sum();
        final Tile coast = known.getTileSet(t -> t.isLand()
                && !t.hasSettlement() && t.getUnitCount() == 0
                && t.getOwner() == null && us.canClaimToFoundSettlement(t)
                && foods.stream().mapToInt(f -> t.getPotentialProduction(f, null)).sum() >= eats
                && t.getSurroundingTiles(1, 1).stream().anyMatch(n -> !n.isLand()))
            .stream()
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile offshore = coast.getSurroundingTiles(1, 1).stream()
            .filter(n -> !n.isLand())
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile land = map.getTile(coast.getX(), coast.getY());
        final Tile sea = map.getTile(offshore.getX(), offshore.getY());

        // Explore toward it step by step until the sea tile is in sight,
        // then go there.
        sailTo(commands, ship, sea);

        select(commands, colonist);
        Direction toLand = map.getDirection(sea, land);
        assertTrue(commands.move(toLand.toString()), "the colonist lands");
        assertSame(land, colonist.getTile());

        return colonist;
    }

    /** Make the share of rebels in a colony what is wanted, on the client and the server. */
    private void rebelsIn(Colony serverColony, int percent) throws Exception {
        final Colony ours = client.getGame().getFreeColGameObject(
            serverColony.getId(), Colony.class);
        final java.lang.reflect.Field f = Colony.class.getDeclaredField("sonsOfLiberty");
        f.setAccessible(true);
        f.setInt(ours, percent);
        // The server checks the declaration again.
        f.setInt(serverColony, percent);
    }

    @Test
    @Timeout(240)
    void theHumanShowsTheHighScoresOnRequestAndRetires() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();

        // On request, the table is shown with no header text.
        assertTrue(commands.showHighScores());
        awaitTrue(() -> !highScores.isEmpty(), "the high scores are shown");
        assertTrue(highScores.get(0).contains("\"scores\":["), highScores.get(0));
        assertTrue(highScores.get(0).contains("\"text\":null"), highScores.get(0));

        // Cancelling the confirmation keeps the player in the game.
        asked.clear();
        confirm = false;
        assertFalse(commands.retire(), "cancelled");
        assertEquals(Messages.message("retireDialog.areYouSure.text"), textOf(lastAsked()));
        assertNotEquals(Player.PlayerType.RETIRED, player.getPlayerType());
        assertEquals(1, highScores.size(), "no scores for a cancel");

        // Confirming retires and shows the scores with the new-score verdict.
        confirm = true;
        assertTrue(commands.retire(), "retired");
        assertEquals(Player.PlayerType.RETIRED, player.getPlayerType());
        awaitTrue(() -> highScores.size() == 2, "the scores are shown after retiring");
    }

    @Test
    @Timeout(240)
    void theHumanDeclaresIndependence() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Player us = server.getGame().getFreeColGameObject(player.getId(), Player.class);

        // Too early: the controller explains, and asks nothing.
        assertFalse(commands.declareIndependence(), "no colony yet");
        assertTrue(asked.isEmpty(), asked.toString());

        final Colony colony = foundAColony(commands);
        rebelsIn(colony, 60);
        asked.clear();
        assertNull(player.checkDeclareIndependence(), "allowed now");

        // Cancelling the names leaves us colonial.
        names = null;
        assertFalse(commands.declareIndependence(), "cancelled");
        assertEquals(Player.PlayerType.COLONIAL, us.getPlayerType());
        // Count the names questions only: a question the end of the last
        // turn brought can reach the fake Browser UI after the clear.
        assertEquals(1, askedOf("names").size(), asked.toString());

        // Names left empty cancel too.
        names = "Free Test\n";
        assertFalse(commands.declareIndependence(), "empty country");
        assertEquals(Player.PlayerType.COLONIAL, us.getPlayerType());
        asked.clear();

        // The Browser UI answers the names and closes the declaration.
        names = "Free Test!\nUnited Test";
        assertTrue(commands.declareIndependence(), "declared");
        // The declaration panel defers, as Swing's does: the declaration
        // goes to the server once it is closed.
        for (int i = 0; i < 3000 && us.getPlayerType() != Player.PlayerType.REBEL; i++) {
            Thread.sleep(10);
        }
        // The names, then the declaration's resolution with only an ok.
        final List<String> named = askedOf("names");
        assertEquals(1, named.size(), asked.toString());
        assertTrue(named.get(0).contains("\"label\":\"" + Messages.message(
            "confirmDeclarationDialog.enterNation") + "\""), named.get(0));
        final String text = Json.quote(Messages.message("declareIndependence.resolution"));
        final List<String> resolution = askedOf("confirm").stream()
            .filter(q -> q.contains(text)).toList();
        assertEquals(1, resolution.size(), asked.toString());
        assertTrue(resolution.get(0).contains("\"cancel\":null"), resolution.get(0));
        assertTrue(asked.indexOf(named.get(0)) < asked.indexOf(resolution.get(0)),
                   asked.toString());
        assertEquals(Player.PlayerType.REBEL, us.getPlayerType());
        assertEquals("Free Test", us.getIndependentNationName());
        assertEquals("United Test", us.getNewLandName());
    }

    /**
     * The standing orders the Swing client gives the active unit: fortify
     * it, sentry it, leave it for this turn and disband it.
     */
    @Test
    @Timeout(240)
    void theActiveUnitTakesItsStandingOrders() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit soldier = player.getUnits()
            .filter(u -> "model.role.soldier".equals(u.getRole().getId()))
            .findFirst().get();
        final Unit pioneer = player.getUnits()
            .filter(u -> "model.role.pioneer".equals(u.getRole().getId()))
            .findFirst().get();
        final Player us = server.getGame().getFreeColGameObject(player.getId(), Player.class);

        // Fortify: the unit starts fortifying at once, and is fortified
        // when its turn ends.
        select(commands, soldier);
        assertTrue(commands.fortify(), "the soldier fortifies");
        assertEquals(Unit.UnitState.FORTIFYING, serverUnit(soldier).getState());
        endTurnAndWait(commands);
        assertEquals(Unit.UnitState.FORTIFIED, serverUnit(soldier).getState());

        // Skip: the ship is done for this turn, and the next unit is
        // selected.
        select(commands, ship);
        assertTrue(commands.skip(), "the ship is skipped");
        assertEquals(Unit.UnitState.SKIPPED, serverUnit(ship).getState());
        assertNotSame(ship, active(), "the next unit is selected");

        // Sentry: the soldier keeps watch.
        select(commands, soldier);
        assertTrue(commands.sentry(), "the soldier is sentried");
        assertEquals(Unit.UnitState.SENTRY, serverUnit(soldier).getState());

        // Disband: the player is asked to confirm it, and the unit goes.
        final int units = us.getUnitCount();
        select(commands, pioneer);
        assertTrue(commands.disband(), "the pioneer is disbanded");
        assertTrue(pioneer.isDisposed(), "the unit is gone");
        assertNull(server.getGame().getFreeColGameObject(pioneer.getId(), Unit.class),
                   "and gone on the server");
        assertEquals(units - 1, us.getUnitCount(), "the server has one unit less");
        assertTrue(asked.stream().anyMatch(q -> q.startsWith("confirm ")
                                           && q.contains("disband this unit")),
                   () -> "the player is asked to confirm: " + asked);
    }

    /**
     * A pioneer works its tile: it plows it, and builds a road on it.
     */
    @Test
    @Timeout(300)
    void aPioneerPlowsAndBuildsARoad() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Map map = client.getGame().getMap();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit pioneer = player.getUnits()
            .filter(u -> "model.role.pioneer".equals(u.getRole().getId()))
            .findFirst().get();
        final Unit soldier = player.getUnits()
            .filter(u -> "model.role.soldier".equals(u.getRole().getId()))
            .findFirst().get();

        // The server's map knows the land: the nearest tile the pioneer
        // may plow, that nobody owns, and the sea beside it.
        final Map known = server.getGame().getMap();
        final Tile from = known.getTile(ship.getTile().getX(), ship.getTile().getY());
        final Specification spec = server.getGame().getSpecification();
        final TileImprovementType plow
            = spec.getTileImprovementType("model.improvement.plow");
        final Tile land = known.getTileSet(t -> t.isLand()
                && plow.isTileTypeAllowed(t.getType())
                && t.getOwner() == null && t.getUnitCount() == 0
                && !t.hasSettlement()
                && t.getSurroundingTiles(1, 1).stream().anyMatch(n -> !n.isLand()))
            .stream()
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile offshore = land.getSurroundingTiles(1, 1).stream()
            .filter(n -> !n.isLand())
            .min(Comparator.comparingInt(t -> t.getDistanceTo(from)))
            .get();
        final Tile work = map.getTile(land.getX(), land.getY());
        final Tile sea = map.getTile(offshore.getX(), offshore.getY());

        sailTo(commands, ship, sea);

        // Put the pioneer ashore. It is a passenger, and landing uses up
        // its moves, so it waits for the next turn to work.
        select(commands, pioneer);
        Direction toLand = map.getDirection(sea, work);
        assertTrue(commands.move(toLand.toString()), "the pioneer lands");
        assertSame(work, pioneer.getTile());
        if (pioneer.getMovesLeft() == 0) endTurnAndWait(commands);

        // The Engine tells the Browser UI which orders the unit can take:
        // a pioneer may plow and build a road, but not clear a forest
        // that is not there.
        final List<String> orders = UnitOrders.valid(player, pioneer);
        assertTrue(orders.contains("plow"), () -> "the pioneer plows: " + orders);
        assertTrue(orders.contains("road"), () -> "the pioneer builds a road: " + orders);
        assertFalse(orders.contains("clearForest"),
                    () -> "there is no forest to clear: " + orders);
        assertEquals(List.of("fortify", "sentry", "skip", "disband", "goto", "buildColony"),
                     UnitOrders.valid(player, soldier),
                     "a soldier can found a colony, but cannot work its tile");

        // Plow: the pioneer works the tile, and the plow is on it when
        // the work is done.
        select(commands, pioneer);
        assertTrue(commands.plow(), "the pioneer plows");
        assertEquals(Unit.UnitState.IMPROVING, serverUnit(pioneer).getState());
        int turns = 0;
        while (!improved(serverTile(work), plow)) {
            endTurnAndWait(commands);
            assertTrue(++turns < 12, "the plow is finished within 12 turns");
        }
        // The work used up the pioneer's moves, so it needs a new turn
        // before it can work again.
        endTurnAndWait(commands);

        // A road on the same tile.
        final TileImprovementType road
            = spec.getTileImprovementType("model.improvement.road");
        select(commands, pioneer);
        assertTrue(commands.road(), "the pioneer builds a road");
        assertEquals(Unit.UnitState.IMPROVING, serverUnit(pioneer).getState());
        turns = 0;
        while (!improved(serverTile(work), road)) {
            endTurnAndWait(commands);
            assertTrue(++turns < 12, "the road is finished within 12 turns");
        }
    }

    /** Whether the tile has the improvement, and it is complete. */
    private static boolean improved(Tile tile, TileImprovementType type) {
        final TileImprovement ti = tile.getTileImprovement(type);
        return ti != null && ti.isComplete();
    }

    /**
     * The Go To order: the player is asked where the ship sails, and
     * Europe is the answer.
     */
    @Test
    @Timeout(300)
    void theShipSailsToEurope() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();

        // A ship sails to Europe from the high seas.
        sailOntoHighSeas(commands, ship);
        assertFalse(serverUnit(ship).isInEurope(), "the ship is not in Europe yet");

        // The order asks the player where the ship sails. Europe is
        // named as the player's Europe is named.
        final String europe = Messages.message(
            player.getEurope().getLocationLabelFor(player));
        wanted = europe;
        select(commands, ship);
        assertTrue(commands.selectDestination(), "the ship sails to Europe");
        assertTrue(asked.stream().anyMatch(q -> q.startsWith("choice ")
                                           && q.contains("Select destination")),
                   () -> "the destination is asked: " + asked);

        // The server knows where the ship is going.
        final Player us = server.getGame()
            .getFreeColGameObject(player.getId(), Player.class);
        assertSame(us.getEurope(), serverUnit(ship).getDestination(),
                   "the ship sails for Europe");

        // And the ship gets there.
        int turns = 0;
        while (!serverUnit(ship).isInEurope()) {
            endTurnAndWait(commands);
            assertTrue(++turns < 12,
                       "the ship reaches Europe within 12 turns; asked " + asked);
        }
        assertTrue(ship.isInEurope(), "the client has the ship in Europe");
    }

    /** The server's trade routes of the human. */
    private List<TradeRoute> serverRoutes(Player player) {
        return server.getGame().getFreeColGameObject(player.getId(), Player.class)
            .getTradeRoutes();
    }

    /** The goods types of each stop of a route, as ids. */
    private static List<List<String>> cargoOf(TradeRoute route) {
        return route.getStopList().stream()
            .map(s -> s.getCargo().stream().map(GoodsType::getId).toList())
            .toList();
    }

    /**
     * The player manages trade routes through the commands: a route is
     * made with stops in Europe and the colony, changed, refused when it
     * is not valid, and deleted, each time as the server sees it.
     */
    @Test
    @Timeout(300)
    void theHumanCreatesEditsAndDeletesTradeRoutes() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Colony colony = foundAColony(commands);
        final String europe = player.getEurope().getId();
        final String home = colony.getId();
        final String tools = "model.goods.tools";
        final String furs = "model.goods.furs";
        final String rum = "model.goods.rum";
        assertTrue(serverRoutes(player).isEmpty(), "no routes to begin with");
        // A new route is offered FreeCol's default name, one no route has.
        assertTrue(commands.tradeRoutes());
        assertTrue(routePanels.get(routePanels.size() - 1)
                       .contains("\"defaultName\":\"New Trade Route\""),
                   "the first new route's name");
        assertNull(commands.saveTradeRoute(null, "New Trade Route", false,
            List.of(europe, home), List.of(List.of(tools), List.of(furs))));
        assertTrue(routePanels.get(routePanels.size() - 1)
                       .contains("\"defaultName\":\"New Trade Route1\""),
                   "the next name is free");
        assertTrue(commands.deleteTradeRoute(serverRoutes(player).get(0).getId()));

        // A new route: the server has it, with its stops and what they load.
        assertNull(commands.saveTradeRoute(null, "Fur run", false,
            List.of(europe, home), List.of(List.of(tools), List.of(furs))),
            "a valid route is saved");
        assertEquals(1, serverRoutes(player).size());
        final TradeRoute made = serverRoutes(player).get(0);
        assertEquals("Fur run", made.getName());
        assertFalse(made.isSilent());
        assertEquals(List.of(europe, home),
                     made.getStopList().stream().map(s -> s.getLocation().getId()).toList());
        assertEquals(List.of(List.of(tools), List.of(furs)), cargoOf(made));
        final String id = made.getId();
        assertTrue(routePanels.get(routePanels.size() - 1).contains("\"Fur run\""),
                   "the panel shows the route");

        // Changed: renamed, silenced, a third stop, other goods.
        assertNull(commands.saveTradeRoute(id, "Rum run", true,
            List.of(home, europe, home),
            List.of(List.of(rum), List.of(tools, furs), List.of())),
            "a valid change is saved");
        assertEquals(1, serverRoutes(player).size());
        final TradeRoute changed = serverRoutes(player).get(0);
        assertEquals(id, changed.getId());
        assertEquals("Rum run", changed.getName());
        assertTrue(changed.isSilent());
        assertEquals(3, changed.getStopCount());
        assertEquals(List.of(List.of(rum), List.of(tools, furs), List.of()), cargoOf(changed));

        // Not valid: FreeCol's reason is given, and nothing is saved.
        final String tooFew = Messages.message(
            StringTemplate.template("model.tradeRoute.notEnoughStops"));
        assertEquals(tooFew, commands.saveTradeRoute(null, "Short", false,
            List.of(home), List.of(List.of(rum))), "a route needs two stops");
        assertEquals(tooFew, commands.saveTradeRoute(id, "Shorter", false,
            List.of(europe), List.of(List.of(tools))), "so does a changed one");
        final String empty = Messages.message(
            StringTemplate.template("model.tradeRoute.allEmpty"));
        assertEquals(empty, commands.saveTradeRoute(null, "Empty", false,
            List.of(europe, home), List.of(List.of(), List.of())), "it must load something");
        final String duplicate = Messages.message(
            StringTemplate.template("model.tradeRoute.duplicateName")
                .addName("%name%", "Rum run"));
        assertEquals(duplicate, commands.saveTradeRoute(null, "Rum run", false,
            List.of(europe, home), List.of(List.of(tools), List.of(furs))), "names are unique");
        assertTrue(routePanels.get(routePanels.size() - 1).contains(
                       "\"error\":" + Json.quote(duplicate)),
                   "the panel gives the reason");
        assertEquals(1, serverRoutes(player).size(), "no refused route was saved");
        final TradeRoute kept = serverRoutes(player).get(0);
        assertEquals("Rum run", kept.getName());
        assertEquals(3, kept.getStopCount());
        // The client's route is as it was, too.
        assertEquals(1, player.getTradeRoutes().size());
        final TradeRoute mine = player.getTradeRoutes().get(0);
        assertEquals("Rum run", mine.getName());
        assertEquals(3, mine.getStopCount());

        // Deleted.
        assertTrue(commands.deleteTradeRoute(id), "the route is deleted");
        assertTrue(serverRoutes(player).isEmpty(), "the server has no route");
        assertTrue(player.getTradeRoutes().isEmpty(), "nor does the client");
    }

    /** An entry's id in a menu's JSON, the first whose id starts with a prefix, else null. */
    private static String entryWith(String menu, String prefix) {
        final Matcher m = Pattern.compile("\"id\":\"(" + Pattern.quote(prefix) + "[^\"]*)\"").matcher(menu);
        return m.find() ? m.group(1) : null;
    }

    @Test
    @Timeout(180)
    void aRightClickOnATileListsItsUnitsAndSelectsThePickedOne() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Menus menus = client.getMenus();
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit aboard = ship.getUnitList().get(0);
        select(commands, ship);
        final Tile at = ship.getTile();

        final String menu = menus.tile(at.getX(), at.getY());
        assertTrue(menu.contains("\"title\":"), menu);
        assertNotNull(entryWith(menu, "select:" + ship.getId()), menu);
        assertNotNull(entryWith(menu, "select:" + aboard.getId()), menu);
        assertNotNull(entryWith(menu, "tile:" + at.getX() + "," + at.getY()),
            "the tile's own line opens its panel: " + menu);
        // One unit on the tile (the ship), so no "activate all", as in TilePopup.
        assertNull(entryWith(menu, "activateAll:"), menu);
        assertEquals("null", menus.tile(-1, -1), "off the map");

        // Picking the passenger makes it the active unit.
        assertTrue(commands.menuEntry("select:" + aboard.getId()));
        assertSame(aboard, active());
        assertFalse(commands.menuEntry("select:model.noSuch"));
        assertFalse(commands.menuEntry("noSuchVerb:1"));
    }

    @Test
    @Timeout(180)
    void aRightClickOnANeighbouringTileOffersGoTo() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        select(commands, ship);
        final Tile from = ship.getTile();
        Tile next = null;
        for (Direction d : Direction.values()) {
            final Tile n = from.getNeighbourOrNull(d);
            if (n != null && n.isExplored() && !n.isLand() && n.getUnitCount() == 0) {
                next = n;
                break;
            }
        }
        assertNotNull(next, "an explored sea neighbour");
        final String menu = client.getMenus().tile(next.getX(), next.getY());
        final String go = "goto:" + next.getX() + "," + next.getY();
        assertEquals(go, entryWith(menu, "goto:"), menu);
        assertNull(entryWith(menu, "state:"), "the unit is not on this tile: " + menu);
        assertTrue(commands.menuEntry(go), "the ship sets off");
        assertSame(next, ship.getTile());
    }

    @Test
    @Timeout(180)
    void aRightClickOnAColonistInTheColonyPanelPutsItToWork() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Menus menus = client.getMenus();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit colonist = ours.getUnitList().get(0);

        // The colony tile's menu has the colony, and picking it opens the panel.
        final String tileMenu = menus.tile(ours.getTile().getX(), ours.getTile().getY());
        assertEquals("colony:" + ours.getId(), entryWith(tileMenu, "colony:"), tileMenu);
        colonies.clear();
        assertTrue(commands.menuEntry("colony:" + ours.getId()));
        assertEquals(1, colonies.size(), colonies::toString);

        // The colonist's quick action menu: where it may work, and leaving town.
        final String menu = menus.unit(colonist.getId());
        final String work = entryWith(menu, "work:" + colonist.getId() + ",");
        assertNotNull(work, "a place to work: " + menu);
        assertEquals("null", menus.unit("model.unit.noSuch"));
        assertTrue(menu.contains("\"id\":\"colopedia:" + colonist.getType().getId() + "\""),
            "the unit's Colopedia entry: " + menu);

        // Picking a work entry moves the colonist and sets what it makes.
        final String[] a = work.substring("work:".length()).split(",");
        final Unit onServer = serverUnit(colonist);
        assertTrue(commands.menuEntry(work) || colonist.getLocation().getId().equals(a[1]),
            "works: " + work);
        assertEquals(a[1], colonist.getLocation().getId());
        assertEquals(a[2], colonist.getWorkType().getId());
        assertEquals(a[2], onServer.getWorkType().getId());

        // Any role it can take (tools, a soldier...) is offered, and picking one equips the colonist.
        final String role = entryWith(menus.unit(colonist.getId()), "role:" + colonist.getId() + ",");
        if (role != null) {
            assertTrue(commands.menuEntry(role), "takes the role: " + role);
            assertEquals(role.split(",")[1], colonist.getRole().getId());
        }

        // Leaving town puts it outside.
        final String after = menus.unit(colonist.getId());
        final String leave = entryWith(after, "leaveTown:");
        if (leave != null) {
            assertTrue(commands.menuEntry(leave));
            assertEquals(ours.getTile(), colonist.getLocation());
        }
    }

    @Test
    @Timeout(240)
    void aRightClickOnGoodsLoadsThemOntoAShip() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Player player = client.getClient().getMyPlayer();
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        select(commands, ship);
        assertTrue(commands.move(client.getGame().getMap()
            .getDirection(ship.getTile(), ours.getTile()).toString()), "into port");
        final GoodsType food = client.getGame().getSpecification().getGoodsTypeList().stream()
            .filter(g -> ours.getGoodsCount(g) > 0).findFirst().orElse(null);
        assertNotNull(food, "the warehouse has goods");

        final String menu = client.getMenus().goods(ours.getId(), food.getId(), ours.getGoodsCount(food));
        final String load = entryWith(menu, "load:" + ship.getId());
        assertNotNull(load, menu);
        assertNotNull(entryWith(menu, "colopedia:" + food.getId()), "the goods' Colopedia entry: " + menu);
        assertTrue(commands.menuEntry(load), "loads");
        assertTrue(ship.getGoodsCount(food) > 0, "the ship has the goods");

        final String back = client.getMenus().goods(ship.getId(), food.getId(), ship.getGoodsCount(food));
        assertNotNull(entryWith(back, "unload:" + ship.getId()), back);
        assertTrue(commands.menuEntry("unloadAll:" + ship.getId()), "unloads");
        assertEquals(0, ship.getGoodsCount(food));
    }

    /**
     * A ship is assigned to a route between the colony and Europe: it
     * loads at the colony, sails on its own turns, and the route is
     * shown for it and dropped again on request.
     */
    @Test
    @Timeout(300)
    void aShipFollowsItsTradeRoute() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Colony serverColony = foundAColony(commands);
        final Colony ours = client.getGame()
            .getFreeColGameObject(serverColony.getId(), Colony.class);
        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit serverShip = serverUnit(ship);
        select(commands, ship);
        assertTrue(commands.move(client.getGame().getMap()
            .getDirection(ship.getTile(), ours.getTile()).toString()), "into port");
        final GoodsType cloth = client.getGame().getSpecification().getGoodsType("model.goods.cloth");
        client.debugApplied(server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.cloth\","
            + "\"amount\":100,\"x\":" + ours.getTile().getX() + ",\"y\":" + ours.getTile().getY() + "}"));
        awaitTrue(() -> ours.getGoodsCount(cloth) == 100, "the colony has the cloth");

        assertNull(commands.saveTradeRoute(null, "Cloth run", true,
            List.of(serverColony.getId(), player.getEurope().getId()),
            List.of(List.of(cloth.getId()), List.of())), "the route is saved");
        final String routeId = serverRoutes(player).get(0).getId();

        assertFalse(commands.assignTradeRoute(ship.getId(), "tradeRoute:none"), "no such route");
        assertTrue(commands.assignTradeRoute(ship.getId(), routeId), "assigned");
        assertEquals(routeId, serverShip.getTradeRoute().getId(), "the server has it");
        assertSame(player.getTradeRoutes().get(0), ship.getTradeRoute(), "so does the client");
        assertEquals(1, serverRoutes(player).get(0).getAssignedUnits().size());

        // The ship follows the route as turns pass: the cloth leaves the colony.
        int turns = 0;
        while (serverColony.getGoodsCount(cloth) == 100) {
            endTurnAndWait(commands);
            assertTrue(++turns < 4, "the ship loads within 4 turns");
        }
        assertTrue(serverShip.getGoodsCount(cloth) > 0, "the ship took the cloth");
        assertEquals(100, serverShip.getGoodsCount(cloth) + serverColony.getGoodsCount(cloth));
        // ... and sails to Europe, where it is sold.
        turns = 0;
        while (!serverShip.isInEurope()) {
            endTurnAndWait(commands);
            assertTrue(++turns < 14, "the ship reaches Europe within 14 turns");
        }
        turns = 0;
        while (serverShip.getGoodsCount(cloth) > 0) {
            endTurnAndWait(commands);
            assertTrue(++turns < 4, "the cloth is sold in Europe within 4 turns");
        }

        // Dropped.
        assertTrue(commands.assignTradeRoute(ship.getId(), null), "dropped");
        assertNull(serverShip.getTradeRoute());
        assertNull(ship.getTradeRoute());
    }

    /**
     * A ship on a route between two colonies loads at the first and
     * unloads into the second.
     */
    @Test
    @Timeout(300)
    void aShipCarriesGoodsBetweenTwoColonies() throws Exception {
        startGame();
        final Commands commands = client.getCommands();
        final Player player = client.getClient().getMyPlayer();
        final Colony colonyA = foundAColony(commands);
        final Colony oursA = client.getGame()
            .getFreeColGameObject(colonyA.getId(), Colony.class);

        // The second colony is put on the map directly: a coastal tile well away
        // from the first, so the cloth is seen on the ship before it arrives.
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(player.getId(), Player.class);
        final Tile at = colonyA.getTile();
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && !t.hasSettlement()
                && t.getUnitCount() == 0 && t.getOwner() == null
                && t.getDistanceTo(at) >= 9 && t.getDistanceTo(at) <= 16
                && t.getSurroundingTiles(1, 1).stream().anyMatch(n -> !n.isLand()))
            .stream().min(Comparator.comparingInt(t -> t.getDistanceTo(at))).get();
        final Colony colonyB = new ServerColony(game, us, "Tradeville", land);
        land.setSettlement(colonyB);
        client.debugApplied(server.debug("{\"action\":\"revealMap\"}"));
        awaitTrue(() -> client.getGame().getMap().getTile(land.getX(), land.getY())
            .getColony() != null, "the client has the second colony");

        final Unit ship = player.getUnits().filter(Unit::isNaval).findFirst().get();
        final Unit serverShip = serverUnit(ship);
        select(commands, ship);
        assertTrue(commands.move(client.getGame().getMap()
            .getDirection(ship.getTile(), oursA.getTile()).toString()), "into port");
        final GoodsType cloth = game.getSpecification().getGoodsType("model.goods.cloth");
        client.debugApplied(server.debug("{\"action\":\"addGoods\",\"type\":\"model.goods.cloth\","
            + "\"amount\":100,\"x\":" + at.getX() + ",\"y\":" + at.getY() + "}"));
        awaitTrue(() -> oursA.getGoodsCount(cloth) == 100, "colony A has the cloth");
        assertEquals(0, colonyB.getGoodsCount(cloth), "colony B has none");

        assertNull(commands.saveTradeRoute(null, "Cloth ferry", true,
            List.of(colonyA.getId(), colonyB.getId()),
            List.of(List.of(cloth.getId()), List.of())), "the route is saved");
        final String routeId = serverRoutes(player).get(0).getId();
        assertTrue(commands.assignTradeRoute(ship.getId(), routeId), "assigned");

        // The cloth leaves A and rides on the ship.
        int turns = 0;
        while (colonyA.getGoodsCount(cloth) == 100) {
            endTurnAndWait(commands);
            assertTrue(++turns < 4, "the ship loads within 4 turns");
        }
        assertTrue(serverShip.getGoodsCount(cloth) > 0, "the ship took the cloth");
        assertEquals(100, serverShip.getGoodsCount(cloth) + colonyA.getGoodsCount(cloth));
        // ... and arrives in B's warehouse.
        turns = 0;
        while (colonyB.getGoodsCount(cloth) == 0) {
            endTurnAndWait(commands);
            assertTrue(++turns < 14, "the cloth reaches colony B within 14 turns");
        }
        assertEquals(0, serverShip.getGoodsCount(cloth), "the ship is empty");
        assertTrue(colonyB.getGoodsCount(cloth) > 0, "B's warehouse has the cloth");
        assertEquals(100, colonyB.getGoodsCount(cloth) + colonyA.getGoodsCount(cloth),
            "no cloth was lost");
    }
}
