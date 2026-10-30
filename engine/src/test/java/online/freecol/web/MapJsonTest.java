package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Resource;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementStyle;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The map the Tileset renderer draws, as the client Engine sees it at the
 * start of a Classic game: tile types, what we can see now, tile items
 * and the resource keys of units, in FreeCol's ImageLibrary terms.
 */
class MapJsonTest {

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
                    client.answer(id, kind.equals("confirm") ? "true" : null);
                }
            });
        server.startGame("classic");
        assertTrue(client.startGame(0), "login");
        ourTurn.await();
    }

    /** The value of a top-level field, as raw JSON up to the next top-level key. */
    private static String field(String json, String key) {
        int start = json.indexOf("\"" + key + "\":") + key.length() + 3;
        int depth = 0;
        for (int i = start; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '[' || c == '{') depth++;
            else if (c == ']' || c == '}') depth--;
            else if (c == '"') i = json.indexOf('"', i + 1);
            if (depth < 0 || (depth == 0 && c == ',')) return json.substring(start, i);
        }
        return json.substring(start);
    }

    @Test
    @Timeout(120)
    void theMapCarriesWhatTheTilesetDraws() throws Exception {
        startGame();
        final Game game = client.getGame();
        final Map map = game.getMap();
        final Player us = client.getClient().getMyPlayer();
        final Unit ship = us.getUnits().filter(Unit::isNaval).findFirst().get();
        final Tile at = ship.getTile();

        final String json = MapJson.of(game, us, client.getClient().getGUI().getActiveUnit());
        final int w = map.getWidth(), h = map.getHeight();
        assertEquals(String.valueOf(w), field(json, "w"));
        assertEquals(String.valueOf(h), field(json, "h"));

        // One character per tile: '.' unexplored, else the type's index;
        // seen is '1' where we can see the tile now.
        final String tiles = field(json, "tiles");
        final String seen = field(json, "seen");
        assertEquals(w * h + 2, tiles.length());
        assertEquals(w * h + 2, seen.length());
        final int i = 1 + at.getY() * w + at.getX();
        assertTrue(tiles.charAt(i) != '.', "the ship's tile is explored");
        assertEquals('1', seen.charAt(i), "and we see it");
        final Tile unexplored = map.getTileSet(t -> !t.isExplored()).stream().findFirst().get();
        assertEquals('.', tiles.charAt(1 + unexplored.getY() * w + unexplored.getX()));
        assertEquals('0', seen.charAt(1 + unexplored.getY() * w + unexplored.getX()));
        assertTrue(field(json, "types").contains(
            "{\"id\":\"model.tile.highSeas\",\"land\":false,\"forested\":false}"),
            "tile types say whether they are land and forested");

        // The ship: its image keys, most specific first, the owner's
        // colour, the occupation chip, how many units the tile holds and
        // whether to fade it.
        final String nation = us.getNationResourceKey();
        final String units = field(json, "units");
        final String key = "image.unit." + ship.getType().getId();
        assertTrue(units.contains("[" + at.getX() + "," + at.getY()
            + ",[\"" + key + "." + nation + "\",\"" + key + "\"],"), units);

        assertEquals("[" + at.getX() + "," + at.getY() + "]", field(json, "active"));
    }

    @Test
    @Timeout(120)
    void tileItemsComeWithTheirKeysInZIndexOrder() throws Exception {
        startGame();
        // The client game cannot make objects, so plant them in the
        // server's game and write that one's map.
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand()
                && !t.hasSettlement() && t.getRiver() == null
                && t.getResource() == null && !t.hasLostCityRumour())
            .stream().findFirst().get();
        land.addRiver(2, null)
            .setStyle(TileImprovementStyle.getInstance("2020"));
        land.addResource(new Resource(game, land,
            game.getSpecification().getResourceType("model.resource.ore")));
        land.addLostCityRumour(new LostCityRumour(game, land));

        final String json = MapJson.of(game, us, null);
        final String xy = land.getX() + "," + land.getY();
        assertTrue(field(json, "rivers").contains("[" + xy + ",2,\"2020\",\"1010\"]"),
            "a river carries its magnitude, style and forest mask");
        final String items = field(json, "items");
        final int ore = items.indexOf("[" + xy + ",400,\"centered\",\"image.tileitem.model.resource.ore\"]");
        final int rumour = items.indexOf("[" + xy + ",500,\"centered\",\"image.tileitem.lostCityRumour\"]");
        assertTrue(ore >= 0 && rumour >= 0, items);
        assertTrue(ore < rumour,
            "items come in zIndex order");
    }

    @Test
    @Timeout(120)
    void aColonyTellsWhetherItWouldRatherGrow() throws Exception {
        startGame();
        // As FreeColTestUtils builds a colony, in the server's game.
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final Tile land = game.getMap().getTileSet(t -> t.isLand()
                && !t.hasSettlement() && t.getOwner() == null)
            .stream().findFirst().get();
        final Colony colony = new ServerColony(game, us, "Jamestown", land);
        us.addSettlement(colony);
        colony.placeSettlement(true);
        new ServerUnit(game, land, us,
            game.getSpecification().getDefaultUnitType(us)).setLocation(colony);
        final int change = colony.getPreferredSizeChange();
        assertTrue(change > 0, "a colony of one can grow, so the flag shows");

        final String settlements = field(MapJson.of(game, us, null), "settlements");
        assertTrue(settlements.contains("\"Jamestown\",1,"
                + colony.getProductionBonus() + "," + change + "]"), settlements);
        assertTrue(settlements.contains(",-1,0,0]"),
            "native settlements send no size change: " + settlements);
    }
}
