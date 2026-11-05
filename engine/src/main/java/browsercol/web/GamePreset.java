package browsercol.web;

import java.awt.Color;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import net.sf.freecol.common.model.Game;
import net.sf.freecol.FreeCol;
import net.sf.freecol.common.model.EuropeanNationType;
import net.sf.freecol.common.model.Nation;
import net.sf.freecol.common.model.NationOptions.Advantages;
import net.sf.freecol.common.model.NationOptions.NationState;
import net.sf.freecol.common.model.Specification;
import net.sf.freecol.common.option.AbstractOption;
import net.sf.freecol.common.option.BooleanOption;
import net.sf.freecol.common.option.IntegerOption;
import net.sf.freecol.common.option.OptionGroup;
import net.sf.freecol.common.option.StringOption;
import net.sf.freecol.common.option.TextOption;
import net.sf.freecol.common.option.UnitListOption;
import net.sf.freecol.server.FreeColServer;
import net.sf.freecol.server.generator.SimpleMapGenerator;


/**
 * Everything the start screen sets for a new game: the rules, the
 * difficulty level, the human player's nation, option values (game, map
 * generator and difficulty options alike, by their FreeCol ids) and a map
 * seed. A debug quick start reads one from JSON; the start screen can
 * build one from the player's choices and apply it the same way.
 *
 * <pre>
 * { "rules": "classic",
 *   "difficulty": "model.difficulty.medium",
 *   "nation": "model.nation.england",
 *   "seed": 42,
 *   "advantages": "SELECTABLE",
 *   "nationType": "model.nationType.trade",
 *   "colors": { "model.nation.england": "0x336699" },
 *   "unavailable": [ "model.nation.spanish", "model.nation.tupi" ],
 *   "options": { "model.option.mapWidth": 200, "model.option.fogOfWar": false },
 *   "setup": [ { "action": "addColony" },
 *              { "action": "addBuilding", "type": "model.building.schoolhouse" } ] }
 * </pre>
 *
 * The {@code setup} is a scenario: debug requests ({@link DebugActions}) the
 * Engine runs, in order, once the game has started ({@link ServerEngine#setup}).
 * A request with no x and y acts where the last colony or request was.
 *
 * {@code advantages} is FreeCol's National Advantages choice (SELECTABLE,
 * FIXED or NONE); {@code nationType} the human nation's own advantage, which
 * only SELECTABLE allows; {@code colors} a nation's colour, as the
 * specification writes it; {@code unavailable} the other nations left out of
 * the game (FreeCol's NOT_AVAILABLE; the rest play as AI).
 *
 * Every key is optional. An unknown key, option or id fails with a message
 * naming it; nothing falls back to a default silently.
 *
 * <p>The seed. Desktop FreeCol's {@code --seed} reseeds a game only when it
 * loads a saved one; a new game always gets {@code new Random()}. So the
 * seed here replaces the server's random numbers (the game's, the map
 * generator's and the in-game controller's) right after the server is
 * made, before anything is generated.
 */
public final class GamePreset {

    /** The ruleset id, or null for the caller's. */
    public final String rules;
    /** The difficulty level id, or null for the default. */
    public final String difficulty;
    /** The nation id of the human player, or null for the first free one. */
    public final String nation;
    /** The seed of the server's random numbers, or null for a random game. */
    public final Long seed;
    /** FreeCol's national advantages choice, or null for the default. */
    public final Advantages advantages;
    /** The human nation's own nation type id, or null for the nation's. */
    public final String nationType;
    /** Nation id to colour, as {@code 0xrrggbb}. */
    public final Map<String, String> colors;
    /** The ids of the nations that do not take part. */
    public final List<String> unavailable;
    /** Option id to value: a Boolean, Long or String. */
    public final Map<String, Object> options;
    /**
     * The debug requests (see {@link DebugActions}) that set up the game
     * state once the game has started, in order: a scenario.
     */
    public final List<Map<?, ?>> setup;

    public GamePreset(String rules, String difficulty, String nation,
                      Long seed, Map<String, Object> options) {
        this(rules, difficulty, nation, seed, options, new ArrayList<>());
    }

    public GamePreset(String rules, String difficulty, String nation,
                      Long seed, Map<String, Object> options,
                      List<Map<?, ?>> setup) {
        this(rules, difficulty, nation, seed, options, setup,
             null, null, new LinkedHashMap<>(), new ArrayList<>());
    }

    public GamePreset(String rules, String difficulty, String nation,
                      Long seed, Map<String, Object> options,
                      List<Map<?, ?>> setup, Advantages advantages,
                      String nationType, Map<String, String> colors,
                      List<String> unavailable) {
        this.advantages = advantages;
        this.nationType = nationType;
        this.colors = new LinkedHashMap<>(colors);
        this.unavailable = new ArrayList<>(unavailable);
        this.setup = new ArrayList<>(setup);
        this.rules = rules;
        this.difficulty = difficulty;
        this.nation = nation;
        this.seed = seed;
        this.options = new LinkedHashMap<>(options);
    }

