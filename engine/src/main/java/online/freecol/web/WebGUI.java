package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;

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
import net.sf.freecol.common.model.HighScore;
import net.sf.freecol.common.model.IndianNationType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.NationSummary;
import net.sf.freecol.common.model.Ownable;
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
 * <tr><td>updateMenuBar</td><td>event refresh</td><td>{}; the status line
 *         comes with the map, so the map is sent again</td></tr>
 * <tr><td>changeView(Unit, boolean)</td><td>event activeUnit</td>
 *     <td>{unit, tile, at: [x, y], force, orders}; the orders are the
 *         ones the active unit can take now</td></tr>
 * <tr><td>changeView()</td><td>event activeUnit</td>
 *     <td>{unit: null, tile: null, at: null, force: false, orders: []}</td></tr>
 * <tr><td>updateMapControls</td><td>event activeUnit</td>
 *     <td>the active unit again, when its orders have changed</td></tr>
 * <tr><td>changeView(Tile)</td><td>event selectedTile</td>
 *     <td>{tile, at}; the active unit is kept</td></tr>
 * <tr><td>setFocus</td><td>event focus</td><td>{tile, at}</td></tr>
 * <tr><td>showInformationPanel(FreeColObject, StringTemplate)</td>
 *     <td>event information</td><td>{text, object, tile, at, ok}</td></tr>
 * <tr><td>showErrorPanel(String, Runnable)</td><td>event error</td>
 *     <td>{text, ok}</td></tr>
 * <tr><td>showEventPanel</td><td>event eventPanel</td>
 *     <td>{header, image, footer, ok}</td></tr>
 * <tr><td>showHighScoresPanel(String, List)</td><td>event highScores</td>
 *     <td>{text, scores: [{score, headline, fields: [{label, value}]}], ok};
 *         text is the message for the key, or null; the fields are the
 *         ones ReportHighScoresPanel shows below its headline</td></tr>
 * <tr><td>showModelMessages</td><td>event messages</td>
 *     <td>{title: null, messages: [{text, type, source, tile, at}], ok};
 *         tile and at are the source's, to go to</td></tr>
 * <tr><td>showReportTurnPanel</td><td>event messages</td>
 *     <td>as showModelMessages, titled as the turn report</td></tr>
 * <tr><td>modalConfirmDialog(Tile, StringTemplate, ImageIcon, ...)</td>
 *     <td>question confirm</td>
 *     <td>{text, ok, cancel, defaultOk, tile, object, header};
 *         "true" for ok, else cancel; the header is the Swing dialog's, null
 *         for a dialog with none</td></tr>
 * <tr><td>modalChoiceDialog(Tile, StringTemplate, ImageIcon, ...)</td>
 *     <td>question choice</td>
 *     <td>{text, cancel, tile, object,
 *         choices: [{text, enabled, ok, cancel, default}]};
 *         the chosen index, else cancel</td></tr>
 * <tr><td>showFirstContactDialog (defers)</td><td>question confirm</td>
 *     <td>as modalConfirmDialog with its header, object the native player;
 *         "false" declines, else (closed too) accepts, as in Swing</td></tr>
 * <tr><td>modalInputDialog</td><td>question input</td>
 *     <td>{text, value, ok, cancel, tile};
 *         the text entered, null to cancel</td></tr>
 * <tr><td>showNamingDialog (defers)</td><td>question input</td>
 *     <td>as modalInputDialog; the handler gets the answer</td></tr>
 * <tr><td>showConfirmDeclarationDialog (blocks)</td><td>question names</td>
 *     <td>{text, fields: [{label, value}], ok, cancel}, the nation's then
 *         the country's name; the answers joined by a line break, null to
 *         cancel</td></tr>
 * <tr><td>showDeclarationPanel (defers)</td><td>question confirm</td>
 *     <td>{text, ok} with no cancel; the callback runs when it is closed</td></tr>
 * <tr><td>showChooseFoundingFatherDialog, showEmigrationDialog (defer)</td>
 *     <td>question choice</td><td>as modalChoiceDialog, no cancel</td></tr>
 * <tr><td>showSelectDestinationDialog</td><td>question choice</td>
 *     <td>as modalChoiceDialog, one choice per destination, as
 *         SelectDestinationDialog lists them; the chosen destination,
 *         else null, which cancels the move</td></tr>
 * <tr><td>showMonarchDialog, showNativeDemandDialog, showVictoryDialog,
 *     showEndTurnDialog (all defer), showPreCombatDialog (blocks)</td>
 *     <td>question confirm</td>
 *     <td>as modalConfirmDialog, with the Swing dialog's header, text and
 *         buttons; a closed dialog cancels</td></tr>
 * <tr><td>showCaptureGoodsDialog, showDumpCargoDialog (defer)</td>
 *     <td>question goods</td>
 *     <td>{text, ok, cancel, max, object, goods: [{id, type, name, amount,
 *         icon, label, checked}]}, icon being the goods type's resource
 *         key; the chosen indexes as a JSON array, at most max of them,
 *         null for a closed dialog. The handler gets the chosen goods,
 *         an empty list for cancel or closed, as Swing's dialogs give</td></tr>
 * <tr><td>showNegotiationDialog (defers)</td><td>question negotiation</td>
 *     <td>the question {@link Negotiation} describes; the answer is its
 *         lines, and the handler gets the agreement, null for a closed
 *         dialog</td></tr>
 * <tr><td>showSelectTributeAmountDialog (blocks)</td><td>question input</td>
 *     <td>as modalInputDialog, suggesting the most; the amount, else -1</td></tr>
 * <tr><td>the other dialogs the controllers ask (see "Not asked yet")</td>
 *     <td>event unasked</td><td>{method}; the controller gets the base
 *         GUI's default, as before</td></tr>
 * </table>
 *
 * <h2>Which dialogs block and which defer</h2>
 *
 * A dialog either blocks the controller until the player answers, or
 * defers: the call returns at once, the question is asked on a thread of
 * its own, and the controller's handler runs there with the answer. The
 * rule is Swing's. A dialog Swing shows non-modally, answering through a
 * {@code DialogHandler}, defers. A dialog Swing shows modally, returning
 * the answer from the call, blocks.
 *
 * The reason is the thread the controller runs on. The server sends each
 * update as a request and waits for its reply, for
 * {@code Connection.DEFAULT_REPLY_TIMEOUT} (30 s), and the
 * {@link PostMessageConnection} sends that reply when the client's message
 * handler returns. The handlers behind firstContactHandler,
 * monarchActionHandler, indianDemandHandler, newLandNameHandler,
 * newRegionNameHandler, chooseFoundingFatherHandler, fountainOfYouthHandler
 * and gameEndedHandler ask their dialog through {@code invokeLater}, which
 * here runs at once on that handler thread (in Swing it moves to the event
 * thread). Blocking there would hold the server's thread, in the middle of
 * whatever sent the update, until the player answered, and fail the send
 * after 30 s. The player's answer would then reach the server as a command
 * on top of a half-finished one. Deferring releases the server at once, as
 * in Swing. Emigration is also asked from the updates of a new turn, so it
 * defers too.
 *
 * <table>
 * <caption>Blocks or defers, as Swing does</caption>
 * <tr><th>Dialog</th><th>Swing</th><th>Here</th></tr>
 * <tr><td>showFirstContactDialog, showMonarchDialog,
 *     showNativeDemandDialog, showVictoryDialog,
 *     showChooseFoundingFatherDialog, showNamingDialog,
 *     showEmigrationDialog, showEndTurnDialog, showCaptureGoodsDialog,
 *     showDumpCargoDialog, showDeclarationPanel</td>
 *     <td>non-modal: a panel, or a dialog shown later, with a handler
 *         or callback (capture goods and dump cargo: DialogCallback;
 *         the declaration panel: showFreeColPanel and a closing
 *         callback)</td>
 *     <td>defer</td></tr>
 * <tr><td>showNegotiationDialog</td>
 *     <td>non-modal: showFreeColPanel, with a handler</td>
 *     <td>defer</td></tr>
 * <tr><td>showWarehouseDialog (not asked yet)</td>
 *     <td>non-modal</td><td>defer, when asked</td></tr>
 * <tr><td>modalConfirmDialog, modalChoiceDialog, modalInputDialog,
 *     showPreCombatDialog, showSelectDestinationDialog,
 *     showSelectAmountDialog, showSelectTributeAmountDialog,
 *     showConfirmDeclarationDialog</td>
 *     <td>modal: the answer is the return value</td><td>block</td></tr>
 * </table>
 *
 * The blocking dialogs are asked by the player's own commands, never from
 * a message handler, so they hold nothing but that command. A dialog that
 * defers has not answered when its call returns. While an end turn dialog
 * waits for its answer another is not asked, as Swing's open panel stops
 * another end turn. The negotiation dialog (#52) defers: its handler's
 * answer is what {@code askServer().diplomacy} sends the server.
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
    /** An end turn dialog has been asked and not yet answered. */
    private final AtomicBoolean endTurnDialogOpen = new AtomicBoolean(false);
    /** The orders last sent with the active unit event. */
    private List<String> lastOrders = new ArrayList<>();


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
    private String confirm(String header, String text, String okKey,
                           String cancelKey, boolean defaultOk, Tile tile,
                           String object) {
        return this.questions.ask("confirm", new Json()
            .put("text", text)
            .put("ok", label(okKey))
            .put("cancel", label(cancelKey))
            .put("defaultOk", defaultOk)
            .put("tile", id(tile))
            .put("object", object)
            .put("header", header)
            .toString());
    }

    /** Ask a confirm question; true for ok, false for cancel or closed. */
    private boolean confirmed(String header, String text, String okKey,
                              String cancelKey, boolean defaultOk, Tile tile,
                              String object) {
        return "true".equals(confirm(header, text, okKey, cancelKey,
                                     defaultOk, tile, object));
    }

    /**
     * Report a dialog the Browser UI cannot show yet. The caller then
     * does what the base GUI does, so the controller gets its default.
     */
    private void unasked(String method) {
        logger.warning("WebGUI: no dialog yet for " + method);
        this.ui.show("unasked", new Json().put("method", method).toString());
    }

    /**
     * Run a dialog's question and handler on a thread of its own, so the
     * controller returns at once, as it does when Swing shows the dialog
     * later. The dialogs that defer are listed in the class comment.
     */
    private void defer(String name, Runnable task) {
        new Thread(() -> {
                try {
                    task.run();
                } catch (RuntimeException ex) {
                    logger.log(Level.WARNING,
                               "WebGUI: " + name + " failed: " + ex, ex);
                }
        }, "WebGUI-" + name).start();
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
        sendRefresh();
    }

    /**
     * {@inheritDoc}
     *
     * The Swing GUI repaints its menu bar, whose status line shows the
     * player's score, gold, tax and the year. The Browser UI's status
     * line comes with the map, so a refresh makes it up to date, as when
     * the gold changes in the middle of a turn.
     */
    @Override
    public void updateMenuBar() {
        sendRefresh();
    }

    /** The refresh event: the Browser UI pulls the map again. */
    private void sendRefresh() {
        this.ui.show("refresh", new Json().toString());
    }

    @Override
    public Unit getActiveUnit() {
        return this.activeUnit;
    }

    @Override
    public void changeView(Unit unit, boolean force) {
        this.activeUnit = unit;
        showActiveUnit(force);
    }

    /** Send the active unit event, with the orders the unit can take now. */
    private void showActiveUnit(boolean force) {
        final List<String> orders = orders(this.activeUnit);
        this.lastOrders = orders;
        this.ui.show("activeUnit", tile(new Json().put("unit", id(this.activeUnit)),
                (this.activeUnit == null) ? null : this.activeUnit.getTile())
            .put("force", force)
            .putRaw("orders", Json.array(orders))
            .toString());
    }

    /** The orders the unit can take now, as UnitOrders works them out. */
    private List<String> orders(Unit unit) {
        final List<String> names = UnitOrders.valid(
            getFreeColClient().getMyPlayer(), unit);
        final List<String> json = new ArrayList<>();
        for (String name : names) json.add(Json.quote(name));
        return json;
    }

    /**
     * {@inheritDoc}
     *
     * The Swing GUI updates the order buttons here, so the Browser UI
     * needs the orders again whenever they have changed, as they do when
     * the unit's state changes and it stays the active one.
     */
    @Override
    public void updateMapControls() {
        if (orders(this.activeUnit).equals(this.lastOrders)) return;
        showActiveUnit(false);
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

    /**
     * {@inheritDoc}
     *
     * The entries as ReportHighScoresPanel lists them. The server may have
     * no scores file to read (it sends null then): that shows as no entries.
     */
    @Override
    public FreeColPanel showHighScoresPanel(String messageId,
                                            List<HighScore> scores) {
        List<String> entries = new ArrayList<>();
        if (scores != null) {
            for (HighScore h : scores) entries.add(highScore(h));
        }
        this.ui.show("highScores", new Json()
            .put("text", label(messageId))
            .putRaw("scores", Json.array(entries))
            .put("ok", label("ok")).toString());
        return null;
    }

    private static String highScore(HighScore h) {
        final boolean independent = h.getIndependenceTurn() > 0;
        final String headline = Messages.message(StringTemplate
            .template(independent ? "report.highScores.president"
                                  : "report.highScores.governor")
            .addName("%name%", h.getPlayerName())
            .addName("%nation%", Objects.toString(h.getNewLandName(), "")));
        final String nation = Messages.message(independent
            ? StringTemplate.name(h.getNationName())
            : StringTemplate.key(h.getOldNationNameKey()));
        final List<String> fields = new ArrayList<>();
        fields.add(field("report.highScores.turn", turnOrNone(
            h.getRetirementTurn(), "notApplicable")));
        fields.add(field("report.highScores.score",
            String.valueOf(h.getScore())));
        fields.add(field("report.highScores.difficulty",
            Messages.message(Messages.nameKey(h.getDifficulty()))));
        fields.add(field("report.highScores.independence", turnOrNone(
            h.getIndependenceTurn(), "no")));
        fields.add(field("report.highScores.nation", nation));
        fields.add(field("report.highScores.nationType",
            Messages.message(Messages.nameKey(h.getNationTypeId()))));
        fields.add(field("report.highScores.units",
            String.valueOf(h.getUnitCount())));
        fields.add(field("report.highScores.colonies",
            String.valueOf(h.getColonyCount())));
        fields.add(field("report.highScores.retired", h.getDateString()));
        return new Json().put("score", h.getScore())
            .put("headline", headline)
            .putRaw("fields", Json.array(fields)).toString();
    }

    private static String turnOrNone(int turn, String noneKey) {
        return (turn <= 0) ? Messages.message(noneKey)
            : Messages.message(Turn.getTurnLabel(turn));
    }

    private static String field(String labelKey, String value) {
        return new Json().put("label", Messages.message(labelKey))
            .put("value", value).toString();
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
        return confirmed(null, Messages.message(template), okKey, cancelKey,
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
     * Defers (Swing shows a panel). The server holds the end of turn until
     * this is answered, so it must not be dropped as the base GUI does,
     * and it is asked from a message handler, so it must not block it.
     */
    @Override
    public void showFirstContactDialog(Player player, Player other, Tile tile,
                                       int settlementCount,
                                       DialogHandler<Boolean> handler) {
        final String type = ((IndianNationType)other.getNationType())
            .getSettlementTypeKey(true);
        String headerKey = "firstContactDialog.meeting."
            + other.getNation().getSuffix();
        if (!Messages.containsKey(headerKey)) {
            headerKey = "firstContactDialog.meeting.natives";
        }
        final String header = Messages.message(headerKey);
        final String text = Messages.message(StringTemplate
                .template((tile != null) ? "firstContactDialog.welcomeOffer.text"
                    : "firstContactDialog.welcomeSimple.text")
                .addStringTemplate("%nation%", other.getNationLabel())
                .addName("%camps%", Integer.toString(settlementCount))
                .add("%settlementType%", type));
        defer("showFirstContactDialog", () -> handler.handle(!"false".equals(
            confirm(header, text, "yes", "no", true, tile, id(other)))));
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

    /** {@inheritDoc} Defers: Swing's input dialog is a panel with a handler. */
    @Override
    public void showNamingDialog(StringTemplate template, String defaultName,
                                 Unit unit, DialogHandler<String> handler) {
        final Tile tile = unit.getTile();
        defer("showNamingDialog", () -> handler.handle(
            modalInputDialog(tile, template, defaultName, "ok", "cancel")));
    }

    /**
     * {@inheritDoc}
     *
     * Defers. One item per father, as Swing's tabs; there is no cancel,
     * and a closed dialog postpones the choice, as the controller expects.
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
        defer("showChooseFoundingFatherDialog", () -> handler.handle(
            modalChoiceDialog(
                StringTemplate.key("chooseFoundingFatherDialog.title"),
                null, choices)));
    }

    /**
     * {@inheritDoc}
     *
     * Defers. One item per recruitable unit, as Swing's buttons, answering its
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
        final StringTemplate question = text;
        defer("showEmigrationDialog", () -> {
                Integer chosen;
                do {
                    chosen = modalChoiceDialog(question, null, choices);
                } while (chosen == null);
                handler.handle(chosen);
            });
    }

    /** {@inheritDoc} Defers. The text and buttons are MonarchDialog's. */
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
        String headerKey = action.getHeaderKey();
        if (!Messages.containsKey(headerKey)) headerKey = "monarchDialog.default";
        final String header = Messages.message(headerKey);
        final String yes = yesId;
        final String no = noId;
        defer("showMonarchDialog", () -> handler.handle(
            confirmed(header, text, yes, no, false, null, null)));
    }

    /** {@inheritDoc} Defers. The text and buttons are NativeDemandDialog's. */
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
        final String text = Messages.message(template);
        final String header = Messages.message(StringTemplate
            .template("nativeDemandDialog.name")
            .addName("%colony%", colony.getName()));
        defer("showNativeDemandDialog", () -> handler.handle(confirmed(header, text,
                (key.equals("food")) ? "indianDemand.food.yes" : "accept",
                "indianDemand." + key + ".no", false,
                colony.getTile(), id(colony))));
    }

    /** {@inheritDoc} Defers. The text and buttons are VictoryDialog's. */
    @Override
    public void showVictoryDialog(DialogHandler<Boolean> handler) {
        defer("showVictoryDialog", () -> handler.handle(
            confirmed(null, Messages.message("victory.text"),
                "victory.yes", "victory.continue", false, null, null)));
    }

    /**
     * {@inheritDoc}
     *
     * Defers: Swing shows EndTurnDialog as a panel, and its ok button ends
     * the turn later. This asks EndTurnDialog's question, without its list
     * of waiting units, and ok ends the turn, as its ok button does. A
     * second end turn while the question is open is dropped, as Swing's
     * open panel stops it.
     */
    @Override
    public void showEndTurnDialog(List<Unit> units) {
        final String text = Messages.message(StringTemplate
            .template("endTurnDialog.areYouSure")
            .addAmount("%number%", units.size()));
        final String header = Messages.message("endTurnDialog.name");
        if (!this.endTurnDialogOpen.compareAndSet(false, true)) return;
        defer("showEndTurnDialog", () -> {
                try {
                    if (confirmed(header, text, "ok", "cancel", true, null, null)) {
                        getFreeColClient().getInGameController().endTurn(false);
                    }
                } finally {
                    this.endTurnDialogOpen.set(false);
                }
            });
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
        return confirmed(null, text, "ok", "cancel", false, tile, id(defender));
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


    /**
     * Ask a goods question: which of some goods to take.
     *
     * @return The chosen goods, in the order picked; none for a closed dialog.
     */
    private List<Goods> pickGoods(String text, List<Goods> goods, int max,
                                  boolean checked, Unit unit) {
        final List<String> lots = new ArrayList<>();
        for (Goods g : goods) {
            lots.add(new Json()
                .put("id", g.getType().getId())
                .put("type", g.getType().getId())
                .put("name", Messages.getName(g.getType()))
                .put("amount", g.getAmount())
                .put("icon", "image.icon." + g.getType().getId())
                .put("label", Messages.message(g.getLabel(true)))
                .put("checked", checked)
                .toString());
        }
        final String answer = this.questions.ask("goods", new Json()
            .put("text", text)
            .put("ok", label("ok"))
            .put("cancel", label("cancel"))
            .put("max", max)
            .put("object", id(unit))
            .putRaw("goods", Json.array(lots))
            .toString());
        final List<Goods> chosen = new ArrayList<>();
        if (answer == null) return chosen;
        final String body = answer.replaceAll("[\\[\\]\\s]", "");
        if (body.isEmpty()) return chosen;
        final List<Integer> seen = new ArrayList<>();
        for (String part : body.split(",")) {
            final int i;
            try {
                i = Integer.parseInt(part);
            } catch (NumberFormatException nfe) {
                continue;
            }
            if (i < 0 || i >= goods.size() || seen.contains(i)) continue;
            if (chosen.size() >= max) break;
            seen.add(i);
            chosen.add(goods.get(i));
        }
        return chosen;
    }

    /**
     * {@inheritDoc}
     *
     * Asks for the two names, as ConfirmDeclarationDialog does: the
     * nation first, then the country. The nation is cleaned as Swing
     * cleans it, being used in a save file name. The flag is not asked.
     */
    @Override
    public List<String> showConfirmDeclarationDialog() {
        final Player player = getMyPlayer();
        final String nation = Messages.message(StringTemplate
            .template("confirmDeclarationDialog.defaultNation")
            .addStringTemplate("%nation%", player.getNationLabel()));
        final String country = Messages.message(StringTemplate
            .template("confirmDeclarationDialog.defaultCountry")
            .addStringTemplate("%nation%", player.getNationLabel()));
        final String answer = this.questions.ask("names", new Json()
            .put("text", Messages.message(StringTemplate
                .template("confirmDeclarationDialog.areYouSure.text")
                .addNamed("%monarch%", player.getMonarch())))
            .putRaw("fields", Json.array(List.of(
                new Json().put("label", label("confirmDeclarationDialog.enterNation"))
                    .put("value", nation).toString(),
                new Json().put("label", label("confirmDeclarationDialog.enterCountry"))
                    .put("value", country).toString())))
            .put("ok", label("confirmDeclarationDialog.areYouSure.yes"))
            .put("cancel", label("confirmDeclarationDialog.areYouSure.no"))
            .toString());
        if (answer == null) return null;
        // The names are separated by a line break, which a field has none of.
        final String[] names = answer.split("\n", -1);
        if (names.length != 2) return null;
        return List.of(names[0].replaceAll("[^\\s\\w]", ""), names[1]);
    }

    /**
     * {@inheritDoc}
     *
     * Defers, as Swing shows DeclarationPanel without waiting. Asks the
     * declaration's resolution as a confirm with only an ok button, then
     * runs the callback, as DeclarationPanel does on closing. The animated
     * signature is not shown.
     */
    @Override
    public void showDeclarationPanel(Runnable afterClosing) {
        defer("showDeclarationPanel", () -> {
                this.questions.ask("confirm", new Json()
                    .put("text", Messages.message("declareIndependence.resolution"))
                    .put("ok", label("ok"))
                    .put("cancel", (String)null)
                    .put("defaultOk", true)
                    .put("tile", (String)null)
                    .put("object", (String)null)
                    .put("header", (String)null)
                    .toString());
                afterClosing.run();
            });
    }


    /**
     * {@inheritDoc}
     *
     * CaptureGoodsDialog: none are checked at first, at most the winner's
     * free holds can be; a closed dialog gives an empty list, as Swing's.
     */
    @Override
    public void showCaptureGoodsDialog(Unit unit, List<Goods> gl,
                                       DialogHandler<List<Goods>> handler) {
        final int space = unit.getSpaceLeft();
        defer("showCaptureGoodsDialog", () -> handler.handle(
            pickGoods(Messages.message("captureGoodsDialog.title"),
                      gl, space, false, unit)));
    }

    /**
     * {@inheritDoc}
     *
     * DumpCargoDialog: all the unit's goods are checked at first, with no
     * limit; cancel or closed gives an empty list.
     */
    @Override
    public void showDumpCargoDialog(Unit unit,
                                    DialogHandler<List<Goods>> handler) {
        final List<Goods> cargo = unit.getGoodsList();
        defer("showDumpCargoDialog", () -> handler.handle(
            pickGoods(Messages.message("dumpCargo"), cargo,
                      cargo.size(), true, unit)));
    }

    /**
     * {@inheritDoc}
     *
     * Defers (Swing shows a panel): it is asked from the message handler of
     * a diplomatic offer, whose handler's answer is what the controller
     * sends the server. A closed dialog gives the handler null, which the
     * controllers take as a rejection. See {@link Negotiation}.
     */
    @Override
    public void showNegotiationDialog(FreeColGameObject our,
                                      FreeColGameObject other,
                                      DiplomaticTrade agreement,
                                      StringTemplate comment,
                                      DialogHandler<DiplomaticTrade> handler) {
        final Player player = getMyPlayer();
        defer("showNegotiationDialog", () -> {
                final Player otherPlayer = ((Ownable)other).getOwner();
                final NationSummary ns = getFreeColClient()
                    .getInGameController().nationSummary(otherPlayer);
                final Negotiation negotiation = new Negotiation(player, our,
                    other, agreement, comment,
                    (ns == null) ? Player.GOLD_NOT_ACCOUNTED : ns.getGold());
                handler.handle(negotiation.answer(
                    this.questions.ask("negotiation", negotiation.question())));
            });
    }

    /**
     * {@inheritDoc}
     *
     * Blocks (Swing's is a modal input dialog), asked by the player's own
     * demand. The amount suggested is the most there is. Cancel, and
     * anything that is not a whole number from 1 to the most, is -1, as
     * the base GUI gives; Swing's dialog would throw on those.
     */
    @Override
    public int showSelectTributeAmountDialog(StringTemplate question,
                                             int maximum) {
        final String answer = modalInputDialog(null, question,
            Integer.toString(maximum), "ok", "cancel");
        if (answer == null) return -1;
        try {
            final int amount = Integer.parseInt(answer.trim());
            return (amount <= 0 || amount > maximum) ? -1 : amount;
        } catch (NumberFormatException nfe) {
            return -1;
        }
    }

    // Not asked yet: reported, then the base GUI's default.

    @Override
    public int showSelectAmountDialog(GoodsType goodsType, int available,
                                      int defaultAmount, boolean needToPay) {
        unasked("showSelectAmountDialog");
        return super.showSelectAmountDialog(goodsType, available,
                                            defaultAmount, needToPay);
    }

    @Override
    public void showWarehouseDialog(Colony colony,
                                    DialogHandler<Boolean> handler) {
        unasked("showWarehouseDialog");
        super.showWarehouseDialog(colony, handler);
    }
}
