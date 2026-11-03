package online.freecol.web;

import java.util.ArrayList;
import java.util.List;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Europe;
import net.sf.freecol.common.model.Goods;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.IndianSettlement;
import net.sf.freecol.common.model.Location;
import net.sf.freecol.common.model.Player;
import net.sf.freecol.common.model.Role;
import net.sf.freecol.common.model.AbstractGoods;
import net.sf.freecol.common.model.UnitLocation;
import net.sf.freecol.common.model.Ability;
import net.sf.freecol.common.FreeColException;
import net.sf.freecol.common.model.Settlement;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Tile;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.Unit.UnitState;
import net.sf.freecol.common.model.UnitLocation.NoAddReason;
import net.sf.freecol.common.model.WorkLocation;


/**
 * The entries of FreeCol's right-click menus, as data for the Browser UI:
 * TilePopup for a map tile and QuickActionMenu for a colonist or goods in
 * the colony panel. {@link Commands#menuEntry} runs the one the player
 * picks.
 *
 * A menu is {title, entries: [{id, label, enabled, gap, indent}]}. An
 * entry's id says what it does, as {@code verb} or {@code verb:argument,...}
 * (see {@link Commands#menuEntry}); gap puts a line above the entry, and
 * indent sets it under the unit above, as TilePopup does for a carrier's
 * cargo. A menu with no entries is not shown.
 */
final class Menus {

    private final FreeColClient client;


    Menus(FreeColClient client) {
        this.client = client;
    }

    private Player me() {
        return this.client.getMyPlayer();
    }


    /** One entry of a menu, and a menu being built. */
    private static final class Builder {
        private final List<String> entries = new ArrayList<>();
        private boolean gap = false;

        /** The next entry has a line above it, unless it is the first. */
        void gap() {
            if (!this.entries.isEmpty()) this.gap = true;
        }

        void add(String id, String label, boolean enabled, boolean indent) {
            final Json e = new Json().put("id", id).put("label", label)
                .put("enabled", enabled);
            if (this.gap) e.put("gap", true);
            if (indent) e.put("indent", true);
            this.gap = false;
            this.entries.add(e.toString());
        }

        void add(String id, String label) {
            add(id, label, true, false);
        }

        boolean isEmpty() {
            return this.entries.isEmpty();
        }

        String build(String title) {
            return new Json().put("title", title)
                .putRaw("entries", Json.array(this.entries)).toString();
        }
    }

    private static String text(String key) {
        return Messages.message(key);
    }

    private static String text(StringTemplate t) {
        return Messages.message(t);
    }

    private static String unitLabel(Unit u) {
        return u.getDescription(Unit.UnitLabelType.NATIONAL);
    }


    /**
     * The menu for a right-click on a tile, as TilePopup builds it: what
     * the active unit can do there, the settlement, the tile, and each
     * unit on it to select.
     *
     * @param x The tile's x.
     * @param y The tile's y.
     * @return The menu as JSON; "null" for no such tile or no entries.
     */
    String tile(int x, int y) {
        final Tile tile = this.client.getGame().getMap().getTile(x, y);
        final Player player = me();
        // Nothing is known of an unexplored tile, and its label would give it away.
        if (tile == null || player == null || !tile.isExplored()) return "null";
        final Builder b = new Builder();
        final Unit active = this.client.getGUI().getActiveUnit();
        final String at = x + "," + y;
        if (active != null && player.owns(active) && active.getTile() != null) {
            final Tile from = active.getTile();
            if (active.isOffensiveUnit() && from.isAdjacent(tile)
                && active.getMoveType(tile).isAttack()) {
                b.add("attack:" + at, text(active.getCombatLabel(tile)));
            } else if (active.getSimpleMoveType(from, tile).isLegal()) {
                b.add("goto:" + at, text("goToThisTile"));
            }
            if (from == tile) {
                final String id = active.getId();
                if (active.canMoveToHighSeas()) {
                    b.add("europe:" + id, text(StringTemplate.template("goToEurope")));
                }
                if (active.checkSetState(UnitState.ACTIVE)) {
                    b.add("state:ACTIVE:" + id, text("activateUnit"));
                }
                if (active.checkSetState(UnitState.FORTIFYING)) {
                    b.add("state:FORTIFYING:" + id, text("fortify"));
                }
                if (active.checkSetState(UnitState.SKIPPED)) {
                    b.add("state:SKIPPED:" + id, text("skip"));
                }
                if (active.canCarryTreasure() && active.canCashInTreasureTrain()) {
                    b.add("cashin:" + id, text("cashInTreasureTrain"));
                }
                if (active.getDestination() != null) {
                    b.add("clear:" + id, text("clearOrders"));
                }
            }
            b.gap();
        }
        final Settlement settlement = tile.getSettlement();
        if (settlement != null) {
            if (settlement.getOwner() == player && settlement instanceof Colony) {
                b.add("colony:" + settlement.getId(),
                    text(((Colony)settlement).getLocationLabelFor(player)));
            } else if (settlement instanceof IndianSettlement) {
                b.add("settlement:" + settlement.getId(),
                    text(((IndianSettlement)settlement).getLocationLabelFor(player)));
            }
            b.gap();
        }
        // The tile itself: its label opens the tile panel, as TilePopup's does.
        b.add("tile:" + at, text(tile.getLabel()));
        b.gap();
        for (Unit u : tile.getUnitList()) addUnit(b, u, !u.isDamaged(), false);
        if (tile.getUnitCount() > 1 && player.owns(tile.getFirstUnit())) {
            b.gap();
            b.add("activateAll:" + at, text(StringTemplate.template("activateAllUnits")));
        }
        return b.isEmpty() ? "null" : b.build(text(tile.getSimpleLabel()));
    }

