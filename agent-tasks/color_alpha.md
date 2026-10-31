Issue #35: `colorValue` in `ui/src/resources.ts` drops the alpha byte of a
`urn:color:0xAARRGGBB` value (`& 0xffffff`). FreeCol's
`ColorResource.createColor` keeps it (`new Color(col, colorName.length() > 8)`
in `freecol/src/net/sf/freecol/common/resources/ColorResource.java`, read
it), so a Tileset that gives a map colour such as `color.map.road` an alpha
draws it translucent in FreeCol but opaque in the Browser UI.

Do:
- Carry the alpha from the resource to the draw: an 8-digit value
  (`0xAARRGGBB`) has alpha AA; a 6-digit value and every java.awt.Color name
  stays opaque, exactly as FreeCol decides by the string's length.
- Make the map's draw ops honour it in BOTH renderers: the PixiJS pen and
  the Canvas 2D pen in `ui/src/map.ts` (find where colours reach `pen.line`,
  fills etc.). Keep the colour type change as small as you can: e.g. a
  separate alpha, or a `{rgb, alpha}`; avoid touching every caller that
  passes a literal opaque colour.
- Update the test in `ui/src/resources.test.ts` that documents the current
  choice, and cover an 8-digit value, a 6-digit value and a named colour.
  Add a test that a translucent colour reaches the pen with its alpha.

Done when: `vp check` and `vp test` pass; one or two commits, subject like
`Tileset: keep a colour resource's alpha, as ColorResource does (#35)`.
In the report, say which browser script would show a difference (none of
FreeCol's default data uses alpha today, so probably none).

Traps:
- Java's 0xAARRGGBB parsed with parseInt gives a number above 2^31; mind
  bit operations in JS (`>>> 0`, not `>> 0`).
- Do not change `JAVA_COLORS` (another job tidies it).
