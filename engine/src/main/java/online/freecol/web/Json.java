package online.freecol.web;

import java.util.List;

import net.sf.freecol.common.model.Tile;


/**
 * Writes the WebGUI's payloads to the Browser UI: one flat JSON object,
 * with arrays and nested objects put as raw JSON.
 */
final class Json {

    private final StringBuilder sb = new StringBuilder("{");


    Json put(String key, String value) {
        return putRaw(key, (value == null) ? "null" : quote(value));
    }

    Json put(String key, boolean value) {
        return putRaw(key, String.valueOf(value));
    }

    Json put(String key, int value) {
        return putRaw(key, String.valueOf(value));
    }

    /** Put a value that is already JSON. */
    Json putRaw(String key, String json) {
        if (this.sb.length() > 1) this.sb.append(',');
        this.sb.append(quote(key)).append(':').append(json);
        return this;
    }

    /** A JSON array of values that are already JSON. */
    static String array(List<String> json) {
        return "[" + String.join(",", json) + "]";
    }

    /** A tile as the Browser UI's map takes it, [x, y], or null for none. */
    static String xy(Tile tile) {
        return (tile == null) ? "null" : "[" + tile.getX() + "," + tile.getY() + "]";
    }

    static String quote(String s) {
        StringBuilder q = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
            case '"': q.append("\\\""); break;
            case '\\': q.append("\\\\"); break;
            case '\n': q.append("\\n"); break;
            case '\r': q.append("\\r"); break;
            case '\t': q.append("\\t"); break;
            default:
                if (c < 0x20) {
                    String hex = Integer.toHexString(c);
                    q.append("\\u").append("0000", hex.length(), 4).append(hex);
                } else {
                    q.append(c);
                }
            }
        }
        return q.append('"').toString();
    }

    @Override
    public String toString() {
        return this.sb + "}";
    }
}
