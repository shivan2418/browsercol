package browsercol.shim.java.text;

import java.util.Comparator;
import java.util.Locale;

/**
 * java.text.Collator, which TeaVM lacks, for sorting colony names: plain
 * case-insensitive order, ignoring the locale.
 */
public class TCollator implements Comparator<Object> {

    public static TCollator getInstance() {
        return new TCollator();
    }

    public static TCollator getInstance(Locale locale) {
        return new TCollator();
    }

    public int compare(String a, String b) {
        return a.compareToIgnoreCase(b);
    }

    @Override
    public int compare(Object a, Object b) {
        return compare(a.toString(), b.toString());
    }
}
