# FreeCol+'s shader water (#409): the two seamless ripple textures the water's
# shader slides over each other. Each is a sum of waves whose wave numbers are
# whole numbers over the texture, so it tiles with no seam. The swell's long
# waves roll; the chop's crests are made sharp (1 - |wave|, as ridged noise
# does), with soft troughs between.
#   python3 -I ripples.py <out dir>
# Writes swell.png and chop.png, 256x256: red is the height, green and blue the
# surface's slope across and down (0.5 is flat), which the shader lights.
import math, random, sys

import numpy as np
from PIL import Image

out = sys.argv[1]
N = 256


def ripples(seed, kmin, kmax, count, sharp, across=None):
    rng = random.Random(seed)
    y, x = np.mgrid[0:N, 0:N].astype(np.float64) / N
    h = np.zeros((N, N))
    dx = np.zeros((N, N))
    dy = np.zeros((N, N))
    total = 0.0
    for _ in range(count):
        while True:
            kx, ky = rng.randint(-kmax, kmax), rng.randint(-kmax, kmax)
            # A wave across the texture (crests running east-west, as FreeCol paints them) when asked.
            if kmin <= math.hypot(kx, ky) <= kmax and (across is None or abs(kx) <= across * abs(ky)):
                break
        a = 1 / math.hypot(kx, ky) ** 0.6
        phase = rng.uniform(0, 2 * math.pi)
        arg = 2 * math.pi * (kx * x + ky * y) + phase
        h += a * np.sin(arg)
        dx += a * 2 * math.pi * kx * np.cos(arg)
        dy += a * 2 * math.pi * ky * np.cos(arg)
        total += a
    h /= total
    dx /= total
    dy /= total
    if sharp:
        # Ridged: the crests where the sum crosses zero, sharp; d|h| = sign(h) dh.
        ridge = 1 - np.abs(h) ** sharp
        s = -sharp * (np.abs(h) + 0.02) ** (sharp - 1) * np.sign(h)
        rx, ry = s * dx, s * dy
    else:
        # Rolling: the sum as it is.
        ridge, rx, ry = h, dx, dy
    ridge = (ridge - ridge.min()) / (ridge.max() - ridge.min())
    # The steepest slopes, bar a few, at full scale: a few peaks would leave the rest flat.
    slope = np.percentile(np.abs(np.concatenate([rx, ry])), 99)
    rgb = np.stack([ridge, 0.5 + 0.5 * rx / slope, 0.5 + 0.5 * ry / slope], -1)
    return Image.fromarray((rgb * 255).round().clip(0, 255).astype(np.uint8), 'RGB')


# The swell: long, rolling waves. The chop: short ripples with sharp crests,
# running mostly east-west.
ripples(1409, 2, 6, 12, None).save(f'{out}/swell.png', optimize=True)
ripples(2409, 7, 18, 28, 1.4, across=0.5).save(f'{out}/chop.png', optimize=True)
