package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;

import javax.swing.ImageIcon;

import net.sf.freecol.client.ClientOptions;
import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.gui.ChoiceItem;
import net.sf.freecol.client.gui.DialogHandler;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.client.gui.panel.FreeColPanel;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.AbstractUnit;
import net.sf.freecol.common.model.Building;
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
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.IndianNationType;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.LostCityRumour;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Modifier;
import net.sf.freecol.common.model.Monarch.MonarchAction;
import net.sf.freecol.common.model.Nameable;
import net.sf.freecol.common.model.Named;
import net.sf.freecol.common.model.NationSummary;
import net.sf.freecol.common.model.Ownable;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Turn;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.option.BooleanOption;
import net.sf.freecol.common.option.Option;
import net.sf.freecol.common.option.OptionGroup;


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
 *     <td>event information</td>
 *     <td>{text, object, tile, at, images, ok}; images are the resource
 *         keys of the object's image, best first, as ImageLibrary shows it</td></tr>
 * <tr><td>showErrorPanel(String, Runnable)</td><td>event error</td>
 *     <td>{text, ok}</td></tr>
 * <tr><td>showEventPanel(String, String, String)</td><td>event eventPanel</td>
 *     <td>{header, image, footer, ok}; image is a resource key</td></tr>
 * <tr><td>showEventPanel(String, String, String, Runnable) (defers)</td>
 *     <td>question event</td>
 *     <td>{header, image, footer, ok}; the callback runs once the player
 *         closes the panel (the first landing's tutorial message)</td></tr>
 * <tr><td>showHighScoresPanel(String, List)</td><td>event highScores</td>
 *     <td>{text, scores: [{score, headline, fields: [{label, value}]}], ok};
 *         text is the message for the key, or null; the fields are the
 *         ones ReportHighScoresPanel shows below its headline</td></tr>
 * <tr><td>showEuropePanel</td><td>event europe</td>
 *     <td>what {@link EuropeJson} describes: the ships sailing, in port
 *         and their cargo, the docks, the market's prices and the gold.
 *         Shown when the player asks (the Europe button, EuropeAction),
 *         when the end turn dialog picks a unit in Europe, and when
 *         the messages of a turn tell of a ship's arrival in Europe
 *         (after those messages)</td></tr>
 * <tr><td>showModelMessages</td><td>event messages</td>
 *     <td>{title: null, messages: [{text, type, source, tile, at,
 *         heading: null, images, filter: null, filterTip: null,
 *         ignored: false, ignoreTip: null}], ok}; tile and at are the source's, to go to;
 *         images are the resource keys of the message's display object's
 *         image, best first</td></tr>
 * <tr><td>showReportTurnPanel</td><td>event messages</td>
 *     <td>as showModelMessages, titled as the turn report, and arranged by
 *         the group by client option: unsorted, sorted by type or sorted
 *         so a source's are together, with a heading {text, tile, at} on
 *         the first of each group. Also {groupBy: {label, value, choices:
 *         [{value, text}]}, regrouped: false}, and per message the
 *         buttons ReportTurnPanel has for it: filter is whether its type
 *         is shown (null: no filter button), ignored whether the ignore
 *         button was pressed, filterTip and ignoreTip are the buttons'
 *         tooltips (null: no button). reportGroupBy,
 *         reportFilter and reportIgnore are the buttons' actions, by the
 *         message's index in the report as shown; reportGroupBy sends the
 *         report again, regrouped: true, to replace the open one</td></tr>
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
 * <tr><td>showEndTurnDialog (defers)</td><td>question endTurn</td>
 *     <td>{header, text, ok, cancel, units: [{id, name, location}]}; "ok"
 *         ends the turn, "select" and a line break and a unit's id makes
 *         that unit active, anything else keeps the turn</td></tr>
 * <tr><td>showPreCombatDialog (blocks)</td><td>question preCombat</td>
 *     <td>{attacker, defender, offence, defence: [{source, value}],
 *         finalResult (the label), offenceResult, defenceResult, ok, cancel,
 *         tile, object}; the modifiers in PreCombatDialog's order, values
 *         formatted as ModifierFormat does; "true" for ok, else
 *         cancel</td></tr>
 * <tr><td>showMonarchDialog, showNativeDemandDialog, showVictoryDialog
 *     (all defer)</td>
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
 * <tr><td>showSelectAmountDialog (blocks)</td><td>question amount</td>
 *     <td>{text, type, name, keys, values, value, max, ok, cancel}: the
 *         goods type (id, null for none) and its image's keys, the
 *         amounts SelectGoodsAmountDialog lists ({@link SelectAmount}) and
 *         the one it selects at first (null for none), and the most that
 *         may be chosen; any whole number from 0 to max may be given. The
 *         amount, else -1</td></tr>
 * <tr><td>showSelectTributeAmountDialog (blocks)</td><td>question input</td>
 *     <td>as modalInputDialog, suggesting the most; the amount, else -1</td></tr>
 * <tr><td>showColonyPanel</td><td>event colony</td>
 *     <td>the colony, as {@link ColonyJson} describes it; null for no
 *         colony sends nothing</td></tr>
 * <tr><td>showTradeRoutePanel, and each change of a route</td>
 *     <td>event tradeRoutes</td>
 *     <td>{title, routes: [{id, name, silent, units, stops: [{place, label,
 *         cargo: [goods type]}]}], places: [{id, label}], goods: [{id, name,
 *         icon}], error, and the labels of the panel's buttons}; a panel that
 *         is open is replaced. error is why the last change was refused
 *         (FreeCol's reason), null if it was not</td></tr>
 * <tr><td>showReportColonyPanel, showReportLabourPanel,
 *     showReportLabourDetailPanel, showCompactLabourReport,
 *     showReportMilitaryPanel, showReportNavalPanel, showReportCargoPanel,
 *     showReportReligiousPanel, showReportEducationPanel,
 *     showReportExplorationPanel, showReportHistoryPanel,
 *     showReportTradePanel, showReportProductionPanel,
 *     showReportRequirementsPanel</td>
 *     <td>event report</td>
 *     <td>one of the reports {@link Reports} describes, told apart by its
 *         report field; a report that is open is replaced, so a link to a
 *         detail report opens it in place</td></tr>
 * <tr><td>showIndianSettlementPanel</td><td>event indianSettlement</td>
 *     <td>{name, kind, tension, worthScouting, images, labels, missionary,
 *         skill, mostHated, wanted: [...], ok, tile, at}; as {@link SettlementJson}
 *         describes, with only what the player has learned; opened by a
 *         click on the settlement and by the controllers</td></tr>
 * <tr><td>showGameOptionsDialog, showDifficultyDialog (the in-game menu's
 *     entries)</td><td>event options</td>
 *     <td>{kind: game or difficulty, title, ok, root}: the option group
 *         as {@link OptionsJson} describes it, read-only; a panel that is
 *         open is replaced</td></tr>
 * <tr><td>the other dialogs the controllers ask (see "Not asked yet"), and
 *     the panels the base GUI drops: showClientOptionsDialog, showEditOptionDialog,
 *     showEditSettlementDialog, showFindSettlementPanel</td>
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
                } catch (RuntimeException | Error ex) {
                    logger.log(Level.WARNING,
                               "WebGUI: " + name + " failed: " + ex, ex);
                }
        }, "WebGUI-" + name).start();
    }

    /**
     * The messages event, for both the model messages and the turn report.
     * The turn report is arranged as ReportTurnPanel does by the group by
     * client option: as they come, grouped by type, or grouped by source.
     * Grouped by type the messages are sorted by type, with a heading where
     * the type changes. Grouped by source the messages of a source are
     * together, sources by kind (as FreeCol orders its classes), a source's
     * messages by type, with a heading where the source changes. The
     * report's messages also say what ReportTurnPanel's buttons do for them.
     *
     * @param regrouped The report is the one already open, arranged
     *     differently.
     */
    private void showMessages(String title, List<ModelMessage> modelMessages,
                              boolean report, boolean regrouped) {
        final Game game = getGame();
        final ClientOptions co = getClientOptions();
        final int groupBy = (report)
            ? co.getInteger(ClientOptions.MESSAGES_GROUP_BY)
            : ClientOptions.MESSAGES_GROUP_BY_NOTHING;
        final List<ModelMessage> sorted = new ArrayList<>(modelMessages);
        if (groupBy == ClientOptions.MESSAGES_GROUP_BY_SOURCE) {
            sortBySource(game, sorted);
        } else if (groupBy == ClientOptions.MESSAGES_GROUP_BY_TYPE) {
            sorted.sort(ModelMessage.messageTypeComparator);
        }
        if (report) {
            if (!regrouped) this.ignored.clear();
            this.reportMessages = new ArrayList<>(modelMessages);
            this.shownReport = sorted;
        }
        List<String> messages = new ArrayList<>();
        String sourceId = null;
        ModelMessage.MessageType type = null;
        for (int i = 0; i < sorted.size(); i++) {
            final ModelMessage m = sorted.get(i);
            final FreeColGameObject source = game.getMessageSource(m);
            String heading = null;
            if (groupBy == ClientOptions.MESSAGES_GROUP_BY_SOURCE
                && (i == 0 || !Objects.equals(sourceId, m.getSourceId()))) {
                heading = tile(new Json().put("text", headline(source)),
                               tileOf(source)).toString();
            } else if (groupBy == ClientOptions.MESSAGES_GROUP_BY_TYPE
                && (i == 0 || m.getMessageType() != type)) {
                heading = tile(new Json().put("text",
                        Messages.getName(m.getMessageType())), null).toString();
            }
            sourceId = m.getSourceId();
            type = m.getMessageType();
            final Boolean shown = filterState(co, m);
            final Json json = tile(new Json()
                .put("text", Messages.message(m))
                .put("type", m.getMessageType().toString())
                .put("source", m.getSourceId()),
                tileOf(source));
            if (heading == null) json.put("heading", (String)null);
            else json.putRaw("heading", heading);
            json.putRaw("images", ObjectImages.json(game.getMessageDisplay(m)));
            json.putRaw("filter", (!report || shown == null) ? "null"
                : shown.toString());
            json.put("filterTip", (report && shown != null)
                ? Messages.message(StringTemplate
                    .template("report.turn.filter")
                    .addNamed("%type%", m.getMessageType())) : null);
            json.put("ignored", report && ignorable(m)
                && this.ignored.contains(m.getIgnoredMessageKey()));
            json.put("ignoreTip", (report && ignorable(m))
                ? Messages.message(StringTemplate.copy("report.turn.ignore", m))
                : null);
            messages.add(json.toString());
        }
        final Json event = new Json()
            .put("title", title)
            .putRaw("messages", Json.array(messages))
            .put("ok", label("ok"));
        if (report) {
            final List<String> choices = new ArrayList<>();
            for (int value : GROUP_BY) {
                choices.add(new Json().put("value", value)
                    .put("text", Messages.message(
                            GROUP_BY_LABELS[value] + ".name")).toString());
            }
            event.putRaw("groupBy", new Json()
                .put("label", Messages.message(
                        ClientOptions.MESSAGES_GROUP_BY + ".name"))
                .put("value", groupBy)
                .putRaw("choices", Json.array(choices)).toString());
            event.put("regrouped", regrouped);
        }
        this.ui.show("messages", event.toString());
        if (!regrouped && arrivedInEurope(game, modelMessages)) {
            showEuropePanel();
        }
    }

    /** Whether a message tells that a ship has arrived in Europe. */
    private static boolean arrivedInEurope(Game game,
                                           List<ModelMessage> messages) {
        for (ModelMessage m : messages) {
            if (m.getMessageType() == ModelMessage.MessageType.UNIT_ARRIVED
                && game.getMessageSource(m) instanceof Europe) return true;
        }
        return false;
    }

    /** The values of the group by option, and the labels of their choices. */
    private static final int[] GROUP_BY = {
        ClientOptions.MESSAGES_GROUP_BY_NOTHING,
        ClientOptions.MESSAGES_GROUP_BY_TYPE,
        ClientOptions.MESSAGES_GROUP_BY_SOURCE };
    private static final String[] GROUP_BY_LABELS = {
        "clientOptions.messages.guiMessagesGroupBy.nothing",
        "clientOptions.messages.guiMessagesGroupBy.type",
        "clientOptions.messages.guiMessagesGroupBy.source" };

    /** The turn report as FreeCol sent it, and in the order last shown. */
    private volatile List<ModelMessage> reportMessages = new ArrayList<>();
    private volatile List<ModelMessage> shownReport = new ArrayList<>();
    /**
     * The ignored messages of the open report, by ignored message key, as
     * the report's own buttons set them: the report shows them dimmed, as
     * Swing's buttons disable the message, and regrouping keeps them so.
     */
    private final Set<String> ignored = new java.util.HashSet<>();

    /**
     * Whether the message's type is shown, or null if it has no filter
     * option, as ReportTurnPanel decides to add its filter button.
     */
    private static Boolean filterState(ClientOptions co, ModelMessage m) {
        final String key = m.getOptionName();
        return (key != null && co.hasOption(key, BooleanOption.class))
            ? co.getBoolean(key) : null;
    }

    /** Whether ReportTurnPanel offers to ignore the message: only some types. */
    private static boolean ignorable(ModelMessage m) {
        return m.getMessageType() == ModelMessage.MessageType.WAREHOUSE_CAPACITY;
    }

    /**
     * Change how the turn report groups its messages, as the group by client
     * option does, and show the report again in that arrangement.
     *
     * @param value One of ClientOptions.MESSAGES_GROUP_BY_*.
     */
    public void reportGroupBy(int value) {
        for (int v : GROUP_BY) {
            if (v != value) continue;
            getClientOptions().setInteger(ClientOptions.MESSAGES_GROUP_BY, value);
            showMessages(Messages.message("reportTurnAction.name"),
                         this.reportMessages, true, true);
            return;
        }
    }

    /**
     * Show or filter out a message's type, as ReportTurnPanel's filter
     * button does: the type's client option, which the next turn's
     * messages are checked against.
     *
     * @param index The message's place in the report as shown.
     * @param shown Whether the type's messages are shown.
     */
    public void reportFilter(int index, boolean shown) {
        final List<ModelMessage> report = this.shownReport;
        if (index < 0 || index >= report.size()) return;
        final ClientOptions co = getClientOptions();
        final ModelMessage m = report.get(index);
        if (filterState(co, m) != null) co.setBoolean(m.getOptionName(), shown);
    }

    /**
     * Ignore a message from now on until it is not generated in a turn, or
     * stop ignoring it, as ReportTurnPanel's ignore button does.
     *
     * @param index The message's place in the report as shown.
     * @param ignore Whether to ignore it.
     */
    public void reportIgnore(int index, boolean ignore) {
        final List<ModelMessage> report = this.shownReport;
        if (index < 0 || index >= report.size()) return;
        final ModelMessage m = report.get(index);
        if (ignorable(m)) {
            getFreeColClient().getInGameController().ignoreMessage(m, ignore);
            if (ignore) this.ignored.add(m.getIgnoredMessageKey());
            else this.ignored.remove(m.getIgnoredMessageKey());
        }
    }

    /**
     * Sort messages so that a source's are together, as ReportTurnPanel
     * gets by sorting with ModelMessage.getSourceComparator, whose ties
     * between sources of one kind it leaves unordered. Sources go by kind,
     * then as they first appear; a source's messages by type.
     */
    private static void sortBySource(Game game, List<ModelMessage> messages) {
        final List<String> order = new ArrayList<>();
        for (ModelMessage m : messages) {
            if (!order.contains(m.getSourceId())) order.add(m.getSourceId());
        }
        messages.sort((m1, m2) -> {
                final int kind = FreeColObject.getObjectClassIndex(
                        game.getMessageSource(m1))
                    - FreeColObject.getObjectClassIndex(
                        game.getMessageSource(m2));
                if (kind != 0) return kind;
                final int first = order.indexOf(m1.getSourceId())
                    - order.indexOf(m2.getSourceId());
                return (first != 0) ? first
                    : ModelMessage.messageTypeComparator.compare(m1, m2);
            });
    }

    /** A message source's headline, as ReportTurnPanel's getHeadline words it. */
    private String headline(FreeColGameObject source) {
        if (source == null) return "";
        if (source instanceof Player) {
            final Player player = (Player)source;
            return Messages.message(StringTemplate
                .template("report.turn.playerNation")
                .addName("%player%", player.getName())
                .addStringTemplate("%nation%", player.getNationLabel()));
        } else if (source instanceof Europe) {
            return Messages.getName((Europe)source);
        } else if (source instanceof Market) {
            return Messages.message(((Market)source).getOwner().getMarketName());
        } else if (source instanceof Colony) {
            return ((Colony)source).getName();
        } else if (source instanceof Building) {
            return ((Building)source).getColony().getName();
        } else if (source instanceof Unit) {
            return ((Unit)source).getDescription(Unit.UnitLabelType.NATIONAL);
        } else if (source instanceof Tile) {
            return Messages.message(
                ((Tile)source).getLocationLabelFor(getMyPlayer()));
        } else if (source instanceof Named) {
            return Messages.message(((Named)source).getNameKey());
        } else if (source instanceof Nameable) {
            return ((Nameable)source).getName();
        }
        return source.toString();
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
            .putRaw("images", ObjectImages.json(displayObject))
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
     * Defers, as Swing's panel does: the Browser UI is asked with an event
     * question, and the callback runs when the player closes the panel.
     * No panel is returned for the caller to add a closing callback to:
     * a FreeColPanel is a Swing JPanel, which TeaVM cannot load (see the
     * patched InGameController.newLandName).
     */
    @Override
    public void showEventPanel(String header, String image, String footer,
                               Runnable closing) {
        defer("showEventPanel", () -> {
            this.questions.ask("event", new Json()
                .put("header", header)
                .put("image", image)
                .put("footer", footer)
                .put("ok", label("ok")).toString());
            if (closing != null) closing.run();
        });
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
        showMessages(null, modelMessages, false, false);
        return null;
    }

    @Override
    public FreeColPanel showReportTurnPanel(List<ModelMessage> messages) {
        showMessages(Messages.message("reportTurnAction.name"), messages,
                     true, false);
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
     * the turn later. This asks EndTurnDialog's question and lists the units
     * still waiting, and ok ends the turn, as its ok button does. Picking a
     * unit makes it the active one and, as Swing's selectUnit does, opens
     * its colony, or Europe (reported, not shown yet). Swing leaves the panel
     * open for that; the Browser UI's dialog covers the map, so it closes
     * and the turn goes on, as with cancel. A second end turn while the
     * question is open is dropped, as Swing's open panel stops it.
     */
    @Override
    public void showEndTurnDialog(List<Unit> units) {
        final String text = Messages.message(StringTemplate
            .template("endTurnDialog.areYouSure")
            .addAmount("%number%", units.size()));
        final String header = Messages.message("endTurnDialog.name");
        final List<String> waiting = new ArrayList<>();
        for (Unit u : units) {
            waiting.add(new Json()
                .put("id", u.getId())
                .put("name", u.getDescription(Unit.UnitLabelType.NATIONAL))
                .put("location", Messages.message(u.getLocation()
                        .getLocationLabelFor(u.getOwner())))
                .toString());
        }
        if (!this.endTurnDialogOpen.compareAndSet(false, true)) return;
        defer("showEndTurnDialog", () -> {
                try {
                    final String answer = this.questions.ask("endTurn", new Json()
                        .put("header", header)
                        .put("text", text)
                        .put("ok", label("ok"))
                        .put("cancel", label("cancel"))
                        .putRaw("units", Json.array(waiting))
                        .toString());
                    if ("ok".equals(answer)) {
                        getFreeColClient().getInGameController().endTurn(false);
                    } else if (answer != null && answer.startsWith("select\n")) {
                        selectWaiting(units, answer.substring("select\n".length()));
                    }
                } finally {
                    this.endTurnDialogOpen.set(false);
                }
            });
    }

    /** EndTurnDialog's selectUnit, for the unit with this id. */
    private void selectWaiting(List<Unit> units, String unitId) {
        for (Unit unit : units) {
            if (!unit.getId().equals(unitId)) continue;
            if (unit.isInEurope()) {
                showEuropePanel();
            } else {
                changeView(unit, false);
                if (unit.getColony() != null) {
                    showColonyPanel(unit.getColony(), unit);
                }
            }
            return;
        }
    }

    /**
     * {@inheritDoc}
     *
     * PreCombatDialog's names, the offence and defence modifiers side by
     * side in its order, and the final results. The unit and settlement
     * images are not shown.
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
        final Set<Modifier> offence
            = combat.getOffensiveModifiers(attacker, defender);
        final Set<Modifier> defence
            = combat.getDefensiveModifiers(attacker, defender);
        final String answer = this.questions.ask("preCombat", new Json()
            .put("attacker", attacker.getDescription(Unit.UnitLabelType.NATIONAL))
            .put("defender", defenderName)
            .putRaw("offence", Json.array(modifiers(offence, turn)))
            .putRaw("defence", Json.array(modifiers(defence, turn)))
            .put("finalResult", label("finalResult"))
            .put("offenceResult", decimal(
                    FeatureContainer.applyModifiers(0f, turn, offence)))
            .put("defenceResult", decimal(
                    FeatureContainer.applyModifiers(0f, turn, defence)))
            .put("ok", label("ok"))
            .put("cancel", label("cancel"))
            .put("tile", id(tile))
            .put("object", id(defender))
            .toString());
        return "true".equals(answer);
    }

    /** The modifiers as PreCombatDialog lists them, in its order. */
    private static List<String> modifiers(Set<Modifier> set, Turn turn) {
        final List<Modifier> sorted = new ArrayList<>(set);
        sorted.sort(Modifier.ascendingModifierIndexComparator);
        final List<String> lines = new ArrayList<>();
        for (Modifier m : sorted) {
            lines.add(new Json()
                .put("source", modifierSource(m.getSource()))
                .put("value", modifierValue(m, turn))
                .toString());
        }
        return lines;
    }

    /** What ModifierFormat calls the name of a modifier's source. */
    private static String modifierSource(FreeColObject source) {
        if (source == null) return Messages.message("modifierFormat.unknown");
        String name = null;
        if (source instanceof Nameable) {
            name = ((Nameable)source).getName();
            if (name != null && name.isEmpty()) name = null;
        }
        if (name == null && source instanceof Named) {
            name = Messages.getName((Named)source);
            if (name.isEmpty()) name = null;
        }
        return (name != null) ? name : Messages.getName(source.getId());
    }

    /**
     * A modifier's value as ModifierFormat shows it: a sign (or a times
     * sign for a multiplier), two decimals, and a percent sign for a
     * percentage.
     */
    private static String modifierValue(Modifier m, Turn turn) {
        final float value = m.getValue(turn);
        if (!Modifier.isFloatKnown(value)) {
            return Messages.message("modifierFormat.unknown");
        }
        final String sign = (m.getType() == Modifier.ModifierType.MULTIPLICATIVE)
            ? "\u00D7" : (value < 0) ? "-" : "+";
        return sign + decimal(Math.abs(value))
            + ((m.getType() == Modifier.ModifierType.PERCENTAGE) ? "%" : "");
    }

    /** A number with two decimals, as FreeCol's modifiers show. */
    private static String decimal(float f) {
        final boolean negative = f < 0;
        final long hundredths = Math.round(Math.abs((double)f) * 100.0);
        return ((negative && hundredths != 0) ? "-" : "")
            + (hundredths / 100) + "." + (hundredths % 100 < 10 ? "0" : "")
            + (hundredths % 100);
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

    /**
     * Show the player's trade routes, as TradeRoutePanel does: event
     * tradeRoutes, which replaces the panel if it is open.
     *
     * @param unit The unit that would be assigned a route; not yet used.
     */
    @Override
    public FreeColPanel showTradeRoutePanel(Unit unit) {
        showTradeRoutes(null);
        return null;
    }

    /**
     * Show the trade routes panel.
     *
     * @param error Why the last change to a route was refused, or null.
     */
    void showTradeRoutes(String error) {
        this.ui.show("tradeRoutes",
                     TradeRoutes.json(getFreeColClient(), error));
    }

    /**
     * {@inheritDoc}
     *
     * Shows the classic colony report ({@link Reports#colony}); the compact
     * colony report is not made, so the colony report option is not read.
     */
    @Override
    public FreeColPanel showReportColonyPanel() {
        this.ui.show("report", Reports.colony(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the labour report ({@link Reports#labour}). */
    @Override
    public FreeColPanel showReportLabourPanel() {
        this.ui.show("report", Reports.labour(getMyPlayer()));
        return null;
    }

    /**
     * {@inheritDoc}
     *
     * Shows the details ({@link Reports#labourDetail}) of the unit type,
     * counted again from the player's units, so the data is not used.
     */
    @Override
    public FreeColPanel showReportLabourDetailPanel(net.sf.freecol.common.model.UnitType unitType,
        java.util.Map<net.sf.freecol.common.model.UnitType, java.util.Map<Location, Integer>> data,
        net.sf.freecol.common.model.TypeCountMap<net.sf.freecol.common.model.UnitType> unitCount,
        List<Colony> colonies) {
        this.ui.show("report", Reports.labourDetail(getMyPlayer(), unitType));
        return null;
    }

    /** {@inheritDoc} Shows the military report ({@link Reports#units}). */
    @Override
    public FreeColPanel showReportMilitaryPanel() {
        this.ui.show("report", Reports.units(getFreeColClient(), "military"));
        return null;
    }

    /** {@inheritDoc} Shows the naval report ({@link Reports#units}). */
    @Override
    public FreeColPanel showReportNavalPanel() {
        this.ui.show("report", Reports.units(getFreeColClient(), "naval"));
        return null;
    }

    /** {@inheritDoc} Shows the cargo report ({@link Reports#units}). */
    @Override
    public FreeColPanel showReportCargoPanel() {
        this.ui.show("report", Reports.units(getFreeColClient(), "cargo"));
        return null;
    }

    /** {@inheritDoc} Shows the compact labour report ({@link Reports#compactLabour}). */
    @Override
    public FreeColPanel showCompactLabourReport() {
        this.ui.show("report", Reports.compactLabour(getFreeColClient(), null));
        return null;
    }

    /** {@inheritDoc} Shows the compact labour report of one kind of unit (all colonists for the summary). */
    @Override
    public FreeColPanel showCompactLabourReport(
        net.sf.freecol.client.gui.panel.report.LabourData.UnitData unitData) {
        this.ui.show("report", Reports.compactLabour(getFreeColClient(),
                                                     unitData.getUnitType()));
        return null;
    }

    /** {@inheritDoc} Shows the religion report ({@link Reports#religion}). */
    @Override
    public FreeColPanel showReportReligiousPanel() {
        this.ui.show("report", Reports.religion(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the education report ({@link Reports#education}). */
    @Override
    public FreeColPanel showReportEducationPanel() {
        this.ui.show("report", Reports.education(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the exploration report ({@link Reports#exploration}). */
    @Override
    public FreeColPanel showReportExplorationPanel() {
        this.ui.show("report", Reports.exploration(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the trade report ({@link Reports#trade}). */
    @Override
    public FreeColPanel showReportTradePanel() {
        this.ui.show("report", Reports.trade(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the production report ({@link Reports#production}). */
    @Override
    public FreeColPanel showReportProductionPanel() {
        this.ui.show("report", Reports.production(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the requirements report ({@link Reports#requirements}). */
    @Override
    public FreeColPanel showReportRequirementsPanel() {
        this.ui.show("report", Reports.requirements(getMyPlayer()));
        return null;
    }

    /** {@inheritDoc} Shows the history report ({@link Reports#history}). */
    @Override
    public FreeColPanel showReportHistoryPanel() {
        this.ui.show("report", Reports.history(getMyPlayer()));
        return null;
    }

    /**
     * {@inheritDoc}
     *
     * Asks as SelectGoodsAmountDialog does (see {@link SelectAmount}),
     * blocking. Paying, the most is what the player's gold buys at the
     * market's price.
     */
    @Override
    public int showSelectAmountDialog(GoodsType goodsType, int available,
                                      int defaultAmount, boolean needToPay) {
        int most = available;
        if (needToPay) {
            final Player player = getMyPlayer();
            final Market market = (player == null) ? null : player.getMarket();
            final int price = (market == null) ? 0 : market.getCostToBuy(goodsType);
            most = (price <= 0) ? 0 : Math.min(available, player.getGold() / price);
        }
        final SelectAmount.Choices choices = SelectAmount.choices(most, defaultAmount);
        final List<String> values = new ArrayList<>();
        for (Integer v : choices.values) values.add(String.valueOf(v));
        return SelectAmount.amount(this.questions.ask("amount", new Json()
            .put("text", Messages.message("selectAmountDialog.text"))
            .put("type", id(goodsType))
            .put("name", (goodsType == null) ? null : Messages.getName(goodsType))
            .putRaw("keys", (goodsType == null) ? "[]" : ObjectImages.json(goodsType))
            .putRaw("values", Json.array(values))
            .putRaw("value", (choices.selected == null) ? "null"
                : String.valueOf(choices.selected))
            .put("max", most)
            .put("ok", label("ok"))
            .put("cancel", label("cancel"))
            .toString()), most);
    }

    // Not asked yet: reported, then the base GUI's default.

    @Override
    public void showWarehouseDialog(Colony colony,
                                    DialogHandler<Boolean> handler) {
        unasked("showWarehouseDialog");
        super.showWarehouseDialog(colony, handler);
    }

    /**
     * {@inheritDoc}
     *
     * Sends the colony, as {@link ColonyJson} describes it. The controllers
     * open it after founding a colony and for the end turn dialog's units
     * in one, and a click on our colony opens it. The Browser UI pulls it
     * again as the colony changes (ClientMain.colony). There is no Swing
     * panel to return.
     */
    @Override
    public FreeColPanel showColonyPanel(Colony colony, Unit unit) {
        if (colony != null) this.ui.show("colony", colonyJson(colony));
        return null;
    }

    /** The colony as the colony panel shows it (ColonyJson). */
    String colonyJson(Colony colony) {
        return ColonyJson.of(colony, getClientOptions()
            .getInteger(ClientOptions.MIN_NUMBER_FOR_DISPLAYING_GOODS));
    }

    /**
     * {@inheritDoc}
     *
     * Shows Europe as it is now, with what the player can recruit, train
     * and buy; Commands acts on it and sends the panel again. Cargo and
     * the market's goods are not yet offered. A player without a Europe
     * (after independence) has no panel.
     */
    @Override
    public FreeColPanel showEuropePanel() {
        final Player player = getMyPlayer();
        if (player == null || player.getEurope() == null) return null;
        this.ui.show("europe", EuropeJson.of(player, this.activeUnit));
        return null;
    }

    @Override
    public FreeColPanel showIndianSettlementPanel(IndianSettlement is) {
        final Tile tile = is.getTile();
        this.ui.show("indianSettlement", tile(SettlementJson.of(is,
                getMyPlayer()), tile)
            .put("ok", label("ok")).toString());
        return null;
    }

    /**
     * {@inheritDoc}
     *
     * Shows the game options, read-only: a game that has started has its
     * options. The editable form belongs to the start screen, before there
     * is a game, so the handler is not called.
     */
    @Override
    public void showGameOptionsDialog(boolean editable,
                                      DialogHandler<OptionGroup> dialogHandler) {
        final Game game = getGame();
        if (game == null) return;
        this.ui.show("options", OptionsJson.event("game",
            Messages.message("gameOptions.name"), game.getGameOptions(),
            Messages.message("ok")).toString());
    }

    /**
     * {@inheritDoc}
     *
     * Shows the difficulty level of the game, read-only, as above.
     */
    @Override
    public void showDifficultyDialog(Specification spec, OptionGroup group,
                                     boolean editable,
                                     DialogHandler<OptionGroup> dialogHandler) {
        this.ui.show("options", OptionsJson.event("difficulty",
            Messages.message("difficultyDialog.name") + ": " + group.getName(),
            group, Messages.message("ok")).toString());
    }

    @Override
    public void showClientOptionsDialog() {
        unasked("showClientOptionsDialog");
        super.showClientOptionsDialog();
    }

    @Override
    public boolean showEditOptionDialog(Option<?> option) {
        unasked("showEditOptionDialog");
        return super.showEditOptionDialog(option);
    }

    @Override
    public IndianSettlement showEditSettlementDialog(IndianSettlement is) {
        unasked("showEditSettlementDialog");
        return super.showEditSettlementDialog(is);
    }

    @Override
    public FreeColPanel showFindSettlementPanel() {
        unasked("showFindSettlementPanel");
        return super.showFindSettlementPanel();
    }
}
