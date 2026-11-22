"""PROTOTYPE (throwaway): the layered Top-down look.

Ground is the base terrain (forests stand on their FreeCol base: conifer on grassland, mixed on plains, ...), drawn
from one quiet seamless texture per base type. On top go seamless transparent layers (one per forest type, plus hills
and mountains), tiled in world space so neighbouring tiles match by construction, each faded in over its own terrain's
region. Coast, beach, surf and rivers are drawn by code.

Usage: python3 render_layers.py <out.png> <x0> <y0> <w> <h> [tile px]
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

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
BASES = ['plains', 'grassland', 'prairie', 'savannah', 'marsh', 'swamp', 'desert', 'tundra', 'arctic', 'ocean', 'highSeas', 'lake']
LAYERS = sorted(set(LAYER_OF.values()))
base_idx = np.array([[BASES.index(BASE_OF.get(t, t)) for t in r] for r in names])
layer_idx = np.array([[LAYERS.index(LAYER_OF[t]) if t in LAYER_OF else -1 for t in r] for r in names])
is_water = np.array([[t in WATER for t in r] for r in names])


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
wy = (noise(PH, PW, int(48 * k), 1) - .5) * .55 + (noise(PH, PW, int(8 * k), 2) - .5) * .14
wx = (noise(PH, PW, int(48 * k), 3) - .5) * .55 + (noise(PH, PW, int(8 * k), 4) - .5) * .14
ys, xs = np.mgrid[0:PH, 0:PW] / T
ty = np.clip((ys + y0 + wy).astype(int), 0, MH - 1)
tx = np.clip((xs + x0 + wx).astype(int), 0, MW - 1)
bpx, lpx, water = base_idx[ty, tx], layer_idx[ty, tx], is_water[ty, tx]


def world_tiled(img, n):
    """An image stretched over n x n tiles and repeated in world space, cropped to this region."""
    a = np.asarray(img.resize((n * T, n * T), Image.LANCZOS), float)
    oy, ox = (y0 % n) * T, (x0 % n) * T
    return np.tile(a, (PH // (n * T) + 2, PW // (n * T) + 2, 1))[oy:oy + PH, ox:ox + PW]


# Ground: one quiet texture per base, repeating every 4 tiles.
img = np.zeros((PH, PW, 3))
for i, b in enumerate(BASES):
    sel = bpx == i
    if sel.any():
        t = world_tiled(Image.open(LAY / f'{b}.png').convert('RGB'), 4)
        img[sel] = t[sel]


def grow(mask, n):
    m = mask.copy()
    for _ in range(n):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m


land = ~water
img[grow(water, round(3 * k)) & land] = img[grow(water, round(3 * k)) & land] * .35 + np.array([226, 210, 160]) * .65
sh = grow(land, round(10 * k)) & water
img[sh] = img[sh] * .6 + np.array([70, 160, 170]) * .4
s2 = grow(land, round(2 * k)) & water
img[s2] = img[s2] * .4 + np.array([210, 232, 228]) * .6

pic = Image.fromarray(img.clip(0, 255).astype(np.uint8))

# Rivers: a tree draining to the sea, so no ladders. Drawn on the ground, before the layers.
draw = ImageDraw.Draw(pic)
N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
parent, q = {}, deque()
for (x, y) in river:
    for dx, dy in N4:
        if 0 <= x + dx < MW and 0 <= y + dy < MH and is_water[y + dy, x + dx]:
            parent[(x, y)] = (x + dx * .7, y + dy * .7)
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
        pts.append((a[0] + (b[0] - a[0]) * f + rng.normal() * T * .08, a[1] + (b[1] - a[1]) * f + rng.normal() * T * .08))
    pts.append(b)
    draw.line(pts, fill=(64, 104, 96), width=round(7 * k), joint='curve')
    draw.line(pts, fill=(78, 146, 186), width=round(4 * k), joint='curve')
    rd.line(pts, fill=255, width=round(12 * k), joint='curve')
rcut = np.asarray(rmask, float) / 255

# Layers: forests, hills, mountains, each faded in over its own region; trees step aside for rivers.
base = np.asarray(pic, float)
PERIOD = {'mountains': 4, 'hills': 4}
for i, name in enumerate(LAYERS):
    sel = (lpx == i) & land
    if not sel.any():
        continue
    lay = world_tiled(Image.open(LAY / f'{name}.png').convert('RGBA'), PERIOD.get(name, 5))
    soft = np.asarray(Image.fromarray((sel * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5 * k)), float) / 255
    a = (lay[..., 3] / 255 * soft * (1 - rcut))[..., None]
    base = base * (1 - a) + lay[..., :3] * a
Image.fromarray(base.clip(0, 255).astype(np.uint8)).save(out)
print('ok', out)