    /** A unit on the tile, then what it carries, as TilePopup's addUnit. */
    private void addUnit(Builder b, Unit u, boolean enabled, boolean indent) {
        final Player player = me();
        final String text = unitLabel(u) + " ("
            + text(u.getOccupationLabel(player, true)) + ")";
        b.add("select:" + u.getId(), text, enabled && player.owns(u), indent);
        for (Unit aboard : u.getUnitList()) addUnit(b, aboard, true, true);
        for (Goods g : u.getGoodsList()) {
            b.add("none", text(g.getLabel(true)), false, true);
        }
    }


    /**
     * The quick action menu of a colonist, as QuickActionMenu.createUnitMenu
     * builds it for a unit of ours in a colony or on its tile: the orders,
     * the ships it may board, and where it may work.
     *
     * @param unitId The unit's id.
     * @return The menu as JSON; "null" if it is not our unit there.
     */
    String unit(String unitId) {
        final Player player = me();
        final Unit unit = this.client.getGame().getFreeColGameObject(unitId, Unit.class);
        if (unit == null || player == null || !player.owns(unit)
            || unit.isDisposed()) return "null";
        final Builder b = new Builder();
        if (unit.isInEurope()) {
            addOrders(b, unit);
            b.gap();
            addBoard(b, unit, player.getEurope());
            addRoles(b, unit);
            addClearSpeciality(b, unit);
            return b.build(unitLabel(unit));
        }
        final Colony colony = colonyOf(unit);
        if (colony == null) return "null";
        if (unit.isCarrier() && unit.hasCargo()) {
            // The cargo, as QuickActionMenu.addCarrierItems lists it.
            b.add("none", text("cargoOnCarrier"), false, false);
            for (Unit aboard : unit.getUnitList()) {
                b.add("none", unitLabel(aboard), false, true);
            }
            for (Goods g : unit.getGoodsList()) {
                b.add("none", text(g.getLabel(true)), false, true);
            }
            b.gap();
        }
        if (!unit.isCarrier() && unit.isInColony()) {
            addWork(b, unit, colony);
            addEducation(b, unit, colony);
            if (colony.canReducePopulation()) {
                b.add("leaveTown:" + unitId, text("quickActionMenu.leaveTown"));
                addBoard(b, unit, colony);
                b.gap();
                addRoles(b, unit);
                addClearSpeciality(b, unit);
                return b.build(unitLabel(unit));
            }
        }
        addOrders(b, unit);
        b.gap();
        addBoard(b, unit, colony);
        addRoles(b, unit);
        addClearSpeciality(b, unit);
        return b.build(unitLabel(unit));
    }

    /** QuickActionMenu's "clear speciality", unless the unit works where it would no longer fit. */
    private void addClearSpeciality(Builder b, Unit unit) {
        final net.sf.freecol.common.model.UnitTypeChange uc =
            unit.getUnitChange(net.sf.freecol.common.model.UnitChangeType.CLEAR_SKILL);
        if (uc == null) return;
        b.gap();
        final boolean fits = !(unit.getLocation() instanceof net.sf.freecol.common.model.Building)
            || ((net.sf.freecol.common.model.Building)unit.getLocation()).canAddType(uc.to);
        b.add("clearSpeciality:" + unit.getId(),
            text(StringTemplate.template("quickActionMenu.clearSpeciality")), fits, false);
    }

