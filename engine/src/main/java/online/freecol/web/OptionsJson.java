package online.freecol.web;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import net.sf.freecol.common.i18n.Messages;
import net.sf.freecol.common.option.BooleanOption;
import net.sf.freecol.common.option.IntegerOption;
import net.sf.freecol.common.option.Option;
import net.sf.freecol.common.option.OptionGroup;
import net.sf.freecol.common.option.PercentageOption;
import net.sf.freecol.common.option.SelectOption;
import net.sf.freecol.common.option.StringOption;
import net.sf.freecol.common.option.TextOption;


/**
 * An option group as the Browser UI's option editor gets it (what
 * FreeCol's DifficultyDialog and GameOptionsDialog show). A node is
 * {@code {id, label, description, kind, ...}}:
 *
 * <ul>
 * <li>{@code group}: {@code children}, nested groups included;</li>
 * <li>{@code boolean}: {@code value} is true or false;</li>
 * <li>{@code integer}: {@code value}, {@code min}, {@code max};</li>
 * <li>{@code percentage}: as integer, 0 to 100;</li>
 * <li>{@code select}: a select or range option, {@code value} is one of
 *     the {@code choices}' numbers, each {@code {value, label}};</li>
 * <li>{@code string}: {@code value}, and {@code choices}, each
 *     {@code {value, label}} with a string value; an option that lists
 *     none has its value alone;</li>
 * <li>{@code text}: a string of free text.</li>
 * </ul>
 *
 * An option of another kind (a list of units, a file) is left out, as is
 * a group left with nothing to show.
 */
final class OptionsJson {

    private OptionsJson() {}

    /** A label from its key, or the key's "name" entry, or the text itself. */
    private static String text(String key) {
        if (!Messages.containsKey(key) && Messages.containsKey(key + ".name")) {
            return Messages.message(key + ".name");
        }
        return Messages.message(key);
    }

    private static Json node(String kind, Option<?> option) {
        final String id = option.getId();
        return new Json().put("id", id).put("kind", kind)
            .put("label", Messages.getName(id))
            .put("description", Messages.containsKey(id + ".shortDescription")
                ? Messages.getShortDescription(id) : null);
    }

    /**
     * An option group.
     *
     * @param group The group.
     * @return The group's node, or null if nothing in it can be shown.
     */
    static Json of(OptionGroup group) {
        final List<String> children = new ArrayList<>();
        for (Option<?> o : group.getOptions()) {
            final Json child = (o instanceof OptionGroup) ? of((OptionGroup)o) : leaf(o);
            if (child != null) children.add(child.toString());
        }
        if (children.isEmpty()) return null;
        return node("group", group).putRaw("children", Json.array(children));
    }

    private static Json leaf(Option<?> o) {
        if (o instanceof BooleanOption) {
            return node("boolean", o).putRaw("value", String.valueOf(((BooleanOption)o).getValue()));
        }
        if (o instanceof SelectOption) { // and RangeOption
            final SelectOption s = (SelectOption)o;
            final List<String> choices = new ArrayList<>();
            for (Map.Entry<Integer, String> e : s.getItemValues().entrySet()) {
                choices.add(new Json().putRaw("value", String.valueOf(e.getKey()))
                    .put("label", s.localizeLabels() ? text(e.getValue()) : e.getValue())
                    .toString());
            }
            return node("select", o).putRaw("value", String.valueOf(s.getValue()))
                .putRaw("choices", Json.array(choices));
        }
        if (o instanceof IntegerOption) {
            final IntegerOption i = (IntegerOption)o;
            final boolean percent = o instanceof PercentageOption;
            return node(percent ? "percentage" : "integer", o)
                .putRaw("value", String.valueOf(i.getValue()))
                .put("min", percent ? 0 : i.getMinimumValue())
                .put("max", percent ? 100 : i.getMaximumValue());
        }
        if (o instanceof StringOption) {
            final StringOption s = (StringOption)o;
            final Json json = node("string", o).put("value", s.getValue());
            // Only the custom difficulty level lists the choices of its
            // string options; the other levels have the value alone.
            final List<String> values = new ArrayList<>(s.getChoices());
            if (values.isEmpty() && s.getValue() != null) values.add(s.getValue());
            final List<String> choices = new ArrayList<>();
            for (String c : values) {
                choices.add(new Json().put("value", c).put("label", text(c)).toString());
            }
            return json.putRaw("choices", Json.array(choices));
        }
        if (o instanceof TextOption) {
            return node("text", o).put("value", ((TextOption)o).getValue());
        }
        return null;
    }

    /**
     * The payload of the options event.
     *
     * @param kind "difficulty" or "game".
     * @param title The window's title.
     * @param group The group to show.
     * @param ok The close button's label.
     * @return The JSON object.
     */
    static Json event(String kind, String title, OptionGroup group, String ok) {
        final Json root = of(group);
        return new Json().put("kind", kind).put("title", title)
            .putRaw("root", (root == null) ? "null" : root.toString())
            .put("ok", ok);
    }
}
