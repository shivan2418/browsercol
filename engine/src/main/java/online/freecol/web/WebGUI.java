package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import javax.swing.ImageIcon;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.gui.ChoiceItem;
import net.sf.freecol.client.gui.DialogHandler;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.client.gui.panel.FreeColPanel;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.CombatModel;
import net.sf.freecol.common.model.DiplomaticTrade;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.FeatureContainer;
import net.sf.freecol.common.model.FoundingFather;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.FreeColObject;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianNationType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Unit;


/**
 * FreeCol's {@code GUI} for the Browser UI. The client controllers call it
 * as they would the Swing GUI, and it turns each call into an event (show,
 * returns at once) or a question (ask, waits for the player's answer).
 * Payloads are JSON objects, with text already localized, button labels
 * included (ok: the label of a panel's close button), and game objects as
 * FreeCol ids. Answers come back as strings, null for a closed dialog.
 *
 * <table>
 * <caption>The GUI methods overridden, and what they send</caption>
 * <tr><th>GUI method</th><th>Sends</th><th>Payload; answer</th></tr>
 * <tr><td>invokeNowOrLater, invokeNowOrWait</td><td>nothing</td>
 *     <td>runs the task at once</td></tr>
 * <tr><td>playSound</td><td>nothing</td><td>no audio</td></tr>
 * <tr><td>reconnectGUI</td><td>events activeUnit or selectedTile, focus</td>
 *     <td>as SwingGUI: the active unit, else the fallback tile, then the
 *         focus on its tile; tells the ClientEngine the game started</td></tr>
 * <tr><td>getActiveUnit</td><td>nothing</td><td>the kept active unit</td></tr>
 * <tr><td>dialogIcon (browser: hook)</td><td>nothing</td>
 *     <td>an icon carrying the object, for a question's object id</td></tr>
 * <tr><td>refresh</td><td>event refresh</td><td>{}</td></tr>
 * <tr><td>changeView(Unit, boolean)</td><td>event activeUnit</td>
 *     <td>{unit, tile, at: [x, y], force}</td></tr>
 * <tr><td>changeView()</td><td>event activeUnit</td>
 *     <td>{unit: null, tile: null, at: null, force: false}</td></tr>
 * <tr><td>changeView(Tile)</td><td>event selectedTile</td>
 *     <td>{tile, at}; the active unit is kept</td></tr>
 * <tr><td>setFocus</td><td>event focus</td><td>{tile, at}</td></tr>
 * <tr><td>showInformationPanel(FreeColObject, StringTemplate)</td>
 *     <td>event information</td><td>{text, object, tile, at, ok}</td></tr>
 * <tr><td>showErrorPanel(String, Runnable)</td><td>event error</td>
 *     <td>{text, ok}</td></tr>
 * <tr><td>showEventPanel</td><td>event eventPanel</td>
 *     <td>{header, image, footer, ok}</td></tr>
 * <tr><td>showModelMessages</td><td>event messages</td>
 *     <td>{title: null, messages: [{text, type, source, tile, at}], ok};
 *         tile and at are the source's, to go to</td></tr>
 * <tr><td>showReportTurnPanel</td><td>event messages</td>
 *     <td>as showModelMessages, titled as the turn report</td></tr>
 * <tr><td>modalConfirmDialog(Tile, StringTemplate, ImageIcon, ...)</td>
 *     <td>question confirm</td>
 *     <td>{text, ok, cancel, defaultOk, tile, object};
 *         "true" for ok, else cancel</td></tr>
 * <tr><td>modalChoiceDialog(Tile, StringTemplate, ImageIcon, ...)</td>
 *     <td>question choice</td>
 *     <td>{text, cancel, tile, object,
 *         choices: [{text, enabled, ok, cancel, default}]};
 *         the chosen index, else cancel</td></tr>
 * <tr><td>showFirstContactDialog</td><td>question confirm</td>
 *     <td>as modalConfirmDialog, object the native player;
 *         "false" declines, else (closed too) accepts, as in Swing</td></tr>
 * <tr><td>modalInputDialog</td><td>question input</td>
 *     <td>{text, value, ok, cancel, tile};
 *         the text entered, null to cancel</td></tr>
 * <tr><td>showNamingDialog</td><td>question input</td>
 *     <td>as modalInputDialog; the handler gets the answer</td></tr>
 * <tr><td>showChooseFoundingFatherDialog, showEmigrationDialog</td>
 *     <td>question choice</td><td>as modalChoiceDialog, no cancel</td></tr>
 * <tr><td>showSelectDestinationDialog</td><td>question choice</td>
 *     <td>as modalChoiceDialog, one choice per destination, as
 *         SelectDestinationDialog lists them; the chosen destination,
 *         else null, which cancels the move</td></tr>
 * <tr><td>showMonarchDialog, showNativeDemandDialog, showVictoryDialog,
 *     showEndTurnDialog, showPreCombatDialog</td><td>question confirm</td>
 *     <td>as modalConfirmDialog, with the Swing dialog's text and
 *         buttons; a closed dialog cancels</td></tr>
 * <tr><td>the other dialogs the controllers ask (see "Not asked yet")</td>
 *     <td>event unasked</td><td>{method}; the controller gets the base
 *         GUI's default, as before</td></tr>
 * </table>
 *
 * It also runs the controllers' deferred work at once (the base GUI drops
 * it), keeps the active unit, and tells the {@link ClientEngine} when the
 * game starts and when the map view refreshes. It does not show the start
 * panel: its return type, FreeColPanel, is a Swing JPanel, which TeaVM
 * cannot load, so the ClientEngine launches the game itself.
 */
