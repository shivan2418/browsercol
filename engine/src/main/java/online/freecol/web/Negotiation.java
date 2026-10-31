package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.DiplomaticTrade;
import net.sf.freecol.common.model.DiplomaticTrade.TradeContext;
import net.sf.freecol.common.model.DiplomaticTrade.TradeStatus;
import net.sf.freecol.common.model.ColonyTradeItem;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.Game;
import net.sf.freecol.common.model.GoldTradeItem;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsContainer;
import net.sf.freecol.common.model.GoodsLocation;
import net.sf.freecol.common.model.GoodsTradeItem;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.InciteTradeItem;
import net.sf.freecol.common.model.Ownable;
import net.sf.freecol.common.model.Player;

import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.StanceTradeItem;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.TradeItem;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitTradeItem;


/**
 * The questions of FreeCol's negotiation dialog, for the Browser UI.
 *
 * {@code NegotiationDialog} is a Swing panel, which TeaVM cannot load, so
 * what it offers is copied here without the Swing parts: for each
 * trade context the kinds of item that can be traded and what can be
 * chosen for each (gold up to what the side has, the stances
 * {@code StanceTradeItemPanel} lists, the colonies, goods, units and
 * victims the other panels list), and what an answer does to the
 * agreement.
 *
 * The question is {@code {title, text, demand, offer, exchange, version,
 * add, send, accept, cancel, items, options}}. The items are the agreement's:
 * {@code {kind, side, key, amount, text}}, the kind being gold, stance,
 * colony, goods, incite or unit, the side "offer" for what we give and
 * "demand" for what the other player gives (a stance has neither, being
 * traded by both) and the key what identifies the thing traded: a stance's
 * name, an id, a goods type's id, nothing for gold. The options are the
 * groups of things that can be added: {@code {kind, side, label, note,
 * unique, max, choices: [{key, amount, text}]}}. A group with a max is
 * gold, an amount from 1 to max; a group with choices is one of them. A
 * unique kind has at most one item in an agreement, as the
 * {@code TradeItem}s say, so adding another replaces it.
 *
 * The answer is a status line (accept, propose or reject) then one line
 * per item, its kind, side, key and amount separated by tabs, for propose
 * only: accept and reject send the agreement as it was, as Swing does.
 */
final class Negotiation {

    private static final Logger logger
        = Logger.getLogger(Negotiation.class.getName());

    /** What Swing offers when a side's gold is not known. */
    static final int HUGE_DEMAND = 100000;

    private final Game game;
    private final Player player;
    private final Player otherPlayer;
    private final Unit ourUnit;
    private final Colony ourColony;
    private final DiplomaticTrade agreement;
    private final StringTemplate comment;
    private final int theirGold;

    /**
     * @param our Our unit or colony that is negotiating.
     * @param other The other unit or colony.
     * @param agreement The agreement under negotiation.
     * @param comment A comment message, or null.
     * @param theirGold The other player's gold, or
     *     {@code Player.GOLD_NOT_ACCOUNTED} if it is not known.
     */
    Negotiation(Player player, FreeColGameObject our, FreeColGameObject other,
                DiplomaticTrade agreement, StringTemplate comment,
                int theirGold) {
        this.game = player.getGame();
        this.player = player;
        this.otherPlayer = ((Ownable)other).getOwner();
        this.ourUnit = (our instanceof Unit) ? (Unit)our : null;
        this.ourColony = (our instanceof Colony) ? (Colony)our : null;
        this.agreement = agreement;
        this.comment = comment;
        this.theirGold = theirGold;
    }

    /** The question for the Browser UI. */
    String question() {
        final StringTemplate nation = this.player.getCountryLabel();
        final StringTemplate otherNation = this.otherPlayer.getCountryLabel();
        final TradeContext context = this.agreement.getContext();
        final boolean version = this.agreement.getVersion() > 0;

        final List<String> items = new ArrayList<>();
        for (TradeItem item : this.agreement.getItems()) {
            final String json = describe(item);
            if (json != null) items.add(json);
        }
        return new Json()
            .put("title", Messages.message("negotiationDialog.title."
                                           + context.getKey()))
            .put("text", (this.comment == null) ? null
                 : Messages.message(this.comment))
            .put("demand", Messages.message(StringTemplate
                .template("negotiationDialog.demand")
                .addStringTemplate("%nation%", nation)
                .addStringTemplate("%otherNation%", otherNation)))
            .put("offer", Messages.message(StringTemplate
                .template("negotiationDialog.offer")
                .addStringTemplate("%nation%", nation)
                .addStringTemplate("%otherNation%", otherNation)))
            .put("exchange", Messages.message("negotiationDialog.exchange"))
            .put("version", this.agreement.getVersion())
            .put("add", Messages.message("negotiationDialog.add"))
            .put("send", Messages.message("negotiationDialog.send"))
            // A new offer can not be accepted.
            .put("accept", version
                 ? Messages.message("negotiationDialog.accept") : null)
            // The first contact offer cannot be cancelled.
            .put("cancel", (version || context != TradeContext.CONTACT)
                 ? Messages.message("negotiationDialog.cancel") : null)
            .putRaw("items", Json.array(items))
            .putRaw("options", Json.array(options(context)))
            .toString();
    }

