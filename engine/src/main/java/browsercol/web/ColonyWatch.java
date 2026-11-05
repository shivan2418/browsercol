package browsercol.web;

import java.beans.PropertyChangeEvent;
import java.beans.PropertyChangeListener;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

import net.sf.freecol.client.FreeColClient;
import net.sf.freecol.common.model.Colony;
import net.sf.freecol.common.model.Colony.ColonyChangeEvent;
import net.sf.freecol.common.model.FreeColGameObject;
import net.sf.freecol.common.model.GoodsType;
import net.sf.freecol.common.model.ModelMessage;
import net.sf.freecol.common.model.StringTemplate;
import net.sf.freecol.common.model.Unit;
import net.sf.freecol.common.model.UnitType;
import net.sf.freecol.common.model.WorkLocation;


/**
 * What ColonyPanel does when the controller tells it its colony changed
 * (ColonyPanel.propertyChange), for the colonies whose panels are open:
 * the government message when a move changes the Sons of Liberty bonus,
 * the 'unit changed from X to Y' panel, and the check that every worker
 * still has work that produces something (ColonyPanel.updateProduction).
 *
 * The messages are shown as the change comes. The check changes units
 * through the controller, which must not happen in the middle of one of
 * its calls, so it waits for {@link #settle}, run when a command is done.
 */
final class ColonyWatch implements PropertyChangeListener {

    private final WebGUI gui;
    private final Set<Colony> open = new HashSet<>();
    /** Colonies whose goods or build queue changed since the last settle. */
    private final Set<Colony> changed = new HashSet<>();
    private boolean settling = false;

    ColonyWatch(WebGUI gui) {
        this.gui = gui;
    }

    /** Start watching a colony whose panel opens (ColonyPanel.addPropertyChangeListeners). */
    void watch(Colony colony) {
        if (!this.open.add(colony)) return;
        colony.addPropertyChangeListener(this);
        if (colony.getGoodsContainer() != null) {
            colony.getGoodsContainer().addPropertyChangeListener(this);
        }
    }

    /** Stop watching a colony whose panel closes. */
    void unwatch(Colony colony) {
        if (!this.open.remove(colony)) return;
        colony.removePropertyChangeListener(this);
        if (colony.getGoodsContainer() != null) {
            colony.getGoodsContainer().removePropertyChangeListener(this);
        }
        this.changed.remove(colony);
    }

    @Override
    public void propertyChange(PropertyChangeEvent event) {
        final String property = event.getPropertyName();
        if (property == null) return;
        final Object source = event.getSource();
        Colony colony = (source instanceof Colony) ? (Colony)source : null;
        if (colony == null) {
            for (Colony c : this.open) {
                if (source == c.getGoodsContainer()) colony = c;
            }
            if (colony == null) return;
        }
        if (ColonyChangeEvent.BONUS_CHANGE.toString().equals(property)) {
            if (colony.getUnitCount() > 0) { // Ignore messages when abandoning
                final ModelMessage msg = colony.checkForGovMgtChangeMessage();
                if (msg != null) this.gui.showInformationPanel(colony, msg);
            }
        } else if (ColonyChangeEvent.UNIT_TYPE_CHANGE.toString().equals(property)) {
            this.gui.showInformationPanel((FreeColGameObject)source, StringTemplate
                .template("colonyPanel.unitChange")
                .addName("%colony%", colony.getName())
                .addNamed("%oldType%", (UnitType)event.getOldValue())
                .addNamed("%newType%", (UnitType)event.getNewValue()));
            this.changed.add(colony);
        } else if (ColonyChangeEvent.BUILD_QUEUE_CHANGE.toString().equals(property)
                   || property.startsWith("model.goods.")) {
            this.changed.add(colony);
        }
    }

    /**
     * Move the workers whose location no longer makes their goods, or has no
     * production type, to the work it suits them for best, for each watched
     * colony that changed (the first half of ColonyPanel.updateProduction).
     *
     * @param client The client, whose controller changes the work.
     */
    void settle(FreeColClient client) {
        if (this.settling || this.changed.isEmpty()) return;
        this.settling = true;
        try {
            final Set<Colony> todo = new HashSet<>(this.changed);
            this.changed.clear();
            for (Colony colony : todo) {
                if (colony.isDisposed()) continue;
                for (WorkLocation wl : colony.getCurrentWorkLocationsList()) {
                    boolean change = false;
                    final boolean check = wl.getProductionType() == null;
                    for (Unit unit : new ArrayList<>(wl.getUnitList())) {
                        if (!check && wl.produces(unit.getWorkType())) continue;
                        final GoodsType workType = wl.getWorkFor(unit);
                        if (workType != null && workType != unit.getWorkType()) {
                            change |= client.getInGameController()
                                .changeWorkType(unit, workType);
                        }
                    }
                    if (change) wl.updateProductionType();
                }
            }
        } finally {
            this.changed.clear();
            this.settling = false;
        }
    }
}
