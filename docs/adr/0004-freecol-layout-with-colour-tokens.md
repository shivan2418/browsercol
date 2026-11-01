# Panels follow FreeCol's layout; colours come from swappable tokens

For 1.0 the Browser UI's panels and dialogs keep FreeCol's own arrangement. There is a menu bar over the map with the status line at its right (Score ✧ Gold ✧ Tax ✧ Year), the minimap bottom-left and the info panel bottom-right. The colony panel, Europe and choice dialogs are laid out as the Swing client lays them out (ColonyPanel, EuropePanel, FreeColChoiceDialog). What we change is readability: dark text on light parchment panels, with brown kept for borders, headings and the menu bar, in place of FreeCol's small dark text on brown, textured backgrounds. The colours are a small set of tokens named for their role (`--menubar`, `--panel`, `--ink`, `--btn` and so on) in `ui/src/theme.css`. Everything else uses only the tokens, so the palette can be changed or swapped in one file. Parchment is the default and a dark palette is an alternative (`?theme=dark`).

The prototype that settled this is on branch `prototype/48-look` (#48), as look E.

## Considered Options

- **A new layout (prototype looks A to D):** rejected for 1.0. A light window-and-table look, a dark docked drawer, and full-screen sheets with a top bar each needed their own design for every later panel. FreeCol's layout is already known to players and to us. A colony quick-view drawer (look D) was liked, but it is left for after 1.0.
- **Keep FreeCol's skin as it is:** rejected, it is hard to read.

## Consequences

- A new panel copies the layout of its Swing counterpart, so read FreeCol's source for it rather than design one.
- No colour literal outside `theme.css`. `theme.test.ts` checks that `index.html` uses tokens only and that every palette sets every token.
- Today's right-hand side panel is a debug scaffold, not part of this look.