    private String describe(TradeItem item) {
        final String kind;
        String key = "";
        int amount = 0;
        if (item instanceof GoldTradeItem) {
            kind = "gold";
            amount = item.getGold();
        } else if (item instanceof StanceTradeItem) {
            kind = "stance";
            key = item.getStance().name();
        } else if (item instanceof ColonyTradeItem) {
            kind = "colony";
            final Colony colony = item.getColony(this.game);
            if (colony == null) return null;
            key = colony.getId();
        } else if (item instanceof GoodsTradeItem) {
            kind = "goods";
            key = item.getGoods().getType().getId();
            amount = item.getGoods().getAmount();
        } else if (item instanceof InciteTradeItem) {
            kind = "incite";
            key = item.getVictim().getId();
        } else if (item instanceof UnitTradeItem) {
            kind = "unit";
            key = item.getUnit().getId();
        } else {
            return null;
        }
        return new Json()
            .put("kind", kind)
            .put("side", (item.getSource() == this.player) ? "offer" : "demand")
            .put("key", key)
            .put("amount", amount)
            .put("text", Messages.message(item.getLabel()))
            .toString();
    }

    private List<String> options(TradeContext context) {
        final List<String> groups = new ArrayList<>();
        groups.add(gold("demand", this.theirGold));
        groups.add(gold("offer", this.player.getGold()));
        switch (context) {
        case CONTACT:
            groups.add(stances());
            incite(groups);
            break;
        case DIPLOMATIC:
            colonies(groups);
            groups.add(stances());
            incite(groups);
            break;
        case TRADE:
            goods(groups);
            units(groups);
            break;
        case TRIBUTE:
            groups.add(stances());
            incite(groups);
            break;
        default:
            throw new IllegalStateException("Bogus trade context: " + context);
        }
        return groups;
    }

    private static String group(String kind, String side, String label,
                                String note, boolean unique, Integer max,
                                List<String> choices) {
        final Json json = new Json()
            .put("kind", kind)
            .put("side", side)
            .put("label", label)
            .put("note", note)
            .put("unique", unique);
        if (max != null) json.put("max", max);
        return json.putRaw("choices", Json.array(choices)).toString();
    }

    private static String choice(String key, int amount, String text) {
        return new Json().put("key", key).put("amount", amount)
            .put("text", text).toString();
    }

    private String gold(String side, int gold) {
        final int max = (gold == Player.GOLD_NOT_ACCOUNTED) ? HUGE_DEMAND
            : gold;
        return group("gold", side,
            Messages.getName("model.tradeItem.gold"),
            Messages.message(StringTemplate
                .template("negotiationDialog.goldAvailable")
                .addAmount("%amount%", max)),
            true, max, List.of());
    }

    /** The stances StanceTradeItemPanel lists. */
    private String stances() {
        final List<String> choices = new ArrayList<>();
        final Stance stance = this.player.getStance(this.otherPlayer);
        final Stance first = (stance != Stance.WAR) ? Stance.WAR
            : Stance.CEASE_FIRE;
        choices.add(choice(first.name(), 0, Messages.getName(first)));
        if (stance != Stance.PEACE) {
            choices.add(choice(Stance.PEACE.name(), 0,
                               Messages.getName(Stance.PEACE)));
        }
        if (stance == Stance.PEACE) {
            choices.add(choice(Stance.ALLIANCE.name(), 0,
                               Messages.getName(Stance.ALLIANCE)));
        }
        return group("stance", null,
            Messages.getName("model.tradeItem.stance"), null, true, null,
            choices);
    }

    private void colonies(List<String> groups) {
        // Swing offers a colony only when the source is European.
        for (Player source : new Player[] { this.otherPlayer, this.player }) {
            if (!source.isEuropean()) continue;
            final List<String> choices = new ArrayList<>();
            for (Colony c : source.getColonyList()) {
                choices.add(choice(c.getId(), 0, c.getName()));
            }
            groups.add(group("colony", side(source),
                Messages.getName("model.tradeItem.colony"), null, false, null,
                choices));
        }
    }

    private void incite(List<String> groups) {
        for (Player source : new Player[] { this.otherPlayer, this.player }) {
            final Player target = (source == this.player) ? this.otherPlayer
                : this.player;
            final List<String> choices = new ArrayList<>();
            this.game.getLivePlayers(source).forEach(p -> {
                    if (p != target && source.getStance(p).isIncitable()) {
                        choices.add(choice(p.getId(), 0,
                            Messages.message(p.getNationLabel())));
                    }
                });
            groups.add(group("incite", side(source),
                Messages.getName("model.tradeItem.incite"), null, true, null,
                choices));
        }
    }

