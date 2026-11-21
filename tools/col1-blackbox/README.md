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
