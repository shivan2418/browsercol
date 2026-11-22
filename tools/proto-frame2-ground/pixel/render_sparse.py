"""PROTOTYPE (throwaway): "less is more" Top-down, after render_clumps.py looked chaotic.

Same ground and water as render_clumps.py, but objects follow the tile grid: a few large trees per forest tile, one
hill or one peak per tile, drawn only from the few most complete cut-outs of each layer.

Previous notes:

No texture is faded into another texture (that is what ghosts). Instead:
- Ground is a flat colour per base terrain plus one shared light grain, so soft borders have nothing to double up.
- All detail is opaque objects (trees, hills, peaks) cut out of the AI layers and placed as overlapping clumps, back
  to front. A forest's edge is the edge of its trees.
- Water and coast are drawn by code with bold shapes: deep blue, turquoise shelf, white surf, sand.

Usage: python3 render_clumps.py <out.png> <x0> <y0> <w> <h> [tile px]   (needs scipy: run via uv in Docker)
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
LAY = HERE.parent / 'layers'
out, x0, y0, W, H = sys.argv[1], *map(int, sys.argv[2:6])
T = int(sys.argv[6]) if len(sys.argv) > 6 else 64
d = json.load(open(HERE.parent / 'usa-names.json'))
names = d['tiles']
MH, MW = len(names), len(names[0])
river = {tuple(p) for p in d['river']}
rng = np.random.default_rng(3)

BASE_OF = {'borealForest': 'tundra', 'broadleafForest': 'prairie', 'coniferForest': 'grassland', 'mixedForest': 'plains',
           'rainForest': 'swamp', 'scrubForest': 'desert', 'tropicalForest': 'savannah', 'wetlandForest': 'marsh',
           'hills': 'grassland', 'mountains': 'tundra'}
LAYER_OF = {'borealForest': 'forest-boreal', 'broadleafForest': 'forest-broadleaf', 'coniferForest': 'forest-conifer',
            'mixedForest': 'forest-mixed', 'rainForest': 'forest-rain', 'scrubForest': 'forest-scrub',
            'tropicalForest': 'forest-tropical', 'wetlandForest': 'forest-wetland', 'hills': 'hills', 'mountains': 'mountains'}
WATER = {'ocean', 'highSeas', 'lake'}
# Flat ground colours: bright and readable, each base clearly its own hue.
GROUND = {'plains': (150, 172, 78), 'grassland': (104, 158, 70), 'prairie': (196, 182, 96), 'savannah': (182, 170, 70),
          'marsh': (112, 138, 84), 'swamp': (84, 112, 74), 'desert': (222, 196, 140), 'tundra': (160, 160, 128),
          'arctic': (234, 240, 244)}
BASES = list(GROUND) + ['ocean', 'highSeas', 'lake']
LAYERS = sorted(set(LAYER_OF.values()))
base_idx = np.array([[BASES.index(BASE_OF.get(t, t)) for t in r] for r in names])
layer_idx = np.array([[LAYERS.index(LAYER_OF[t]) if t in LAYER_OF else -1 for t in r] for r in names])
is_water = np.array([[t in WATER for t in r] for r in names])
is_deep = np.array([[t == 'highSeas' for t in r] for r in names])


def noise(h, w, cell, seed):
    g = np.random.default_rng(seed).random((h // cell + 3, w // cell + 3))
    ys, xs = np.mgrid[0:h, 0:w] / cell
    yi, xi = ys.astype(int), xs.astype(int)
    fy, fx = ys - yi, xs - xi
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b, c, e = g[yi, xi], g[yi, xi + 1], g[yi + 1, xi], g[yi + 1, xi + 1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy


PH, PW = H * T, W * T
k = T / 64
wy = (noise(PH, PW, int(48 * k), 1) - .5) * .6 + (noise(PH, PW, int(10 * k), 2) - .5) * .18
wx = (noise(PH, PW, int(48 * k), 3) - .5) * .6 + (noise(PH, PW, int(10 * k), 4) - .5) * .18
ys, xs = np.mgrid[0:PH, 0:PW] / T
ty = np.clip((ys + y0 + wy).astype(int), 0, MH - 1)
tx = np.clip((xs + x0 + wx).astype(int), 0, MW - 1)
bpx, lpx = base_idx[ty, tx], layer_idx[ty, tx]

# Coast: a smoothed land mask, so the shore curves instead of following tile steps.
landf = nd.gaussian_filter((~is_water[ty, tx]).astype(float), 6 * k)
land = landf > .5
deepf = nd.gaussian_filter(is_deep[ty, tx].astype(float), 40 * k)

# Ground: flat colours, softly blended (flat colours can't ghost), plus one shared grain.
pal = np.array([GROUND.get(b, (0, 0, 0)) for b in BASES], float)
img = pal[bpx]
for c in range(3):
    img[..., c] = nd.gaussian_filter(img[..., c], 7 * k)
grain = np.asarray(Image.open(LAY / 'grassland.png').convert('L').resize((4 * T, 4 * T), Image.LANCZOS), float)
grain = grain - nd.gaussian_filter(grain, 6 * k)
grain = np.tile(grain, (PH // (4 * T) + 2, PW // (4 * T) + 2))[(y0 % 4) * T:(y0 % 4) * T + PH, (x0 % 4) * T:(x0 % 4) * T + PW]
img += grain[..., None] * .45
img += ((noise(PH, PW, int(30 * k), 9) - .5) * 22)[..., None]  # large soft light/dark patches

# Water by code: distance from shore decides shelf, surf and depth.
dist_w = nd.distance_transform_edt(~land) / k   # px from land, inside water
dist_l = nd.distance_transform_edt(land) / k    # px from water, inside land
deep = np.array([28, 78, 150.]) * (1 - deepf[..., None]) + np.array([20, 56, 120.]) * deepf[..., None]
shelf = np.array([40, 176, 196.])
t = np.clip(dist_w / 48, 0, 1)[..., None] ** .8
water = shelf * (1 - t) + deep * t
wob = (noise(PH, PW, int(14 * k), 11) - .5) * 4
surf = np.exp(-((dist_w - 5 - wob) / 1.6) ** 2)[..., None]
water = water * (1 - surf * .85) + np.array([236, 248, 246.]) * surf * .85
img[~land] = water[~land]
sand = (land & (dist_l < 4 + wob * .5))
img[sand] = img[sand] * .2 + np.array([232, 214, 160.]) * .8

pic = Image.fromarray(img.clip(0, 255).astype(np.uint8))

# Rivers: tree draining to the sea, drawn on the ground.
draw = ImageDraw.Draw(pic)
N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
parent, q = {}, deque()
for (x, y) in river:
    for dx, dy in N4:
        if 0 <= x + dx < MW and 0 <= y + dy < MH and is_water[y + dy, x + dx]:
            parent[(x, y)] = (x + dx * .8, y + dy * .8)
            q.append((x, y))
            break
while True:
    while q:
        x, y = q.popleft()
        for dx, dy in N4:
            n = (x + dx, y + dy)
            if n in river and n not in parent:
                parent[n] = (x, y)
                q.append(n)
    rest = [p for p in river if p not in parent]
    if not rest:
        break
    parent[rest[0]] = None
    q.append(rest[0])
P = lambda x, y: ((x + .5 - x0) * T, (y + .5 - y0) * T)
rmask = Image.new('L', pic.size)
rd = ImageDraw.Draw(rmask)
for (x, y), par in parent.items():
    if par is None:
        continue
    a, b = P(x, y), P(*par)
    pts = [a]
    for f in (.33, .66):
        pts.append((a[0] + (b[0] - a[0]) * f + rng.normal() * T * .1, a[1] + (b[1] - a[1]) * f + rng.normal() * T * .1))
    pts.append(b)
    draw.line(pts, fill=(226, 212, 160), width=round(9 * k), joint='curve')
    draw.line(pts, fill=(44, 150, 186), width=round(5 * k), joint='curve')
    rd.line(pts, fill=255, width=round(14 * k), joint='curve')
rcut = np.asarray(rmask) > 0


SPEC = {  # layer: (sprite scale vs the 1024 px layer spanning 5 tiles, spacing in tiles)
    'mountains': (1.7 * 4 * T / 1024, .42), 'hills': (1.3 * 4 * T / 1024, .38)}

# Objects: cut each layer into its separate trees / clumps / peaks.
def sprites(name, scale):
    """Split a layer into single crowns: watershed on brightness, seeded at bright crown tops, so cuts run along the
    dark gaps between trees. Crowns cut by the image edge are dropped."""
    a = np.asarray(Image.open(LAY / f'{name}.png').convert('RGBA'))
    solid = a[..., 3] > 110
    if name in SPEC:
        lab = nd.label(nd.binary_erosion(solid, iterations=3))[0]
        lab = np.where(solid, nd.grey_dilation(lab, size=9), 0)
        return crowns(a, lab, scale, name, 1500)
    L = nd.gaussian_filter(a[..., :3].mean(-1), 5 if name.startswith('forest') else 12)
    peaks = (L == nd.maximum_filter(L, 31 if name.startswith('forest') else 90)) & solid
    markers, n = nd.label(peaks)
    markers = markers.astype(np.int32)
    markers[~solid] = -1
    lab = nd.watershed_ift((255 - L.clip(0, 255)).astype(np.uint8), markers)
    lab[~solid] = 0
    return crowns(a, lab, scale, name, 150)


def crowns(a, lab, scale, name, min_area):
    out = []
    for i, sl in enumerate(nd.find_objects(lab.clip(0)), 1):
        if sl is None:
            continue
        own = lab[sl] == i
        if own.sum() < min_area or sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == a.shape[0] or sl[1].stop == a.shape[1]:
            continue
        crop = a[sl].copy()
        crop[..., 3] = (crop[..., 3] * nd.binary_opening(own, iterations=1)).astype(np.uint8)
        im = Image.fromarray(crop)
        out.append(im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS))
    print(name, len(out), 'sprites', file=sys.stderr)
    return out


canvas = pic.convert('RGBA')
SLOTS = [(.28, .30), (.72, .28), (.30, .72), (.72, .70)]
SIZE = {'mountains': 1.05, 'hills': .95}  # object width in tiles; trees default below
TREE = .40
# One consistent set of single sprites (art/, first round): conifers, broadleaf trees, peaks, hills.
ART = HERE.parent / 'art'
ld = lambda ids, kind: [Image.open(ART / f'{kind}{i}.png').convert('RGBA') for i in ids]
CON, BRD = ld([0, 1, 2, 3, 8, 9], 'tree'), ld([4, 5, 6, 7, 10, 11], 'tree')
best = {'forest-conifer': CON, 'forest-boreal': CON, 'forest-broadleaf': BRD, 'forest-tropical': BRD,
        'forest-rain': BRD, 'forest-wetland': BRD + CON[:2], 'forest-scrub': BRD, 'forest-mixed': CON + BRD,
        'mountains': ld(range(9), 'mountain'), 'hills': ld(range(9), 'hill')}
placed = []
for ty_ in range(y0, min(MH, y0 + H)):
    for tx_ in range(x0, min(MW, x0 + W)):
        name = LAYER_OF.get(names[ty_][tx_])
        if not name or not best.get(name):
            continue
        cx, cy = (tx_ - x0) * T, (ty_ - y0) * T
        if name in SIZE:
            slots, wid = [(.5 + rng.uniform(-.06, .06), .48 + rng.uniform(-.05, .05))], SIZE[name]
        else:
            slots = [(u + rng.uniform(-.07, .07), v + rng.uniform(-.07, .07)) for u, v in SLOTS if rng.random() > .12]
            wid = TREE
        for u, v in slots:
            px, py = int(cx + u * T), int(cy + v * T)
            if not (0 <= px < PW and 0 <= py < PH) or rcut[py, px] or not land[py, px]:
                continue
            s = best[name][rng.integers(len(best[name]))]
            w_ = round(wid * T * rng.uniform(.92, 1.08))
            s = s.resize((w_, max(1, round(s.height * w_ / s.width))), Image.LANCZOS)
            if rng.random() < .5:
                s = s.transpose(Image.FLIP_LEFT_RIGHT)
            placed.append((py + s.height // 2, px, s))
placed.sort(key=lambda p: p[0])  # back to front: the lower on screen, the later
shadow_cache = {}
for py, px, s in placed:
    x_, y_ = px - s.width // 2, py - s.height
    sh = shadow_cache.get(id(s))
    if sh is None:
        al = np.asarray(s)[..., 3].astype(float) * .32
        sh = Image.fromarray(np.dstack([np.zeros_like(al)] * 3 + [al]).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2 * k))
        shadow_cache[id(s)] = sh
    pass  # canvas.alpha_composite(sh, (max(0, x_ + round(3 * k)), max(0, y_ + round(3 * k)))) if x_ >= 0 and y_ >= 0 else None
    canvas.paste(s, (x_, y_), s)
canvas.convert('RGB').save(out)
print('ok', out, len(placed), 'objects')