    private void goods(List<String> groups) {
        final List<String> demand = new ArrayList<>();
        for (GoodsType gt : this.game.getSpecification()
                 .getStorableGoodsTypeList()) {
            demand.add(choice(gt.getId(), GoodsContainer.CARGO_SIZE,
                Messages.message(new Goods(this.game, null, gt,
                    GoodsContainer.CARGO_SIZE).getLabel(true))));
        }
        groups.add(group("goods", "demand",
            Messages.getName("model.tradeItem.goods"), null, false, null,
            demand));

        final List<String> offer = new ArrayList<>();
        for (Goods g : ourGoods()) {
            offer.add(choice(g.getType().getId(), g.getAmount(),
                             Messages.message(g.getLabel(true))));
        }
        groups.add(group("goods", "offer",
            Messages.getName("model.tradeItem.goods"), null, false, null,
            offer));
    }

    /** Our goods, one cargo load of each at most, as GoodsTradeItemPanel. */
    private List<Goods> ourGoods() {
        final List<Goods> goods = (this.ourUnit != null)
            ? this.ourUnit.getGoodsList()
            : this.ourColony.getCompactGoodsList();
        final List<Goods> loads = new ArrayList<>();
        for (Goods g : goods) {
            loads.add(new Goods(this.game, g.getLocation(), g.getType(),
                Math.min(g.getAmount(), GoodsContainer.CARGO_SIZE)));
        }
        return loads;
    }

    /** Our units to offer, as UnitTradeItemPanel. The other side has none. */
    private void units(List<String> groups) {
        final List<Unit> units = new ArrayList<>();
        if (this.ourUnit == null) {
            units.addAll(this.ourColony.getUnitList());
        } else if (this.ourUnit.isCarrier()) {
            units.addAll(this.ourUnit.getUnitList());
        } else if (this.ourUnit.isOnCarrier()) {
            units.addAll(this.ourUnit.getCarrier().getUnitList());
        } else {
            units.add(this.ourUnit);
        }
        final List<String> choices = new ArrayList<>();
        for (Unit u : units) {
            choices.add(choice(u.getId(), 0, u.getDescription()));
        }
        groups.add(group("unit", "offer",
            Messages.getName("model.tradeItem.unit"), null, false, null,
            choices));
    }

    private String side(Player source) {
        return (source == this.player) ? "offer" : "demand";
    }

    /**
     * Apply an answer to the agreement, as the buttons of the Swing dialog do.
     *
     * @param answer The answer, or null for a closed dialog.
     * @return The agreement to hand the handler, or null for a closed dialog.
     */
    DiplomaticTrade answer(String answer) {
        if (answer == null) return null;
        final String[] lines = answer.split("\n", -1);
        switch (lines[0]) {
        case "accept":
            this.agreement.setStatus(TradeStatus.ACCEPT_TRADE);
            break;
        case "propose":
            this.agreement.clear();
            for (int i = 1; i < lines.length; i++) {
                if (!lines[i].isEmpty()) add(lines[i]);
            }
            this.agreement.setStatus(TradeStatus.PROPOSE_TRADE);
            break;
        case "reject":
            this.agreement.setStatus(TradeStatus.REJECT_TRADE);
            break;
        default:
            return null;
        }
        return this.agreement;
    }

    /** Add the item on a line of a proposal; a bad line is dropped. */
    private void add(String line) {
        final String[] f = line.split("\t", -1);
        if (f.length != 4) return;
        final String kind = f[0], key = f[2];
        final Player source = "offer".equals(f[1]) ? this.player
            : this.otherPlayer;
        final Player destination = (source == this.player) ? this.otherPlayer
            : this.player;
        final int amount;
        try {
            amount = Integer.parseInt(f[3]);
        } catch (NumberFormatException nfe) {
            logger.warning("Negotiation: bad amount in " + line);
            return;
        }
        final TradeItem item;
        switch (kind) {
        case "gold":
            if (amount <= 0) return;
            item = new GoldTradeItem(this.game, source, destination, amount);
            break;
        case "stance":
            try {
                item = new StanceTradeItem(this.game, this.otherPlayer,
                    this.player, Stance.valueOf(key));
            } catch (IllegalArgumentException iae) {
                logger.warning("Negotiation: bad stance in " + line);
                return;
            }
            break;
        case "colony":
            final Colony colony = this.game.getFreeColGameObject(key,
                                                                  Colony.class);
            if (colony == null || colony.getOwner() != source
                || !destination.isEuropean()) return;
            item = new ColonyTradeItem(this.game, source, destination, colony);
            break;
        case "goods":
            final GoodsType type = this.game.getSpecification()
                .getGoodsType(key);
            if (type == null || amount <= 0) return;
            final GoodsLocation where = (source != this.player) ? null
                : (this.ourUnit != null) ? this.ourUnit : this.ourColony;
            item = new GoodsTradeItem(this.game, source, destination,
                new Goods(this.game, where, type, amount));
            break;
        case "incite":
            final Player victim = this.game.getFreeColGameObject(key,
                                                                  Player.class);
            if (victim == null) return;
            item = new InciteTradeItem(this.game, source, destination, victim);
            break;
        case "unit":
            final Unit unit = this.game.getFreeColGameObject(key, Unit.class);
            if (unit == null) return;
            item = new UnitTradeItem(this.game, source, destination, unit);
            break;
        default:
            logger.warning("Negotiation: bad kind in " + line);
            return;
        }
        this.agreement.add(item);
    }
}
