# FreeCol+'s silver bonus: FreeCol's silver cart with its grey load recoloured
# to a bright, cool silver, so it no longer looks like the ore cart. The cart
# and wheels stay as FreeCol has them. The load is where FreeCol's ore cart
# (the same cart) is brown.
#   python3 -I silver.py <freecol/data/default/resources/images/bonus> <out dir>
# Writes silver.png (45x36, the map's size), made from FreeCol's 180x143 art.
import colorsys, sys
from PIL import Image, ImageFilter

bonus, out = sys.argv[1:3]
ore = Image.open(f'{bonus}/ore.size9.png').convert('RGBA')
silver = Image.open(f'{bonus}/silver.size9.png').convert('RGBA')
W, H = silver.size

load = Image.new('L', (W, H))
lp, op = load.load(), ore.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = op[x, y]
        if a > 40 and colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[1] > 0.28:
            lp[x, y] = 255
load = load.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))

# Shadow to highlight: steel blue to near white.
SILVER = [(0.0, (52, 62, 78)), (0.35, (128, 142, 160)), (0.7, (206, 216, 230)), (1.0, (252, 254, 255))]


def ramp(l):
    for (a, ca), (b, cb) in zip(SILVER, SILVER[1:]):
        if l <= b:
            f = (l - a) / (b - a)
            return [ca[i] + (cb[i] - ca[i]) * f for i in range(3)]
    return SILVER[-1][1]


sp, lp = silver.load(), load.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = sp[x, y]
        s = lp[x, y] / 255
        if a == 0 or s == 0:
            continue
        l = (0.3 * r + 0.59 * g + 0.11 * b) / 255
        c = ramp(min(1, max(0, (l - 0.15) / 0.7)) ** 0.85)
        sp[x, y] = tuple(round(v + (c[i] - v) * s) for i, v in enumerate((r, g, b))) + (a,)

silver.resize((45, 36), Image.LANCZOS).save(f'{out}/silver.png')