    /** QuickActionMenu.addEducationItems: the teachers that may take the unit, and its own lessons. */
    private void addEducation(Builder b, Unit unit, Colony colony) {
        boolean any = false;
        if (unit.getSpecification().getBoolean(
                net.sf.freecol.common.option.GameOptions.ALLOW_STUDENT_SELECTION)) {
            for (Unit teacher : colony.getTeachers().collect(java.util.stream.Collectors.toList())) {
                if (!unit.canBeStudent(teacher) || !teacher.isInColony()) continue;
                final String name = Messages.getName(teacher.getType());
                final String progress = " (" + teacher.getTurnsOfTraining() + "/"
                    + teacher.getNeededTurnsOfTraining() + ")";
                if (teacher.getStudent() == unit) {
                    b.add("none", text(StringTemplate.template("quickActionMenu.apprentice")
                        .addName("%unit%", name)) + ":" + progress, false, false);
                } else {
                    b.add("assign:" + unit.getId() + "," + teacher.getId(),
                        text(StringTemplate.template("quickActionMenu.assignToTeacher")
                            .addName("%unit%", name))
                        + (teacher.getStudent() != null ? progress : ""));
                }
                any = true;
            }
        }
        if (unit.getStudent() != null) {
            b.add("none", text(StringTemplate.template("quickActionMenu.teaching")
                .addName("%unit%", Messages.getName(unit.getStudent().getType())))
                + ": " + unit.getTurnsOfTraining() + "/" + unit.getNeededTurnsOfTraining(),
                false, false);
            any = true;
        }
        if (any) b.gap();
    }

    /**
     * QuickActionMenu.addRoleItems: the roles (tools, soldier, dragoon...) the unit can take in
     * the colony or Europe, each with as many of its goods as can be had and paid for.
     */
    private void addRoles(Builder b, Unit unit) {
        if (!unit.hasAbility(Ability.CAN_BE_EQUIPPED)) return;
        final Player player = me();
        final UnitLocation at = unit.isInEurope() ? player.getEurope() : unit.getSettlement();
        if (at == null) return;
        final Role role = unit.getRole();
        final int roleCount = unit.getRoleCount();
        boolean any = false;
        for (Role r : unit.getAvailableRoles(null).collect(java.util.stream.Collectors.toList())) {
            if (r == role) continue;
            int count = 0;
            int price = 0;
            if (r.isDefaultRole()) {
                count = 0;
            } else {
                boolean found = false;
                for (int n = r.getMaximumCount(); n > 0 && !found; n--) {
                    try {
                        final int p = at.priceGoods(unit.getGoodsDifference(r, n));
                        if (player.checkGold(p)) {
                            count = n;
                            price = p;
                            found = true;
                        }
                    } catch (FreeColException fce) {
                        continue;
                    }
                }
                if (!found) continue;
            }
            String key = "model.role.change." + r.getSuffix();
            if (!Messages.containsKey(key)) {
                key = "model.role.change." + role.getSuffix() + "." + r.getSuffix();
            }
            String label = text(key);
            if (price != 0) {
                label += " (" + text(StringTemplate.template("goldAmount")
                    .addAmount("%amount%", Math.abs(price)))
                    + (price < 0 ? " (" + text("income") + "))" : ")");
            }
            if (!any) b.gap();
            any = true;
            b.add("role:" + unit.getId() + "," + r.getId() + "," + count, label);
        }
    }

    /** The colony a unit is in or on the tile of, else null. */
    private static Colony colonyOf(Unit unit) {
        if (unit.getLocation() == null) return null;
        return unit.getLocation().getColony() != null
            ? unit.getLocation().getColony()
            : unit.hasTile() ? unit.getTile().getColony() : null;
    }

