# BrowserCol's own order buttons, in the look of FreeCol's (data/base/resources/images/ui/order-buttons):
# Go to (goto) and Next unit on tile (change), the buttons a touch screen adds to the map orders (#510), for
# which FreeCol has no picture. Each is FreeCol's bronze coin with the emblem taken out, and a new emblem drawn
# on it as FreeCol draws its own: a flat fill with a one-pixel black outline, at the button's own pixel scale
# (size2 doubles the emblem's pixels; the coin is FreeCol's size2 art), moved a pixel down and right when pressed.
#
# The blank coin, per state and size: FreeCol's buttons share one coin, so each pixel takes the colour most of
# them have there; the middle, where the emblems are, is filled by mirroring the ring around it inwards.
#
# Writes ui/art/resources/order-buttons/<state>/<name>[.size2].png. Needs Python 3 with numpy and Pillow, and
# FreeCol's data at freecol/ (run from anywhere): python3 ui/art/tools/order-buttons.py
import math
import os
from collections import Counter

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '../../..'))
SRC = os.path.join(REPO, 'freecol/data/base/resources/images/ui/order-buttons')
DEST = os.path.join(HERE, '../resources/order-buttons')
# FreeCol's buttons with this coin, to recover it from.
COINS = ['build', 'clear', 'disband', 'done', 'fortify', 'plow', 'road', 'sentry', 'wait']
# The emblems at base scale: o is fill; the outline is added round it.
EMBLEMS = {
    # An arrow: go there.
    'goto': """
.......o.....
.......oo....
.......ooo...
ooooooooooo..
oooooooooooo.
ooooooooooooo
oooooooooooo.
ooooooooooo..
.......ooo...
.......oo....
.......o.....
""",
    # Two arrows round a circle: the next unit on the tile, in turn.
    'change': """
.....oooo......
...oooooooo.o..
..oo......oooo.
.oo........ooo.
.oo.......oooo.
.oo............
.oo............
...............
............oo.
............oo.
.oooo.......oo.
.ooo........oo.
.oooo......oo..
..o.oooooooo...
......oooo.....
""",
}
# The emblems' fill per state, as FreeCol's (its outline is black in every state).
FILL = {
    'normal': (161, 147, 109),
    'highlighted': (161, 147, 109),
    'pressed': (94, 86, 64),
    'disabled': (148, 148, 148),
}


def blank(state, suffix, size):
    """FreeCol's coin for this state and size, with no emblem."""
    stack = np.stack(
        [np.array(Image.open(f'{SRC}/{state}/{n}{suffix}.png').convert('RGBA')) for n in COINS]
    )
    coin = np.zeros((size, size, 4), np.uint8)
    for y in range(size):
        for x in range(size):
            coin[y, x] = Counter(tuple(p) for p in stack[:, y, x]).most_common(1)[0][0]
    out = coin.copy()
    c = size / 2
    rim = size * 20.5 / 78  # just outside the largest of FreeCol's emblems
    for y in range(size):
        for x in range(size):
            dy, dx = y + 0.5 - c, x + 0.5 - c
            r = math.hypot(dx, dy)
            if r < rim:
                if r < 1:
                    dy, dx, r = -1, 0, 1
                k = (2 * rim - r) / r
                out[y, x] = coin[int(c + dy * k - 0.5), int(c + dx * k - 0.5)]
    # The very middle mirrors to one pixel: an even colour from round it instead.
    inner, outer = 3 * size / 39, 5 * size / 39
    near = [
        out[y, x]
        for y in range(size)
        for x in range(size)
        if inner <= math.hypot(y + 0.5 - c, x + 0.5 - c) < outer
    ]
    even = np.median(np.array(near), axis=0).astype(np.uint8)
    for y in range(size):
        for x in range(size):
            if math.hypot(y + 0.5 - c, x + 0.5 - c) < inner:
                out[y, x] = even
    return out


def button(name, state, scale):
    """The button picture: the blank coin with the emblem, at 39 px times scale."""
    img = blank(state, '' if scale == 1 else '.size2', 39 * scale)
    rows = EMBLEMS[name].strip('\n').split('\n')
    mask = np.array([[ch == 'o' for ch in row] for row in rows])
    h, w = mask.shape
    fill = np.zeros((39, 39), bool)
    shift = 1 if state == 'pressed' else 0
    top, left = 19 - h // 2 + shift, 19 - w // 2 + shift
    fill[top : top + h, left : left + w] = mask
    grown = np.zeros_like(fill)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            grown |= np.roll(np.roll(fill, dy, 0), dx, 1)
    up = lambda m: np.repeat(np.repeat(m, scale, 0), scale, 1)
    img[up(grown & ~fill)] = (0, 0, 0, 255)
    img[up(fill)] = (*FILL[state], 255)
    return Image.fromarray(img)


if __name__ == '__main__':
    for name in EMBLEMS:
        for state in FILL:
            os.makedirs(f'{DEST}/{state}', exist_ok=True)
            button(name, state, 1).save(f'{DEST}/{state}/{name}.png')
            button(name, state, 2).save(f'{DEST}/{state}/{name}.size2.png')
