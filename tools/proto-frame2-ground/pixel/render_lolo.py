"""PROTOTYPE (throwaway): Lolonization's layered forest, ported to Top-down.

A rule-for-rule port of Lolonization's prototypes/connected/layered.js (leg C, the owner's rule), with the camera
looking straight down: its 48 single trees (lolo-trees/), Poisson placement driven by a signed depth field (dense
inside, thinning to young trees and saplings at the edge, ragged by noise), species mixes per forest type, a darker
forest floor, contact shadows, no trees on beach or river banks, no lone trees. Ground and water as render_clumps.py.
Hills and mountains: one first-round sprite per tile, sorted in with the trees.

Usage: python3 render_lolo.py <out.png> <x0> <y0> <w> <h> [tile px]   (needs scipy: run via uv in Docker)
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


# ---------- Lolonization's layered forest (layered.js), top-down ----------
FOREST_KIND = {'borealForest': 'Boreal', 'broadleafForest': 'Broadleaf', 'coniferForest': 'Conifer',
               'mixedForest': 'Mixed', 'rainForest': 'Rain', 'scrubForest': 'Scrub', 'tropicalForest': 'Tropical',
               'wetlandForest': 'Wetland'}
MIX = {
    'Mixed': {'kinds': {'oak': .3, 'autumn': .35, 'fir': .35}},
    'Broadleaf': {'kinds': {'oak': .8, 'autumn': .2}},
    'Conifer': {'kinds': {'fir': .8, 'boreal': .2}},
    'Boreal': {'kinds': {'boreal': .75, 'fir': .25}},
    'Tropical': {'kinds': {'palm': .6, 'jungle': .4}},
    'Rain': {'kinds': {'jungle': .75, 'palm': .25}, 'space': 1.15},
    'Scrub': {'kinds': {'scrub': 1}, 'space': 1.35, 'fill': .7},
    'Wetland': {'kinds': {'swamp': .85, 'oak': .15}, 'space': 1.1, 'fill': .85},
}
SIZE = {'oak': .26, 'autumn': .26, 'fir': .31, 'boreal': .31, 'palm': .28, 'jungle': .44, 'scrub': .2, 'swamp': .28}
TW = float(__import__('os').environ.get('TW', 1.41)) * T  # Lolonization's sizes are in iso tile widths (2*sqrt(.5)*T)
LT = HERE.parent / 'lolo-trees'
art = {}
for e in json.load(open(LT / 'trees.json')):
    art.setdefault(e['species'], []).append(Image.open(LT / e['file']).convert('RGBA'))
tallest = {k: max(i.height for i in a) for k, a in art.items()}

tname = lambda x, y: names[y][x] if 0 <= x < MW and 0 <= y < MH else 'ocean'
isF = lambda x, y: tname(x, y) in FOREST_KIND
isRel = lambda x, y: tname(x, y) in ('hills', 'mountains')
isW = lambda x, y: tname(x, y) in WATER

# Signed depth field in tiles (> 0 inside a forest), sampled K per tile over the region plus a margin.
K, MG = 8, 3
gx0, gy0, GW, GH = x0 - MG, y0 - MG, W + 2 * MG, H + 2 * MG
inF = np.array([[isF(gx0 + x // K, gy0 + y // K) for x in range(GW * K)] for y in range(GH * K)])
sd = np.where(inF, (nd.distance_transform_edt(inF) - .5) / K, -(nd.distance_transform_edt(~inF) - .5) / K)
def depthAt(px, py):
    return float(nd.map_coordinates(sd, [[(py - gy0) * K - .5], [(px - gx0) * K - .5]], order=1, mode='nearest')[0])

def fbm(x, y):
    return (vn(x, y) * .6 + vn(x * 2.1 + 7, y * 2.1 + 3) * .3 + vn(x * 4.3 + 1, y * 4.3 + 9) * .1)
def h2(x, y):
    s_ = np.sin(x * 127.1 + y * 311.7) * 43758.5453
    return s_ - np.floor(s_)
def vn(x, y):
    i, j = np.floor(x), np.floor(y); u, v = x - i, y - j; a, b = u * u * (3 - 2 * u), v * v * (3 - 2 * v)
    return (h2(i, j) * (1 - a) + h2(i + 1, j) * a) * (1 - b) + (h2(i, j + 1) * (1 - a) + h2(i + 1, j + 1) * a) * b

# coastAt: distance to water in tiles; riverClear: distance to a river's centre line in tiles.
coast_t = dist_l * k / T
rline = Image.new('L', pic.size); rl = ImageDraw.Draw(rline)
for (x, y), par in parent.items():
    if par is not None:
        rl.line([P(x, y), P(*par)], fill=255, width=1)
river_t = nd.distance_transform_edt(np.asarray(rline) == 0) / T
def sample(arr, px, py):
    X, Y = int((px - x0) * T), int((py - y0) * T)
    return arr[min(max(Y, 0), PH - 1), min(max(X, 0), PW - 1)]
BEACH, BANK = .15, .2
coastAt = lambda px, py: sample(coast_t, px, py)
riverClear = lambda px, py: sample(river_t, px, py)

def ragged(px, py):
    return min(depthAt(px, py), (coastAt(px, py) - BEACH) * 2 - .04) + (fbm(px * 1.6, py * 1.6) - .5) * .45 + (vn(px * 6, py * 6) - .5) * .12
def plain(x, y):
    return (not isF(x, y) and not isW(x, y) and not isRel(x, y) and (x, y) not in river
            and not any(isW(x + dx, y + dy) for dx, dy in N4))
def fieldAt(px, py):  # leg C: a dense core per forest tile; young trees may step onto plain ground
    d = ragged(px, py); x, y = int(np.floor(px)), int(np.floor(py))
    if isF(x, y):
        fx, fy = px - x, py - y
        return max(d, min(fx, 1 - fx, fy, 1 - fy) * 1.1 - .04)
    return min(d, 0) if plain(x, y) else -1
def speciesAt(px, py):
    wx, wy = px + (fbm(px * 1.3 + 5, py * 1.3) - .5) * .9, py + (fbm(px * 1.3, py * 1.3 + 11) - .5) * .9
    for x, y in [(int(np.floor(wx)), int(np.floor(wy))), (int(np.floor(px)), int(np.floor(py)))]:
        if isF(x, y):
            return FOREST_KIND[tname(x, y)]
    x, y = int(np.floor(px)), int(np.floor(py))
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)]:
        if isF(x + dx, y + dy):
            return FOREST_KIND[tname(x + dx, y + dy)]
    return 'Mixed'
wet = lambda px, py: coastAt(px, py) < BEACH or riverClear(px, py) < BANK * .6
def crownWet(px, py, h):  # the crown rises up the screen from its base
    return any(wet(px, py - kk * h * .7 / 8 / T) for kk in range(2, 9))

r_ = np.random.default_rng(12345)
cand, M = [], 7
for y in range(max(0, y0 - 1), min(MH, y0 + H + 1)):
    for x in range(max(0, x0 - 1), min(MW, x0 + W + 1)):
        if isW(x, y) or isRel(x, y):
            continue
        if not isF(x, y) and not any(isF(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            continue
        for j in range(M):
            for i in range(M):
                cand.append((x + (i + r_.random()) / M, y + (j + r_.random()) / M, r_.random()))
cand.sort(key=lambda c: c[2])
G, grid, trees = .25, {}, []
def near(px, py, r):
    gx, gy = int(np.floor(px / G)), int(np.floor(py / G))
    for v in range(gy - 2, gy + 3):
        for u in range(gx - 2, gx + 3):
            for o in grid.get((u, v), []):
                if np.hypot(o['x'] - px, o['y'] - py) < (r + o['r']) / 2:
                    return True
    return False
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
for px, py, _ in cand:
    x, y = int(np.floor(px)), int(np.floor(py))
    if isW(x, y) or isRel(x, y):
        continue
    d = fieldAt(px, py)
    if d < -.15 or coastAt(px, py) < BEACH + .02 or riverClear(px, py) < BANK:
        continue
    out0 = not isF(x, y)
    dens = smooth(-.08, .45, d)
    mix = MIX[speciesAt(px, py)]
    if r_.random() > (.3 + .7 * dens) * mix.get('fill', 1):
        continue
    r = (.27 - .14 * dens) * mix.get('space', 1)
    if near(px, py, r):
        continue
    q = r_.random()
    for kind, p in mix['kinds'].items():
        q -= p
        if q <= 0:
            break
    a = art[kind]
    young = out0 or r_.random() < .15 + .5 * (1 - dens)
    tex = a[min(4 + (r_.random() < .5) if young else int(r_.random() * 4), len(a) - 1)]
    h = SIZE[kind] * TW * tex.height / tallest[kind] * (.85 + r_.random() * .3) * (.8 + .2 * dens)
    while h > SIZE[kind] * TW * .3 and crownWet(px, py, h):
        h *= .85
    if crownWet(px, py, h):
        continue
    o = {'x': px, 'y': py, 'r': r, 'tex': tex, 'h': h, 'flip': r_.random() < .5, 'tint': r_.random()}
    trees.append(o)
    grid.setdefault((int(np.floor(px / G)), int(np.floor(py / G))), []).append(o)
for _ in range(2):  # no lone trees
    alive = set(map(id, trees))
    for o in trees:
        n = sum(1 for v in range(int(o['y'] // G) - 2, int(o['y'] // G) + 3) for u in range(int(o['x'] // G) - 2, int(o['x'] // G) + 3)
                for q in grid.get((u, v), []) if q is not o and id(q) in alive and np.hypot(q['x'] - o['x'], q['y'] - o['y']) < .42)
        if n < 2:
            alive.discard(id(o))
    trees = [o for o in trees if id(o) in alive]
    for kk in grid:
        grid[kk] = [q for q in grid[kk] if id(q) in alive]

# Forest floor: darker under the trees, following the same field.
FK = 4
fl = np.zeros((H * FK, W * FK))
for yy in range(H * FK):
    for xx in range(W * FK):
        px, py = x0 + (xx + .5) / FK, y0 + (yy + .5) / FK
        fl[yy, xx] = smooth(.12, .55, fieldAt(px, py))
fl = np.asarray(Image.fromarray((fl * 255).astype(np.uint8)).resize((PW, PH), Image.BICUBIC), float) / 255
fl *= np.clip((coast_t - BEACH) / .15, 0, 1) * np.clip((river_t - BANK) / .14, 0, 1)
base = np.asarray(pic, float)
base = base * (1 - fl[..., None] * .65) + base * np.array([.58, .7, .48]) * fl[..., None] * .65
canvas = Image.fromarray(base.clip(0, 255).astype(np.uint8)).convert('RGBA')

# Contact shadows, then trees and relief back to front.
yy, xx = np.mgrid[0:32, 0:64]
rr = np.hypot((xx + .5 - 32) / 32, (yy + .5 - 16) / 16)
contact = Image.fromarray(np.dstack([np.zeros((32, 64))] * 3 + [255 * (1 - np.clip((rr - .25) / .75, 0, 1) ** 2 * (3 - 2 * np.clip((rr - .25) / .75, 0, 1))) * .9 * .55]).astype(np.uint8))
items = []
for o in trees:
    kk = o['h'] / o['tex'].height
    w_, h_ = max(1, round(o['tex'].width * kk)), max(1, round(o['h']))
    X, Y = (o['x'] - x0) * T, (o['y'] - y0) * T
    cw, ch = max(1, round(w_ * .95)), max(1, round(w_ * .4))
    canvas.alpha_composite(contact.resize((cw, ch)), (int(X + o['h'] * .04 - cw / 2) % 99999, int(Y + o['h'] * .02 - ch / 2) % 99999)) if X - cw / 2 >= 0 and Y - ch / 2 >= 0 else None
    sp = o['tex'].resize((w_, h_), Image.LANCZOS)
    if o['flip']:
        sp = sp.transpose(Image.FLIP_LEFT_RIGHT)
    f = .84 + o['tint'] * .14
    arr = np.asarray(sp, float); arr[..., :3] *= [f, f + .02, f - .04]
    items.append((Y, X, Image.fromarray(arr.clip(0, 255).astype(np.uint8)), .97))
ART = HERE.parent / 'art'
RELIEF = {'mountains': ([Image.open(ART / f'mountain{i}.png').convert('RGBA') for i in range(9)], 1.25),
          'hills': ([Image.open(ART / f'hill{i}.png').convert('RGBA') for i in range(9)], 1.0)}
for ty_ in range(y0, min(MH, y0 + H)):
    for tx_ in range(x0, min(MW, x0 + W)):
        nm = tname(tx_, ty_)
        if nm in RELIEF:
            sprs, wid = RELIEF[nm]
            s_ = sprs[rng.integers(len(sprs))]
            w_ = round(wid * T * rng.uniform(.92, 1.1))
            s_ = s_.resize((w_, round(s_.height * w_ / s_.width)), Image.LANCZOS)
            if rng.random() < .5:
                s_ = s_.transpose(Image.FLIP_LEFT_RIGHT)
            items.append(((ty_ - y0 + .78) * T, (tx_ - x0 + .5 + rng.uniform(-.06, .06)) * T, s_, .9))
items.sort(key=lambda i: i[0])
for Y, X, sp, ay in items:
    canvas.alpha_composite(sp, (int(X - sp.width / 2), int(Y - sp.height * ay))) if X - sp.width / 2 >= 0 and Y - sp.height * ay >= 0 else canvas.paste(sp, (int(X - sp.width / 2), int(Y - sp.height * ay)), sp)
canvas.convert('RGB').save(out)
print('ok', out, len(trees), 'trees')
