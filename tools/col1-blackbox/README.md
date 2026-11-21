# col1-blackbox

Clean-room black-box harness for the original Colonization (1994). It runs
the user's own GOG copy in DOSBox on a hidden X display inside Docker, drives
it with keystrokes, and observes what the game shows and writes. It never
reads or disassembles the game's code, and uses no reverse-engineered
documentation (including community savegame-format docs). Hypotheses come from
`docs/research/col1-tax-public-sources.md`.

Nothing from the game is committed: no game files, screenshots, save files or
font glyphs (`runs/` and `glyphs.json` are ignored).

- `docker build -t col1-blackbox .` builds the image (DOSBox, Xvfb, xdotool).
- `run.sh runs/NAME --difficulty 0 --until 1600` plays one do-nothing game,
  logging the side panel each turn to `runs/NAME/turns.jsonl` and saving each
  popup to `runs/NAME/screens/`.
- `panel.py` reads the side panel by exact glyph match; `learn.py` labels new
  glyphs from a screenshot whose text you know.
- `poke.sh` sends keys to a running container and saves a 2x screenshot, for
  exploring screens by hand.

Screenshots only drive the game. The measurements are meant to come from save
files, with fields located by diffing our own saves (see the tax-rate ticket).

## Driving a game from a save

- `probe.sh NAME ORIGIN.SAV` starts a container with the save installed as
  slot 1; `poke.sh` gets through the menus to load it.
- `col.py` runs checked steps inside the container (`docker exec -w /harness
  NAME python3 col.py ...`): `screen`, `cheat`, `europe`, `tax up|down N`,
  `leave-europe`, `save SLOT`, `endturn N`. Each step first checks which
  screen is showing. Escape on the map asks to quit, and a blind Return then
  exits to DOS.
- Turn on the game options' Autosave: the game then rewrites `COLONY09.SAV`
  every turn, so every turn's state can be read from it.

## Save fields found by diffing our own saves

| Field | Where | How it was found |
|---|---|---|
| Year (16-bit little-endian) | offset 0x1A | Autosaves from consecutive turns hold 1497, 1498, … there. |
| Tax rate (percent, 1 byte) | 22,062 bytes before the end of the file | Saves at tax 0/1/2/5 in one turn (set with the cheat keys) differ in that byte only. It held for saves of 25,097 and 25,905 bytes, at tax 7 and 11. |

## Experiments

- `soak.sh OUT ORIGIN.SAV --until YEAR` loads the save and keeps ending
  turns, logging year and tax from every autosave to `OUT/turns.jsonl`.
  The game autosaves to `COLONY09.SAV` each turn, and to `COLONY08.SAV` in
  years ending in 0.
- `batch.sh PREFIX N ORIGIN.SAV` runs N soaks in parallel.
- Two runs from the same save become different games within a few turns, so
  the save does not fix the random seed and each run is its own sample.