public class WebGUI extends GUI {

    /** The Browser UI, as the WebGUI sees it. Neither call may block. */
    public interface BrowserUI {
        /** Show something; nothing comes back. */
        void show(String kind, String json);
        /** Ask something; the answer comes back through {@link WebGUI#answer}. */
        void ask(int id, String kind, String json);
    }

    /**
     * The icon of a dialog about a game object. It carries the object, so
     * a question can name it to the Browser UI.
     */
    private static final class ObjectIcon extends ImageIcon {
        final FreeColObject display;

        ObjectIcon(FreeColObject display) {
            this.display = display;
        }
    }

    private final ClientEngine engine;
    private final BrowserUI ui;
    private final Questions questions;
    private volatile Unit activeUnit = null;


    public WebGUI(FreeColClient freeColClient, ClientEngine engine, BrowserUI ui) {
        super(freeColClient);
        this.engine = engine;
        this.ui = ui;
        this.questions = new Questions(ui::ask);
    }

    /**
     * Accept the Browser UI's answer to a question.
     *
     * @param id The question's id.
     * @param answer The answer, or null if the player closed the dialog.
     */
    public void answer(int id, String answer) {
        this.questions.answer(id, answer);
    }

    private static String id(FreeColObject object) {
        return (object == null) ? null : object.getId();
    }

    private static String id(ImageIcon icon) {
        return (icon instanceof ObjectIcon) ? id(((ObjectIcon)icon).display) : null;
    }

    /** A tile as its id and, for the Browser UI's map, its [x, y]. */
    private static Json tile(Json json, Tile tile) {
        return json.put("tile", id(tile)).putRaw("at", MapJson.xy(tile));
    }

    /** The localized text for a message key, or null for no key. */
    private static String label(String key) {
        return (key == null) ? null : Messages.message(key);
    }

    /** The tile of a game object that has one, else null. */
    private static Tile tileOf(FreeColObject object) {
        return (object instanceof Location) ? ((Location)object).getTile()
            : null;
    }

    /**
     * Ask a confirm question.
     *
     * @return The raw answer: "true" for ok, else cancel or closed.
     */
    private String confirm(String text, String okKey, String cancelKey,
                           boolean defaultOk, Tile tile, String object) {
        return this.questions.ask("confirm", new Json()
            .put("text", text)
            .put("ok", label(okKey))
            .put("cancel", label(cancelKey))
            .put("defaultOk", defaultOk)
            .put("tile", id(tile))
            .put("object", object)
            .toString());
    }

