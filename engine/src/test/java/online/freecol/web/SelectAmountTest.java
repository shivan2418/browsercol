package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;

import org.junit.jupiter.api.Test;


/** The amounts SelectGoodsAmountDialog offers, and how an answer is read. */
class SelectAmountTest {

    @Test
    void aStackOfMoreThanAHundredOffersTheStepsUpToAHundred() {
        final SelectAmount.Choices c = SelectAmount.choices(150, 100);
        assertEquals(List.of(20, 40, 50, 60, 80, 100), c.values);
        assertEquals(Integer.valueOf(100), c.selected);
    }

    @Test
    void theStepsStopAtWhatIsAvailable() {
        final SelectAmount.Choices c = SelectAmount.choices(50, 50);
        assertEquals(List.of(20, 40, 50), c.values);
        assertEquals(Integer.valueOf(50), c.selected);

        assertEquals(List.of(20, 40, 45), SelectAmount.choices(45, -1).values);
        assertNull(SelectAmount.choices(45, -1).selected, "no default, none selected");
    }

    @Test
    void aDefaultThatIsNotAStepIsPutInOrder() {
        final SelectAmount.Choices c = SelectAmount.choices(30, 25);
        assertEquals(List.of(20, 25, 30), c.values);
        assertEquals(Integer.valueOf(25), c.selected);
    }

    @Test
    void aDefaultMoreThanEveryStepGoesLast() {
        // A whole hold of goods is more than the last step, and is suggested.
        final SelectAmount.Choices c = SelectAmount.choices(200, 200);
        assertEquals(List.of(20, 40, 50, 60, 80, 100, 200), c.values);
        assertEquals(Integer.valueOf(200), c.selected);
        // A default beyond what is available is not offered.
        assertNull(SelectAmount.choices(30, 50).selected, "more than there is");
    }

    @Test
    void anAnswerIsTheAmountOrMinusOneForCancelOrNonsense() {
        assertEquals(25, SelectAmount.amount("25", 30));
        assertEquals(30, SelectAmount.amount(" 30 ", 30));
        assertEquals(-1, SelectAmount.amount(null, 30), "closed");
        assertEquals(-1, SelectAmount.amount("lots", 30));
        assertEquals(-1, SelectAmount.amount("31", 30), "more than there is");
        assertEquals(-1, SelectAmount.amount("-5", 30));
    }
}
