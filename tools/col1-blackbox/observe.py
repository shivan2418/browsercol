"""Play a do-nothing game: start a new game, then end turns with Space and
record the side panel (season, year, gold, tax) each turn. Any screen that
is not the plain map is saved as a PNG and dismissed with Return.

Runs inside the harness container. Writes OUT/turns.jsonl and OUT/screens/.
"""
import argparse, hashlib, json, os, re, subprocess, time
from PIL import Image
import panel

DATE = re.compile(r"^(Spring|Autumn) (\d{4})$")
MONEY = re.compile(r"^Go1d: (-?[\d,]+)\$ Tax: (\d+)%$")
VIEW = (0, 9, 240, 200)  # map viewport, left of the side panel


def sh(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout.strip()


class Game:
    def __init__(self, out):
        os.environ["DISPLAY"] = ":1"
        self.win = None
        self.out = out
        self.n = 0
        os.makedirs(os.path.join(out, "screens"), exist_ok=True)

    def window(self):
        while not self.win:
            try:
                self.win = sh("xdotool", "search", "--class", "dosbox").split()[0]
            except subprocess.CalledProcessError:
                time.sleep(0.5)
        return self.win

    def key(self, k):
        sh("xdotool", "key", "--window", self.window(), k)

    def grab(self):
        sh("import", "-window", self.window(), "/tmp/g.png")
        return Image.open("/tmp/g.png").convert("RGB")

    def settle(self, timeout=30):
        """Wait until two grabs 0.4 s apart are identical."""
        prev, t0 = None, time.time()
        while time.time() - t0 < timeout:
            im = self.grab()
            if prev is not None and im.tobytes() == prev.tobytes():
                return im
            prev = im
            time.sleep(0.4)
        return prev

    def save(self, im, tag):
        self.n += 1
        p = os.path.join(self.out, "screens", f"{self.n:05d}-{tag}.png")
        im.save(p)
        return os.path.basename(p)


MENUBAR = "903117206131d63048136f58bb53e3d4"  # md5 of the map screen's menu bar, (0,0)-(240,8)
POPUP_PIXELS = 1500  # a popup changes at least this many viewport pixels


def on_map(im):
    return hashlib.md5(im.crop((0, 0, 240, 8)).tobytes()).hexdigest() == MENUBAR


def parse(im):
    r = panel.read(im)
    d, m = DATE.match(r["date"]), MONEY.match(r["money"])
    return r, (d.group(1), int(d.group(2))) if d else None, (int(m.group(1).replace(",", "")), int(m.group(2))) if m else None


class View:
    """The map viewport at rest, with the blinking active unit masked out."""

    def __init__(self, g):
        frames = []
        for _ in range(8):
            frames.append(g.grab().crop(VIEW).tobytes())
            time.sleep(0.25)
        self.base = frames[0]
        self.mask = {i for f in frames[1:] for i in range(0, len(f), 3) if f[i:i + 3] != self.base[i:i + 3]}

    def changed(self, im):
        f = im.crop(VIEW).tobytes()
        return sum(1 for i in range(0, len(f), 3) if i not in self.mask and f[i:i + 3] != self.base[i:i + 3])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--difficulty", type=int, default=0, help="0 Discoverer .. 4 Viceroy")
    ap.add_argument("--until", type=int, default=1850, help="stop at this year")
    a = ap.parse_args()
    g = Game(a.out)
    log = open(os.path.join(a.out, "turns.jsonl"), "a")

    # Setup: skip the intro, open the menu, pick difficulty, then Return
    # through nation, name and the opening texts until the map shows.
    time.sleep(6)
    g.key("Escape"); time.sleep(4); g.key("Escape"); time.sleep(3)
    g.key("Return"); time.sleep(2)
    for _ in range(a.difficulty):
        g.key("Right"); time.sleep(0.3)
    g.save(g.grab(), "difficulty")
    g.key("Return"); time.sleep(2)
    for _ in range(30):
        g.key("Return"); time.sleep(2.5)
        im = g.grab()
        if on_map(im):
            break
    else:
        g.save(im, "setup-stuck"); raise SystemExit("setup never reached the map")
    time.sleep(1)
    view = View(g)
    g.save(g.grab(), "first-map")

    last, turn, t_progress, popup_since = None, 0, time.time(), None
    while True:
        im = g.grab()
        g_on = on_map(im)
        diff = view.changed(im) if g_on else None
        if not g_on or diff > POPUP_PIXELS:
            # A popup or another screen. Let it finish drawing, keep it, dismiss it.
            time.sleep(0.6)
            im = g.grab()
            raw = panel.read(im)
            g.save(im, f"t{turn}-popup")
            log.write(json.dumps({"turn": turn, "popup": g.n, "panel": raw, "t": round(time.time(), 1)}) + "\n"); log.flush()
            g.key("Return"); time.sleep(0.8)
            t_progress = time.time()
            continue
        raw, date, money = parse(im)
        if date and money:
            if (date, money) != last:
                turn += 1
                rec = {"turn": turn, "season": date[0], "year": date[1], "gold": money[0], "tax": money[1], "t": round(time.time(), 1)}
                log.write(json.dumps(rec) + "\n"); log.flush()
                last, t_progress = (date, money), time.time()
                if date[1] >= a.until:
                    break
                time.sleep(0.3)
                g.key("space")
                continue
        elif "?" in raw["date"] + raw["money"]:
            g.save(im, f"t{turn}-unknown-glyph")
            log.write(json.dumps({"turn": turn, "unknown": raw}) + "\n"); log.flush()
            last = ("?", raw["date"], raw["money"])
            g.key("space"); time.sleep(0.5)
            t_progress = time.time()
            continue
        if time.time() - t_progress > 20:
            g.save(im, f"t{turn}-nudge")
            g.key("space")
            t_progress = time.time()
        time.sleep(0.3)


if __name__ == "__main__":
    main()
