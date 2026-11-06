# Controls a browser draws itself come from a headless library; the rest stay native, styled in CSS

The Browser UI should look like a game, not a web page, and a browser draws some form controls itself: the open list of a `<select>` (the operating system's list, its font and its blue highlight), the tooltip of a `title` attribute, and the spinner of an `<input type="number">`. CSS cannot reach these. For them we use Base UI (`@base-ui/react`), an unstyled component library, styled with the colour tokens of `theme.css` like everything else (ADR 0004): its Select, Tooltip and NumberField. Every other control stays a native element, restyled in CSS: checkboxes and radio buttons with `appearance: none`, drawn in FreeCol's shape with its checkmark and radio art (FreeColCheckBoxUI, FreeColRadioButtonUI), and sliders, progress bars, disclosure triangles and scroll bars with their own CSS rules. A native element stays a real form input that needs no script, and the page loads less code.

## Considered Options

- **shadcn/ui:** rejected. It copies Radix-based components into the repo, styled with Tailwind in its own web-app look. That look is the part we would throw away, and Tailwind would be a second styling system beside the token CSS that `theme.test.ts` checks.
- **Radix Primitives:** close second. It is unstyled and styled through `data-state` as Base UI is, but it has no number field, and its development has slowed since Base UI, by the same authors, became stable.
- **React Aria:** rejected for now. It covers the same controls and more, but it is larger and hook-shaped, and its drag and drop uses the browser's own drag, which is the very thing the colony and Europe panels want to leave behind.
- **Build each control by hand:** rejected. A listbox and a tooltip that a keyboard and a screen reader can use are a lot of code to get right, and the menu bar and popup menu already show how much.
- **A library for every control, checkboxes included:** rejected. CSS styles those fully, and a library control adds script and moves away from a plain form input for no gain.

## Consequences

- A new control that a browser draws itself and CSS cannot style is taken from Base UI before writing one by hand.
- Base UI's popups (a select's list, a tooltip) render in a portal. The portal is `#overlays`, and the popup gets the player's UI scale (`--ui-zoom`) as the windows do.
- Escape closes only the newest thing on screen (`useEscape` in `frame.tsx`): a select's list or a tooltip closing on Escape must not also close the window it is in.
- What is already built by hand stays as it is: the menu bar, the popup menu, the window frame and the focus trap in `focus.ts`.
- Drag and drop is outside this decision; Base UI has none.
- The styles stay in `index.html` and use the tokens only, so a palette or font set still changes the controls with everything else.
