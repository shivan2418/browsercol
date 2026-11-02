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
import net.sf.freecol.server.model.ServerBuilding;
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
        return twoColonies(false);
    }

    /**
     * Our two colonies; with a school, the first has a schoolhouse and
     * a master carpenter besides its founder, not yet teaching.
     */
    private List<Colony> twoColonies(boolean school) throws Exception {
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
        final Specification spec = game.getSpecification();
        if (school) {
            final Player us = game.getFreeColGameObject(me().getId(), Player.class);
            one.addBuilding(new ServerBuilding(game, one,
                spec.getBuildingType("model.building.schoolhouse")));
            final Unit teacher = new ServerUnit(game, first, us,
                spec.getUnitType("model.unit.masterCarpenter"));
            teacher.setLocation(one);
        }
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
            && me().getColonyList().stream().allMatch(c -> c.getUnitCount()
                == (school && c.getName().equals("Jamestown") ? 2 : 1)));
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
    void theReligionReportShowsTheCrossesAndTheChurchOfEachColony() throws Exception {
        twoColonies();
        final Player us = me();

        final Map<String, Object> report = obj(JsonReader.read(Reports.religion(us)));
        assertEquals("religion", report.get("report"));
        assertEquals("Religious Advisor", report.get("title"));
        final Map<String, Object> crosses = objs(report.get("goods")).stream()
            .filter(g -> "model.goods.crosses".equals(g.get("type"))).findFirst().get();
        assertEquals("Crosses", crosses.get("name"));
        assertEquals((long)us.getImmigration(), crosses.get("immigration"));
        assertEquals((long)us.getImmigrationRequired(), crosses.get("required"));
        assertEquals((long)us.getTotalImmigrationProduction(), crosses.get("production"));
        // Each colony's church or town hall is the building that makes crosses.
        final List<Map<String, Object>> rows = objs(crosses.get("colonies"));
        assertEquals(List.of("Jamestown", "Plymouth"), rows.stream()
            .map(r -> (String)r.get("name")).sorted().collect(Collectors.toList()));
        for (Map<String, Object> row : rows) {
            assertEquals(List.of("image.buildingicon.model.building.chapel"),
                obj(row.get("building")).get("keys"));
            assertTrue(list(row.get("workers")).isEmpty(), "nobody works the chapel yet");
        }
    }

    @Test
    @Timeout(240)
    void theEducationReportShowsTheTeachersAndStudentsOfEachSchool() throws Exception {
        twoColonies(true);
        final Player us = me();

        final Map<String, Object> report = obj(JsonReader.read(Reports.education(us)));
        assertEquals("education", report.get("report"));
        assertEquals("Potential teachers", obj(report.get("headers")).get("teachers"));
        assertEquals("Potential students", obj(report.get("headers")).get("students"));
        final List<Map<String, Object>> schools = objs(report.get("colonies"));
        assertEquals(1, schools.size(), "only Jamestown has a school");
        final Map<String, Object> school = schools.get(0);
        assertEquals("Jamestown", school.get("name"));
        assertEquals(List.of("image.buildingicon.model.building.schoolhouse"),
            obj(school.get("building")).get("keys"));
        assertEquals(List.of("Dutch Master Carpenter"), objs(school.get("teachers")).stream()
            .map(t -> (String)t.get("name")).collect(Collectors.toList()));
        final List<Map<String, Object>> students = objs(school.get("students"));
        assertEquals(1, students.size(), "the founder could learn");
        assertEquals("Dutch Free Colonist", students.get(0).get("name"));
        assertTrue(((String)students.get(0).get("learns")).contains("Carpenter"),
            (String)students.get(0).get("learns"));
    }

    @Test
    @Timeout(240)
    void theExplorationReportListsTheDiscoveredRegionsEarliestFirst() throws Exception {
        final Player us = me();
        final List<net.sf.freecol.common.model.Region> regions
            = new ArrayList<>(us.getGame().getMap().getRegions());
        assertTrue(regions.size() >= 2, "the map has regions");
        regions.get(0).setDiscoveredIn(new net.sf.freecol.common.model.Turn(3));
        regions.get(0).setDiscoveredBy(us);
        regions.get(1).setDiscoveredIn(new net.sf.freecol.common.model.Turn(7));
        regions.get(1).setDiscoveredBy(us);

        final Map<String, Object> report = obj(JsonReader.read(Reports.exploration(us)));
        assertEquals("exploration", report.get("report"));
        assertEquals("Name of Region", obj(report.get("headers")).get("name"));
        final List<Map<String, Object>> rows = objs(report.get("regions"));
        assertTrue(rows.size() >= 2);
        assertEquals(net.sf.freecol.common.i18n.Messages.message(
            new net.sf.freecol.common.model.Turn(3).getLabel()), rows.get(0).get("turn"));
        assertEquals(net.sf.freecol.common.i18n.Messages.message(
            new net.sf.freecol.common.model.Turn(7).getLabel()), rows.get(1).get("turn"));
        assertEquals(net.sf.freecol.common.i18n.Messages
            .message(us.getCountryLabel()), rows.get(1).get("by"));
        assertEquals(net.sf.freecol.common.i18n.Messages
            .message(regions.get(0).getType().getNameKey()), rows.get(0).get("type"));
        assertEquals((long)regions.get(0).getScoreValue(), rows.get(0).get("value"));
    }

    @Test
    @Timeout(240)
    void theHistoryReportListsThePlayersEventsInOrder() throws Exception {
        final Player us = me();
        us.addHistory(new net.sf.freecol.common.model.HistoryEvent(
            new net.sf.freecol.common.model.Turn(2),
            net.sf.freecol.common.model.HistoryEvent.HistoryEventType.FOUND_COLONY, us)
            .addName("%colony%", "Jamestown"));

        final Map<String, Object> report = obj(JsonReader.read(Reports.history(us)));
        assertEquals("history", report.get("report"));
        assertEquals("History Report", report.get("title"));
        final List<Map<String, Object>> events = objs(report.get("events"));
        assertEquals(us.getHistory().size(), events.size());
        final Map<String, Object> last = events.get(events.size() - 1);
        assertTrue(((String)last.get("text")).contains("Jamestown"), (String)last.get("text"));
        assertEquals(net.sf.freecol.common.i18n.Messages.message(
            new net.sf.freecol.common.model.Turn(2).getLabel()), last.get("turn"));
    }

    @Test
    @Timeout(240)
    void theTradeReportCountsEachStorableGoodsInTheShipsAndColonies() throws Exception {
        twoColonies();
        final Player us = me();
        final var spec = us.getSpecification();
        // Some food in the store of one colony, and a sale to the market.
        final Colony jamestown = us.getColonyList().stream()
            .filter(c -> c.getName().equals("Jamestown")).findFirst().get();
        final var food = spec.getGoodsType("model.goods.food");
        jamestown.addGoods(food, 7);

        final Map<String, Object> report = obj(JsonReader.read(Reports.trade(us)));
        assertEquals("trade", report.get("report"));
        assertEquals("Trade Advisor", report.get("title"));
        assertEquals("Units bought or sold", obj(report.get("labels")).get("unitsSold"));
        final List<Map<String, Object>> goods = objs(report.get("goods"));
        assertEquals(spec.getStorableGoodsTypeList().stream().map(g -> g.getId())
            .collect(Collectors.toList()),
            goods.stream().map(g -> (String)g.get("type")).collect(Collectors.toList()));
        final int at = spec.getStorableGoodsTypeList().indexOf(food);
        assertEquals((long)us.getMarket().getCostToBuy(food), goods.get(at).get("buy"));
        assertEquals((long)us.getMarket().getPaidForSale(food), goods.get(at).get("sell"));
        for (String column : List.of("sold", "beforeTaxes", "afterTaxes", "cargo", "total", "delta")) {
            assertEquals(goods.size(), list(report.get(column)).size(), column);
        }
        assertEquals((long)us.getSales(food), list(report.get("sold")).get(at));
        final long inColonies = us.getColonyList().stream().mapToLong(c -> c.getGoodsCount(food)).sum();
        assertTrue((Long)list(report.get("total")).get(at) >= inColonies);
        assertTrue(inColonies >= 7);
        assertEquals((long)us.getColonyList().stream()
            .mapToInt(c -> c.getNetProductionOf(food)).sum(), list(report.get("delta")).get(at));
        final List<Map<String, Object>> rows = objs(report.get("colonies"));
        assertEquals(List.of("Jamestown", "Plymouth"), rows.stream()
            .map(r -> (String)r.get("name")).sorted().collect(Collectors.toList()));
        final Map<String, Object> row = rows.stream()
            .filter(r -> r.get("name").equals("Jamestown")).findFirst().get();
        assertEquals(goods.size(), list(row.get("cells")).size());
        final Map<String, Object> cell = obj(list(row.get("cells")).get(at));
        assertEquals((long)jamestown.getGoodsCount(food), cell.get("amount"));
        assertEquals((long)jamestown.getNetProductionOf(food), cell.get("production"));
        assertEquals(Boolean.FALSE, row.get("export"));
    }

    @Test
    @Timeout(240)
    void theProductionReportShowsEachColonysOutputAndTheBuildingsThatMakeIt() throws Exception {
        twoColonies();
        final Player us = me();
        final var spec = us.getSpecification();

        final Map<String, Object> report = obj(JsonReader.read(Reports.production(us)));
        assertEquals("production", report.get("report"));
        assertEquals("Production Report", report.get("title"));
        assertEquals("Colony", obj(report.get("labels")).get("colony"));
        assertEquals("Nothing", obj(report.get("labels")).get("nothing"));
        final List<Map<String, Object>> goods = objs(report.get("goods"));
        assertTrue(goods.stream().noneMatch(g ->
                spec.getGoodsType((String)g.get("type")).isFarmed()), "farmed goods are left out");
        final int hammers = goods.stream().map(g -> g.get("type")).collect(Collectors.toList())
            .indexOf("model.goods.hammers");
        assertTrue(hammers >= 0);
        assertEquals(List.of("model.building.carpenterHouse"), objs(goods.get(hammers).get("buildings"))
            .stream().map(b -> (String)b.get("id")).collect(Collectors.toList()));
        for (Map<String, Object> row : objs(report.get("colonies"))) {
            final Colony ours = us.getColonyList().stream()
                .filter(c -> c.getId().equals(row.get("id"))).findFirst().get();
            final List<Map<String, Object>> cells = objs(row.get("cells"));
            assertEquals(goods.size(), cells.size());
            final Map<String, Object> cell = cells.get(hammers);
            assertEquals((long)ours.getNetProductionOf(spec.getGoodsType("model.goods.hammers")),
                cell.get("amount"));
            // A colony has a carpenter's house, with nobody in it yet.
            assertTrue(list(cell.get("buildings")).get(0) instanceof List, "its carpenter's house");
        }
    }

    @Test
    @Timeout(240)
    void theRequirementsReportAdvisesEachColonyOrSaysItsRequirementsAreMet() throws Exception {
        twoColonies();
        final Player us = me();

        final Map<String, Object> report = obj(JsonReader.read(Reports.requirements(us)));
        assertEquals("requirements", report.get("report"));
        assertEquals("Requirements", report.get("title"));
        final List<Map<String, Object>> rows = objs(report.get("colonies"));
        assertEquals(List.of("Jamestown", "Plymouth"), rows.stream()
            .map(r -> (String)r.get("name")).sorted().collect(Collectors.toList()));
        for (Map<String, Object> row : rows) {
            final Colony ours = us.getColonyList().stream()
                .filter(c -> c.getId().equals(row.get("id"))).findFirst().get();
            final List<Map<String, Object>> items = objs(row.get("items"));
            // One or the other, as in Swing: advice, or that nothing is needed.
            assertEquals(items.isEmpty(), row.get("met") != null);
            // The founder works a tile with no expert in the colony: Swing says so.
            final Unit worker = ours.getUnitList().get(0);
            if (worker.getWorkType() != null && ours.getColonyTiles().stream()
                    .anyMatch(ct -> ct.getUnitList().contains(worker))
                && ours.getUnitList().stream().noneMatch(u -> u.getType()
                    == us.getSpecification().getExpertForProducing(worker.getWorkType()))) {
                final String expert = net.sf.freecol.common.i18n.Messages.getName(
                    us.getSpecification().getExpertForProducing(worker.getWorkType()));
                assertTrue(items.stream().anyMatch(i -> ((String)i.get("text")).contains(expert)
                        && ((String)i.get("text")).contains((String)row.get("name"))),
                    "no " + expert + " in " + row.get("name") + ": " + items);
            }
        }
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
        gui.showReportReligiousPanel();
        gui.showReportEducationPanel();
        gui.showReportExplorationPanel();
        gui.showReportHistoryPanel();
        gui.showReportTradePanel();
        gui.showReportProductionPanel();
        gui.showReportRequirementsPanel();
        assertEquals(List.of("colony", "labour", "compactLabour", "religion", "education",
                "exploration", "history", "trade", "production", "requirements"), reports.stream()
            .map(r -> (String)obj(JsonReader.read(r)).get("report")).collect(Collectors.toList()));

        reports.clear();
        assertTrue(commands.showReport("colony"));
        assertTrue(commands.showReport("labour"));
        assertTrue(commands.showReport("compactLabour"));
        assertTrue(commands.showReport("religion"));
        assertTrue(commands.showReport("education"));
        assertTrue(commands.showReport("exploration"));
        assertTrue(commands.showReport("history"));
        assertTrue(commands.showReport("trade"));
        assertTrue(commands.showReport("production"));
        assertTrue(commands.showReport("requirements"));
        assertFalse(commands.showReport("nothing"));
        assertTrue(commands.showReportDetail("labourDetail", "model.unit.freeColonist"));
        assertTrue(commands.showReportDetail("compactLabour", "model.unit.freeColonist"));
        assertTrue(commands.showReportDetail("compactLabour", ""));
        assertFalse(commands.showReportDetail("labourDetail", ""));
        assertEquals(List.of("colony", "labour", "compactLabour", "religion", "education",
                "exploration", "history", "trade", "production", "requirements", "labourDetail", "compactLabour", "compactLabour"),
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

        // Load the ship on the client's copy: food and a pioneer.
        final Unit ourShip = us.getGame().getFreeColGameObject(galleon.getId(), Unit.class);
        ourShip.getGoodsContainer().addGoods(us.getSpecification().getGoodsType("model.goods.food"), 40);
        final Unit passenger = us.getUnits().filter(u -> u.getType().getId().equals("model.unit.hardyPioneer"))
            .findFirst().get();
        passenger.setLocation(ourShip);

        // Cargo: the carriers, with what they carry.
        final Map<String, Object> cargo = obj(JsonReader.read(Reports.units(client.getClient(), "cargo")));
        assertEquals("cargo", cargo.get("report"));
        assertEquals("Cargo Report", cargo.get("title"));
        final List<Map<String, Object>> carriers = new ArrayList<>();
        for (Map<String, Object> p : objs(cargo.get("locations"))) carriers.addAll(objs(p.get("units")));
        assertTrue(carriers.stream().anyMatch(u -> galleon.getId().equals(u.get("id"))));
        assertFalse(carriers.stream().anyMatch(u -> dragoon.getId().equals(u.get("id"))));
        final Map<String, Object> loaded = carriers.stream()
            .filter(u -> galleon.getId().equals(u.get("id"))).findFirst().get();
        assertEquals(List.of(passenger.getId()), ids(loaded.get("cargo")));
        assertEquals("model.goods.food", objs(loaded.get("goods")).get(0).get("type"));
        assertEquals(40L, objs(loaded.get("goods")).get(0).get("amount"));
        assertTrue(((String)loaded.get("text")).contains("Galleon"));
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
