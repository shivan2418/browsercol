package browsercol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.TransactionListener;


/**
 * The purchases and sales of the turn in Europe, as the transaction log of
 * FreeCol's EuropePanel words them. The client's InGameController logs a
 * trade to the market's listeners when it buys or sells goods, unloads
 * them or equips a unit in Europe (MarketWas). FreeCol clears its log
 * when the panel opens; this one keeps the whole turn and is empty again
 * once a new turn has begun.
 *
 * Each entry is the lines of one trade: what was traded at what price and
 * the total, and for a sale the tax and the net.
 */
final class SalesLog implements TransactionListener {

    private Market market = null;
    private Game game = null;
    /** The turn the entries are of. */
    private int turn = -1;
    private final List<List<String>> entries = new ArrayList<>();
    /** True while a trade is being reported that is not one (#441). */
    private final java.util.function.BooleanSupplier muted;

    SalesLog(java.util.function.BooleanSupplier muted) {
        this.muted = muted;
    }

    /**
     * Listen to the player's market, if not already: the game has started
     * or been loaded. A new market starts an empty log.
     *
     * @param player The player; may be null before a game.
     */
    synchronized void listen(Player player) {
        final Market m = (player == null) ? null : player.getMarket();
        if (m == this.market) return;
        if (this.market != null) this.market.removeTransactionListener(this);
        this.market = m;
        this.game = (player == null) ? null : player.getGame();
        this.entries.clear();
        if (m != null) m.addTransactionListener(this);
    }

    /** The entries of this turn, oldest first. */
    synchronized List<List<String>> entries() {
        sync();
        final List<List<String>> copy = new ArrayList<>();
        for (List<String> e : this.entries) copy.add(new ArrayList<>(e));
        return copy;
    }

    /** Forget the entries of an earlier turn. */
    private void sync() {
        final int now = (this.game == null || this.game.getTurn() == null)
            ? -1 : this.game.getTurn().getNumber();
        if (now != this.turn) {
            this.entries.clear();
            this.turn = now;
        }
    }

    private synchronized void add(List<String> lines) {
        sync();
        this.entries.add(lines);
    }

    // Implement TransactionListener, as EuropePanel.TransactionLog

    @Override
    public void logPurchase(GoodsType goodsType, int amount, int price) {
        add(List.of(
            Messages.message(StringTemplate
                .template("europePanel.transaction.purchase")
                .addNamed("%goods%", goodsType)
                .addAmount("%amount%", amount)
                .addAmount("%gold%", price)),
            Messages.message(StringTemplate
                .template("europePanel.transaction.price")
                .addAmount("%gold%", amount * price))));
    }

    @Override
    public void logSale(GoodsType goodsType, int amount, int price, int tax) {
        if (this.muted.getAsBoolean()) return;
        final int beforeTax = amount * price;
        final int totalTax = beforeTax * tax / 100;
        add(List.of(
            Messages.message(StringTemplate
                .template("europePanel.transaction.sale")
                .addNamed("%goods%", goodsType)
                .addAmount("%amount%", amount)
                .addAmount("%gold%", price)),
            Messages.message(StringTemplate
                .template("europePanel.transaction.price")
                .addAmount("%gold%", beforeTax)),
            Messages.message(StringTemplate
                .template("europePanel.transaction.tax")
                .addAmount("%tax%", tax)
                .addAmount("%gold%", totalTax)),
            Messages.message(StringTemplate
                .template("europePanel.transaction.net")
                .addAmount("%gold%", beforeTax - totalTax))));
    }
}
