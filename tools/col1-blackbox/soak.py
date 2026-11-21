"""Do-nothing soak: load slot 1, then keep ending turns. Every autosave the
game writes is read for year and tax and logged; every screen that is not
the map is kept as a PNG (once per distinct image) and dismissed with Return.

Runs inside the harness container. Writes OUT/turns.jsonl, OUT/screens/,
and OUT/game-over.png when the game stops writing autosaves.
"""
import argparse, hashlib, json, os, struct, time
import col

# The game autosaves to COLONY09.SAV each turn; years ending in 0 went
# elsewhere in the first runs, so watch the other non-slot file too.
AUTOS = [os.path.join(col.SAVE_DIR, f"COLONY0{i}.SAV") for i in (8, 9)]


def mtimes():
    return {p: os.path.getmtime(p) for p in AUTOS if os.path.exists(p)}


def fields(d):
    return {
        "year": struct.unpack_from("<H", d, 0x1A)[0],
        "tax": d[len(d) - 22062],
        "gold_candidate": struct.unpack_from("<I", d, len(d) - 22062 + 41)[0],
        "size": len(d),
        "md5": hashlib.md5(d).hexdigest(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--until", type=int, default=1900)
    ap.add_argument("--idle", type=float, default=120, help="seconds without an autosave that end the run")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "screens"), exist_ok=True)
    log = open(os.path.join(a.out, "turns.jsonl"), "a")

    c = col.Col()
    col.load_slot1(c)
    last_mtimes = mtimes()
    last_save, last_key, n, seen = time.time(), 0, 0, set()
    while True:
        now = mtimes()
        changed = [p for p in now if now[p] != last_mtimes.get(p)]
        if changed:
            time.sleep(0.3)  # let the write finish
            last_mtimes = mtimes()
            p = changed[0]
            rec = {"n": n, "t": round(time.time(), 1), "file": os.path.basename(p), **fields(open(p, "rb").read())}
            n += 1
            log.write(json.dumps(rec) + "\n"); log.flush()
            last_save = time.time()
            if rec["year"] >= a.until:
                return
        if time.time() - last_save > a.idle:
            c.grab(os.path.join(a.out, "game-over.png"))
            return
        im = c.grab()
        s = c.screen(im)
        if s == "other":
            time.sleep(0.4)
            im = c.grab()
            h = hashlib.md5(im.tobytes()).hexdigest()
            if h not in seen:
                seen.add(h)
                im.save(os.path.join(a.out, "screens", f"{n:04d}-{h[:8]}.png"))
                log.write(json.dumps({"n": n, "t": round(time.time(), 1), "screen": h[:8]}) + "\n"); log.flush()
            c.key("Return")
            last_key = time.time()
        elif s == "map" and time.time() - last_key > 1.5:
            c.key("space")
            last_key = time.time()
        time.sleep(0.3)


if __name__ == "__main__":
    main()