    /** Ask a confirm question; true for ok, false for cancel or closed. */
    private boolean confirmed(String text, String okKey, String cancelKey,
                              boolean defaultOk, Tile tile, String object) {
        return "true".equals(confirm(text, okKey, cancelKey, defaultOk,
                                     tile, object));
    }

    /**
     * Report a dialog the Browser UI cannot show yet. The caller then
     * does what the base GUI does, so the controller gets its default.
     */
    private void unasked(String method) {
        logger.warning("WebGUI: no dialog yet for " + method);
        this.ui.show("unasked", new Json().put("method", method).toString());
    }

    /** The messages event, for both the model messages and the turn report. */
    private void showMessages(String title, List<ModelMessage> modelMessages) {
        final Game game = getGame();
        List<String> messages = new ArrayList<>();
        for (ModelMessage m : modelMessages) {
            messages.add(tile(new Json()
                .put("text", Messages.message(m))
                .put("type", m.getMessageType().toString())
                .put("source", m.getSourceId()),
                tileOf(game.getMessageSource(m))).toString());
        }
        this.ui.show("messages", new Json()
            .put("title", title)
            .putRaw("messages", Json.array(messages))
            .put("ok", label("ok")).toString());
    }


    // Override GUI

    @Override
    public void invokeNowOrLater(Runnable runnable) {
        runnable.run();
    }

    @Override
    public void invokeNowOrWait(Runnable runnable) {
        runnable.run();
    }

    @Override
    public void playSound(String sound) {
        // No audio in the browser slice.
    }

    @Override
    public void reconnectGUI(Unit active, Tile tile) {
        if (active != null) {
            changeView(active, false);
            if (active.hasTile()) {
                tile = active.getTile();
            } else if (active.getOwner().getFallbackTile() != null) {
                tile = active.getOwner().getFallbackTile();
                changeView(tile);
            }
        } else if (tile != null) {
            changeView(tile);
        } else {
            changeView((Unit)null, false);
        }
        if (tile != null) setFocus(tile);
        this.engine.gameStarted();
    }

    @Override
    public void refresh() {
        this.engine.checkTurn();
        this.ui.show("refresh", new Json().toString());
    }

    @Override
    public Unit getActiveUnit() {
        return this.activeUnit;
    }

    @Override
    public void changeView(Unit unit, boolean force) {
        this.activeUnit = unit;
        this.ui.show("activeUnit", tile(new Json().put("unit", id(unit)),
                (unit == null) ? null : unit.getTile())
            .put("force", force).toString());
    }

    /**
     * {@inheritDoc}
     *
     * Terrain mode: a tile is selected, and the active unit is kept, as
     * in SwingGUI, to come back to.
     */
    @Override
    public void changeView(Tile tile) {
        this.ui.show("selectedTile", tile(new Json(), tile).toString());
    }

    @Override
    public void setFocus(Tile tile) {
        this.ui.show("focus", tile(new Json(), tile).toString());
    }

    /**
     * {@inheritDoc}
     *
     * End-turn mode: no active unit, as in SwingGUI. The controllers rely
     * on it, e.g. ending a turn stops while a unit is active.
     */
    @Override
    public void changeView() {
        changeView(null, false);
    }

    @Override
    protected ImageIcon dialogIcon(FreeColObject display) {
        return new ObjectIcon(display);
    }

    @Override
    public FreeColPanel showInformationPanel(FreeColObject displayObject,
                                             StringTemplate template) {
        this.ui.show("information", tile(new Json()
            .put("text", Messages.message(template))
            .put("object", id(displayObject)), tileOf(displayObject))
            .put("ok", label("ok")).toString());
        return null;
    }

    /**
     * {@inheritDoc}
     *
     * The callback runs at once: FreeCol's own callbacks return to the
     * main panel, which the WebGUI does not have.
     */
    @Override
    public FreeColPanel showErrorPanel(String message, Runnable callback) {
        this.ui.show("error", new Json().put("text", message)
            .put("ok", label("ok")).toString());
        if (callback != null) callback.run();
        return null;
    }