    /** QuickActionMenu.addCommandItems. */
    private static void addOrders(Builder b, Unit unit) {
        final String id = unit.getId();
        final boolean atSea = unit.isAtSea();
        final UnitState state = unit.getState();
        // FreeCol also offers "Activate unit" in Europe, where it only
        // selects the unit on a map it is not on; "Clear orders" sets it
        // active there, so the entry is left out.
        // Europe has nothing to fortify (QuickActionMenu.addCommandItems).
        if (!unit.isInEurope()) {
            b.add("state:ACTIVE:" + id, text("activateUnit"), !atSea, false);
            b.add("state:FORTIFYING:" + id, text("fortify"),
                unit.getMovesLeft() > 0 && state != UnitState.FORTIFIED
                    && state != UnitState.FORTIFYING, false);
        }
        // Europe has nothing to sentry or clear either.
        if (!unit.isInEurope()) {
            b.add("state:SENTRY:" + id, text("sentry"),
                state != UnitState.SENTRY && !atSea, false);
            b.add("clear:" + id, text("clearOrders"),
                (state != UnitState.ACTIVE || unit.getTradeRoute() != null) && !atSea,
                false);
        }
        if (unit.canCarryTreasure() && unit.canCashInTreasureTrain()) {
            b.add("cashin:" + id, text("cashInTreasureTrain"));
        }
        if (unit.getLocation() instanceof Unit && !unit.isInEurope()) {
            b.add("leaveShip:" + id, text("leaveShip"));
        }
        // Cargo in Europe is sold from the goods menu, not unloaded.
        if (unit.isCarrier() && !unit.isInEurope()) {
            b.add("unloadAll:" + id,
                text(unit.getSettlement() != null ? "unload" : "dumpCargo"),
                !atSea && unit.hasCargo(), false);
        }
    }

    /** QuickActionMenu.addBoardItems: the ships here that can take the unit. */
    private static void addBoard(Builder b, Unit unit, Colony colony) {
        addBoard(b, unit, colony.getTile());
    }

    /** The ships at a place (a tile, or Europe) that can take the unit. */
    private static void addBoard(Builder b, Unit unit, Location at) {
        if (unit.isCarrier()) return;
        for (Unit ship : at.getUnitList()) {
            if (!ship.isCarrier() || !ship.canCarryUnits() || !ship.canAdd(unit)
                || unit.getLocation() == ship) continue;
            b.add("board:" + unit.getId() + "," + ship.getId(),
                text(StringTemplate.template("quickActionMenu.board")
                    .addStringTemplate("%unit%",
                        ship.getLabel(Unit.UnitLabelType.NATIONAL))));
        }
    }

    /**
     * QuickActionMenu.addWorkItems: for each goods type, the colony's best
     * place for the unit to make it, those it already has first and those
     * that need a claim after.
     */
    private void addWork(Builder b, Unit unit, Colony colony) {
        final Specification spec = this.client.getGame().getSpecification();
        final GoodsType expert = unit.getType().getExpertProduction();
        final WorkLocation current = unit.getWorkLocation();
        final int bonusChange = (current != null) ? 0
            : colony.governmentChange(colony.getUnitCount() + 1);
        final int bonus = colony.getProductionBonus();
        final List<Work> owned = new ArrayList<>();
        final List<Work> claims = new ArrayList<>();
        for (GoodsType type : spec.getGoodsTypeList()) {
            int bestOwnedProd = bonus + bonusChange;
            int bestUnownedProd = bonus + bonusChange;
            WorkLocation bestOwned = null;
            WorkLocation bestUnowned = null;
            for (WorkLocation wl : colony.getAllWorkLocationsList()) {
                final NoAddReason reason = wl.getNoAddReason(unit);
                if (reason != NoAddReason.NONE
                    && reason != NoAddReason.ALREADY_PRESENT
                    && reason != NoAddReason.CLAIM_REQUIRED) continue;
                final int prod = wl.getPotentialProduction(type, unit.getType());
                if (reason == NoAddReason.CLAIM_REQUIRED) {
                    if (bestUnownedProd < prod) {
                        bestUnownedProd = prod;
                        bestUnowned = wl;
                    }
                } else if (bestOwnedProd < prod) {
                    bestOwnedProd = prod;
                    bestOwned = (reason == NoAddReason.ALREADY_PRESENT
                        && unit.getWorkType() == type) ? null : wl;
                }
            }
            if (bestOwned != null && bestOwnedProd > 0) {
                owned.add(new Work(type, bestOwned, bestOwnedProd, false, type == expert));
            }
            if (bestUnowned != null && bestUnownedProd > bestOwnedProd
                && bestUnownedProd > 0) {
                claims.add(new Work(type, bestUnowned, bestUnownedProd, true, type == expert));
            }
        }
        final List<Work> all = new ArrayList<>();
        owned.sort(Work.ORDER);
        claims.sort(Work.ORDER);
        all.addAll(owned);
        all.addAll(claims);
        for (int i = 0; i < all.size(); i++) {
            final Work w = all.get(i);
            // A line between the places the colony has and those that need a claim.
            if (w.claim && i > 0 && !all.get(i - 1).claim) b.gap();
            final StringTemplate t = StringTemplate
                .template(w.type.getId() + ".workAs")
                .addAmount("%amount%", w.amount);
            if (w.claim) t.addStringTemplate("%claim%", w.where.getClaimTemplate());
            else t.addName("%claim%", "");
            b.add("work:" + unit.getId() + "," + w.where.getId() + ","
                + w.type.getId(), text(t));
        }
        if (!all.isEmpty()) b.gap();
    }

