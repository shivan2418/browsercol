package online.freecol.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;


/**
 * A small JSON reader for the Engine's own settings files, the reverse of
 * {@link Json}. Objects come out as maps in file order, arrays as lists,
 * whole numbers as Long, other numbers as Double.
 */
final class JsonReader {

    private final String s;
    private int i = 0;

    private JsonReader(String s) {
        this.s = s;
    }

    /**
     * Read one JSON value.
     *
     * @param json The text.
     * @return A Map, List, String, Long, Double, Boolean or null.
     * @exception IllegalArgumentException if the text is not JSON.
     */
    static Object read(String json) {
        JsonReader r = new JsonReader(json);
        Object v = r.value();
        r.space();
        if (r.i < json.length()) throw r.fail("unexpected text after the value");
        return v;
    }

    private IllegalArgumentException fail(String why) {
        return new IllegalArgumentException("Bad JSON at character " + this.i + ": " + why);
    }

    private void space() {
        while (this.i < this.s.length() && Character.isWhitespace(this.s.charAt(this.i))) this.i++;
    }

    private char peek() {
        space();
        if (this.i >= this.s.length()) throw fail("the text ends early");
        return this.s.charAt(this.i);
    }

    private void expect(char c) {
        if (peek() != c) throw fail("expected '" + c + "'");
        this.i++;
    }

    private Object value() {
        char c = peek();
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"') return string();
        if (this.s.startsWith("true", this.i)) { this.i += 4; return Boolean.TRUE; }
        if (this.s.startsWith("false", this.i)) { this.i += 5; return Boolean.FALSE; }
        if (this.s.startsWith("null", this.i)) { this.i += 4; return null; }
        return number();
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        expect('{');
        if (peek() == '}') { this.i++; return m; }
        while (true) {
            if (peek() != '"') throw fail("expected a key");
            String key = string();
            expect(':');
            Object v = value();
            if (m.containsKey(key)) throw fail("\"" + key + "\" appears twice");
            m.put(key, v);
            if (peek() == ',') { this.i++; continue; }
            expect('}');
            return m;
        }
    }

    private List<Object> array() {
        List<Object> l = new ArrayList<>();
        expect('[');
        if (peek() == ']') { this.i++; return l; }
        while (true) {
            l.add(value());
            if (peek() == ',') { this.i++; continue; }
            expect(']');
            return l;
        }
    }

    private String string() {
        expect('"');
        StringBuilder b = new StringBuilder();
        while (this.i < this.s.length()) {
            char c = this.s.charAt(this.i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            if (this.i >= this.s.length()) break;
            char e = this.s.charAt(this.i++);
            switch (e) {
            case '"': case '\\': case '/': b.append(e); break;
            case 'b': b.append('\b'); break;
            case 'f': b.append('\f'); break;
            case 'n': b.append('\n'); break;
            case 'r': b.append('\r'); break;
            case 't': b.append('\t'); break;
            case 'u':
                if (this.i + 4 > this.s.length()) throw fail("a short \\u escape");
                try {
                    b.append((char)Integer.parseInt(this.s.substring(this.i, this.i + 4), 16));
                } catch (NumberFormatException ex) {
                    throw fail("a bad \\u escape");
                }
                this.i += 4;
                break;
            default: throw fail("a bad escape \\" + e);
            }
        }
        throw fail("a string that does not end");
    }

    private Object number() {
        int start = this.i;
        while (this.i < this.s.length() && "+-0123456789.eE".indexOf(this.s.charAt(this.i)) >= 0) this.i++;
        String t = this.s.substring(start, this.i);
        try {
            if (t.matches("-?[0-9]+")) return Long.valueOf(t);
            if (!t.isEmpty()) return Double.valueOf(t);
        } catch (NumberFormatException ex) {
            // fall through
        }
        this.i = start;
        throw fail("expected a value");
    }
}
