package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.ClientOptions;
import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.control.InGameController;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.model.BuildableType;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.ColonyTile;
import net.sf.freecol.common.model.Direction;
import net.sf.freecol.common.model.ExportData;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsContainer;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.UnitLocation.NoAddReason;
import net.sf.freecol.common.model.WorkLocation;
import net.sf.freecol.common.model.PathNode;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.TileImprovementType;
import net.sf.freecol.common.model.TradeRoute;
import net.sf.freecol.common.model.Unit;


/**
 * What the human player can do on their turn, as the Browser UI asks for
 * it: the input the Swing GUI's actions and mouse listener turn into
 * client controller calls. Each command blocks until the controller is
 * done, and returns false if it did nothing.
 */
public final class Commands {

    private final FreeColClient client;


    Commands(FreeColClient client) {
        this.client = client;
    }

    private InGameController igc() {
        return this.client.getInGameController();
    }

    /**
     * Called when a command is done: the colony panels that are open move
     * workers off work that no longer produces (ColonyPanel.updateProduction).
     */
    void afterCommand() {
        if (gui() instanceof WebGUI) ((WebGUI)gui()).settleColonies();
    }

    private GUI gui() {
        return this.client.getGUI();
    }

    private Tile tile(int x, int y) {
        return this.client.getGame().getMap().getTile(x, y);
    }

    /**
     * Click a tile: on a native settlement, show its panel; on our colony,
     * open its panel, as SwingGUI.clickAt does. Elsewhere select our next
     * unit there, units aboard a carrier
     * included, so repeated clicks cycle through a stack. With none, do
     * nothing: sending the active unit there is {@link #goTo}, which the
     * Browser UI asks for by holding the pointer on the tile.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return True if a panel opened or a unit was selected.
     */
    public boolean click(int x, int y) {
        return click(x, y, 1);
    }

    /**
     * Click a tile as {@link #click(int, int)} does, with the click count
     * of the gesture. Where nothing opens and no unit of ours is selected
     * (an unexplored tile, one with only foreign units, an empty one), the
     * map is centred on the tile, as SwingGUI.clickAt's setFocus does, and
     * a double click on an empty tile selects it in terrain view.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @param count How many clicks in a row this is, 1 for a single click.
     * @return True if a panel opened or a unit was selected.
     */
    public boolean click(int x, int y, int count) {
        final Tile tile = tile(x, y);
        if (tile == null) return false;
        if (!tile.isExplored()) {
            gui().setFocus(tile);
            return false;
        }
        // A native settlement opens its panel, as SwingGUI's click does.
        if (tile.getSettlement() instanceof IndianSettlement) {
            gui().showIndianSettlementPanel((IndianSettlement)tile.getSettlement());
            return true;
        }
        final Player player = this.client.getMyPlayer();
        final Colony colony = tile.getColony();
        if (colony != null && player.owns(colony)) {
            gui().showColonyPanel(colony, null);
            return true;
        }
        final List<Unit> ours = new ArrayList<>();
        for (Unit u : tile.getUnitList()) {
            if (!player.owns(u)) continue;
            ours.add(u);
            for (Unit aboard : u.getUnitList()) ours.add(aboard);
        }
        if (ours.isEmpty()) {
            // SwingGUI.clickAt: an empty tile is selected in terrain view on a
            // multi-click; any other tile without a unit of ours is focused.
            if (count > 1 && tile.isEmpty() && tile.getSettlement() == null) {
                gui().changeView(tile);
            } else {
                gui().setFocus(tile);
            }
            return false;
        }
        final int i = ours.indexOf(gui().getActiveUnit());
        gui().changeView(ours.get((i + 1) % ours.size()), false);
        return true;
    }