    /** A place to work and what it would make. */
    private static final class Work {
        /** The expert's goods first, then the most, then by name. */
        static final java.util.Comparator<Work> ORDER =
            java.util.Comparator.comparing((Work w) -> !w.expert)
                .thenComparing(w -> -w.amount)
                .thenComparing(w -> w.type.getId());

        final GoodsType type;
        final WorkLocation where;
        final int amount;
        final boolean claim;
        final boolean expert;

        Work(GoodsType type, WorkLocation where, int amount, boolean claim,
             boolean expert) {
            this.type = type;
            this.where = where;
            this.amount = amount;
            this.claim = claim;
            this.expert = expert;
        }
    }


    /**
     * The quick action menu of goods in the colony panel, as
     * QuickActionMenu.createGoodsMenu builds it: goods in a colony's
     * warehouse load onto a ship in its port, and goods on a ship in port
     * unload into the warehouse.
     *
     * @param locationId The id of the colony, or of the ship the goods are on;
     *     "europe" for the Europe panel's market.
     * @param goodsTypeId The goods type's id.
     * @param amount The amount in the stack the player clicked.
     * @return The menu as JSON; "null" if there is nothing to pick.
     */
    String goods(String locationId, String goodsTypeId, int amount) {
        final Player player = me();
        final GoodsType type = this.client.getGame().getSpecification()
            .getGoodsType(goodsTypeId);
        if (type == null || player == null) return "null";
        final Object where = "europe".equals(locationId) ? player.getEurope()
            : this.client.getGame().getFreeColGameObject(locationId);
        final Builder b = new Builder();
        if (where instanceof Colony && player.owns((Colony)where)) {
            final Colony colony = (Colony)where;
            final Goods goods = new Goods(this.client.getGame(), colony, type,
                Math.min(amount, colony.getGoodsCount(type)));
            for (Unit ship : colony.getTile().getUnitList()) {
                if (!player.owns(ship) || !ship.isCarrier() || !ship.canCarryGoods()
                    || !ship.canAdd(goods)) continue;
                b.add("load:" + ship.getId() + "," + goodsTypeId,
                    text(StringTemplate.template("quickActionMenu.loadOnTo")
                        .addStringTemplate("%unit%",
                            ship.getLabel(Unit.UnitLabelType.NATIONAL))));
            }
        } else if (where instanceof Europe && where == player.getEurope()) {
            // The market's goods buy onto a ship in Europe (addMarketItems).
            final Goods goods = new Goods(this.client.getGame(), null, type, amount);
            for (Unit ship : player.getEurope().getUnitList()) {
                if (!ship.isCarrier() || !ship.canCarryGoods()
                    || !ship.canAdd(goods)) continue;
                b.add("buy:" + ship.getId() + "," + goodsTypeId,
                    text(StringTemplate.template("quickActionMenu.loadOnTo")
                        .addStringTemplate("%unit%",
                            ship.getLabel(Unit.UnitLabelType.NATIONAL))));
            }
        } else if (where instanceof Unit && player.owns((Unit)where)) {
            final Unit ship = (Unit)where;
            if (ship.isInEurope()) {
                b.add("sell:" + ship.getId() + "," + goodsTypeId,
                    text(player.canTrade(type) ? "unload" : "payArrears"));
            } else if (ship.getColony() != null) {
                b.add("unload:" + ship.getId() + "," + goodsTypeId + "," + amount,
                    text("unload"));
            }
        }
        return b.isEmpty() ? "null" : b.build(text("cargo"));
    }
}
