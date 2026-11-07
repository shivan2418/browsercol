package browsercol.web;

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
import net.sf.freecol.common.model.Market;
import net.sf.freecol.common.model.Player;

import net.sf.freecol.common.model.Stance;
import net.sf.freecol.common.model.StanceTradeItem;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.TradeItem;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitTradeItem;


/**
 * The questions of FreeCol's negotiation dialog, for the Browser UI (#357).
 *
 * {@code NegotiationDialog} is a Swing panel, which TeaVM cannot load, so
 * what it offers is copied here without the Swing parts: for each
 * trade context the kinds of item that can be traded and what can be
 * chosen for each (gold up to what the side has, the stances
 * {@code StanceTradeItemPanel} lists, the colonies, goods, units and
 * victims the other panels list), and what an answer does to the
 * agreement. The rules are FreeCol's, with one change in what is offered:
 * war is not among the stances, as a treaty that declares war does what an
 * attack does.
 *
 * The question is {@code {title, context, version, tutorial, nation, other,
 * stance, gold, cancellable, items, options}}. The context is the
 * agreement's: contact, diplomatic, trade or tribute. Nation and other
 * name the two sides. The stance is the current one, {@code {key, name}},
 * and the gold {@code {ours, theirs}}, theirs being null when it is not
 * known. A question whose version is above 0, or whose context is contact,
 * is an offer to answer; cancellable is false for the first contact offer,
 * which cannot be turned down.
 *
 * The items are the agreement's: {@code {kind, side, key, amount, text}},
 * the kind being gold, stance, colony, goods, incite or unit, the side
 * "offer" for what we give and "demand" for what the other player gives (a
 * stance has neither, being traded by both) and the key what identifies the
 * thing traded: a stance's name, an id, a goods type's id, nothing for gold.
 * The text names the thing, a colony or nation by its name.
 *
 * The options are the groups of things that can be added, each only with
 * what is valid for its side: {@code {kind, side, label, unique, max, choices:
 * [{key, amount, text}], empty}}. A group with a max is gold, an amount from
 * 1 to max (an unknown treasury allows {@link #HUGE_DEMAND}); a group with
 * choices is one of them. A unique kind has at most one item in an
 * agreement, as the {@code TradeItem}s say, so adding another replaces it.
 * Where nothing is valid empty says why, else it is null.
 *
 * The answer is a status line (accept, propose or reject) then one line
 * per item, its kind, side, key and amount separated by tabs, for propose
 * only: accept and reject send the agreement as it was, as Swing does. The
 * first contact offer, version 0, is the player's own proposal of peace, so
 * the Browser UI answers it with propose, as Swing's Send does, for the other
 * player to answer; accept would end the contact without them.
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
    private final boolean tutorial;

    /**
     * @param our Our unit or colony that is negotiating.
     * @param other The other unit or colony.
     * @param agreement The agreement under negotiation.
     * @param comment A comment message, or null.
     * @param theirGold The other player's gold, or
     *     {@code Player.GOLD_NOT_ACCOUNTED} if it is not known.
     * @param tutorial Whether the game is in tutorial mode.
     */
    Negotiation(Player player, FreeColGameObject our, FreeColGameObject other,
                DiplomaticTrade agreement, StringTemplate comment,
                int theirGold, boolean tutorial) {
        this.game = player.getGame();
        this.player = player;
        this.otherPlayer = ((Ownable)other).getOwner();
        this.ourUnit = (our instanceof Unit) ? (Unit)our : null;
        this.ourColony = (our instanceof Colony) ? (Colony)our : null;
        this.agreement = agreement;
        this.comment = comment;
        this.theirGold = theirGold;
        this.tutorial = tutorial;
    }

    /** The question for the Browser UI. */
    String question() {
        final TradeContext context = this.agreement.getContext();
        final boolean version = this.agreement.getVersion() > 0;

        final List<String> items = new ArrayList<>();
        for (TradeItem item : this.agreement.getItems()) {
            final String json = describe(item);
            if (json != null) items.add(json);
        }
        final Stance stance = this.player.getStance(this.otherPlayer);
        return new Json()
            .put("title", Messages.message("negotiationDialog.title."
                                           + context.getKey()))
            .put("context", context.getKey())
            .put("version", this.agreement.getVersion())
            // NegotiationDialog shows this in tutorial mode at first contact.
            .put("tutorial", (this.tutorial && context == TradeContext.CONTACT)
                 ? Messages.message("negotiationDialog.contact.tutorial")
                 : null)
            .put("nation", nation(this.player))
            .put("other", nation(this.otherPlayer))
            .putRaw("stance", new Json().put("key", stance.name())
                .put("name", Messages.getName(stance)).toString())
            .putRaw("gold", new Json()
                .put("ours", this.player.getGold())
                .putRaw("theirs", (this.theirGold == Player.GOLD_NOT_ACCOUNTED)
                    ? "null" : Integer.toString(this.theirGold))
                .toString())
            // The first contact offer cannot be cancelled.
            .put("cancellable", version || context != TradeContext.CONTACT)
            .putRaw("items", Json.array(items))
            .putRaw("options", Json.array(options(context)))
            .toString();
    }

    private static String nation(Player player) {
        return Messages.message(player.getCountryLabel());
    }

    private String describe(TradeItem item) {
        final String kind;
        String key = "";
        String text = null;
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
            text = colony.getName();
        } else if (item instanceof GoodsTradeItem) {
            kind = "goods";
            key = item.getGoods().getType().getId();
            amount = item.getGoods().getAmount();
        } else if (item instanceof InciteTradeItem) {
            kind = "incite";
            key = item.getVictim().getId();
            text = Messages.message(item.getVictim().getNationLabel());
        } else if (item instanceof UnitTradeItem) {
            kind = "unit";
            key = item.getUnit().getId();
            text = item.getUnit().getDescription();
        } else {
            return null;
        }
        final boolean offered = item.getSource() == this.player;
        if (text == null) text = Messages.message(item.getLabel());
        // As NegotiationDialog's item buttons: goods say what Europe pays
        // for them if we give them, or asks for them if we get them.
        if (item.getGoods() != null && this.player.getMarket() != null) {
            final Goods g = item.getGoods();
            final Market market = this.player.getMarket();
            text += " " + Messages.message(StringTemplate
                .template(offered ? "negotiationDialog.euSalePrice"
                                  : "negotiationDialog.euBuyPrice")
                .addAmount("%priceTotal%", offered
                    ? market.getSalePrice(g.getType(), g.getAmount())
                    : market.getBidPrice(g.getType(), g.getAmount())));
        }
        return new Json()
            .put("kind", kind)
            .put("side", "stance".equals(kind) ? null
                 : offered ? "offer" : "demand")
            .put("key", key)
            .put("amount", amount)
            .put("text", text)
            .toString();
    }

    private List<String> options(TradeContext context) {
        final List<String> groups = new ArrayList<>();
        groups.add(gold("demand", this.otherPlayer, this.theirGold));
        groups.add(gold("offer", this.player, this.player.getGold()));
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
                                boolean unique, Integer max,
                                List<String> choices, String empty) {
        final Json json = new Json()
            .put("kind", kind)
            .put("side", side)
            .put("label", label)
            .put("unique", unique);
        if (max != null) json.put("max", max);
        return json.putRaw("choices", Json.array(choices))
            .put("empty", empty).toString();
    }

    private static String choice(String key, int amount, String text) {
        return new Json().put("key", key).put("amount", amount)
            .put("text", text).toString();
    }

    /** Gold up to the side's treasury; an unknown one allows what Swing does. */
    private String gold(String side, Player source, int gold) {
        final int max = (gold == Player.GOLD_NOT_ACCOUNTED) ? HUGE_DEMAND
            : gold;
        return group("gold", side,
            Messages.getName("model.tradeItem.gold"), true, max, List.of(),
            (max < 1) ? nation(source) + " has no gold." : null);
    }

    /**
     * The stances StanceTradeItemPanel lists, but for war: a cease-fire
     * from war, peace unless at peace and an alliance from peace.
     */
    private String stances() {
        final List<String> choices = new ArrayList<>();
        final Stance stance = this.player.getStance(this.otherPlayer);
        if (stance == Stance.WAR) {
            choices.add(choice(Stance.CEASE_FIRE.name(), 0,
                               Messages.getName(Stance.CEASE_FIRE)));
        }
        if (stance != Stance.PEACE) {
            choices.add(choice(Stance.PEACE.name(), 0,
                               Messages.getName(Stance.PEACE)));
        }
        if (stance == Stance.PEACE) {
            choices.add(choice(Stance.ALLIANCE.name(), 0,
                               Messages.getName(Stance.ALLIANCE)));
        }
        return group("stance", null,
            Messages.getName("model.tradeItem.stance"), true, null,
            choices, null);
    }

    /** Each side's own colonies, as ColonyTradeItemPanel lists them. */
    private void colonies(List<String> groups) {
        // Swing offers a colony only when the source is European.
        for (Player source : new Player[] { this.otherPlayer, this.player }) {
            if (!source.isEuropean()) continue;
            final List<String> choices = new ArrayList<>();
            for (Colony c : source.getColonyList()) {
                choices.add(choice(c.getId(), 0, c.getName()));
            }
            groups.add(group("colony", side(source),
                Messages.getName("model.tradeItem.colony"), false, null,
                choices,
                choices.isEmpty() ? nation(source) + " has no colonies."
                    : null));
        }
    }

    /** The nations a side could be asked to declare war against, as InciteTradeItemPanel lists them. */
    private void incite(List<String> groups) {
        for (Player source : new Player[] { this.otherPlayer, this.player }) {
            final Player target = (source == this.player) ? this.otherPlayer
                : this.player;
            final List<String> choices = new ArrayList<>();
            final List<String> atWar = new ArrayList<>();
            final List<String> allied = new ArrayList<>();
            final List<String> unmet = new ArrayList<>();
            this.game.getLivePlayers(source).forEach(p -> {
                    if (p == target) return;
                    final Stance stance = source.getStance(p);
                    final String name = Messages.message(p.getNationLabel());
                    if (stance.isIncitable()) {
                        choices.add(choice(p.getId(), 0, name));
                    } else if (stance == Stance.WAR) {
                        atWar.add(name);
                    } else if (stance == Stance.ALLIANCE) {
                        allied.add(name);
                    } else {
                        unmet.add(name);
                    }
                });
            groups.add(group("incite", side(source),
                Messages.getName("model.tradeItem.incite"), true, null,
                choices, choices.isEmpty()
                    ? noOneToDeclareWarOn(source, atWar, allied, unmet)
                    : null));
        }
    }

    /** Why a side has no nation to declare war against. */
    private static String noOneToDeclareWarOn(Player source,
                                              List<String> atWar,
                                              List<String> allied,
                                              List<String> unmet) {
        final String who = nation(source);
        final List<String> parts = new ArrayList<>();
        if (!atWar.isEmpty()) parts.add("is already at war with " + list(atWar));
        if (!allied.isEmpty()) parts.add("is allied with " + list(allied));
        if (!unmet.isEmpty()) parts.add("has not met " + list(unmet));
        if (parts.isEmpty()) return who + " has not met any other nation.";
        return who + " " + String.join(", and ", parts) + ".";
    }

    private static String list(List<String> names) {
        if (names.size() < 2) return String.join("", names);
        return String.join(", ", names.subList(0, names.size() - 1))
            + " and " + names.get(names.size() - 1);
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
            Messages.getName("model.tradeItem.goods"), false, null,
            demand, null));

        final List<String> offer = new ArrayList<>();
        for (Goods g : ourGoods()) {
            offer.add(choice(g.getType().getId(), g.getAmount(),
                             Messages.message(g.getLabel(true))));
        }
        groups.add(group("goods", "offer",
            Messages.getName("model.tradeItem.goods"), false, null, offer,
            offer.isEmpty() ? nation(this.player) + " has no goods to give."
                : null));
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
            Messages.getName("model.tradeItem.unit"), false, null, choices,
            choices.isEmpty() ? "There is no unit to give." : null));
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