    @Override
    public FreeColPanel showEventPanel(String header, String image,
                                       String footer) {
        this.ui.show("eventPanel", new Json()
            .put("header", header)
            .put("image", image)
            .put("footer", footer)
            .put("ok", label("ok")).toString());
        return null;
    }

    @Override
    public FreeColPanel showModelMessages(List<ModelMessage> modelMessages) {
        showMessages(null, modelMessages);
        return null;
    }

    @Override
    public FreeColPanel showReportTurnPanel(List<ModelMessage> messages) {
        showMessages(Messages.message("reportTurnAction.name"), messages);
        return null;
    }

    @Override
    public boolean modalConfirmDialog(Tile tile, StringTemplate template,
                                      ImageIcon icon, String okKey,
                                      String cancelKey, boolean defaultOk) {
        return confirmed(Messages.message(template), okKey, cancelKey,
                         defaultOk, tile, id(icon));
    }

    @Override
    protected <T> T modalChoiceDialog(Tile tile, StringTemplate template,
                                      ImageIcon icon, String cancelKey,
                                      List<ChoiceItem<T>> choices) {
        List<String> items = new ArrayList<>();
        for (ChoiceItem<T> c : choices) {
            items.add(new Json()
                .put("text", c.toString())
                .put("enabled", c.isEnabled())
                .put("ok", c.isOK())
                .put("cancel", c.isCancel())
                .put("default", c.isDefault())
                .toString());
        }
        String answer = this.questions.ask("choice", new Json()
            .put("text", Messages.message(template))
            .put("cancel", label(cancelKey))
            .put("tile", id(tile))
            .put("object", id(icon))
            .putRaw("choices", Json.array(items))
            .toString());
        int i;
        try {
            i = (answer == null) ? -1 : Integer.parseInt(answer);
        } catch (NumberFormatException nfe) {
            i = -1;
        }
        return (i < 0 || i >= choices.size() || !choices.get(i).isEnabled())
            ? null : choices.get(i).getObject();
    }

    /**
     * {@inheritDoc}
     *
     * The server holds the end of turn until this is answered, so it must
     * not be dropped as the base GUI does.
     */
    @Override
    public void showFirstContactDialog(Player player, Player other, Tile tile,
                                       int settlementCount,
                                       DialogHandler<Boolean> handler) {
        final String type = ((IndianNationType)other.getNationType())
            .getSettlementTypeKey(true);
        final String answer = confirm(Messages.message(StringTemplate
                .template((tile != null) ? "firstContactDialog.welcomeOffer.text"
                    : "firstContactDialog.welcomeSimple.text")
                .addStringTemplate("%nation%", other.getNationLabel())
                .addName("%camps%", Integer.toString(settlementCount))
                .add("%settlementType%", type)),
            "yes", "no", true, tile, id(other));
        handler.handle(!"false".equals(answer));
    }

    @Override
    public String modalInputDialog(Tile tile, StringTemplate template,
                                   String defaultValue, String okKey,
                                   String cancelKey) {
        return this.questions.ask("input", new Json()
            .put("text", Messages.message(template))
            .put("value", defaultValue)
            .put("ok", label(okKey))
            .put("cancel", label(cancelKey))
            .put("tile", id(tile))
            .toString());
    }

    @Override
    public void showNamingDialog(StringTemplate template, String defaultName,
                                 Unit unit, DialogHandler<String> handler) {
        handler.handle(modalInputDialog(unit.getTile(), template, defaultName,
                                        "ok", "cancel"));
    }

    /**
     * {@inheritDoc}
     *
     * One item per father, as Swing's tabs; there is no cancel, and a
     * closed dialog postpones the choice, as the controller expects.
     */
    @Override
    public void showChooseFoundingFatherDialog(List<FoundingFather> ffs,
                                               DialogHandler<FoundingFather> handler) {
        List<ChoiceItem<FoundingFather>> choices = new ArrayList<>();
        for (FoundingFather ff : ffs) {
            choices.add(new ChoiceItem<>(Messages.getName(ff) + " ("
                    + Messages.message(ff.getTypeKey()) + ")", ff));
        }
        if (!choices.isEmpty()) choices.get(0).defaultOption();
        handler.handle(modalChoiceDialog(
                StringTemplate.key("chooseFoundingFatherDialog.title"),
                null, choices));
    }

