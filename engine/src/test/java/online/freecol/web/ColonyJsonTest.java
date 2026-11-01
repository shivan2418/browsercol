package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
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
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.option.GameOptions;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The colony as the colony panel shows it, checked against the model for
 * a colony founded in the server's game of a Classic start: its buildings
 * and who works in them, its tiles and who works them, its goods and its
 * production.
 */
class ColonyJsonTest {

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
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        ourTurn.await();
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

        final String text = ColonyJson.of(colony, 1);
        final Map<String, Object> json = obj(JsonReader.read(text));

        assertEquals(colony.getId(), json.get("id"));
        assertEquals("Jamestown", json.get("name"));
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
        final Map<String, Object> shop = list(obj(JsonReader.read(ColonyJson.of(colony, 1)))
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
        final Tile north = land.getNeighbourOrNull(net.sf.freecol.common.model.Direction.N);
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
        north.changeType(spec.getTileType("model.tile.ocean"));
        final Map<String, Object> taken = list(obj(JsonReader.read(ColonyJson.of(colony, 1)))
                .get("tiles")).stream().map(ColonyJsonTest::obj)
            .filter(t -> northJson.get("id").equals(t.get("id"))).findFirst().get();
        assertEquals(Boolean.TRUE, taken.get("taken"), "water, and no docks");

        // Units on the colony's tile but not in it.
        assertEquals(List.of(outside.getId()), ids(obj(json.get("outside")).get("units")));
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

        // Net production per goods type, the non-zero ones, as the model has it.
        final Map<String, Long> net = amounts(json.get("production"));
        for (GoodsType type : spec.getGoodsTypeList()) {
            final int amount = colony.getAdjustedNetProductionOf(type);
            if (amount == 0) {
                assertNull(net.get(type.getId()), type.getId());
            } else {
                assertEquals((long)amount, net.get(type.getId()), type.getId());
            }
        }
        assertTrue(net.get("model.goods.hammers") > 0, "hammers: " + net);

        // Population: the two colonists in it, and the share of rebels.
        final Map<String, Object> population = obj(json.get("population"));
        assertEquals("Total: 2", population.get("total"));
        assertEquals((long)colony.getSonsOfLiberty(), population.get("rebelPercent"));

        // The current build and what it still needs.
        final Map<String, Object> build = obj(json.get("construction"));
        assertNotNull(colony.getCurrentlyBuilding(), "a new colony builds something");
        assertEquals(colony.getCurrentlyBuilding().getId(), build.get("type"));
        final List<Map<String, Object>> needs = list(build.get("required")).stream()
            .map(ColonyJsonTest::obj).collect(Collectors.toList());
        final List<String> types = new ArrayList<>();
        for (Map<String, Object> need : needs) types.add((String)need.get("type"));
        assertTrue(types.contains("model.goods.hammers"), "a building takes hammers: " + types);
    }
}
