package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.networking.ChangeSet;
import net.sf.freecol.common.networking.ChangeSet.See;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerGame;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The reports of the Report menu (Reports.java), for a game with two
 * colonies: the colony report, the labour report and its details, the
 * compact labour report, and the commands and controller calls that open
 * them.
 */
class ReportsTest {

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();
    private final List<String> reports = Collections.synchronizedList(new ArrayList<>());
    private final List<String> colonies = Collections.synchronizedList(new ArrayList<>());
    private ServerEngine server;
    private ClientEngine client;
    private final CountDownLatch finished = new CountDownLatch(1);

    @BeforeEach
    void start() throws Exception {
        server = new ServerEngine(xml -> toClient.execute(() -> client.receive(xml)));
        client = new ClientEngine(new ClientEngine.ServerLink() {
                public void connect() { server.connect(); }
                public void post(String xml) {
                    toServer.execute(() -> server.receive(xml));
                }
            }, new ClientEngine.Listener() {
                public void gameStarted(Game game) { }
                public void roundDone(int round, long millis) { }
                public void finished(Game game) { finished.countDown(); }
            }, new WebGUI.BrowserUI() {
                public void show(String kind, String json) {
                    if (kind.equals("report")) reports.add(json);
                    if (kind.equals("colony")) colonies.add(json);
                }
                public void ask(int id, String kind, String json) {
                    client.answer(id, null);
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        assertTrue(finished.await(120, TimeUnit.SECONDS), "our first turn");
    }

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

    private static void eventually(String what, BooleanSupplier ok) throws InterruptedException {
        for (int i = 0; i < 500 && !ok.getAsBoolean(); i++) Thread.sleep(20);
        assertTrue(ok.getAsBoolean(), what);
    }

    private Player me() {
        return client.getClient().getMyPlayer();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) {
        return (Map<String, Object>)o;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o) {
        return (List<Object>)o;
    }

    private static List<Map<String, Object>> objs(Object o) {
        return list(o).stream().map(ReportsTest::obj).collect(Collectors.toList());
    }

    private static boolean freeAround(Tile t) {
        int n = 0;
        for (Tile around : t.getSurroundingTiles(1)) {
            if (around.getOwner() != null || !around.isLand()) return false;
            n++;
        }
        return n == 8;
    }

    /** Found a colony on the server with a founder in it, and one outside. */
    private Colony found(String name, Tile land) {
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Colony colony = new ServerColony(game, us, name, land);
        us.addSettlement(colony);
        colony.placeSettlement(true);
        land.changeOwnership(us, colony);
        for (Tile t : land.getSurroundingTiles(1)) t.changeOwnership(us, colony);
        final Unit founder = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        founder.setLocation(colony);
        return colony;
    }

    /** Our two colonies, as the client has them once the map is shown to it. */
    private List<Colony> twoColonies() throws Exception {
        final Game game = server.getGame();
        final List<Tile> lands = game.getMap().getTileSet(t -> t.isLand()
                && t.getUnitCount() == 0 && !t.hasSettlement() && t.getOwner() == null
                && freeAround(t))
            .stream().collect(Collectors.toList());
        final Tile first = lands.get(0);
        final Tile second = lands.stream().filter(t -> t.getDistanceTo(first) > 4)
            .findFirst().get();
        final Colony one = found("Jamestown", first);
        final Colony two = found("Plymouth", second);
        // A pioneer in the open, and the colonies reach the client with the map.
        server.debug("{\"action\":\"addUnit\",\"type\":\"model.unit.hardyPioneer\",\"x\":"
            + first.getX() + ",\"y\":" + first.getY() + "}");
        client.debugApplied(server.debug("{\"action\":\"revealMap\",\"reveal\":true}"));
        // As a founding is sent: the player with its colonies, each with its tile and people.
        final Player us = server.getGame().getFreeColGameObject(me().getId(), Player.class);
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us), us);
        for (Colony c : List.of(one, two)) {
            cs.add(See.only(us), c.getTile());
            for (Tile t : c.getTile().getSurroundingTiles(1)) cs.add(See.only(us), t);
            cs.add(See.only(us), c);
            for (Unit u : c.getUnitList()) cs.add(See.only(us), u);
        }
        ((ServerGame)server.getGame()).sendTo(us, cs);
        eventually("the client has both colonies and their people", () -> me().getColonyList().size() == 2
            && me().getColonyList().stream().allMatch(c -> c.getUnitCount() == 1));
        return List.of(one, two);
    }

    @Test
    @Timeout(240)
    void theColonyReportListsEachColonyWithItsPeopleGoodsAndBuildings() throws Exception {
        final List<Colony> served = twoColonies();

        final Map<String, Object> report = obj(JsonReader.read(Reports.colony(me())));
        assertEquals("colony", report.get("report"));
        assertEquals("Colony Advisor", report.get("title"));
        assertEquals("OK", report.get("ok"));
        assertNull(report.get("back"));
        final List<Map<String, Object>> rows = objs(report.get("colonies"));
        assertEquals(List.of("Jamestown", "Plymouth"), rows.stream()
            .map(r -> (String)r.get("name")).sorted().collect(Collectors.toList()));
        for (Map<String, Object> row : rows) {
            final Colony ours = me().getColonyList().stream()
                .filter(c -> c.getId().equals(row.get("id"))).findFirst().get();
            assertEquals(ours.getUnitList().stream().map(Unit::getId).collect(Collectors.toList()),
                objs(row.get("colonists")).stream().map(u -> (String)u.get("id"))
                    .collect(Collectors.toList()), "the colonists");
            final List<Object> keys = list(obj(list(row.get("colonists")).get(0)).get("keys"));
            assertFalse(keys.isEmpty(), "a colonist has an image");
            // The goods are the ones made or kept: each net production and stock is the colony's.
            for (Map<String, Object> g : objs(row.get("goods"))) {
                final var type = me().getSpecification().getGoodsType((String)g.get("type"));
                assertEquals((long)ours.getNetProductionOf(type), g.get("amount"));
                assertEquals((long)ours.getGoodsCount(type), g.get("stock"));
            }
            assertFalse(objs(row.get("goods")).isEmpty(), "a colony makes or keeps something");
            // A building that is not built automatically, in the colony.
            for (Map<String, Object> b : objs(row.get("buildings"))) {
                assertNotNull(b.get("name"));
            }
        }
        assertEquals(served.size(), rows.size());
    }

    @Test
    @Timeout(240)
    void theLabourReportCountsEachKindOfPersonAndWhereTheyAre() throws Exception {
        twoColonies();
        final Player us = me();
        final UnitType colonist = us.getSpecification().getUnitType("model.unit.freeColonist");

        final Map<String, Object> report = obj(JsonReader.read(Reports.labour(us)));
        assertEquals("labour", report.get("report"));
        assertEquals("Labor Advisor", report.get("title"));
        final Map<String, Object> row = objs(report.get("types")).stream()
            .filter(t -> colonist.getId().equals(t.get("id"))).findFirst().get();
        final long have = us.getUnits().filter(u -> u.getType() == colonist).count();
        assertTrue(have >= 2, "the founders and any on the ship");
        assertEquals(have, row.get("count"));
        assertEquals("Free Colonist", row.get("name"));
        assertEquals(1L, objs(report.get("types")).stream()
            .filter(t -> "model.unit.hardyPioneer".equals(t.get("id")))
            .map(t -> t.get("count")).findFirst().get());

        // The details: one colonist in each colony, the rest elsewhere.
        final Map<String, Object> detail = obj(JsonReader.read(Reports.labourDetail(us, colonist)));
        assertEquals("labourDetail", detail.get("report"));
        assertEquals("labour", detail.get("back"));
        assertEquals(have, detail.get("total"));
        final List<Map<String, Object>> byColony = objs(detail.get("colonies"));
        assertEquals(List.of("Jamestown", "Plymouth"), byColony.stream()
            .map(c -> (String)c.get("name")).sorted().collect(Collectors.toList()));
        assertTrue(byColony.stream().allMatch(c -> Long.valueOf(1).equals(c.get("count"))));
        long counted = byColony.size();
        for (Map<String, Object> p : objs(detail.get("places"))) counted += (Long)p.get("count");
        for (Map<String, Object> p : objs(detail.get("atSea"))) counted += (Long)p.get("count");
        assertEquals(have, counted, "every colonist is somewhere");
    }

    @Test
    @Timeout(240)
    void theCompactLabourReportSummarisesTheColonistsByKindAndColony() throws Exception {
        twoColonies();
        final Player us = me();
        final UnitType colonist = us.getSpecification().getUnitType("model.unit.freeColonist");

        final Map<String, Object> overview = obj(JsonReader.read(
            Reports.compactLabour(client.getClient(), null)));
        assertEquals("compactLabour", overview.get("report"));
        assertEquals("Working As", obj(overview.get("headers")).get("workingAs"));
        assertEquals("Unit Type", obj(overview.get("headers")).get("unitType"));
        assertNull(overview.get("unit"));
        final List<Map<String, Object>> groups = objs(overview.get("groups"));
        assertEquals("All Colonists", groups.get(0).get("label"));
        final Map<String, Object> free = groups.stream()
            .filter(g -> "Free Colonist".equals(g.get("label"))).findFirst().get();
        assertEquals(colonist.getId(), obj(free.get("link")).get("id"));
        assertTrue((Long)obj(free.get("summary")).get("colonists") >= 2);
        assertTrue(objs(free.get("rows")).stream().mapToLong(r -> (Long)r.get("count")).sum() >= 2);

        final Map<String, Object> detail = obj(JsonReader.read(
            Reports.compactLabour(client.getClient(), colonist)));
        assertEquals("compactLabour", detail.get("back"));
        final List<Map<String, Object>> places = objs(detail.get("groups"));
        assertEquals("Summary", places.get(0).get("label"));
        assertTrue(places.stream().anyMatch(g -> "Jamestown".equals(g.get("label"))
            || "Jamestown*".equals(g.get("label"))));
        assertTrue(places.stream().anyMatch(g -> g.get("link") != null
            && "colony".equals(obj(g.get("link")).get("kind"))));
    }

    @Test
    @Timeout(240)
    void theControllersReportCallsAndTheCommandsOpenTheReports() throws Exception {
        twoColonies();
        final Commands commands = client.getCommands();
        final var gui = client.getClient().getGUI();

        reports.clear();
        gui.showReportColonyPanel();
        gui.showReportLabourPanel();
        gui.showCompactLabourReport();
        assertEquals(List.of("colony", "labour", "compactLabour"), reports.stream()
            .map(r -> (String)obj(JsonReader.read(r)).get("report")).collect(Collectors.toList()));

        reports.clear();
        assertTrue(commands.showReport("colony"));
        assertTrue(commands.showReport("labour"));
        assertTrue(commands.showReport("compactLabour"));
        assertFalse(commands.showReport("nothing"));
        assertTrue(commands.showReportDetail("labourDetail", "model.unit.freeColonist"));
        assertTrue(commands.showReportDetail("compactLabour", "model.unit.freeColonist"));
        assertTrue(commands.showReportDetail("compactLabour", ""));
        assertFalse(commands.showReportDetail("labourDetail", ""));
        assertEquals(List.of("colony", "labour", "compactLabour", "labourDetail",
                "compactLabour", "compactLabour"),
            reports.stream().map(r -> (String)obj(JsonReader.read(r)).get("report"))
                .collect(Collectors.toList()));

        // A colony in a report opens its panel.
        colonies.clear();
        final Colony ours = me().getColonyList().get(0);
        assertTrue(commands.showColony(ours.getId()));
        assertEquals(1, colonies.size());
        assertTrue(colonies.get(0).startsWith("{\"id\":\"" + ours.getId() + "\""));
        assertFalse(commands.showColony("nothing"));
    }

    /** Add a unit of a type to the server, in a colony or at sea on its own, and sync it to the client. */
    private Unit give(String type, Tile tile) throws Exception {
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(me().getId(), Player.class);
        final Unit u = new ServerUnit(game, tile, us, game.getSpecification().getUnitType(type));
        final ChangeSet cs = new ChangeSet();
        cs.add(See.only(us), tile);
        cs.add(See.only(us), u);
        ((ServerGame)game).sendTo(us, cs);
        eventually("the client has " + u.getId(), () -> me().getGame().getFreeColGameObject(u.getId(), Unit.class) != null);
        return u;
    }

    private static List<String> ids(Object units) {
        return objs(units).stream().map(u -> (String)u.get("id")).collect(Collectors.toList());
    }

    @Test
    @Timeout(240)
    void theMilitaryNavalAndCargoReportsListTheForcesAndWhereTheyAre() throws Exception {
        final List<Colony> served = twoColonies();
        final Player us = me();
        final Tile home = served.get(0).getTile();
        final Unit dragoon = give("model.unit.kingsRegular", home);
        final Unit galleon = give("model.unit.galleon", home);

        // Military: every colony is listed, the soldier is in the one it stands in.
        final Map<String, Object> military = obj(JsonReader.read(Reports.units(client.getClient(), "military")));
        assertEquals("military", military.get("report"));
        assertEquals("Military Advisor", military.get("title"));
        assertNull(military.get("back"));
        final List<Map<String, Object>> places = objs(military.get("locations"));
        assertTrue(places.stream().anyMatch(p -> "Plymouth".equals(p.get("label"))), "a colony with no soldiers");
        final Map<String, Object> here = places.stream()
            .filter(p -> "Jamestown".equals(p.get("label"))).findFirst().get();
        assertEquals("colony", obj(here.get("link")).get("kind"));
        assertTrue(ids(here.get("units")).contains(dragoon.getId()), "the soldier is in its colony");
        assertFalse(ids(here.get("units")).contains(galleon.getId()), "a ship is not military");
        final long soldiers = us.getUnits().filter(u -> !u.isNaval()
            && (u.hasAbility(net.sf.freecol.common.model.Ability.EXPERT_SOLDIER) || u.isOffensiveUnit())).count();
        assertEquals(soldiers, objs(obj(military.get("forces")).get("units")).stream()
            .mapToLong(u -> (Long)u.get("count")).sum());
        assertTrue(objs(obj(military.get("forces")).get("units")).stream()
            .anyMatch(u -> "model.unit.kingsRegular".equals(u.get("type"))));

        // Naval: the ship only, and no empty places.
        final Map<String, Object> naval = obj(JsonReader.read(Reports.units(client.getClient(), "naval")));
        assertEquals("naval", naval.get("report"));
        assertEquals("Naval Advisor", naval.get("title"));
        final List<String> ships = new ArrayList<>();
        for (Map<String, Object> p : objs(naval.get("locations"))) {
            assertFalse(objs(p.get("units")).isEmpty());
            ships.addAll(ids(p.get("units")));
        }
        assertTrue(ships.contains(galleon.getId()));
        assertFalse(ships.contains(dragoon.getId()));
        assertEquals(us.getUnits().filter(Unit::isNaval).count(), ships.size());

        // Cargo: the carriers, with what they carry.
        final Map<String, Object> cargo = obj(JsonReader.read(Reports.units(client.getClient(), "cargo")));
        assertEquals("cargo", cargo.get("report"));
        assertEquals("Cargo Report", cargo.get("title"));
        final List<Map<String, Object>> carriers = new ArrayList<>();
        for (Map<String, Object> p : objs(cargo.get("locations"))) carriers.addAll(objs(p.get("units")));
        assertTrue(carriers.stream().anyMatch(u -> galleon.getId().equals(u.get("id"))));
        assertFalse(carriers.stream().anyMatch(u -> dragoon.getId().equals(u.get("id"))));
        for (Map<String, Object> c : carriers) {
            final Unit u = me().getGame().getFreeColGameObject((String)c.get("id"), Unit.class);
            assertEquals(u.getUnitList().stream().map(Unit::getId).collect(Collectors.toList()),
                ids(c.get("cargo")), "what the carrier holds");
            assertEquals(u.getGoodsList().size(), list(c.get("goods")).size());
            assertFalse(list(c.get("keys")).isEmpty());
        }
    }

    @Test
    @Timeout(240)
    void theControllersCallsAndTheCommandsOpenTheUnitReports() throws Exception {
        twoColonies();
        final Commands commands = client.getCommands();
        final var gui = client.getClient().getGUI();

        reports.clear();
        gui.showReportMilitaryPanel();
        gui.showReportNavalPanel();
        gui.showReportCargoPanel();
        assertTrue(commands.showReport("military"));
        assertTrue(commands.showReport("naval"));
        assertTrue(commands.showReport("cargo"));
        assertEquals(List.of("military", "naval", "cargo", "military", "naval", "cargo"), reports.stream()
            .map(r -> (String)obj(JsonReader.read(r)).get("report")).collect(Collectors.toList()));
    }
}
