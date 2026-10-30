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
import net.sf.freecol.common.model.FreeColObject;
import net.sf.freecol.common.model.IndianNationType;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * FreeCol's {@code GUI} for the Browser UI. The client controllers call it
 * as they would the Swing GUI, and it turns each call into an event (show,
 * returns at once) or a question (ask, waits for the player's answer).
 * Payloads are JSON objects, with text already localized and game objects
 * as FreeCol ids. Answers come back as strings, null for a closed dialog.
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
 *     <td>event information</td><td>{text, object}</td></tr>
 * <tr><td>showErrorPanel(String, Runnable)</td><td>event error</td>
 *     <td>{text}</td></tr>
 * <tr><td>showEventPanel</td><td>event eventPanel</td>
 *     <td>{header, image, footer}</td></tr>
 * <tr><td>showModelMessages</td><td>event messages</td>
 *     <td>{messages: [{text, type, source}]}</td></tr>
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
        return json.put("tile", id(tile)).putRaw("at", (tile == null) ? "null"
            : "[" + tile.getX() + "," + tile.getY() + "]");
    }

    /** The localized text for a message key, or null for no key. */
    private static String label(String key) {
        return (key == null) ? null : Messages.message(key);
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
        this.ui.show("information", new Json()
            .put("text", Messages.message(template))
            .put("object", id(displayObject))
            .toString());
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
        this.ui.show("error", new Json().put("text", message).toString());
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
            .toString());
        return null;
    }

    @Override
    public FreeColPanel showModelMessages(List<ModelMessage> modelMessages) {
        List<String> messages = new ArrayList<>();
        for (ModelMessage m : modelMessages) {
            messages.add(new Json()
                .put("text", Messages.message(m))
                .put("type", m.getMessageType().toString())
                .put("source", m.getSourceId())
                .toString());
        }
        this.ui.show("messages", new Json()
            .putRaw("messages", Json.array(messages)).toString());
        return null;
    }

    @Override
    public boolean modalConfirmDialog(Tile tile, StringTemplate template,
                                      ImageIcon icon, String okKey,
                                      String cancelKey, boolean defaultOk) {
        return "true".equals(this.questions.ask("confirm", new Json()
            .put("text", Messages.message(template))
            .put("ok", label(okKey))
            .put("cancel", label(cancelKey))
            .put("defaultOk", defaultOk)
            .put("tile", id(tile))
            .put("object", id(icon))
            .toString()));
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
        final String answer = this.questions.ask("confirm", new Json()
            .put("text", Messages.message(StringTemplate
                .template((tile != null) ? "firstContactDialog.welcomeOffer.text"
                    : "firstContactDialog.welcomeSimple.text")
                .addStringTemplate("%nation%", other.getNationLabel())
                .addName("%camps%", Integer.toString(settlementCount))
                .add("%settlementType%", type)))
            .put("ok", label("yes"))
            .put("cancel", label("no"))
            .put("defaultOk", true)
            .put("tile", id(tile))
            .put("object", id(other))
            .toString());
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
}
