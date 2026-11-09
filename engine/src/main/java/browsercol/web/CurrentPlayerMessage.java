package browsercol.web;

import javax.xml.stream.XMLStreamException;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.FreeColException;
import net.sf.freecol.common.io.FreeColXMLReader;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.networking.SetCurrentPlayerMessage;

/**
 * The server's setCurrentPlayer, read by the client: FreeCol's handling, and the page told whose turn it is
 * (WebGUI.currentPlayer), as FreeCol's own GUI has no call for an AI player's turn starting, and
 * at the start of ours the Go To steps into settlements that waited for it (WebGUI.ourTurnStarted).
 */
final class CurrentPlayerMessage extends SetCurrentPlayerMessage {

    CurrentPlayerMessage(Game game, FreeColXMLReader xr) throws XMLStreamException {
        super(game, xr);
    }

    @Override
    public void clientHandler(FreeColClient freeColClient) throws FreeColException {
        final Player player = getPlayer(freeColClient.getGame());
        if (player != null && freeColClient.getGUI() instanceof WebGUI) {
            ((WebGUI) freeColClient.getGUI()).currentPlayer(player);
        }
        super.clientHandler(freeColClient);
        if (player != null && player.equals(freeColClient.getMyPlayer())
            && freeColClient.getGUI() instanceof WebGUI) {
            ((WebGUI) freeColClient.getGUI()).ourTurnStarted();
        }
    }
}