    /** A preset that sets nothing. */
    public static GamePreset none() {
        return new GamePreset(null, null, null, null, new LinkedHashMap<>());
    }

    /**
     * Read a preset from JSON.
     *
     * @param json The JSON text.
     * @return The preset.
     * @exception IllegalArgumentException if the JSON is malformed or has
     *     a key or a value of the wrong kind.
     */
    public static GamePreset parse(String json) {
        Object top = JsonReader.read(json);
        if (!(top instanceof Map)) throw bad("a preset is a JSON object");
        String rules = null, difficulty = null, nation = null;
        Long seed = null;
        Map<String, Object> options = new LinkedHashMap<>();
        List<Map<?, ?>> setup = new ArrayList<>();
        Advantages advantages = null;
        String nationType = null;
        Map<String, String> colors = new LinkedHashMap<>();
        List<String> unavailable = new ArrayList<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>)top).entrySet()) {
            String key = (String)e.getKey();
            Object v = e.getValue();
            switch (key) {
            case "rules": rules = string(key, v); break;
            case "difficulty": difficulty = string(key, v); break;
            case "nation": nation = string(key, v); break;
            case "seed": seed = seed(v); break;
            case "advantages": advantages = advantages(string(key, v)); break;
            case "nationType": nationType = string(key, v); break;
            case "colors":
                if (!(v instanceof Map)) {
                    throw bad("\"colors\" is an object of nation ids and colours");
                }
                for (Map.Entry<?, ?> ce : ((Map<?, ?>)v).entrySet()) {
                    colors.put((String)ce.getKey(),
                               string("colors", ce.getValue()));
                }
                break;
            case "unavailable":
                if (!(v instanceof List)) {
                    throw bad("\"unavailable\" is a list of nation ids");
                }
                for (Object o : (List<?>)v) unavailable.add(string(key, o));
                break;
            case "options":
                if (!(v instanceof Map)) {
                    throw bad("\"options\" is an object of option ids and values");
                }
                for (Map.Entry<?, ?> oe : ((Map<?, ?>)v).entrySet()) {
                    options.put((String)oe.getKey(), oe.getValue());
                }
                break;
            case "setup":
                if (!(v instanceof List)) {
                    throw bad("\"setup\" is a list of debug requests");
                }
                for (Object o : (List<?>)v) {
                    if (!(o instanceof Map)) throw bad("a \"setup\" request is an object");
                    setup.add((Map<?, ?>)o);
                }
                break;
            default:
                throw bad("unknown key \"" + key
                    + "\" (known: rules, difficulty, nation, seed, advantages, "
                    + "nationType, colors, unavailable, options, setup)");
            }
        }
        return new GamePreset(rules, difficulty, nation, seed, options, setup,
                              advantages, nationType, colors, unavailable);
    }

    private static Advantages advantages(String name) {
        for (Advantages a : Advantages.values()) {
            if (a.name().equalsIgnoreCase(name)) return a;
        }
        throw bad("unknown advantages \"" + name
            + "\" (known: SELECTABLE, FIXED, NONE)");
    }

    private static String string(String key, Object v) {
        if (!(v instanceof String)) throw bad("\"" + key + "\" is a string");
        return (String)v;
    }

    /** A whole number, or a string of one for seeds beyond what JSON numbers hold exactly. */
    private static Long seed(Object v) {
        try {
            if (v instanceof Long) return (Long)v;
            if (v instanceof String) return Long.valueOf((String)v);
        } catch (NumberFormatException ex) {
            // fall through
        }
        throw bad("\"seed\" is a whole number, or a string of one");
    }

    static IllegalArgumentException bad(String why) {
        return new IllegalArgumentException("Bad preset: " + why);
    }

    /**
     * Set the difficulty level and the options on a specification.
     *
     * @param spec The specification, prepared with a difficulty level.
     * @exception IllegalArgumentException if the difficulty, the nation or
     *     an option is unknown, or an option's value is not one it takes.
     */
    public void applyTo(Specification spec) {
        if (this.difficulty != null) {
            OptionGroup level = spec.getDifficultyOptionGroup(this.difficulty);
            if (level == null) {
                List<String> ids = new ArrayList<>();
                spec.getDifficultyLevels().forEach(l -> ids.add(l.getId()));
                throw bad("unknown difficulty \"" + this.difficulty
                    + "\" (known: " + String.join(", ", ids) + ")");
            }
            spec.applyDifficultyLevel(level);
        }
        if (this.nation != null) requireNation(spec);
        for (Map.Entry<String, String> e : this.colors.entrySet()) {
            Nation n = spec.getNation(e.getKey());
            if (n == null) throw bad("unknown nation \"" + e.getKey() + "\"");
            n.setColor(color(e.getValue()));
        }
        if (this.nationType != null) {
            if (this.nation == null) {
                throw bad("\"nationType\" needs a \"nation\" to give it to");
            }
            if (this.advantages != null && this.advantages != Advantages.SELECTABLE) {
                throw bad("\"nationType\" can only be chosen when advantages are SELECTABLE");
            }
            EuropeanNationType type = null;
            for (EuropeanNationType t : spec.getVisibleEuropeanNationTypes()) {
                if (t.getId().equals(this.nationType)) type = t;
            }
            if (type == null) {
                throw bad("unknown nationType \"" + this.nationType + "\"");
            }
            requireNation(spec).setType(type);
        }
        if (!this.unavailable.isEmpty() && this.nation == null) {
            throw bad("\"unavailable\" needs a \"nation\" that plays");
        }
        for (String id : this.unavailable) {
            if (id.equals(this.nation)) {
                throw bad("the human's nation \"" + id + "\" cannot be unavailable");
            }
            if (spec.getNation(id) == null) {
                throw bad("unknown nation \"" + id + "\"");
            }
        }
        for (Map.Entry<String, Object> e : this.options.entrySet()) {
            setOption(spec, e.getKey(), e.getValue());
        }
    }

    /**
     * Make the nation the one the human logs in as, and seed the random
     * numbers of a server's new game.
     *
     * @param server The server, in pre-game with no player yet.
     * @exception IllegalArgumentException if the nation is unknown.
     */
    public void applyTo(FreeColServer server) {
        final Game game = server.getGame();
        if (this.nation != null) chooseNation(game);
        if (this.seed != null) {
            Random random = new Random(this.seed);
            server.setServerRandom(random);
            server.setMapGenerator(new SimpleMapGenerator(random));
            server.getInGameController().setRandom(random);
        }
    }

    private static Color color(String text) {
        try {
            return new Color(Integer.decode(text.replaceFirst("^0[xX]", "#")));
        } catch (NumberFormatException ex) {
            throw bad("\"" + text + "\" is not a colour like 0xrrggbb");
        }
    }

    private static void setOption(Specification spec, String id, Object v) {
        if (!spec.hasOption(id, AbstractOption.class)) {
            throw bad("unknown option \"" + id + "\"");
        }
        AbstractOption<?> option = spec.getOption(id, AbstractOption.class);
        if (option instanceof BooleanOption) {
            if (!(v instanceof Boolean)) throw wrongValue(id, v, "true or false");
            ((BooleanOption)option).setValue((Boolean)v);
        } else if (option instanceof IntegerOption) {
            // Integer, range, select and percentage options.
            IntegerOption io = (IntegerOption)option;
            if (!(v instanceof Long)) throw wrongValue(id, v, "a whole number");
            long n = (Long)v;
            if (n < io.getMinimumValue() || n > io.getMaximumValue()) {
                throw wrongValue(id, v, "a number from " + io.getMinimumValue()
                    + " to " + io.getMaximumValue());
            }
            io.setValue((int)n);
            if (io.getValue() != n) throw wrongValue(id, v, "one of its listed choices");
        } else if (option instanceof StringOption) {
            if (!(v instanceof String)) throw wrongValue(id, v, "a string");
            ((StringOption)option).setValue((String)v);
        } else if (option instanceof TextOption) {
            if (!(v instanceof String)) throw wrongValue(id, v, "a string");
            ((TextOption)option).setValue((String)v);
        } else if (option instanceof UnitListOption) {
            if (!(v instanceof List)) throw wrongValue(id, v, "a list of {type, role, number}");
            String why = OptionsJson.setUnits((UnitListOption)option, (List<?>)v);
            if (why != null) throw wrongValue(id, v, why);
        } else {
            throw bad("option \"" + id + "\" is a " + option.getClass().getSimpleName()
                + ", which a preset cannot set");
        }
    }

    private static IllegalArgumentException wrongValue(String id, Object v, String wanted) {
        return bad("option \"" + id + "\" takes " + wanted + ", not " + v);
    }

    private Nation requireNation(Specification spec) {
        List<String> ids = new ArrayList<>();
        for (Nation n : spec.getEuropeanNations()) {
            ids.add(n.getId());
            if (n.getId().equals(this.nation)) return n;
        }
        throw bad("unknown nation \"" + this.nation
            + "\" (known: " + String.join(", ", ids) + ")");
    }

    /**
     * Make the nation the one the human logs in as: the only nation that
     * is still available. The other nations that were available play as AI.
     */
    private void chooseNation(Game game) {
        Nation chosen = requireNation(game.getSpecification());
        Map<Nation, NationState> nations = game.getNationOptions().getNations();
        for (Map.Entry<Nation, NationState> e : nations.entrySet()) {
            if (e.getValue() == NationState.AVAILABLE) e.setValue(NationState.AI_ONLY);
        }
        nations.put(chosen, NationState.AVAILABLE);
        for (String id : this.unavailable) {
            nations.put(game.getSpecification().getNation(id),
                        NationState.NOT_AVAILABLE);
        }
    }
}
