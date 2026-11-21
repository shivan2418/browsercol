"""Drive a running game with checked steps. Every action first confirms
which screen is showing, so a stray key can't land on the wrong screen
(Escape on the map asks to quit, and a later Return would answer yes).

Runs inside the harness container. CLI: col.py screen | save SLOT |
europe | leave-europe | tax up|down [N] | cheat | endturn
"""
import hashlib, os, subprocess, sys, time
from PIL import Image

SAVE_DIR = "/work/data/MPS/COLONIZE"
REF = {
    "map": ((0, 0, 60, 8), "3d02a1abb19a5ec2508062642e912850"),
    "europe": ((281, 90, 318, 120), "b3a9754bed8b48f46fc45faa789b9946"),
}


def sh(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout.strip()


class Col:
    def __init__(self):
        os.environ["DISPLAY"] = ":1"
        out = sh("xdotool", "search", "--class", "dosbox").split()
        if not out:
            raise SystemExit("DOSBox is not running")
        self.win = out[0]
        subprocess.run(["xdotool", "windowfocus", "--sync", self.win], capture_output=True)

    def menu(self, hotkey, downs):
        """Open a menu from the map and pick the item `downs` rows below the top."""
        self.need("map")
        for _ in range(3):  # the first key after a save is sometimes dropped
            self.key(hotkey, pause=0.6)
            if self.screen() != "map":
                break
        else:
            raise SystemExit(f"{hotkey} did not open a menu")
        self.key(*(["Down"] * downs), "Return")

    def key(self, *keys, pause=0.3):
        """Send keys the way poke.sh does, which DOSBox accepts with modifiers."""
        for k in keys:
            sh("xdotool", "key", "--window", self.win, "--delay", "80", k)
            time.sleep(pause)

    def grab(self, path="/tmp/raw.png"):
        sh("import", "-window", self.win, path)
        return Image.open(path).convert("RGB")

    def screen(self, im=None):
        im = im or self.grab()
        for name, (box, h) in REF.items():
            if hashlib.md5(im.crop(box).tobytes()).hexdigest() == h:
                return name
        return "other"

    def wait_for(self, name, timeout=15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.screen() == name:
                return
            time.sleep(0.3)
        raise SystemExit(f"expected the {name} screen, saw {self.screen()}")

    def need(self, name):
        s = self.screen()
        if s != name:
            raise SystemExit(f"expected the {name} screen, saw {s}")

    def cheat(self):
        self.need("map")
        sh("xdotool", "keydown", "--window", self.win, "alt")
        for k in "win":
            sh("xdotool", "key", "--window", self.win, k)
            time.sleep(0.2)
        sh("xdotool", "keyup", "--window", self.win, "alt")
        time.sleep(0.5)

    def europe(self):
        self.menu("alt+v", 2)
        self.wait_for("europe")

    def leave_europe(self):
        self.need("europe")
        self.key("Escape")
        self.wait_for("map")

    def tax(self, direction, n=1):
        self.need("europe")
        self.key(*(["bracketright" if direction == "up" else "bracketleft"] * n))

    def save(self, slot):
        """Save into slot 1-8 (file COLONY0{slot-1}.SAV) and wait for the file."""
        path = os.path.join(SAVE_DIR, f"COLONY0{slot - 1}.SAV")
        before = os.path.getmtime(path) if os.path.exists(path) else 0
        self.menu("alt+g", 4)
        time.sleep(0.5)
        self.key(*(["Down"] * (slot - 1)), "Return")
        t0 = time.time()
        while time.time() - t0 < 10:
            if os.path.exists(path) and os.path.getmtime(path) > before:
                break
            time.sleep(0.2)
        else:
            raise SystemExit(f"slot {slot} was not written")
        time.sleep(1)
        if self.screen() != "map":
            self.grab("/tmp/after-save.png")
            raise SystemExit("not back on the map after saving; see /tmp/after-save.png")
        return path


def load_slot1(c):
    """From DOSBox start: skip the intro, LOAD Game, slot 1, dismiss the notice."""
    time.sleep(6)
    c.key("Escape", pause=4)
    c.key("Escape", pause=3)
    c.key("Down", "Down", "Down", "Return", pause=0.5)
    time.sleep(2)
    c.key("Return", pause=5)
    for _ in range(5):
        if c.screen() == "map":
            return
        c.key("Return", pause=2)
    raise SystemExit("load did not reach the map")


def end_turn(c, timeout=60):
    """End the turn with Space and wait for the next turn's autosave.
    Popups on the way are kept in /tmp/popups and dismissed with Return."""
    auto = os.path.join(SAVE_DIR, "COLONY09.SAV")
    before = os.path.getmtime(auto) if os.path.exists(auto) else 0
    c.need("map")
    c.key("space")
    t0, n, last_key = time.time(), 0, time.time()
    os.makedirs("/tmp/popups", exist_ok=True)
    while time.time() - t0 < timeout:
        if time.time() - last_key > 5 and c.screen() == "map":
            c.key("space")  # a dropped key, or a unit still waiting for orders
            last_key = time.time()
        if os.path.exists(auto) and os.path.getmtime(auto) > before:
            time.sleep(0.5)
            return auto
        if c.screen() == "other":
            time.sleep(0.5)
            n += 1
            c.grab(f"/tmp/popups/{int(time.time())}-{n}.png")
            c.key("Return")
            last_key = time.time()
        time.sleep(0.3)
    raise SystemExit("turn did not end")


if __name__ == "__main__":
    c = Col()
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "screen":
        print(c.screen())
    elif cmd == "save":
        print(c.save(int(args[0])))
    elif cmd == "europe":
        c.europe()
    elif cmd == "leave-europe":
        c.leave_europe()
    elif cmd == "tax":
        c.tax(args[0], int(args[1]) if len(args) > 1 else 1)
    elif cmd == "load":
        load_slot1(c)
    elif cmd == "endturn":
        for _ in range(int(args[0]) if args else 1):
            print(end_turn(c))
    elif cmd == "cheat":
        c.cheat()
    else:
        raise SystemExit(f"unknown command {cmd}")