    /**
     * Move the active unit one step, as MoveAction does.
     *
     * @param direction A {@code Direction} name, e.g. "NE".
     * @return True if the unit moved or acted.
     */
    public boolean move(String direction) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        final Tile from = unit.getTile();
        final int moves = unit.getMovesLeft();
        igc().moveUnit(unit, Direction.valueOf(direction));
        return unit.isDisposed() || unit.getTile() != from
            || unit.getMovesLeft() != moves;
    }

    /**
     * Send the active unit to a tile along its best path, as a goto drag
     * in the Swing GUI does.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return True if the unit set off.
     */
    public boolean goTo(int x, int y) {
        final Unit unit = gui().getActiveUnit();
        final Tile tile = tile(x, y);
        if (unit == null || tile == null || unit.getTile() == tile) return false;
        final PathNode path = unit.findPath(tile);
        if (path == null) {
            // SwingGUI.traverseGotoPath: no path clears the unit's goto orders.
            igc().clearGotoOrders(unit);
            return false;
        }
        return igc().goToTile(unit, path);
    }

    /**
     * The path the active unit would take to a tile, as goTo would send it.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return The path as MapJson.path gives it; "null" for none.
     */
    public String pathTo(int x, int y) {
        final Unit unit = gui().getActiveUnit();
        final Tile tile = tile(x, y);
        if (unit == null || tile == null || unit.getTile() == tile) return "null";
        try {
            return MapJson.path(unit.findPath(tile));
        } catch (RuntimeException e) {
            return "null";
        }
    }

    /** Show the Europe panel (EuropeAction). */
    public boolean showEurope() {
        gui().showEuropePanel();
        return true;
    }

    /** Show the game options, read-only (ShowGameOptionsAction). */
    public boolean showGameOptions() {
        gui().showGameOptionsDialog(false, null);
        return true;
    }

    /** Show the map generator options of the game, read-only (ShowMapGeneratorOptionsAction). */
    public boolean showMapGeneratorOptions() {
        gui().showMapGeneratorOptionsDialog(false, null);
        return true;
    }

    /** Show the game's difficulty level, read-only (ShowDifficultyAction). */
    public boolean showDifficulty() {
        gui().showDifficultyDialog();
        return true;
    }

    /**
     * Recruit the unit at an index of Europe's docks (RecruitPanel). The
     * Europe panel is sent again.
     *
     * @param index The index in the recruit pool, [0..RECRUIT_COUNT).
     * @return True if a unit was recruited.
     */
    public boolean recruitUnit(int index) {
        final boolean done = igc().recruitUnitInEurope(index);
        gui().showEuropePanel();
        return done;
    }

    /**
     * Train or buy a unit of a type in Europe (TrainPanel, PurchasePanel:
     * both are the controller's trainUnitInEurope). The Europe panel is
     * sent again.
     *
     * @param unitTypeId The id of the unit type.
     * @return True if the unit was bought.
     */
    public boolean trainUnit(String unitTypeId) {
        final boolean done = igc().trainUnitInEurope(
            this.client.getGame().getSpecification().getUnitType(unitTypeId));
        gui().showEuropePanel();
        return done;
    }

    /**
     * Put a unit aboard a ship beside it: on Europe's docks (a drop on the
     * Europe panel's cargo) or in a colony with the ship in port (a drop
     * on the colony panel's cargo, UnitLabel.addCargo). In Europe the
     * Europe panel is sent again.
     *
     * @param unitId The id of the unit.
     * @param shipId The id of the ship.
     * @return True if the unit boarded.
     */
    public boolean boardShip(String unitId, String shipId) {
        final Player player = this.client.getMyPlayer();
        final Unit unit = player.getOurFreeColGameObject(unitId, Unit.class);
        final Unit ship = player.getOurFreeColGameObject(shipId, Unit.class);
        final boolean done = unit != null && ship != null && ship.canAdd(unit)
            && igc().boardShip(unit, ship);
        if (ship != null && ship.isInEurope()) gui().showEuropePanel();
        return done;
    }

    /**
     * Take a unit off a ship in a colony's port, onto the colony's tile
     * (dragging it out of the colony panel's cargo, UnitLabel.removeCargo),
     * or off a ship in Europe, onto the docks (a drop on the Europe panel's
     * docks), after which the Europe panel is sent again.
     *
     * @param unitId The id of one of our units aboard a ship in a colony or Europe.
     * @return True if the unit left the ship.
     */
    public boolean leaveShip(String unitId) {
        final Unit unit = this.client.getMyPlayer()
            .getOurFreeColGameObject(unitId, Unit.class);
        if (unit == null || !unit.isOnCarrier()) return false;
        final Unit ship = unit.getCarrier();
        if (ship.getColony() == null && !ship.isInEurope()) return false;
        final boolean done = igc().leaveShip(unit);
        if (ship.isInEurope()) gui().showEuropePanel();
        return done;
    }

    /**
     * Buy goods in Europe onto a ship in port, as the market's goods dropped
     * on the cargo does (MarketLabel.addCargo): the player is asked how much
     * through the select amount dialog, and the most is what the ship has
     * room for and the gold buys at the market's price. A boycotted goods
     * cannot be bought, and the player is told why. The Europe panel is
     * sent again.
     *
     * @param shipId The id of one of our ships in Europe.
     * @param goodsTypeId The id of the goods type.
     * @return True if goods were bought.
     */
    public boolean buyGoods(String shipId, String goodsTypeId) {
        return buyGoods(shipId, goodsTypeId, true);
    }

    /**
     * Buy goods in Europe onto a ship in port, as {@link #buyGoods(String,
     * String)} does, but asking the amount only when {@code ask}: otherwise
     * the most the ship has room for and the gold buys is bought (a plain
     * drag of the market's goods; shift asks).
     *
     * @param shipId The id of one of our ships in Europe.
     * @param goodsTypeId The id of the goods type.
     * @param ask Whether to ask the amount.
     * @return True if goods were bought.
     */
    public boolean buyGoods(String shipId, String goodsTypeId, boolean ask) {
        final Unit ship = shipInEurope(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        final Player player = this.client.getMyPlayer();
        if (!player.canTrade(type)) {
            // The Crown is boycotting this goods: the player is asked to pay
            // the arrears, as Swing does, and the goods is not traded.
            igc().payArrears(type);
            gui().showEuropePanel();
            return false;
        }
        final int loadable = ship.getLoadableAmount(type);
        if (loadable <= 0) return false;
        final Market market = player.getMarket();
        final int price = market.getCostToBuy(type);
        final int most = (price <= 0) ? 0 : Math.min(loadable, player.getGold() / price);
        if (most <= 0) {
            gui().showInformationPanel(null, StringTemplate.template("info.notEnoughGold"));
            gui().showEuropePanel();
            return false;
        }
        // Paying, the dialog limits the amount to what the gold buys.
        final int amount = ask
            ? gui().showSelectAmountDialog(type, loadable, most, true) : most;
        if (amount <= 0) return false;
        final boolean done = igc().buyGoods(type, amount, ship);
        gui().showEuropePanel();
        return done;
    }

    /**
     * Sell a ship's cargo in Europe, as a stack of the cargo dropped on the
     * market does (EuropePanel's MarketPanel): the player is asked how much
     * of the stack to sell through the select amount dialog. A boycotted
     * goods cannot be sold, and the player is told why. The Europe panel is
     * sent again.
     *
     * @param shipId The id of one of our ships in Europe.
     * @param goodsTypeId The id of the goods type.
     * @return True if goods were sold.
     */
    public boolean sellGoods(String shipId, String goodsTypeId) {
        return sellGoods(shipId, goodsTypeId, true);
    }

    /**
     * Sell a ship's cargo in Europe, as {@link #sellGoods(String, String)}
     * does, but asking the amount only when {@code ask}: otherwise the whole
     * stack is sold (a plain drag of the cargo; shift asks).
     *
     * @param shipId The id of one of our ships in Europe.
     * @param goodsTypeId The id of the goods type.
     * @param ask Whether to ask the amount.
     * @return True if goods were sold.
     */
    public boolean sellGoods(String shipId, String goodsTypeId, boolean ask) {
        final Unit ship = shipInEurope(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        final int aboard = ship.getGoodsCount(type);
        if (aboard <= 0) return false;
        final Player player = this.client.getMyPlayer();
        if (!player.canTrade(type)) {
            // The Crown is boycotting this goods: the player is asked to pay
            // the arrears, as Swing does, and the goods is not sold.
            igc().payArrears(type);
            gui().showEuropePanel();
            return false;
        }
        final int amount = ask
            ? gui().showSelectAmountDialog(type, aboard, aboard, false) : aboard;
        if (amount <= 0) return false;
        final boolean done = igc().sellGoods(
            new Goods(this.client.getGame(), ship, type, amount));
        gui().showEuropePanel();
        return done;
    }

    /**
     * Load goods of a type from a colony's warehouse onto a ship in its
     * port, as dropping the warehouse's goods on the colony panel's cargo
     * does (DefaultTransferHandler.importGoods, GoodsLabel.addCargo): a
     * plain drop takes up to a hold's worth (100); asked, the player
     * chooses up to all the warehouse has, through the select amount
     * dialog, starting from what the ship can take. Either way the ship
     * takes no more than it has room for.
     *
     * @param shipId The id of one of our ships in a colony.
     * @param goodsTypeId The id of the goods type.
     * @param ask Whether to ask the amount (FreeCol's shift-drag).
     * @return True if goods were loaded.
     */
    public boolean loadGoods(String shipId, String goodsTypeId, boolean ask) {
        final Unit ship = shipInPort(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        final Colony colony = ship.getColony();
        final int stored = colony.getGoodsCount(type);
        if (stored <= 0) return false;
        int amount = Math.min(stored, GoodsContainer.CARGO_SIZE);
        if (ask) {
            int suggested = stored;
            final int capacity = colony.getWarehouseCapacity();
            // Over capacity, favour the amount that would correct it.
            if (stored > capacity) {
                suggested = Math.min(GoodsContainer.CARGO_SIZE, stored - capacity);
            }
            final int loadable = ship.getLoadableAmount(type);
            if (loadable >= 0 && loadable < suggested) suggested = loadable;
            if (suggested <= 0) return false;
            amount = gui().showSelectAmountDialog(type, stored, suggested, false);
        }
        amount = Math.min(amount, ship.getLoadableAmount(type));
        if (amount <= 0) return false;
        return igc().loadCargo(new Goods(this.client.getGame(), colony, type, amount), ship);
    }

    /**
     * Unload goods from a ship in a colony's port into the warehouse, as
     * dragging a stack of the colony panel's cargo out does (a GoodsLabel
     * per stack of up to 100): the whole stack, or, asked, as much of it
     * as the player chooses through the select amount dialog, starting from
     * what the warehouse has room for (WarehousePanel.suggested). With no
     * room left, nothing is asked or unloaded, as in Swing.
     *
     * @param shipId The id of one of our ships in a colony.
     * @param goodsTypeId The id of the goods type.
     * @param stack The amount of the stack dragged.
     * @param ask Whether to ask the amount (FreeCol's shift-drag).
     * @return True if goods were unloaded.
     */
    public boolean unloadGoods(String shipId, String goodsTypeId, int stack,
                               boolean ask) {
        final Unit ship = shipInPort(shipId);
        final GoodsType type = goodsType(goodsTypeId);
        if (ship == null || type == null) return false;
        int amount = Math.min(stack, ship.getGoodsCount(type));
        if (amount <= 0) return false;
        if (ask) {
            final Colony colony = ship.getColony();
            final int room = colony.getWarehouseCapacity() - colony.getGoodsCount(type);
            final int suggested = (room >= 0 && room < amount) ? room : amount;
            if (suggested <= 0) return false;
            amount = gui().showSelectAmountDialog(type, amount, suggested, false);
        }
        if (amount <= 0) return false;
        return igc().unloadCargo(new Goods(this.client.getGame(), ship, type, amount), false);
    }

    /**
     * Run the entry a player picked in a right-click menu ({@link Menus}):
     * its id is a verb, then its arguments after a colon, separated by
     * commas (or by a colon, for a unit state).
     *
     * <table>
     * <caption>The verbs</caption>
     * <tr><td>goto:x,y</td><td>send the active unit to the tile</td></tr>
     * <tr><td>attack:x,y</td><td>the active unit attacks the adjacent tile</td></tr>
     * <tr><td>europe:unit</td><td>send the unit to Europe</td></tr>
     * <tr><td>state:STATE:unit</td><td>change the unit's state</td></tr>
     * <tr><td>cashin:unit</td><td>cash in a treasure train</td></tr>
     * <tr><td>clear:unit</td><td>clear the unit's orders</td></tr>
     * <tr><td>select:unit</td><td>make the unit the active one</td></tr>
     * <tr><td>tile:x,y</td><td>show the tile's panel</td></tr>
     * <tr><td>activateAll:x,y</td><td>clear the orders of the tile's units and select the first</td></tr>
     * <tr><td>rename:colony</td><td>ask for a new name for our colony</td></tr>
     * <tr><td>colony:id, settlement:id</td><td>open the settlement's panel</td></tr>
     * <tr><td>leaveTown:unit, leaveShip:unit, board:unit,ship</td><td>as the colony panel's moves</td></tr>
     * <tr><td>work:unit,location,goods</td><td>put the colonist to work making the goods</td></tr>
     * <tr><td>buy:ship,goods, sell:ship,goods</td><td>trade goods between a ship in Europe and the market</td></tr>
     * <tr><td>load:ship,goods, unload:ship,goods,amount, unloadAll:ship</td><td>move goods between a ship and the warehouse</td></tr>
     * </table>
     * A load, unload, buy or sell entry with ",ask" added asks how many to move (a shift-click).
     *
     * @param entry The entry's id.
     * @return True if it did something.
     */
    public boolean menuEntry(String entry) {
        final int colon = entry.indexOf(':');
        final String verb = colon < 0 ? entry : entry.substring(0, colon);
        String args = colon < 0 ? "" : entry.substring(colon + 1);
        // A shift-click on a goods entry has ",ask" added: the player is asked how many.
        final boolean ask = args.endsWith(",ask");
        if (ask) args = args.substring(0, args.length() - ",ask".length());
        final String rest = args;
        final String[] a = rest.split(",");
        switch (verb) {
        case "goto": return goTo(Integer.parseInt(a[0]), Integer.parseInt(a[1]));
        case "attack": return attack(Integer.parseInt(a[0]), Integer.parseInt(a[1]));
        case "europe": return moveToEurope(rest);
        case "state": {
            final int c2 = rest.indexOf(':');
            return changeState(rest.substring(c2 + 1),
                Unit.UnitState.valueOf(rest.substring(0, c2)));
        }
        case "cashin": return cashIn(rest);
        case "clear": return clearOrders(rest);
        case "select": return selectUnit(rest);
        case "waiting": return selectWaiting(rest);
        case "activateAll":
            return activateAll(Integer.parseInt(a[0]), Integer.parseInt(a[1]));
        case "colony": return showColony(rest);
        case "rename": return renameColony(rest);
        case "settlement": return showSettlement(rest);
        case "tile": return showTile(Integer.parseInt(a[0]), Integer.parseInt(a[1]));
        case "colopedia": return showColopedia(rest);
        case "leaveTown": return putOutsideColony(rest);
        case "leaveShip": return leaveShip(rest);
        case "clearSpeciality": return clearSpeciality(rest);
        case "assign": return assignTeacher(a[0], a[1]);
        case "board": return boardShip(a[0], a[1]);
        case "work": return workAs(a[0], a[1], a[2]);
        case "role": return takeRole(a[0], a[1], Integer.parseInt(a[2]));
        case "buy": return buyGoods(a[0], a[1], ask);
        case "sell": return sellGoods(a[0], a[1], ask);
        case "load": return loadGoods(a[0], a[1], ask);
        case "unload":
            return unloadGoods(a[0], a[1], Integer.parseInt(a[2]), ask);
        case "unloadAll": return unloadAll(rest);
        default: return false;
        }
    }

    /** One of our units, by id, else null. */
    private Unit ours(String unitId) {
        final Unit unit = object(unitId, Unit.class);
        return unit != null && this.client.getMyPlayer().owns(unit) ? unit : null;
    }

    /** The active unit attacks the adjacent tile, as the arrow key toward it does. */
    private boolean attack(int x, int y) {
        final Unit unit = gui().getActiveUnit();
        final Tile target = tile(x, y);
        if (unit == null || target == null || unit.getTile() == null
            || !unit.getTile().isAdjacent(target)) return false;
        return move(unit.getTile().getDirection(target).toString());
    }

    private boolean moveToEurope(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null || !unit.canMoveToHighSeas()) return false;
        return igc().moveTo(unit, this.client.getMyPlayer().getEurope());
    }

    /** Change one of our units' state, as the menus' state entries do. */
    private boolean changeState(String unitId, Unit.UnitState state) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        if (state == Unit.UnitState.ACTIVE) {
            if (unit.getState() != Unit.UnitState.ACTIVE) {
                igc().changeState(unit, state);
            }
            gui().changeView(unit, false);
            europeAgain(unit);
            return true;
        }
        final boolean done = igc().changeState(unit, state);
        europeAgain(unit);
        return done;
    }

    private boolean cashIn(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null || !unit.canCarryTreasure()
            || !unit.canCashInTreasureTrain()) return false;
        return igc().checkCashInTreasureTrain(unit);
    }

    private boolean clearOrders(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        final boolean done = igc().clearOrders(unit);
        europeAgain(unit);
        return done;
    }

    /** Make one of our units the active one, as picking it in a tile popup does. */
    private boolean selectUnit(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        gui().changeView(unit, false);
        return true;
    }

    /** The end turn dialog's pick of a waiting unit: it becomes active, and its colony or Europe opens. */
    private boolean selectWaiting(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        ((WebGUI)gui()).selectWaiting(unit);
        return true;
    }

    /** TilePopup's "activate all units": clear the orders of the tile's units and select the first. */
    private boolean activateAll(int x, int y) {
        final Tile tile = tile(x, y);
        if (tile == null || tile.isEmpty()
            || !this.client.getMyPlayer().owns(tile.getFirstUnit())) return false;
        for (Unit u : tile.getUnitList()) {
            if (this.client.getMyPlayer().owns(u)) igc().clearOrders(u);
        }
        gui().changeView(tile.getFirstUnit(), false);
        return true;
    }

    /** TilePopup's "rename": ask for a new name for one of our colonies. */
    private boolean renameColony(String colonyId) {
        final Colony colony = object(colonyId, Colony.class);
        return colony != null && this.client.getMyPlayer().owns(colony)
            && igc().rename(colony);
    }

    private boolean showTile(int x, int y) {
        final Tile tile = this.client.getGame().getMap().getTile(x, y);
        if (tile == null || !tile.isExplored()) return false;
        gui().showTilePanel(tile);
        return true;
    }

    /**
     * Open the Colopedia on an entry (terrain, resource, goods, unit, building, founding
     * father, nation, nation type or concept); false if there is none of that id.
     */
    private boolean showColopedia(String id) {
        // A concept (the tax dialog's Help button opens the taxes article) or a spec type.
        final boolean concept = id.startsWith("colopedia.concepts.")
            && Messages.containsKey(id + ".name");
        final net.sf.freecol.common.model.FreeColSpecObjectType t =
            concept ? null : this.client.getGame().getSpecification().getType(id);
        if (!concept && !(t instanceof net.sf.freecol.common.model.TileType
            || t instanceof net.sf.freecol.common.model.ResourceType
            || t instanceof net.sf.freecol.common.model.GoodsType
            || t instanceof net.sf.freecol.common.model.UnitType
            || t instanceof net.sf.freecol.common.model.BuildingType
            || t instanceof net.sf.freecol.common.model.FoundingFather
            || t instanceof net.sf.freecol.common.model.Nation
            || t instanceof net.sf.freecol.common.model.NationType)) return false;
        gui().showColopediaPanel(id);
        return true;
    }

    private boolean showSettlement(String id) {
        final IndianSettlement is = object(id, IndianSettlement.class);
        if (is == null) return false;
        gui().showIndianSettlementPanel(is);
        return true;
    }

    /**
     * Make a colonist an ordinary one again (QuickActionMenu's "clear
     * speciality"). In Europe the panel is sent again, for the new picture.
     */
    private boolean clearSpeciality(String unitId) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        final boolean done = igc().clearSpeciality(unit);
        europeAgain(unit);
        return done;
    }

    /**
     * Send the Europe panel again after a change to a unit there: the colony
     * panels follow every command's map, but the Europe panel only this.
     */
    private void europeAgain(Unit unit) {
        if (unit.isInEurope()) gui().showEuropePanel();
    }

    /** Put a colonist to school under a teacher (QuickActionMenu's "assign to teacher"). */
    private boolean assignTeacher(String studentId, String teacherId) {
        final Unit student = ours(studentId);
        final Unit teacher = ours(teacherId);
        return student != null && teacher != null && igc().assignTeacher(student, teacher);
    }

    /**
     * Equip a unit for a role (QuickActionMenu's role entries). In Europe the
     * panel is sent again, for the unit's new picture and the gold paid.
     */
    private boolean takeRole(String unitId, String roleId, int count) {
        final Unit unit = ours(unitId);
        if (unit == null) return false;
        for (net.sf.freecol.common.model.Role r : unit.getAvailableRoles(null).collect(java.util.stream.Collectors.toList())) {
            if (!r.getId().equals(roleId)) continue;
            final boolean done = igc().equipUnitForRole(unit, r, count);
            europeAgain(unit);
            return done;
        }
        return false;
    }

    /** Put a colonist to work at a place making goods (QuickActionMenu's work entries). */
    private boolean workAs(String unitId, String locationId, String goodsTypeId) {
        final Unit unit = ours(unitId);
        final GoodsType type = goodsType(goodsTypeId);
        final WorkLocation wl = object(locationId, WorkLocation.class);
        if (unit == null || type == null || wl == null) return false;
        if (unit.getLocation() != wl && !work(unitId, locationId)) return false;
        if (unit.getLocation() != wl) return false;
        return unit.getWorkType() == type || igc().changeWorkType(unit, type);
    }

    /**
     * Unload everything a ship in port carries, as InGameController.unload
     * does in a colony: the units go ashore and the goods into the warehouse.
     */
    private boolean unloadAll(String shipId) {
        final Unit ship = shipInPort(shipId);
        if (ship == null) return false;
        boolean any = false;
        for (Unit u : new ArrayList<>(ship.getUnitList())) {
            any |= igc().leaveShip(u);
        }
        for (Goods g : new ArrayList<>(ship.getGoodsList())) {
            any |= unloadGoods(shipId, g.getType().getId(), g.getAmount(), false);
        }
        return any;
    }

    /** One of our carriers in one of our colonies, by id, else null. */
    private Unit shipInPort(String shipId) {
        final Unit ship = this.client.getMyPlayer()
            .getOurFreeColGameObject(shipId, Unit.class);
        return (ship == null || !ship.isCarrier() || ship.getColony() == null) ? null : ship;
    }

    /** One of our carriers in Europe, by id, else null. */
    private Unit shipInEurope(String shipId) {
        final Unit ship = this.client.getMyPlayer()
            .getOurFreeColGameObject(shipId, Unit.class);
        return (ship == null || !ship.isCarrier() || !ship.isInEurope()) ? null : ship;
    }

    /** The goods type with this id, else null. */
    private GoodsType goodsType(String id) {
        return this.client.getGame().getSpecification().getGoodsType(id);
    }

    /**
     * Send a ship in Europe to the New World (EuropePanel's sail button, a
     * drop on the sailing to America list). A trade route it follows is
     * cleared first, after asking. The Europe panel is sent again.
     *
     * @param shipId The id of the ship.
     * @return True if the ship set sail.
     */
    public boolean sailToNewWorld(String shipId) {
        final Player player = this.client.getMyPlayer();
        final Unit ship = player.getOurFreeColGameObject(shipId, Unit.class);
        boolean done = false;
        if (ship != null && ship.isInEurope() && ship.isNaval()
            && !ship.isDamagedAndUnderForcedRepair()
            && (ship.getTradeRoute() == null
                || (gui().confirmClearTradeRoute(ship)
                    && igc().assignTradeRoute(ship, null)))) {
            igc().moveTo(ship, this.client.getGame().getMap());
            done = !ship.isInEurope();
        }
        gui().showEuropePanel();
        return done;
    }

    /** Leave the active unit for now and select the next one (WaitAction). */
    public boolean nextUnit() {
        return igc().waitUnit();
    }

    /**
     * Declare independence (DeclareIndependenceAction): the controller
     * explains if it is not allowed yet, else asks for the new names and
     * shows the declaration, and the server hears of it when that closes.
     */
    public boolean declareIndependence() {
        return igc().declareIndependence();
    }

    /**
     * Retire from the game (RetireAction): the player is asked to confirm,
     * becomes RETIRED, tells the server, and the high scores are shown.
     *
     * @return True if the player retired.
     */
    public boolean retire() {
        this.client.retire();
        final Player me = this.client.getMyPlayer();
        return me != null && me.getPlayerType() == Player.PlayerType.RETIRED;
    }

    /** Show the high score table on request (ReportHighScoresAction). */
    public boolean showHighScores() {
        return igc().highScore(null);
    }

    /** Fortify the active unit (FortifyAction). */
    public boolean fortify() {
        return changeState(Unit.UnitState.FORTIFYING);
    }

    /** Sentry the active unit (SentryAction). */
    public boolean sentry() {
        return changeState(Unit.UnitState.SENTRY);
    }

    /**
     * Leave the active unit for this turn (SkipUnitAction): the unit is
     * done for now, and the next one is selected.
     */
    public boolean skip() {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        if (unit.getState() != Unit.UnitState.SKIPPED) {
            igc().changeState(unit, Unit.UnitState.SKIPPED);
        }
        if (unit.getState() == Unit.UnitState.SKIPPED) {
            return igc().nextActiveUnit();
        }
        return false;
    }

    /**
     * Disband the active unit (DisbandUnitAction), which asks the player
     * to confirm it first.
     */
    public boolean disband() {
        return igc().disbandUnit(gui().getActiveUnit());
    }

    /**
     * Send the active unit to a destination (GotoAction): the player is
     * asked where it goes, and the unit sails there.
     *
     * The order is named after the controller method it calls, as
     * {@code goto} is a Java keyword and {@code goTo} is already the
     * order that sends the unit to a tile of the map.
     *
     * @return True if the unit set off.
     */
    public boolean selectDestination() {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        return igc().selectDestination(unit);
    }

    /** Change the active unit's state, as FortifyAction and SentryAction do. */
    private boolean changeState(Unit.UnitState state) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        return igc().changeState(unit, state);
    }

    /** Plow the active unit's tile (the plow ImprovementAction). */
    public boolean plow() {
        return improve("model.improvement.plow");
    }

    /**
     * Clear the forest on the active unit's tile (the clearForest
     * ImprovementAction).
     */
    public boolean clearForest() {
        return improve("model.improvement.clearForest");
    }

    /** Build a road on the active unit's tile (the road ImprovementAction). */
    public boolean road() {
        return improve("model.improvement.road");
    }

    /** Work the active unit's tile, as ImprovementAction does. */
    private boolean improve(String id) {
        final Unit unit = gui().getActiveUnit();
        if (unit == null) return false;
        final TileImprovementType type = this.client.getGame()
            .getSpecification().getTileImprovementType(id);
        if (type == null) return false;
        return igc().changeWorkImprovementType(unit, type);
    }

    /** Found a colony with the active unit (BuildColonyAction). */
    public boolean buildColony() {
        return igc().buildColony(gui().getActiveUnit());
    }

    /**
     * Put a colonist to work at a building or on a colony tile, as dropping
     * its label there in ColonyPanel does: the controller claims the tile
     * if needed, the unit takes the work the location suits it for best,
     * and a location that cannot take it is explained, as Swing explains it.
     *
     * @param unitId The id of one of our units, in the colony or beside it.
     * @param locationId The id of the building or colony tile.
     * @return True if the unit now works there.
     */
    public boolean work(String unitId, String locationId) {
        final Unit unit = object(unitId, Unit.class);
        final WorkLocation wl = object(locationId, WorkLocation.class);
        final Player player = this.client.getMyPlayer();
        if (unit == null || wl == null || !player.owns(unit)
            || wl.getColony() == null || !player.owns(wl.getColony())) return false;
        if (unit.getLocation() == wl) return false;
        final NoAddReason reason = wl.getNoAddReason(unit);
        if (reason != NoAddReason.NONE && reason != NoAddReason.CLAIM_REQUIRED) {
            gui().showInformationPanel(wl, StringTemplate.template(noAddKey(wl, reason)));
            return false;
        }
        final GoodsType workType = wl.getWorkFor(unit);
        igc().work(unit, wl);
        if (unit.getLocation() != wl) return false;
        // The server may have changed the unit's work, as it may upgrade it.
        if (workType != null && workType != unit.getWorkType()) {
            igc().changeWorkType(unit, workType);
        }
        warnIfNotBestTile(unit, wl);
        return true;
    }

    /**
     * The message key that says why a location cannot take a unit.
     * ColonyTile.getNoWorkReason folds a tile that cannot be claimed, such
     * as one with a lost city rumour or unsettleable terrain, into
     * MISSING_ABILITY, whose words are about docks; such a land tile is
     * explained by why it cannot be claimed instead.
     */
    private String noAddKey(WorkLocation wl, NoAddReason reason) {
        if (reason == NoAddReason.MISSING_ABILITY && wl instanceof ColonyTile) {
            final Tile tile = ((ColonyTile)wl).getWorkTile();
            if (tile.isLand() || wl.getColony().hasAbility(Ability.PRODUCE_IN_WATER)) {
                final Player.NoClaimReason claim = wl.getOwner().canClaimForSettlementReason(tile);
                if (claim != Player.NoClaimReason.NONE) return claim.getDescriptionKey();
            }
        }
        return reason.getDescriptionKey();
    }

    /** The better work location last warned about, so a warning is not repeated (ColonyPanel.bestLocation). */
    private WorkLocation lastBest = null;

    /**
     * Warn when a colonist put on a colony tile would make more of its goods
     * on another, as ColonyPanel's tile does when the not best tile client
     * option is on.
     */
    private void warnIfNotBestTile(Unit unit, WorkLocation wl) {
        final GoodsType workType = unit.getWorkType();
        if (!(wl instanceof ColonyTile) || workType == null
            || !this.client.getClientOptions().getBoolean(ClientOptions.SHOW_NOT_BEST_TILE)) return;
        final WorkLocation best = wl.getColony().getWorkLocationFor(unit, workType);
        if (best == null || best == wl
            || wl.getPotentialProduction(workType, unit.getType())
                >= best.getPotentialProduction(workType, unit.getType())) return;
        if (best == this.lastBest) return;
        this.lastBest = best;
        gui().showInformationPanel(best, StringTemplate.template("colonyPanel.notBestTile")
            .addStringTemplate("%unit%", unit.getLabel(Unit.UnitLabelType.NATIONAL))
            .addNamed("%goods%", workType)
            .addStringTemplate("%tile%", best.getLabel()));
    }

    /**
     * Equip a colonist of the colony with the role the goods dropped on it
     * give, as dropping goods of the warehouse on its label does
     * (DefaultTransferHandler.equipUnitIfPossible): the first role it can
     * take whose only requirement is these goods, as many times as the
     * warehouse's stock allows. Missionaries are not equipped.
     *
     * @param unitId The id of one of our units in the colony or beside it.
     * @param goodsTypeId The id of the goods type dropped.
     * @return True if the unit was equipped.
     */
    public boolean equip(String unitId, String goodsTypeId) {
        final Unit unit = object(unitId, Unit.class);
        final Player player = this.client.getMyPlayer();
        if (unit == null || !player.owns(unit)) return false;
        final Colony colony = unit.getColony() != null ? unit.getColony()
            : (unit.getTile() == null) ? null : unit.getTile().getColony();
        final GoodsType type = this.client.getGame().getSpecification().getGoodsType(goodsTypeId);
        if (colony == null || type == null || !player.owns(colony)) return false;
        if (!unit.hasAbility(Ability.CAN_BE_EQUIPPED)
            || unit.getRole().hasAbility(Ability.ESTABLISH_MISSION)) return false;
        final int stock = colony.getGoodsCount(type);
        for (Role role : (Iterable<Role>)unit.getAvailableRoles(null)::iterator) {
            if (role.isDefaultRole()) continue;
            final List<AbstractGoods> required = unit.getGoodsDifference(role, 1);
            int count;
            if (required.size() == 1 && required.get(0).getType() == type
                && (count = Math.min(role.getMaximumCount(),
                        stock / required.get(0).getAmount())) > 0
                && (role != unit.getRole() || count != unit.getRoleCount())) {
                return igc().equipUnitForRole(unit, role, count);
            }
        }
        return false;
    }

    /**
     * Put a colonist outside the colony, on its tile (the outside colony
     * panel, as ColonyPanel.OutsideColonyPanel.add does).
     *
     * @param unitId The id of one of our units working in a colony.
     * @return True if the unit is now on the colony's tile.
     */
    public boolean putOutsideColony(String unitId) {
        final Unit unit = object(unitId, Unit.class);
        if (unit == null || !this.client.getMyPlayer().owns(unit)
            || !(unit.getLocation() instanceof WorkLocation)) return false;
        return igc().putOutsideColony(unit);
    }

    /**
     * Change what a colonist produces where it works.
     *
     * @param unitId The id of one of our units working in a colony.
     * @param goodsTypeId The id of the goods type to produce.
     * @return True if the unit now produces it.
     */
    public boolean changeWorkType(String unitId, String goodsTypeId) {
        final Unit unit = object(unitId, Unit.class);
        final GoodsType type = this.client.getGame().getSpecification()
            .getGoodsType(goodsTypeId);
        if (unit == null || type == null || !this.client.getMyPlayer().owns(unit)
            || !(unit.getLocation() instanceof WorkLocation)) return false;
        return igc().changeWorkType(unit, type);
    }

    /**
     * Set a colony's build queue, as the build queue panel's OK does. A
     * queue with something the colony cannot build there is explained and
     * not set, but what depended on a buildable the queue drops is dropped
     * with it.
     *
     * @param colonyId The id of one of our colonies.
     * @param typeIds The ids of the buildings and units to build, in order.
     * @return True if the colony's build queue is now this.
     */
    public boolean setBuildQueue(String colonyId, List<String> typeIds) {
        final Colony colony = object(colonyId, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        final List<BuildableType> wanted = new ArrayList<>();
        for (String id : typeIds) {
            final Object type = this.client.getGame().getSpecification().getType(id);
            if (!(type instanceof BuildableType)) return false;
            wanted.add((BuildableType)type);
        }
        // Taking out a prerequisite takes out what depended on it, as Swing's panel does.
        final List<BuildableType> queue = BuildQueues.pruned(colony, wanted);
        final String problem = BuildQueues.problem(colony, queue);
        if (problem != null) {
            gui().showInformationPanel(null, StringTemplate.name(problem));
            return false;
        }
        return igc().setBuildQueue(colony, queue);
    }

    /**
     * Pay for what the colony is building now (the build queue panel's buy
     * button), once the player confirms the price.
     *
     * @param colonyId The id of one of our colonies.
     * @return True if the building was paid for.
     */
    public boolean payForBuilding(String colonyId) {
        final Colony colony = object(colonyId, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        return igc().payForBuilding(colony);
    }

    /**
     * Close the colony panel (its close button), as
     * ColonyPanel.closeColonyPanel does: a colony of ours with no colonist
     * left asks whether to abandon it, and one with fewer colonists than
     * what it builds now needs asks whether to close anyway. On no the
     * panel stays open; otherwise the Browser UI is told to close it, and
     * the colony is abandoned on yes (InGameController.closeColony).
     *
     * @param colonyId The id of the colony whose panel is closed.
     * @return True if the panel was closed.
     */
    public boolean closeColonyPanel(String colonyId) {
        final Colony colony = object(colonyId, Colony.class);
        final Player player = this.client.getMyPlayer();
        boolean abandon = false;
        if (colony != null && player.owns(colony)) {
            final BuildableType buildable;
            if (colony.getUnitCount() == 0) {
                final String key = (player.isRebel()
                    && player.getNumberOfPorts() == 1
                    && colony.isConnectedPort())
                    ? "abandonColony.lastPort.text"
                    : "abandonColony.text";
                if (!gui().modalConfirmDialog(null, StringTemplate.key(key), colony,
                        "abandonColony.yes", "abandonColony.no")) return false;
                abandon = true;
            } else if ((buildable = colony.getCurrentlyBuilding()) != null) {
                final int required = buildable.getRequiredPopulation();
                if (required > colony.getUnitCount()
                    && !gui().modalConfirmDialog(null, StringTemplate
                        .template("colonyPanel.reducePopulation")
                            .addName("%colony%", colony.getName())
                            .addAmount("%number%", required)
                            .addNamed("%buildable%", buildable),
                        colony, "ok", "cancel")) return false;
            }
        }
        if (gui() instanceof WebGUI) ((WebGUI)gui()).closeColonyPanel(colonyId);
        if (colony != null) igc().closeColony(colony, abandon);
        return true;
    }

    /**
     * Set a colony's export data for one goods type, as the warehouse dialog
     * saves it, and send it to the server. The levels are the dialog's: the
     * low and high warnings 0 to 100 (percent of the capacity), the import
     * and export levels up to the warehouse's capacity (300 for goods that
     * ignore it). Only a colony with a custom house can export. A colony
     * with the enhanced trade routes option off has no import level, which
     * stays as it is.
     *
     * @param colonyId The id of one of our colonies.
     * @param goodsTypeId The id of a storable goods type.
     * @param exported Whether the goods are exported.
     * @param low The low level warning, in percent.
     * @param high The high level warning, in percent.
     * @param importLevel The import level, or -1 to leave it.
     * @param exportLevel The export level.
     * @return True if the server has the levels.
     */
    public boolean setGoodsLevels(String colonyId, String goodsTypeId, boolean exported,
                                  int low, int high, int importLevel, int exportLevel) {
        final Colony colony = object(colonyId, Colony.class);
        final GoodsType type = this.client.getGame().getSpecification().getGoodsType(goodsTypeId);
        if (colony == null || type == null || !this.client.getMyPlayer().owns(colony)
            || !type.isStorable()) return false;
        final int max = Warehouses.maxLevel(colony, type);
        if (low < 0 || low > 100 || high < 0 || high > 100
            || exportLevel < 0 || exportLevel > max
            || importLevel < -1 || importLevel > max) return false;
        if (exported && !colony.hasAbility(Ability.EXPORT)) return false;
        final ExportData data = colony.getExportData(type);
        data.setExported(exported);
        data.setLowLevel(low);
        data.setHighLevel(high);
        if (importLevel >= 0) data.setImportLevel(importLevel);
        data.setExportLevel(exportLevel);
        return igc().setGoodsLevels(colony, type);
    }

    /**
     * Open the warehouse dialog of one of our colonies (the colony panel's
     * warehouse button).
     *
     * @param colonyId The id of one of our colonies.
     * @return True if the dialog was opened.
     */
    public boolean warehouse(String colonyId) {
        final Colony colony = object(colonyId, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        gui().showWarehouseDialog(colony, updated -> {});
        return true;
    }

    /** The game object with this id, if it is of the class. */
    private <T extends FreeColGameObject> T object(String id, Class<T> type) {
        return this.client.getGame().getFreeColGameObject(id, type);
    }

    /**
     * End the turn (EndTurnAction), asking first if units still wait for
     * orders and the client options say to.
     *
     * @return True if the turn was ours to end.
     */
    public boolean endTurn() {
        if (!this.client.currentPlayerIsMyPlayer()) return false;
        igc().endTurn(true);
        return true;
    }

    /** Open the trade routes panel (TradeRouteAction). */
    public boolean tradeRoutes() {
        gui().showTradeRoutePanel(gui().getActiveUnit());
        return true;
    }

    /**
     * Assign a ship or wagon train to a trade route, or take it off its
     * route, as TradeRoutePanel does for the unit it was opened for. A unit
     * already on a route is asked about first. The unit follows the route
     * when its turn comes, loading and unloading as the route says.
     *
     * @param unitId The id of the unit.
     * @param routeId The id of the route, or null to drop its route.
     * @return True if the unit now has that route.
     */
    public boolean assignTradeRoute(String unitId, String routeId) {
        final Unit unit = this.client.getMyPlayer()
            .getOurFreeColGameObject(unitId, Unit.class);
        final TradeRoute route = (routeId == null) ? null : route(routeId);
        if (unit == null || !unit.isCarrier() || (routeId != null && route == null)) {
            return false;
        }
        final boolean done = igc().assignTradeRoute(unit, route);
        if (gui() instanceof WebGUI) {
            ((WebGUI)gui()).refreshActiveUnit();
        }
        refused(null);
        return done;
    }

    /**
     * Open a report of the Report menu, as its action does: colony, labour,
     * compactLabour, military, naval, cargo, religion, education, exploration,
     * history, trade, production, requirements, foreign, indian or
     * congress, or colopedia. {@link Reports} says how to
     * add one.
     *
     * @param name The report's name.
     * @return True if there is such a report.
     */
    public boolean showReport(String name) {
        switch (name) {
        case "colony": gui().showReportColonyPanel(); return true;
        case "labour":
            // ReportLabourAction: the classic or the compact report, as the client option says.
            if (this.client.getClientOptions().getInteger(ClientOptions.LABOUR_REPORT)
                == ClientOptions.LABOUR_REPORT_CLASSIC) {
                gui().showReportLabourPanel();
            } else {
                gui().showCompactLabourReport();
            }
            return true;
        case "compactLabour": gui().showCompactLabourReport(); return true;
        case "military": gui().showReportMilitaryPanel(); return true;
        case "naval": gui().showReportNavalPanel(); return true;
        case "cargo": gui().showReportCargoPanel(); return true;
        case "religion": gui().showReportReligiousPanel(); return true;
        case "education": gui().showReportEducationPanel(); return true;
        case "exploration": gui().showReportExplorationPanel(); return true;
        case "history": gui().showReportHistoryPanel(); return true;
        case "trade": gui().showReportTradePanel(); return true;
        case "production": gui().showReportProductionPanel(); return true;
        case "requirements": gui().showReportRequirementsPanel(); return true;
        case "foreign": gui().showReportForeignAffairPanel(); return true;
        case "indian": gui().showReportIndianPanel(); return true;
        case "congress": gui().showReportContinentalCongressPanel(); return true;
        case "colopedia": gui().showColopediaPanel(null); return true;
        default: return false;
        }
    }

    /**
     * Open the details a report links to: labourDetail or compactLabour
     * for a unit type (compactLabour with an empty id is for all colonists).
     *
     * @param name The report's name.
     * @param id What the details are of.
     * @return True if there is such a report and thing.
     */
    public boolean showReportDetail(String name, String id) {
        final net.sf.freecol.common.model.UnitType type = id.isEmpty() ? null
            : this.client.getGame().getSpecification().getUnitType(id);
        switch (name) {
        case "labourDetail":
            if (type == null) return false;
            gui().showReportLabourDetailPanel(type, null, null, null);
            return true;
        case "compactLabour":
            final net.sf.freecol.client.gui.panel.report.LabourData data
                = new net.sf.freecol.client.gui.panel.report.LabourData(this.client);
            gui().showCompactLabourReport((type == null) ? data.getSummary()
                                          : data.getUnitData(type));
            return true;
        default: return false;
        }
    }

    /**
     * Close a colony's panel and open the panel of the previous or next
     * colony in the player's colony order, wrapping round, as choosing
     * from ColonyPanel's name box does (its Left and Right keys). The
     * panel is closed as closeColonyPanel does, which may ask first and
     * stay open.
     *
     * @param colonyId The id of the colony whose panel is open.
     * @param by -1 for the previous colony, 1 for the next.
     * @return True if the other colony's panel was opened.
     */
    public boolean stepColony(String colonyId, int by) {
        final Colony colony = object(colonyId, Colony.class);
        final Player player = this.client.getMyPlayer();
        if (colony == null || !player.owns(colony)) return false;
        final List<Colony> colonies = player.getSortedColonies(
            this.client.getClientOptions().getColonyComparator());
        final int n = colonies.size();
        final int at = colonies.indexOf(colony);
        if (n < 2 || at < 0) return false;
        final Colony next = colonies.get(Math.floorMod(at + (by < 0 ? -1 : 1), n));
        if (!closeColonyPanel(colonyId)) return false;
        gui().showColonyPanel(next, null);
        return true;
    }

    /**
     * Open the panel of one of our colonies, as a link in a report does.
     *
     * @param id The colony's id.
     * @return True if it is ours.
     */
    public boolean showColony(String id) {
        final Colony colony = this.client.getGame()
            .getFreeColGameObject(id, Colony.class);
        if (colony == null || !this.client.getMyPlayer().owns(colony)) return false;
        gui().showColonyPanel(colony, null);
        return true;
    }

    private TradeRoute route(String id) {
        final Player player = this.client.getMyPlayer();
        for (TradeRoute tr : player.getTradeRoutes()) {
            if (tr.getId().equals(id)) return tr;
        }
        return null;
    }

    /**
     * Create a trade route, or change one, as TradeRoutePanel and
     * TradeRouteInputPanel do. The server is asked for a new route, which
     * is then given its name and stops and checked as FreeCol checks it. A
     * route that is not valid is not saved, and the reason is shown in the
     * trade routes panel, which is shown again.
     *
     * @param id The id of the route to change, or null for a new one.
     * @param name The route's name.
     * @param silent Whether it is to be silent.
     * @param places The ids of the places (Europe or a colony) of its stops.
     * @param cargo For each stop, the ids of the goods types to load there.
     * @return The reason the route was not saved, or null if it was.
     */
    public String saveTradeRoute(String id, String name, boolean silent,
                                 List<String> places,
                                 List<List<String>> cargo) {
        final TradeRoute existing = (id == null) ? null : route(id);
        if (id != null && existing == null) return refused("No such trade route.");
        final TradeRoute route = (existing != null) ? existing
            : igc().newTradeRoute(this.client.getMyPlayer());
        if (route == null) return refused("The server did not make a trade route.");
        final String why = TradeRoutes.edit(this.client, route, name, silent,
                                            places, cargo);
        // A new route that is not valid is dropped, as TradeRoutePanel drops it.
        if (why != null && existing == null) igc().deleteTradeRoute(route);
        return refused(why);
    }

    /**
     * Delete a trade route: the units that follow it stop, as
     * TradeRoutePanel's delete button does first.
     *
     * @param id The id of the route.
     * @return True if the route is gone.
     */
    public boolean deleteTradeRoute(String id) {
        final TradeRoute route = route(id);
        if (route == null) return false;
        for (Unit u : TradeRoutes.assigned(route)) igc().assignTradeRoute(u, null);
        final boolean done = igc().deleteTradeRoute(route);
        refused(null);
        return done;
    }

    /** Show the trade routes panel again with the reason a change was refused, if any; pass the reason on. */
    private String refused(String why) {
        if (gui() instanceof WebGUI) ((WebGUI)gui()).showTradeRoutes(why);
        return why;
    }
}
