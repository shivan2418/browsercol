package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Map;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Resource;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementStyle;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.util.Utils;
import net.sf.freecol.server.model.ServerColony;
import net.sf.freecol.server.model.ServerUnit;


/**
 * The map Tileset mode draws, as the client Engine sees it at the
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
            "{\"id\":\"model.tile.highSeas\",\"land\":false,\"forested\":false,"
            + "\"name\":" + Json.quote(Messages.getName("model.tile.highSeas")) + "}"),
            "tile types say whether they are land and forested, and their name");

        // The ship: its image keys, most specific first, the owner's
        // colour, the occupation chip, how many units the tile holds and
        // whether to fade it.
        final String nation = us.getNationResourceKey();
        final String units = field(json, "units");
        final String key = "image.unit." + ship.getType().getId();
        assertTrue(units.contains("{\"x\":" + at.getX() + ",\"y\":" + at.getY()
            + ",\"keys\":[\"" + key + "." + nation + "\",\"" + key + "\"],"
            + "\"rgb\":" + (Utils.getRGB(us.getNationColor()) & 0xffffff) + ",\"chip\":"), units);
        assertTrue(units.contains(",\"stack\":" + at.getTotalUnitCount() + ",\"fade\":false}"),
            "the ship is not sentried and in sight: " + units);

        assertEquals("[" + at.getX() + "," + at.getY() + "]", field(json, "active"));

        // The regions, for the tile text option's regions: the ship's tile is in one.
        final String regions = field(json, "regions");
        assertEquals(w * h + 2, regions.length());
        assertNotNull(at.getRegion(), "the ship's tile is in a region");
        final int r = regions.charAt(i) - 'A';
        assertEquals(Messages.message(at.getRegion().getLabel()),
            ((List<?>)JsonReader.read(field(json, "regionNames"))).get(r));
        assertEquals('.', regions.charAt(1 + unexplored.getY() * w + unexplored.getX()));

        // The fog of war shows as the game and the display fog of war option say.
        assertEquals(String.valueOf(game.getSpecification().getBoolean(
            net.sf.freecol.common.option.GameOptions.FOG_OF_WAR)), field(json, "fog"));
        assertEquals("false", field(MapJson.of(game, us, null, false), "fog"));

        // For the info panel: what the ship is, its moves and its cargo.
        final List<String> cargo = new ArrayList<>();
        for (Unit u : ship.getUnitList()) {
            cargo.add(Json.quote(u.getDescription(Unit.UnitLabelType.NATIONAL)));
        }
        for (Goods g : ship.getGoodsList()) cargo.add(Json.quote(Messages.message(g.getLabel(true))));
        assertTrue(cargo.size() > 1, "the ship sails with colonists aboard");
        assertEquals("{\"id\":\"" + ship.getId() + "\",\"label\":"
            + Json.quote(ship.getDescription(Unit.UnitLabelType.FULL))
            + ",\"moves\":\"" + ship.getMovesAsString() + "\",\"cargo\":" + Json.array(cargo)
            + ",\"path\":null}", field(json, "activeUnit"));
    }

    @Test
    @Timeout(120)
    void theMapCarriesFreeColsStatusLine() throws Exception {
        startGame();
        final Game game = client.getGame();
        final Player us = client.getClient().getMyPlayer();

        // The line InGameMenuBar paints: the score, gold, tax and year.
        final String expected = Messages.message(StringTemplate
            .template("menuBar.statusLine")
            .addAmount("%gold%", us.getGold())
            .addAmount("%tax%", us.getTax())
            .addAmount("%score%", us.getScore())
            .addStringTemplate("%year%", game.getTurn().getLabel()))
            .replace("|", "\u2727");
        final String statusLine = field(MapJson.of(game, us, null), "statusLine");
        assertEquals(Json.quote(expected), statusLine);
        assertEquals(Json.quote(Messages.message(game.getTurn().getLabel())),
            field(MapJson.of(game, us, null), "turnLabel"));
        assertTrue(statusLine.contains("Gold: " + us.getGold()),
            "the gold is in the line: " + statusLine);
        assertTrue(statusLine.contains("Year: "), "the year is in the line: "
            + statusLine);
        assertTrue(statusLine.contains("\u2727"), "the bars are stars: "
            + statusLine);

        // The gold changes in the middle of a turn: the line follows.
        us.modifyGold(1234);
        final String after = field(MapJson.of(game, us, null), "statusLine");
        assertTrue(after.contains("Gold: " + us.getGold()),
            "the new gold is in the line: " + after);
        assertNotEquals(statusLine, after, "the line changed: " + after);
    }

    @Test
    @Timeout(120)
    void theActiveUnitShowsItsPathWhileItHasADestination() throws Exception {
        startGame();
        final Game game = client.getGame();
        final Player us = client.getClient().getMyPlayer();
        final Unit ship = client.getClient().getGUI().getActiveUnit();
        final Tile from = ship.getTile();
        // The farthest water we have explored: the ship sees only so far.
        final Tile to = game.getMap().getTileSet(t -> t.isExplored() && !t.isLand())
            .stream().max(Comparator.comparingInt(t -> t.getDistanceTo(from))).get();
        ship.setDestination(to);
        final PathNode path = ship.findPath(to);

        final List<String> nodes = new ArrayList<>();
        for (PathNode p = path; p != null; p = p.next) {
            nodes.add("[" + p.getTile().getX() + "," + p.getTile().getY() + "," + p.getTurns() + "]");
        }
        assertTrue(nodes.size() > 1, nodes.toString());
        assertTrue(field(MapJson.of(game, us, ship), "activeUnit")
                .endsWith(",\"path\":" + Json.array(nodes) + "}"),
            "each step's tile, and the turns it takes to get there");
    }

    @Test
    @Timeout(120)
    void eachTileSaysWhoOwnsIt() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final Map map = game.getMap();
        final Tile owned = map.getTileSet(t -> t.getOwner() != null && t.isExplored())
            .stream().findFirst().get();
        final Tile free = map.getTileSet(t -> t.getOwner() == null)
            .stream().findFirst().get();

        final String json = MapJson.of(game, us, null);
        final String owners = field(json, "owners");
        final int w = map.getWidth();
        assertEquals(w * map.getHeight() + 2, owners.length());
        assertEquals('.', owners.charAt(1 + free.getY() * w + free.getX()));
        final int i = owners.charAt(1 + owned.getY() * w + owned.getX()) - 'A';
        final String players = field(json, "players");
        assertTrue(players.startsWith("[{"), players);
        final String entry = players.substring(1, players.length() - 1).split("(?<=\\}),")[i];
        assertEquals("{\"name\":" + Json.quote(Messages.message(owned.getOwner().getNationLabel()))
            + ",\"rgb\":" + (Utils.getRGB(owned.getOwner().getNationColor()) & 0xffffff) + "}", entry);
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
        assertTrue(settlements.contains("\"name\":\"Jamestown\",\"population\":1,"
                + "\"bonus\":" + colony.getProductionBonus()
                + ",\"sizeChange\":" + change + ",\"chips\":null}"),
            "and no native settlement chips: " + settlements);
        assertTrue(settlements.contains("\"population\":-1,\"bonus\":0,\"sizeChange\":0,\"chips\":{"),
            "native settlements send no size change: " + settlements);
    }

    @Test
    @Timeout(120)
    void aNativeSettlementSendsWhatItsChipsShow() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        // A settlement of the nation in dark brown, 0x6c3c18, so its
        // settlement chip's text is white.
        final IndianSettlement is = game.getMap().getTileSet(t ->
                t.getSettlement() instanceof IndianSettlement
                && (Utils.getRGB(t.getOwner().getNationColor()) & 0xffffff) == 0x6c3c18)
            .stream().findFirst().get().getIndianSettlement();
        final Supplier<String> entry = () -> {
            final String all = field(MapJson.of(game, us, null), "settlements");
            final int from = all.indexOf("{\"x\":" + is.getTile().getX()
                + ",\"y\":" + is.getTile().getY() + ",");
            final int to = all.indexOf(",{\"x\":", from);
            return all.substring(from, (to < 0) ? all.length() - 1 : to);
        };
        final String capital = "\"chips\":{\"capital\":" + is.getType().isCapital()
            + ",\"fg\":16777215";
        final int ours = Utils.getRGB(us.getNationColor()) & 0xffffff;

        // Before contact: the settlement chip only.
        assertTrue(entry.get().endsWith(capital + ",\"mission\":null,\"alarm\":null}}"),
            entry.get());

        // Contacted, with our expert missionary and hating us most: the
        // alarm chip's text is in our light colour's foreground, black,
        // and it reads as worth scouting until scouted.
        is.setContacted(us);
        is.setMostHated(us);
        is.setMissionary(new ServerUnit(game, null, us,
            game.getSpecification().getUnitType("model.unit.jesuitMissionary")));
        assertTrue(entry.get().endsWith(capital
                + ",\"mission\":{\"rgb\":" + ours + ",\"expert\":true}"
                + ",\"alarm\":{\"fg\":0,\"worthScouting\":true}}}"),
            entry.get());
        is.setScouted(us);
        assertTrue(entry.get().endsWith("\"worthScouting\":false}}}"), entry.get());
    }

    /**
     * The native settlement panel's payload, against the model: what the
     * player has not learned is hidden, and each step of contact and visit
     * shows more, as IndianSettlementPanel's checks have it.
     */
    @Test
    @Timeout(120)
    void theNativeSettlementPanelShowsOnlyWhatThePlayerHasLearned() throws Exception {
        startGame();
        final Game game = server.getGame();
        final Player us = game.getFreeColGameObject(
            client.getClient().getMyPlayer().getId(), Player.class);
        final IndianSettlement is = game.getMap().getTileSet(
                t -> t.getSettlement() instanceof IndianSettlement)
            .stream().findFirst().get().getIndianSettlement();
        is.setWantedGoods(List.of(game.getSpecification().getGoodsType("model.goods.rum"),
            game.getSpecification().getGoodsType("model.goods.tools")));
        final String nation = Messages.message(is.getOwner().getNationLabel());
        final String skillName = Messages.message(is.getLearnableSkill().getNameKey());
        final String wanted = Messages.message(is.getWantedGoods(0).getNameKey());
        final String skillKey = ObjectImages.json(is.getLearnableSkill());
        final String goodsKey = ObjectImages.json(is.getWantedGoods(0));
        final String none = "[{\"text\":\"\",\"images\":[],\"tip\":null}]";

        // Unmet: the settlement and its type, nothing it knows.
        String json = SettlementJson.of(is, us).toString();
        assertEquals(Messages.message(is.getLocationLabelFor(us)), unquote(field(json, "name")));
        assertTrue(unquote(field(json, "kind")).contains(nation), json);
        assertEquals("null", field(json, "tension"));
        assertEquals("null", field(json, "missionary"));
        assertEquals("false", field(json, "worthScouting"));
        assertEquals("{\"text\":\"" + Messages.message("model.indianSettlement.skillUnknown")
            + "\",\"images\":[]}", field(json, "skill"));
        assertEquals("{\"text\":\"" + Messages.message("model.indianSettlement.mostHatedUnknown")
            + "\",\"images\":[]}", field(json, "mostHated"));
        assertEquals(none, field(json, "wanted"));
        assertTrue(!json.contains(skillName) && !json.contains(skillKey), json);

        // Contacted: the most hated nation is known, the skill still not.
        is.setContacted(us);
        is.setMostHated(us);
        json = SettlementJson.of(is, us).toString();
        assertEquals("true", field(json, "worthScouting"));
        assertTrue(field(json, "mostHated").contains(Messages.message(us.getCountryLabel())), json);
        assertTrue(field(json, "mostHated").contains(ObjectImages.json(us.getNation())), json);
        assertTrue(field(json, "skill").contains("\"images\":[]"), json);
        assertEquals(none, field(json, "wanted"));

        // Visited: the skill and the wanted goods, with their icons.
        is.setVisited(us);
        json = SettlementJson.of(is, us).toString();
        assertEquals("{\"text\":\"" + skillName + "\",\"images\":" + skillKey + "}",
            field(json, "skill"));
        assertTrue(field(json, "wanted").startsWith("[{\"text\":\"" + wanted
                + "\",\"images\":" + goodsKey), json);
        assertEquals(Math.max(1, is.getWantedGoodsCount()),
            field(json, "wanted").split("\\{\"text\"", -1).length - 1);

        // A missionary of ours shows with its label.
        is.setMissionary(new ServerUnit(game, null, us,
            game.getSpecification().getUnitType("model.unit.jesuitMissionary")));
        json = SettlementJson.of(is, us).toString();
        assertTrue(field(json, "missionary").contains(
            Messages.message(is.getMissionary().getLabel(Unit.UnitLabelType.NATIONAL))), json);
        assertTrue(field(json, "missionary").contains("image.unit.model.unit.jesuitMissionary"), json);
    }

    private static String unquote(String quoted) {
        return quoted.substring(1, quoted.length() - 1);
    }
}
