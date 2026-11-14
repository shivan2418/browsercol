# Small screens show windows as full-screen sheets

ADR 0004 keeps FreeCol's window layout, and it is built for 1280×720 and up. A phone in landscape is about 844×390, where those windows would shrink below a usable touch target. So the layout switches on available size: when the window's short side is under about 600 CSS px, every window is a full-screen sheet with a top bar (title, back/close), and windows opened from one stack on it. Small confirm dialogs stay centred modals. The map screen folds the menu bar into one menu button, makes the minimap a toggle and the info panel a bottom strip. The colony and Europe sheets have their own compact layouts with a vertical tab rail; other windows reflow inside the sheet.

The layout switch is independent of the input switch. Touch behaviour (long-press for right-click, gestures, tap-then-tap) follows the pointer type, per event. An iPad in landscape keeps FreeCol's windows with touch behaviour; a tiny desktop window gets sheets with mouse behaviour.

## Considered Options

- **Shrink FreeCol's windows to fit (`--fit`) and allow pinch inside them:** rejected, unplayable at phone size.
- **A separate mobile UI:** rejected, two of everything to keep.
- **Switch layout on touch input:** rejected, a 4K tablet is not a phone and a small laptop window is not a desktop.

Full-screen sheets were look C in the #48 prototype (`prototype/48-look`), rejected then for 1.0 only. Plan and stages: #509.

## Consequences

- ADR 0004 governs large screens. A new window copies its Swing layout and must also work as a sheet; most get this from `frame.tsx` for free.
- A panel needing its own compact layout (today colony and Europe) has it checked at phone sizes in `screen-fit`.
- Sizes and the 600 px threshold are tuned in one place.
