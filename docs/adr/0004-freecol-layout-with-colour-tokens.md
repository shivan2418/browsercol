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

## Fonts (#166)

The text uses a bundled font set rather than the system's fonts, so the game looks the same on Windows, Mac and Linux. The default set is Cinzel, Roman inscription capitals, on window title bars, and Noto Sans for everything else, body text and numbers included. The fonts are OFL-licensed woff2 subsets served from our own `dist/` (ADR 0001), declared in `ui/src/fonts.css` as two tokens, `--font` and `--font-title`. The palette and the font set together are the player's theme: both are in Preferences (`theme.ts`), and a new font set is one more `:root[data-fonts=…]` block plus an entry in `FONT_SETS`. The prototype that settled this is on branch `prototype/166-font`, as direction D.

- No font family outside `fonts.css` and `--font-mono`; panels use the tokens.
- A bundled font is credited in `credits.tsx` and ships its licence text beside its files.
- Rejected for the default: Noto Sans alone (no period feel), and EB Garamond, IM Fell English or Goudy Bookletter 1911 for headings (heavier, and the last two have no Cyrillic). They remain candidates for further font sets.
