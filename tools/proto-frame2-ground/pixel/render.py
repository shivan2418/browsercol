"""PROTOTYPE (throwaway): the "constraints" test.

Renders a region of FreeCol's USA map offline with the constraints that give old games a consistent look:
32 px tiles, one shared palette for everything, quiet ground, and forests / mountains / hills as connected masses
(objects scattered on a grid that ignores tile lines, kept inside the region of their terrain) instead of a stamp
per tile. Rivers form a tree that drains to the sea, so they can't make ladders.

Usage: python3 render.py <out.png> <x0> <y0> <w> <h> [colours]
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ART = HERE.parent / 'art'
T = 32
out, x0, y0, W, H = sys.argv[1], *map(int, sys.argv[2:6])
NCOL = int(sys.argv[6]) if len(sys.argv) > 6 else 40
cells = json.load(open(HERE.parent / 'usa.json'))['cells']
MH, MW = len(cells), len(cells[0])
code = np.array([[c[0] for c in r] for r in cells])
kind = np.array([[c[1] for c in r] for r in cells])
river = np.array([[c[2] for c in r] for r in cells])
rng = np.random.default_rng(3)


def noise(h, w, cell, seed):
    """Smooth value noise, h x w pixels, lattice every `cell` pixels."""
    g = np.random.default_rng(seed).random((h // cell + 3, w // cell + 3))
    ys, xs = np.mgrid[0:h, 0:w] / cell
    yi, xi = ys.astype(int), xs.astype(int)
    fy, fx = ys - yi, xs - xi
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b, c, d = g[yi, xi], g[yi, xi + 1], g[yi + 1, xi], g[yi + 1, xi + 1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


PH, PW = H * T, W * T
# Terrain per pixel at a warped position: borders wander a little and get a hand-pixelled, broken fringe.
wy = (noise(PH, PW, 24, 1) - .5) * .5 + (noise(PH, PW, 4, 2) - .5) * .16
wx = (noise(PH, PW, 24, 3) - .5) * .5 + (noise(PH, PW, 4, 4) - .5) * .16
ys, xs = np.mgrid[0:PH, 0:PW] / T
ty = np.clip((ys + y0 + wy).astype(int), 0, MH - 1)
tx = np.clip((xs + x0 + wx).astype(int), 0, MW - 1)
ter = code[ty, tx]
water = ter == 0


def texture(name, contrast):
    """A terrain's texture at 4 tiles per repeat, tiled over the region, with its contrast lowered (quiet ground)."""
    t = np.asarray(Image.open(ART / f'{name}.jpg').convert('RGB').resize((4 * T, 4 * T), Image.LANCZOS), float)
    t = t.mean((0, 1)) + (t - t.mean((0, 1))) * contrast
    reps = (PH // t.shape[0] + 1, PW // t.shape[1] + 1, 1)
    return np.tile(t, reps)[:PH, :PW]


grass, prairie, plains = texture('grassland', .45), texture('prairie', .4), texture('plains', .4)
TEX = {
    0: texture('ocean', .25), 1: grass, 2: prairie,
    3: plains * [1.0, .9, .75] * .95 + 8,
    4: texture('forest', .35) * .9,
    5: texture('swamp', .5),
    6: plains * .35 + np.array([110, 104, 96]) * .65,
    7: plains * .3 + np.array([226, 206, 150]) * .7,
    8: grass * .8 + texture('forest', .3) * .2,
}
img = np.zeros((PH, PW, 3))
for k, t in TEX.items():
    img[ter == k] = t[ter == k]
big = noise(PH, PW, 96, 9)[..., None]
img[~water] *= .9 + .2 * big[~water]


def grow(mask, n):
    """Pixels within n steps of mask (4-neighbour)."""
    m = mask.copy()
    for _ in range(n):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m


land = ~water
near_land = [grow(land, n) & water for n in (1, 2, 7)]
img[grow(water, 2) & land] = np.array([222, 204, 150])                     # beach
img[near_land[2]] = img[near_land[2]] * .55 + np.array([60, 150, 165]) * .45  # shallows
img[near_land[1]] = np.array([150, 200, 205])
img[near_land[0]] = np.array([232, 240, 236])                               # surf line

pic = Image.fromarray(img.clip(0, 255).astype(np.uint8))
draw = ImageDraw.Draw(pic)

# Rivers: a tree draining to the sea (breadth-first from river tiles beside the sea), drawn centre to parent.
rv = {(x, y) for y in range(MH) for x in range(MW) if river[y, x]}
N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
parent, q = {}, deque()
for (x, y) in rv:
    for dx, dy in N4:
        if 0 <= x + dx < MW and 0 <= y + dy < MH and code[y + dy, x + dx] == 0:
            parent[(x, y)] = (x + dx * .7, y + dy * .7, 'sea')
            q.append((x, y))
            break
while True:
    while q:
        x, y = q.popleft()
        for dx, dy in N4:
            n = (x + dx, y + dy)
            if n in rv and n not in parent:
                parent[n] = (x, y, 'river')
                q.append(n)
    rest = [p for p in rv if p not in parent]
    if not rest:
        break
    parent[rest[0]] = (*rest[0], 'root')
    q.append(rest[0])
px = lambda x, y: ((x + .5 - x0) * T, (y + .5 - y0) * T)
for (x, y), (pxx, pyy, why) in parent.items():
    if why == 'root':
        continue
    a, b = px(x, y), px(pxx, pyy)
    mid = ((a[0] + b[0]) / 2 + rng.normal() * 3, (a[1] + b[1]) / 2 + rng.normal() * 3)
    for w, col in ((5, (70, 110, 120)), (3, (80, 150, 200))):
        draw.line([a, mid, b], fill=col, width=w, joint='curve')

# Objects: scattered on a jittered grid that ignores tile lines, each kept inside its own terrain's region.
def sprites(prefix, n, height, tint=None):
    out = []
    for i in range(n):
        im = Image.open(ART / f'{prefix}{i}.png').convert('RGBA')
        im = im.resize((max(1, round(im.width * height / im.height)), height), Image.LANCZOS)
        if tint is not None:
            a = np.asarray(im, float)
            a[..., :3] = a[..., :3] * tint[0] + np.array(tint[1]) * (1 - tint[0])
            im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
        out.append(im)
    return out


PINES = sprites('tree', 12, 17)
PINE_I, BROAD_I = [0, 1, 2, 3, 8, 9], [4, 5, 6, 7, 10, 11]
MOUNT = sprites('mountain', 9, 30)
MOUNT_S = sprites('mountain', 9, 22)
HILL = sprites('hill', 9, 12, tint=(.7, (90, 105, 60)))
inside = lambda m, x, y: 0 <= x < PW and 0 <= y < PH and m[int(y), int(x)]
edge_ok = lambda m, x, y, r: all(inside(m, x + dx, y + dy) for dx, dy in ((r, 0), (-r, 0), (0, r // 2), (0, -r)))
objs = []
for (mask, step, r, pick) in (
    (ter == 4, 10, 3, 'tree'),
    (ter == 6, 17, 7, 'mount'),
    (ter == 8, 18, 6, 'hill'),
):
    for gy in np.arange(-T, PH + T, step * .87):
        for gx in np.arange(-T, PW + T, step):
            x = gx + (step / 2 if int(gy / step) % 2 else 0) + rng.normal() * step * .22
            y = gy + rng.normal() * step * .22
            if not edge_ok(mask, x, y, r):
                continue
            if pick == 'tree':
                k = kind[min(MH - 1, int(y / T) + y0), min(MW - 1, int(x / T) + x0)]
                pool = PINE_I if k == 1 else BROAD_I if k == 3 else (PINE_I if rng.random() < .5 else BROAD_I)
                im = PINES[pool[rng.integers(6)]]
            elif pick == 'mount':
                im = (MOUNT if rng.random() < .6 else MOUNT_S)[rng.integers(9)]
            else:
                im = HILL[rng.integers(9)]
            objs.append((y, x, im))
for y, x, im in sorted(objs, key=lambda o: o[0]):
    pic.alpha_composite(im, (int(x - im.width / 2), int(y - im.height * .9))) if pic.mode == 'RGBA' else \
        pic.paste(im, (int(x - im.width / 2), int(y - im.height * .9)), im)

# One palette for everything: built once from all the art, then the whole picture is reduced to it.
srcs = [Image.open(ART / f'{n}.jpg').convert('RGB').resize((96, 96)) for n in ('grassland', 'prairie', 'plains', 'ocean', 'forest', 'swamp')]
srcs += [Image.open(ART / f'{p}{i}.png').convert('RGB').resize((48, 48)) for p, n in (('tree', 12), ('mountain', 9), ('hill', 9)) for i in range(n)]
srcs.append(pic.resize((PW // 4, PH // 4)))
sheet = Image.new('RGB', (96 * len(srcs), max(s.height for s in srcs)))
for i, s in enumerate(srcs):
    sheet.paste(s, (96 * i, 0))
palette = sheet.quantize(NCOL, method=Image.Quantize.MEDIANCUT)
final = pic.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE).convert('RGB')
final.resize((PW * 2, PH * 2), Image.NEAREST).save(out)
pic.convert('RGB').resize((PW * 2, PH * 2), Image.NEAREST).save(out.replace('.png', '-nopalette.png'))
print('ok', out, final.size)
