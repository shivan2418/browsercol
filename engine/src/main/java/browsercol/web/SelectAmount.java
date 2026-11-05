package browsercol.web;

import java.util.ArrayList;
import java.util.List;


/**
 * What FreeCol's SelectGoodsAmountDialog offers, without its Swing: the
 * amounts its editable combo box lists and the one it selects at first,
 * and the reading of the amount the player gives back. The dialog is the
 * WebGUI's {@code amount} question.
 */
final class SelectAmount {

    /** SelectGoodsAmountDialog's amounts, in order. */
    private static final int[] AMOUNTS = { 20, 40, 50, 60, 80, 100 };

    /** The amounts listed, and the one selected at first (or null). */
    static final class Choices {
        final List<Integer> values;
        final Integer selected;

        Choices(List<Integer> values, Integer selected) {
            this.values = values;
            this.selected = selected;
        }
    }

    private SelectAmount() {}

    /**
     * The amounts as SelectGoodsAmountDialog lists them: its steps below
     * what is available, then what is available (unless more than the last
     * step), with a default that is not one of them put in order.
     *
     * @param available The most that may be chosen.
     * @param defaultAmount The amount to select at first, or not positive
     *     for none.
     */
    static Choices choices(int available, int defaultAmount) {
        final List<Integer> values = new ArrayList<>();
        int defaultIndex = -1;
        for (int index = 0; index < AMOUNTS.length; index++) {
            if (AMOUNTS[index] < available) {
                if (AMOUNTS[index] == defaultAmount) defaultIndex = index;
                values.add(AMOUNTS[index]);
            } else {
                if (available == defaultAmount) defaultIndex = index;
                values.add(available);
                break;
            }
        }
        if (defaultAmount > 0 && defaultIndex < 0) {
            for (int index = 0; index < values.size(); index++) {
                if (defaultAmount < values.get(index)) {
                    values.add(index, defaultAmount);
                    defaultIndex = index;
                    break;
                }
            }
            // The default is more than every step, as a whole hold of goods
            // is: it goes last, if it is within what is available.
            if (defaultIndex < 0 && defaultAmount <= available) {
                defaultIndex = values.size();
                values.add(defaultAmount);
            }
        }
        return new Choices(values,
            (defaultIndex < 0) ? null : values.get(defaultIndex));
    }

    /**
     * The amount the player chose, as the dialog returns it: -1 for a
     * closed dialog, and for an answer its input verifier would refuse
     * (not a whole number from 0 to what is available).
     *
     * @param answer The Browser UI's answer.
     * @param available The most that may be chosen.
     */
    static int amount(String answer, int available) {
        if (answer == null) return -1;
        final int n;
        try {
            n = Integer.parseInt(answer.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
        return (n < 0 || n > available) ? -1 : n;
    }
}
