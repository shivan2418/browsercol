package online.freecol.web;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.client.gui.GUI;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;


/**
 * Stub WebGUI: FreeCol's no-op headless GUI, plus what a game needs to run
 * without a player at the controls. It runs the controllers' deferred work
 * at once (the base GUI drops it) and tells the {@link ClientEngine} when
 * the game starts and when the map view would refresh. It does not show
 * the start panel: its return type, FreeColPanel, is a Swing JPanel, which
 * TeaVM cannot load, so the ClientEngine launches the game itself.
 */
public class WebGUI extends GUI {

    private final ClientEngine engine;

    public WebGUI(FreeColClient freeColClient, ClientEngine engine) {
        super(freeColClient);
        this.engine = engine;
    }

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
        this.engine.gameStarted();
    }

    @Override
    public void refresh() {
        this.engine.checkTurn();
    }
}
