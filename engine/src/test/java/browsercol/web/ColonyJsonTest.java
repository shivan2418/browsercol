package browsercol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Building;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.common.util.Utils;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The colony as the colony panel shows it, checked against the model for
 * a colony founded in the server's game of a Classic start: its buildings
 * and who works in them, its tiles and who works them, its goods and its
 * production.
 */
class ColonyJsonTest {

    /**
     * The map seed the test plays on. Fixed, so that a run can be
     * reproduced, as in {@link CommandsTest}. On this map the colony's
     * north tile grows grain, and a colony stores grain as food, so
     * the food the colony produces changes when that tile turns to
     * water. Another seed needs one whose north tile grows food.
     */
    private static final long MAP_SEED = 4;

    private final ExecutorService toClient = Executors.newSingleThreadExecutor();
    private final ExecutorService toServer = Executors.newSingleThreadExecutor();

    private ServerEngine server;
    private ClientEngine client;

    @AfterEach
    void stop() {
        toClient.shutdownNow();
        toServer.shutdownNow();
    }

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
                public void show(String kind, String json) {}
                public void ask(int id, String kind, String json) {
                    client.answer(id, null);
                }
            });
        server.startGame("classic", new GamePreset(null, null, null,
            MAP_SEED, new LinkedHashMap<>()));
        assertTrue(client.startGame(0), "login");
        FirstTurn.await(ourTurn);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) {
        return (Map<String, Object>)o;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object o) {
        return (List<Object>)o;
    }

    private static List<String> ids(Object units) {
        return list(units).stream().map(u -> (String)obj(u).get("id"))
            .collect(Collectors.toList());
    }

    /** The colony panel's JSON, as the Browser UI is shown it. */
    private static Map<String, Object> panel(Colony colony) {
        return obj(JsonReader.read(ColonyJson.of(colony, 1)));
    }

    /** The market's entry for a goods type. */
    private static Map<String, Object> marketOf(Map<String, Object> panel, String type) {
        return list(panel.get("market")).stream().map(ColonyJsonTest::obj)
            .filter(m -> type.equals(m.get("type"))).findFirst().get();
    }

    /** The goods in a list of {type, amount}, as type to amount. */
    private static Map<String, Long> amounts(Object goods) {
        return list(goods).stream().map(ColonyJsonTest::obj)
            .collect(Collectors.toMap(g -> (String)g.get("type"),
                                      g -> (Long)g.get("amount")));
    }

    /** All eight neighbours are on the map, land (a colony without docks cannot work water) and nobody's. */
    private static boolean freeAround(Tile t) {
        int n = 0;
        for (Tile around : t.getSurroundingTiles(1)) {
            if (around.getOwner() != null || !around.isLand()) return false;
            n++;
        }
        return n == 8;
    }

    /** FreeColProgressBar's turns: rounded up, 0 when full, N/A with no step. */
    @Test
    @Timeout(120)
    void aProgressBarCountsTheTurnsItsStepTakesToFillIt() throws Exception {
        startGame();
        assertEquals("(Turns: 4)", ColonyJson.progressTurns(40, 18, 6));
        assertEquals("(Turns: 1)", ColonyJson.progressTurns(40, 34, 6));
        assertEquals("(Turns: 0)", ColonyJson.progressTurns(40, 40, 0));
        assertEquals("(Turns: N/A)", ColonyJson.progressTurns(40, 18, 0));
        assertEquals("(Turns: N/A)", ColonyJson.progressTurns(40, 18, -2));
    }

    @Test
    @Timeout(120)
    void theColonySendsItsBuildingsTilesGoodsAndProduction() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand()
                && t.getType().getId().equals("model.tile.plains")
                && !t.hasSettlement() && t.getOwner() == null
                && freeAround(t))
            .stream().findFirst().get();
        // As FreeColTestUtils founds a colony: the founder joins it, and
        // another colonist waits outside, on the colony's tile.
        final Colony colony = new ServerColony(game, us, "Jamestown", land);
        us.addSettlement(colony);
        colony.placeSettlement(true);
        // The colony's tiles are its own, whatever the player has explored.
        land.changeOwnership(us, colony);
        for (Tile t : land.getSurroundingTiles(1)) t.changeOwnership(us, colony);
        final Unit founder = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        founder.setLocation(colony);
        final Unit carpenter = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        final Building carpentersHouse = colony.getBuilding(
            spec.getBuildingType("model.building.carpenterHouse"));
        carpenter.setLocation(carpentersHouse);
        carpenter.changeWorkType(spec.getGoodsType("model.goods.hammers"));
        final Unit outside = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        // A ship in port, a colonist and food aboard.
        final Unit ship = new ServerUnit(game, land, us, spec.getUnitType("model.unit.caravel"));
        final Unit aboard = new ServerUnit(game, ship, us, spec.getDefaultUnitType(us));
        ship.addGoods(spec.getGoodsType("model.goods.food"), 50);
        final GoodsType lumber = spec.getGoodsType("model.goods.lumber");
        colony.addGoods(lumber, 150);
        colony.invalidateCache();

        final Map<String, Object> json = panel(colony);

        assertEquals(colony.getId(), json.get("id"));
        assertEquals("Jamestown", json.get("name"));

        // Europe's prices, from the player's Market: what it pays and asks,
        // and a boycotted goods type cannot be traded, with the reason.
        final GoodsType furType = spec.getGoodsType("model.goods.furs");
        final Map<String, Object> furs = marketOf(json, furType.getId());
        assertEquals((long)us.getMarket().getPaidForSale(furType), furs.get("sell"));
        assertEquals((long)us.getMarket().getCostToBuy(furType), furs.get("buy"));
        assertEquals(true, furs.get("enabled"));
        us.getMarket().setArrears(furType, 500);
        final Map<String, Object> boycott = marketOf(panel(colony), furType.getId());
        assertEquals(false, boycott.get("enabled"));
        assertNotNull(boycott.get("reason"));
        us.getMarket().setArrears(furType, 0);
        assertEquals(List.of((long)land.getX(), (long)land.getY()), json.get("at"));

        // Buildings: each with its icon's resource key, its workers and what
        // it makes. The carpenter turns lumber into hammers.
        final List<Map<String, Object>> buildings = list(json.get("buildings")).stream()
            .map(ColonyJsonTest::obj).collect(Collectors.toList());
        final Map<String, Object> carpentry = buildings.stream()
            .filter(b -> carpentersHouse.getId().equals(b.get("id"))).findFirst().get();
        assertEquals(List.of("image.buildingicon.model.building.carpenterHouse"),
            carpentry.get("keys"));
        assertEquals("Carpenter's house", carpentry.get("name"));
        assertEquals(List.of(carpenter.getId()), ids(carpentry.get("workers")));
        assertEquals(List.of("image.unit.model.unit.freeColonist.dutch",
                "image.unit.model.unit.freeColonist"),
            obj(list(carpentry.get("workers")).get(0)).get("keys"));
        assertEquals(3L, carpentry.get("capacity"));
        // A worker names what it makes there, and what it could make instead.
        final Map<String, Object> carpenterJson = obj(list(carpentry.get("workers")).get(0));
        assertEquals("model.goods.hammers", carpenterJson.get("work"));
        assertEquals(List.of("model.goods.hammers"), list(carpenterJson.get("choices")).stream()
            .map(c -> obj(c).get("type")).collect(Collectors.toList()));
        final Map<String, Object> hammers = obj(carpentry.get("production"));
        assertEquals("model.goods.hammers", hammers.get("type"));
        assertEquals(List.of("image.icon.model.goods.hammers"), hammers.get("keys"));
        assertEquals((long)carpentersHouse.getProductionInfo().getProduction().get(0).getAmount(),
            hammers.get("amount"));
        assertTrue((Long)hammers.get("amount") > 0, "the carpenter makes hammers");
        assertTrue(buildings.stream().anyMatch(b -> List.of(
                    "image.buildingicon.model.building.townHall").equals(b.get("keys"))),
            "the town hall is there");
        assertNull(carpentry.get("upkeep"), "Classic has no building upkeep");
        // The tooltip, as BuildingToolTip: lumber in, hammers out, the
        // carpenter with what they make, nothing short.
        final Map<String, Object> carpentryTip = obj(carpentry.get("tip"));
        assertEquals("model.goods.lumber", obj(carpentryTip.get("input")).get("type"));
        assertEquals(obj(carpentryTip.get("input")).get("amount"),
            obj(carpentryTip.get("input")).get("max"));
        assertEquals(hammers.get("amount"), obj(carpentryTip.get("output")).get("amount"));
        assertEquals(List.of(carpenter.getId()), ids(carpentryTip.get("workers")));
        assertEquals((long)carpentersHouse.getUnitProduction(carpenter, spec.getGoodsType("model.goods.hammers")),
            obj(obj(list(carpentryTip.get("workers")).get(0)).get("made")).get("amount"));
        assertNull(carpentryTip.get("breeding"));
        // A building short of its input: a tobacconist with one tobacco
        // makes one cigar of the three they could, and the label and the
        // tooltip say so.
        final Building tobacconist = colony.getBuilding(
            spec.getBuildingType("model.building.tobacconistHouse"));
        final Unit roller = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        roller.setLocation(tobacconist);
        roller.changeWorkType(spec.getGoodsType("model.goods.cigars"));
        colony.addGoods(spec.getGoodsType("model.goods.tobacco"), 1);
        colony.invalidateCache();
        final Map<String, Object> shortOf = list(panel(colony).get("buildings")).stream()
            .map(ColonyJsonTest::obj)
            .filter(b -> tobacconist.getId().equals(b.get("id"))).findFirst().get();
        final Map<String, Object> cigars = obj(shortOf.get("production"));
        assertTrue((Long)cigars.get("amount") < (Long)cigars.get("max"),
            "short of tobacco, the label shows made/max: " + cigars);
        final Map<String, Object> shortTip = obj(shortOf.get("tip"));
        final Map<String, Object> tobaccoIn = obj(shortTip.get("input"));
        assertEquals("model.goods.tobacco", tobaccoIn.get("type"));
        assertTrue((Long)tobaccoIn.get("amount") < (Long)tobaccoIn.get("max"),
            "the tooltip shows the tobacco used against the tobacco needed: " + tobaccoIn);
        assertEquals(cigars.get("max"), obj(shortTip.get("output")).get("max"));
        // With no tobacco at all the tobacconist makes nothing, and Swing's
        // tooltip leaves the production row empty.
        colony.removeGoods(spec.getGoodsType("model.goods.tobacco"));
        colony.invalidateCache();
        final Map<String, Object> none = list(panel(colony).get("buildings")).stream()
            .map(ColonyJsonTest::obj)
            .filter(b -> tobacconist.getId().equals(b.get("id"))).findFirst().get();
        assertNull(none.get("production"));
        assertNull(obj(none.get("tip")).get("input"));
        assertNull(obj(none.get("tip")).get("output"));
        // Its worker is still listed with the cigars they would make.
        final Map<String, Object> rolls = obj(list(obj(none.get("tip")).get("workers")).get(0));
        assertEquals(roller.getId(), rolls.get("id"));
        assertEquals("model.goods.cigars", obj(rolls.get("made")).get("type"));
        roller.setLocation(land);
        // Where a building is not built yet, an empty plot, as BuildingsPanel
        // shows: a new colony has no schoolhouse.
        final Map<String, Object> school = buildings.stream()
            .filter(b -> "model.building.schoolhouse".equals(b.get("type"))).findFirst().get();
        assertEquals(Boolean.TRUE, school.get("site"));
        assertNull(school.get("id"));
        assertEquals(List.of("image.buildingicon.model.building.BuildingSite"), school.get("keys"));
        assertEquals(Boolean.FALSE, carpentry.get("site"));
        // With the upkeep option on, an upgraded building shows its upkeep.
        final Building smithy = colony.getBuilding(
            spec.getBuildingType("model.building.blacksmithHouse"));
        smithy.upgrade();
        spec.setBoolean(GameOptions.ENABLE_UPKEEP, true);
        final Map<String, Object> shop = list(panel(colony)
                .get("buildings")).stream().map(ColonyJsonTest::obj)
            .filter(b -> smithy.getId().equals(b.get("id"))).findFirst().get();
        assertEquals("model.building.blacksmithShop", shop.get("type"));
        assertEquals(5L, shop.get("upkeep"));
        assertTrue(buildings.stream().noneMatch(b -> ((String)b.get("type"))
                    .equals("model.building.docks")),
            "docks and the stockade are drawn by the panel's background in Swing, not as buildings");

        // Tiles: the colony's 3x3, at Swing's TilesPanel places, the centre
        // in the middle, and the founder wherever the colony put them.
        final List<Map<String, Object>> tiles = list(json.get("tiles")).stream()
            .map(ColonyJsonTest::obj).collect(Collectors.toList());
        assertEquals(9, tiles.size());
        final Map<String, Object> centre = tiles.stream()
            .filter(t -> Boolean.TRUE.equals(t.get("centre"))).findFirst().get();
        assertEquals(List.of(1L, 1L), centre.get("pos"));
        assertEquals(List.of("image.tile." + land.getType().getId() + ".center"),
            centre.get("terrain"));
        final Map<String, Long> centreMakes = amounts(centre.get("production"));
        assertTrue(centreMakes.getOrDefault("model.goods.grain", 0L) > 0,
            "the centre of plains grows grain: " + centreMakes);
        final WorkLocation where = (WorkLocation)founder.getLocation();
        if (where instanceof ColonyTile) {
            final Map<String, Object> worked = tiles.stream()
                .filter(t -> where.getId().equals(t.get("id"))).findFirst().get();
            assertEquals(List.of(founder.getId()), ids(worked.get("workers")));
            // TileViewer's occupation chip on the tile's worker.
            assertEquals(Messages.message(founder.getOccupationLabel(us, false)),
                obj(list(worked.get("workers")).get(0)).get("occupation"));
            assertTrue(!amounts(worked.get("production")).isEmpty(), "a worked tile produces");
        } else {
            final Map<String, Object> worked = buildings.stream()
                .filter(b -> where.getId().equals(b.get("id"))).findFirst().get();
            assertTrue(ids(worked.get("workers")).contains(founder.getId()));
        }
        final Tile north = land.getNeighbourOrNull(Direction.N);
        assertEquals(List.of(0L, 0L), tiles.stream()
            .filter(t -> colony.getColonyTile(north).getId().equals(t.get("id")))
            .findFirst().get().get("pos"), "north is at the top, as in Swing");
        // Each tile's place on the map, for the panel to draw it as the map
        // does, and none taken or native land in a colony on free land.
        final Map<String, Object> northJson = tiles.stream()
            .filter(t -> colony.getColonyTile(north).getId().equals(t.get("id")))
            .findFirst().get();
        assertEquals(List.of((long)north.getX(), (long)north.getY()), northJson.get("at"));
        assertTrue(tiles.stream().noneMatch(t -> Boolean.TRUE.equals(t.get("taken"))
                    || Boolean.TRUE.equals(t.get("natives"))), "free tiles");
        // Water cannot be worked without docks: TileViewer draws the tile
        // taken image over it. (Another player's land only needs a claim.)
        // The north tile grows grain, and a colony stores grain as food, so
        // the food the colony produces drops when the tile turns to water.
        // The map seed is picked for that, so this is the case the panel's
        // numbers have to follow.
        final GoodsType food = spec.getGoodsType("model.goods.food");
        final int foodBefore = colony.getAdjustedNetProductionOf(food);
        north.changeType(spec.getTileType("model.tile.ocean"));
        final int foodAfter = colony.getAdjustedNetProductionOf(food);
        assertTrue(foodAfter < foodBefore, "the north tile's grain is the "
            + "colony's food, and it is gone: " + foodBefore + " -> "
            + foodAfter + "; another map seed?");
        final Map<String, Object> taken = list(panel(colony)
                .get("tiles")).stream().map(ColonyJsonTest::obj)
            .filter(t -> northJson.get("id").equals(t.get("id"))).findFirst().get();
        assertEquals(Boolean.TRUE, taken.get("taken"), "water, and no docks");

        // Units on the colony's tile but not in it.
        assertEquals(List.of(outside.getId()), ids(obj(json.get("outside")).get("units")));
        // Each carries UnitLabel's occupation chip; none is damaged.
        final Map<String, Object> outsideJson = obj(list(obj(json.get("outside")).get("units")).get(0));
        assertEquals(Messages.message(outside.getOccupationLabel(us, false)), outsideJson.get("occupation"));
        // On our nation's colour, as ImageLibrary.getOccupationIndicatorChip draws it.
        assertEquals(Utils.getRGB(us.getNationColor()) & 0xffffff, ((Number) outsideJson.get("rgb")).intValue());
        assertTrue(outsideJson.containsKey("fg"));
        assertFalse(outsideJson.containsKey("repair"));
        // The ship in port, with its cargo as ColonyCargoPanel shows it, and
        // chosen, as InPortPanel.selectLabel chooses the last carrier.
        final Map<String, Object> port = obj(json.get("inPort"));
        assertEquals(List.of(ship.getId()), ids(port.get("units")));
        assertEquals(ship.getId(), port.get("selected"));
        final Map<String, Object> cargo = obj(obj(list(port.get("units")).get(0)).get("cargo"));
        assertEquals("Cargo on Dutch Caravel (0 holds left)", cargo.get("title"));
        assertEquals(List.of(aboard.getId()), ids(cargo.get("units")));
        assertEquals(Map.of("model.goods.food", 50L), amounts(cargo.get("goods")));
        assertEquals("Cargo on carrier", port.get("cargo"), "the cargo box's title with no ship chosen");

        // The warehouse: the goods over the display threshold, and its capacity.
        final Map<String, Object> warehouse = obj(json.get("warehouse"));
        assertEquals(100L, warehouse.get("capacity"));
        final Map<String, Object> stored = list(warehouse.get("goods")).stream()
            .map(ColonyJsonTest::obj).filter(g -> "model.goods.lumber".equals(g.get("type")))
            .findFirst().get();
        assertEquals(150L, stored.get("amount"));
        assertEquals(Boolean.TRUE, stored.get("over"), "150 lumber is more than the warehouse holds");
        assertEquals(List.of("image.icon.model.goods.lumber"), stored.get("keys"));

        // Net production per goods type, the non-zero ones, as the model
        // has it. The panel is drawn now, after the north tile turned to
        // water, so read the panel now too: the colony's food changed with
        // it, and the numbers the panel shows are the model's, now.
        final Map<String, Long> netProduction = amounts(
            panel(colony).get("production"));
        for (GoodsType type : spec.getGoodsTypeList()) {
            final int amount = colony.getAdjustedNetProductionOf(type);
            if (amount == 0) {
                assertNull(netProduction.get(type.getId()), type.getId());
            } else {
                assertEquals((long)amount, netProduction.get(type.getId()), type.getId());
            }
        }
        assertTrue(netProduction.get("model.goods.hammers") > 0,
            "hammers: " + netProduction);

        // Population: the octagons' two colonists and share of rebels.
        final Map<String, Object> population = obj(json.get("population"));
        assertEquals(2L, population.get("size"));
        assertEquals((long)colony.getSonsOfLiberty(), population.get("rebelPercent"));
        final int grow = colony.getPreferredSizeChange();
        assertEquals((grow >= 0 ? "+" : "") + grow, population.get("sizeChange"));
        // RebelToolTip: the rebels and royalists, the bells, the bar to the
        // next rebel, and the turns to the next rebel among the lines under it.
        final Map<String, Object> tip = obj(population.get("tip"));
        final List<Object> members = list(tip.get("members"));
        assertEquals(List.of("Rebel:", "0", colony.getSonsOfLiberty() + "%"), list(members.get(0)));
        assertEquals("Royalist:", list(members.get(1)).get(0));
        assertEquals("model.goods.bells", obj(list(tip.get("liberty")).get(0)).get("type"));
        final Map<String, Object> bar = obj(tip.get("bar"));
        assertEquals(200L, bar.get("max"));
        assertTrue(((String)bar.get("text")).matches("\\d+[+-]\\d+/200 \\(Turns: .+\\)"),
            "FreeColProgressBar's text: " + bar.get("text"));
        assertTrue(list(tip.get("turns")).stream().anyMatch(r -> list(r).get(0)
                .equals(Messages.message("rebelToolTip.nextMember"))),
            "the turns to the next rebel: " + tip);

        // The current build and what it still needs.
        final Map<String, Object> build = obj(json.get("construction"));
        assertNotNull(colony.getCurrentlyBuilding(), "a new colony builds something");
        assertEquals(colony.getCurrentlyBuilding().getId(), build.get("type"));
        final List<Map<String, Object>> needs = list(build.get("required")).stream()
            .map(ColonyJsonTest::obj).collect(Collectors.toList());
        final List<String> types = new ArrayList<>();
        for (Map<String, Object> need : needs) types.add((String)need.get("type"));
        assertTrue(types.contains("model.goods.hammers"), "a building takes hammers: " + types);
        // Each goods' bar has its own turns, as FreeColProgressBar draws them.
        for (Map<String, Object> need : needs) {
            assertEquals(ColonyJson.progressTurns(((Number)need.get("needed")).intValue(),
                    ((Number)need.get("available")).intValue(),
                    ((Number)need.get("produced")).intValue()),
                need.get("turns"));
        }

        // The build queue: what is queued, and what the colony can queue, with
        // the reasons it cannot queue the rest, as BuildQueuePanel gives them.
        final Map<String, Object> queue = obj(json.get("queue"));
        final List<Map<String, Object>> queued = list(queue.get("queue")).stream()
            .map(ColonyJsonTest::obj).collect(Collectors.toList());
        assertEquals(colony.getBuildQueue().stream().map(t -> t.getId())
            .collect(Collectors.toList()),
            queued.stream().map(q -> (String)q.get("type")).collect(Collectors.toList()));
        final Map<String, Map<String, Object>> buildable = new LinkedHashMap<>();
        for (Object o : list(queue.get("buildings"))) buildable.put((String)obj(o).get("type"), obj(o));
        for (Object o : list(queue.get("units"))) buildable.put((String)obj(o).get("type"), obj(o));
        final Map<String, Object> open = buildable.values().stream()
            .filter(e -> e.get("reason") == null).findFirst().orElse(null);
        assertNotNull(open, "something can be queued: " + buildable);
        assertTrue(!list(open.get("required")).isEmpty(), "it shows what it costs");
        // Locked buildings are listed with what they lack.
        final Map<String, Object> university = buildable.get("model.building.university");
        assertNotNull(university, "locked buildings are listed too: " + buildable.keySet());
        assertTrue(((String)university.get("reason")).startsWith("Requires: "), "" + university);
        // The buy button prices the current build.
        final Map<String, Object> buy = obj(queue.get("buy"));
        assertEquals((long)colony.getPriceForBuilding(), buy.get("price"));
    }

    /**
     * The founder works where the colony needs it: on one of its tiles, or in
     * the town hall, which makes bells, when the colony has no tile to work.
     * A colony with nothing but water around it has no tile to work, and
     * neither has one founded on a tile with a lost city rumour, which
     * claims no land around it. The colony panel shows the founder in the
     * town hall, and play.ts puts it to work on a tile itself when FreeCol
     * does not.
     */
    @Test
    @Timeout(120)
    void theFounderWorksTheTownHallWhenTheColonyHasNoTileToWork() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        // A tile of land with water all around it: no tile of the colony can
        // be worked, as a colony without land to claim has none.
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && !t.hasSettlement()
                && t.getOwner() == null && t.getUnitCount() == 0).stream().findFirst().get();
        for (Tile around : land.getSurroundingTiles(1)) {
            if (around.isLand()) around.changeType(spec.getTileType("model.tile.ocean"));
        }
        final Colony colony = new ServerColony(game, us, "Jamestown", land);
        us.addSettlement(colony);
        colony.placeSettlement(true);
        final Unit founder = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        founder.setLocation(colony);

        // The founder works in the town hall, as no tile of the colony can be
        // worked, and the panel shows it there.
        assertTrue(founder.getLocation() instanceof Building,
            () -> "the founder works in a building: " + founder.getLocation());
        assertEquals("model.building.townHall",
            ((Building)founder.getLocation()).getType().getId());
        final Map<String, Object> json = obj(JsonReader.read(ColonyJson.of(colony, 0)));
        final Map<String, Object> hall = list(json.get("buildings")).stream()
            .map(ColonyJsonTest::obj)
            .filter(b -> "model.building.townHall".equals(b.get("type"))).findFirst().get();
        assertEquals(List.of(founder.getId()), ids(hall.get("workers")));
        // And no tile of the colony has the founder working on it.
        assertTrue(list(json.get("tiles")).stream().map(ColonyJsonTest::obj)
            .noneMatch(t -> !ids(t.get("workers")).isEmpty()),
            "the founder works on no tile");
    }

    /**
     * A colony with no colonists inside (they all walked out) has no share of
     * rebels: FreeCol's Colony.getSonsOfLiberty() is -1 then, which Swing
     * draws as -1% rebels and 101% royalists. The panel shows 0% and 100%.
     */
    @Test
    @Timeout(120)
    void anEmptyColonyHasNoRebelsRatherThanMinusOnePercent() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Specification spec = game.getSpecification();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand() && !t.hasSettlement()
                && t.getOwner() == null && t.getUnitCount() == 0).stream().findFirst().get();
        final Colony colony = new ServerColony(game, us, "Jamestown", land);
        us.addSettlement(colony);
        colony.placeSettlement(true);
        final Unit founder = new ServerUnit(game, land, us, spec.getDefaultUnitType(us));
        founder.setLocation(colony);
        founder.setLocation(land);
        colony.updateSoL();
        assertEquals(0, colony.getUnitCount());
        assertEquals(-1, colony.getSonsOfLiberty(), "FreeCol's value for an empty colony");

        final Map<String, Object> population = obj(
            obj(JsonReader.read(ColonyJson.of(colony, 0))).get("population"));
        assertEquals(0L, population.get("rebelPercent"));
        final List<Object> members = list(obj(population.get("tip")).get("members"));
        assertEquals(List.of("Rebel:", "0", "0%"), list(members.get(0)));
        assertEquals(List.of("Royalist:", "0", "100%"), list(members.get(1)));
    }
}
