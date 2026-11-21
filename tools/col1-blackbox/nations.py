"""Tax changes for all four European nations, read from the kept autosaves.

Each nation has a 316-byte record; England's starts at the tax position
(391 + 28*u16(0x2C) + 202*u16(0x2E)), then France, Spain, Dutch. Gold is
41 bytes after each tax byte. Confirmed for France by switching the human
player with the cheat menu and reading the side panel.

Usage: python3 nations.py runs/PREFIX-*     (prints one line per change)
"""
import glob, struct, sys

NAMES = ["England", "France", "Spain", "Dutch"]
RECORD = 316


def read(path):
    e = open(path, "rb").read()
    u = lambda h: struct.unpack_from("<H", e, h)[0]
    q = 391 + 28 * u(0x2C) + 202 * u(0x2E)
    return u(0x1A), u(0x1E), [e[q + RECORD * k] for k in range(4)]


def changes(run):
    prev, out = None, []
    for f in sorted(glob.glob(f"{run}/saves/*.SAV")):
        year, turn, taxes = read(f)
        if prev:
            for k, n in enumerate(NAMES):
                if taxes[k] != prev[k]:
                    out.append((n, turn, year, prev[k], taxes[k]))
        prev = taxes
    return out


if __name__ == "__main__":
    for run in sys.argv[1:]:
        for n, turn, year, a, b in changes(run):
            print(f"{run}\t{n}\tturn {turn}\t{year}\t{a} -> {b}")
