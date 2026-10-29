package online.freecol.web;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;


class JsonTest {

    @Test
    void writesAnObjectWithEscapedStrings() {
        String json = new Json()
            .put("text", "Say \"hi\"\n\\ \u0001")
            .put("none", (String)null)
            .put("ok", true)
            .put("n", 3)
            .putRaw("list", Json.array(List.of("1", "{}")))
            .toString();

        assertEquals("{\"text\":\"Say \\\"hi\\\"\\n\\\\ \\u0001\",\"none\":null,"
            + "\"ok\":true,\"n\":3,\"list\":[1,{}]}", json);
    }

    @Test
    void anEmptyObject() {
        assertEquals("{}", new Json().toString());
    }
}