    /**
     * {@inheritDoc}
     *
     * One item per recruitable unit, as Swing's buttons, answering its
     * migrant slot. There is no cancel: Swing ignores Escape here, so a
     * closed dialog is asked again.
     */
    @Override
    public void showEmigrationDialog(Player player, boolean fountainOfYouth,
                                     DialogHandler<Integer> handler) {
        final List<AbstractUnit> recruitables
            = player.getEurope().getExpandedRecruitables(false);
        List<ChoiceItem<Integer>> choices = new ArrayList<>();
        int slot = Europe.MigrationType.getDefaultSlot();
        for (AbstractUnit au : recruitables) {
            choices.add(new ChoiceItem<>(Messages.message(au.getSingleLabel()),
                                         slot++));
        }
        StringTemplate text = StringTemplate.key("emigrationDialog.chooseImmigrant");
        if (fountainOfYouth) {
            text = StringTemplate.label("\n\n")
                .addStringTemplate(StringTemplate.key(LostCityRumour.RumourType
                        .FOUNTAIN_OF_YOUTH.getDescriptionKey()))
                .addStringTemplate(text);
        }
        Integer chosen;
        do {
            chosen = modalChoiceDialog(text, null, choices);
        } while (chosen == null);
        handler.handle(chosen);
    }

    /** {@inheritDoc} The text and buttons are MonarchDialog's. */
    @Override
    public void showMonarchDialog(MonarchAction action, StringTemplate template,
                                  String monarchKey,
                                  DialogHandler<Boolean> handler) {
        final String messageId = action.getTextKey();
        String yesId = action.getYesKey();
        if (!Messages.containsKey(yesId)) yesId = null;
        String noId = action.getNoKey();
        if (!Messages.containsKey(noId)) noId = "close";
        final String text = Messages.message((template == null)
            ? StringTemplate.key(messageId)
            : StringTemplate.copy(messageId, template));
        handler.handle(confirmed(text, yesId, noId, false, null, null));
    }

    /** {@inheritDoc} The text and buttons are NativeDemandDialog's. */
    @Override
    public void showNativeDemandDialog(Unit unit, Colony colony,
                                       GoodsType type, int amount,
                                       DialogHandler<Boolean> handler) {
        final String nation = Messages.message(unit.getOwner().getNationLabel());
        final String key = (type == null) ? "gold"
            : (type.isFoodType()) ? "food" : "other";
        StringTemplate template = StringTemplate
            .template("indianDemand." + key + ".text")
            .addName("%nation%", nation)
            .addName("%colony%", colony.getName())
            .addAmount("%amount%", amount);
        if (key.equals("other")) template = template.addNamed("%goods%", type);
        handler.handle(confirmed(Messages.message(template),
                (key.equals("food")) ? "indianDemand.food.yes" : "accept",
                "indianDemand." + key + ".no", false,
                colony.getTile(), id(colony)));
    }

    /** {@inheritDoc} The text and buttons are VictoryDialog's. */
    @Override
    public void showVictoryDialog(DialogHandler<Boolean> handler) {
        handler.handle(confirmed(Messages.message("victory.text"),
                "victory.yes", "victory.continue", false, null, null));
    }

    /**
     * {@inheritDoc}
     *
     * EndTurnDialog's question, without its list of waiting units: ok
     * ends the turn, as its ok button does.
     */
    @Override
    public void showEndTurnDialog(List<Unit> units) {
        final String text = Messages.message(StringTemplate
            .template("endTurnDialog.areYouSure")
            .addAmount("%number%", units.size()));
        if (confirmed(text, "ok", "cancel", true, null, null)) {
            getFreeColClient().getInGameController().endTurn(false);
        }
    }

