"""Label glyphs from a screenshot whose panel text is known.
Usage: learn.py RAW.png LINE "expected text" [GLYPHS.json]
A space in the text matches a word gap. Conflicts are reported, not overwritten."""
import json, sys
from PIL import Image
import panel

img, line, text = sys.argv[1:4]
path = sys.argv[4] if len(sys.argv) > 4 else panel.GLYPH_FILE
table = panel.load_table() if len(sys.argv) <= 4 else (json.load(open(path)) if __import__("os").path.exists(path) else {})
gs = panel.glyphs(Image.open(img).convert("RGB"), line)
if len(gs) != len(text):
    sys.exit(f"{len(gs)} glyphs on screen but {len(text)} characters given")
for g, ch in zip(gs, text):
    if g is None:
        if ch != " ":
            sys.exit(f"word gap where {ch!r} was expected")
        continue
    old = table.get(g)
    if old is not None and old != ch:
        print(f"conflict: glyph already {old!r}, not {ch!r}; kept {old!r}")
        continue
    table[g] = ch
json.dump(table, open(path, "w"), indent=0, sort_keys=True)
print(f"{len(table)} glyphs")
