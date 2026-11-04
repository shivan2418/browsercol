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
     * The values of a group's boolean, integer and select options, by id,
     * nested groups included: {@code {id: value}}.
     *
     * @param group The group.
     * @return The JSON object.
     */
    static Json values(OptionGroup group) {
        final Json out = new Json();
        addValues(out, group);
        return out;
    }

    private static void addValues(Json out, OptionGroup group) {
        for (Option<?> o : group.getOptions()) {
            if (o instanceof OptionGroup) {
                addValues(out, (OptionGroup)o);
            } else if (o instanceof BooleanOption) {
                out.put(o.getId(), ((BooleanOption)o).getValue());
            } else if (o instanceof IntegerOption) { // and select and range options
                out.put(o.getId(), ((IntegerOption)o).getValue());
            }
        }
    }

    /**
     * Set a boolean, integer or select option of a group, as the options
     * dialog does when the player changes it.
     *
     * @param group The group.
     * @param id The option's id.
     * @param value "true" or "false", or a whole number.
     * @return True if the group has such an option and the value fits it.
     */
    static boolean set(OptionGroup group, String id, String value) {
        final Option<?> o = group.getOption(id);
        if (o instanceof BooleanOption) {
            if (!"true".equals(value) && !"false".equals(value)) return false;
            ((BooleanOption)o).setValue(Boolean.valueOf(value));
            return true;
        }
        if (o instanceof SelectOption) {
            final int n;
            try {
                n = Integer.parseInt(value);
            } catch (NumberFormatException e) {
                return false;
            }
            if (!((SelectOption)o).getItemValues().containsKey(n)) return false;
            ((SelectOption)o).setValue(n);
            return true;
        }
        if (o instanceof IntegerOption) {
            final IntegerOption i = (IntegerOption)o;
            final int n;
            try {
                n = Integer.parseInt(value);
            } catch (NumberFormatException e) {
                return false;
            }
            if (n < i.getMinimumValue() || n > i.getMaximumValue()) return false;
            i.setValue(n);
            return true;
        }
        return false;
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