    /**
     * {@inheritDoc}
     *
     * PreCombatDialog's names and final results, without the list of
     * modifiers behind them.
     */
    @Override
    public boolean showPreCombatDialog(Unit attacker,
                                       FreeColGameObject defender, Tile tile) {
        final CombatModel combat = attacker.getGame().getCombatModel();
        final Turn turn = attacker.getGame().getTurn();
        final String defenderName = (defender instanceof Settlement)
            ? ((Settlement)defender).getName()
            : (defender instanceof Unit)
            ? ((Unit)defender).getDescription(Unit.UnitLabelType.NATIONAL)
            : String.valueOf(defender);
        final float offence = FeatureContainer.applyModifiers(0f, turn,
            combat.getOffensiveModifiers(attacker, defender));
        final float defence = FeatureContainer.applyModifiers(0f, turn,
            combat.getDefensiveModifiers(attacker, defender));
        final String text = attacker.getDescription(Unit.UnitLabelType.NATIONAL)
            + " - " + defenderName + "\n" + Messages.message("finalResult")
            + ": " + decimal(offence) + " - " + decimal(defence);
        return confirmed(text, "ok", "cancel", false, tile, id(defender));
    }

    /** A number with at most one decimal, as FreeCol's modifiers show. */
    private static String decimal(float f) {
        final long tenths = Math.round(f * 10.0);
        return (tenths % 10 == 0) ? Long.toString(tenths / 10)
            : Long.toString(tenths / 10) + "." + Math.abs(tenths % 10);
    }

    /**
     * {@inheritDoc}
     *
     * The destinations of FreeCol's SelectDestinationDialog, one choice
     * each, as that dialog lists them. A closed dialog cancels the
     * move, as it does in Swing.
     */
    @Override
    public Location showSelectDestinationDialog(Unit unit) {
        if (unit == null) return null;
        final List<ChoiceItem<Location>> choices = new ArrayList<>();
        for (Destinations.Destination d : Destinations.of(unit)) {
            choices.add(new ChoiceItem<>(d.name, d.location));
        }
        if (choices.isEmpty()) return null;
        // Swing's dialog has the first destination selected.
        choices.get(0).defaultOption();
        return modalChoiceDialog(unit.getTile(),
            StringTemplate.key("selectDestinationDialog.text"),
            dialogIcon(unit), "selectDestinationDialog.cancel", choices);
    }


    // Not asked yet: reported, then the base GUI's default.

    @Override
    public void showCaptureGoodsDialog(Unit unit, List<Goods> gl,
                                       DialogHandler<List<Goods>> handler) {
        unasked("showCaptureGoodsDialog");
        super.showCaptureGoodsDialog(unit, gl, handler);
    }

    @Override
    public List<String> showConfirmDeclarationDialog() {
        unasked("showConfirmDeclarationDialog");
        return super.showConfirmDeclarationDialog();
    }

    @Override
    public void showDumpCargoDialog(Unit unit,
                                    DialogHandler<List<Goods>> handler) {
        unasked("showDumpCargoDialog");
        super.showDumpCargoDialog(unit, handler);
    }

    @Override
    public void showNegotiationDialog(FreeColGameObject our,
                                      FreeColGameObject other,
                                      DiplomaticTrade agreement,
                                      StringTemplate comment,
                                      DialogHandler<DiplomaticTrade> handler) {
        unasked("showNegotiationDialog");
        super.showNegotiationDialog(our, other, agreement, comment, handler);
    }

    @Override
    public int showSelectAmountDialog(GoodsType goodsType, int available,
                                      int defaultAmount, boolean needToPay) {
        unasked("showSelectAmountDialog");
        return super.showSelectAmountDialog(goodsType, available,
                                            defaultAmount, needToPay);
    }

    @Override
    public int showSelectTributeAmountDialog(StringTemplate question,
                                             int maximum) {
        unasked("showSelectTributeAmountDialog");
        return super.showSelectTributeAmountDialog(question, maximum);
    }

    @Override
    public void showWarehouseDialog(Colony colony,
                                    DialogHandler<Boolean> handler) {
        unasked("showWarehouseDialog");
        super.showWarehouseDialog(colony, handler);
    }
}
