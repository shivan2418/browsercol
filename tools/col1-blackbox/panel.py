"""Read the map screen's side panel (season, year, gold, tax) from a raw
320x200 screenshot by exact glyph matching against glyphs.json."""
import json, os, sys
from PIL import Image

TEXT = (85, 150, 52)
PANEL_X = (241, 320)
LINES = {"date": (51, 57), "money": (58, 64)}
HERE = os.path.dirname(os.path.abspath(__file__))
GLYPH_FILE = os.environ.get("COL1_GLYPHS", os.path.join(HERE, "glyphs.json"))


def is_text(px):
    return abs(px[0] - TEXT[0]) < 12 and abs(px[1] - TEXT[1]) < 12 and abs(px[2] - TEXT[2]) < 12


def glyphs(im, line):
    """Split one panel line into glyph bitmaps; None marks a word gap."""
    y0, y1 = LINES[line]
    x0, x1 = PANEL_X
    cols = []
    for x in range(x0, x1):
        cols.append("".join("#" if is_text(im.getpixel((x, y))) else "." for y in range(y0, y1)))
    out, cur, gap = [], [], 0
    for c in cols:
        if "#" in c:
            if gap >= 3 and out:
                out.append(None)
            cur.append(c)
            gap = 0
        else:
            if cur:
                out.append("|".join(cur))
                cur = []
            gap += 1
    if cur:
        out.append("|".join(cur))
    return out


def load_table():
    try:
        with open(GLYPH_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def read(im, table=None):
    table = load_table() if table is None else table
    res = {}
    for line in LINES:
        res[line] = "".join(" " if g is None else table.get(g, "?") for g in glyphs(im, line))
    return res


if __name__ == "__main__":
    im = Image.open(sys.argv[1]).convert("RGB")
    if len(sys.argv) > 2 and sys.argv[2] == "--dump":
        for line in LINES:
            for i, g in enumerate(glyphs(im, line)):
                print(line, i, g)
    else:
        print(json.dumps(read(im)))
