Issue #42: the map canvas is sized in CSS pixels and drawn at one canvas
pixel per CSS pixel, so on a HiDPI screen (devicePixelRatio 2) the
browser scales it up and the map is blurry. Draw it at the screen's
pixel ratio.

Where:
- `ui/src/map.ts`: `pixiPen` (~line 151) passes no `resolution` or
  `autoDensity` to PixiJS `app.init`; `canvasPen` (~line 227) sets
  `canvas.width`/`height` to the CSS size and its `resize` does the
  same; `show` clears with `fillRect(0, 0, width, height)` and sets the
  transform with `setTransform(scale, 0, 0, scale, dx, dy)`.
- `ui/src/main.tsx` `mapSize()` gives the map host's box in CSS pixels;
  keep that as the canvas's CSS size.

Do:
- PixiJS: `resolution: window.devicePixelRatio || 1, autoDensity: true`
  in `app.init`; check `app.renderer.resize(w, h)` still takes CSS
  pixels with autoDensity (it does in PixiJS 8; confirm in
  node_modules/pixi.js).
- Canvas 2D: backing store `w * dpr` by `h * dpr`, `canvas.style.width`
  and `height` in CSS px, and fold dpr into the transforms in `show`
  (the clear and the world transform), so all drawing code keeps
  working in CSS pixels. Same in `resize`.
- Read devicePixelRatio when the pen is made and on resize. Watching
  for a ratio change (moving the window to another screen) is optional;
  if you skip it, say so in your report.

Done when:
- Both renderers draw at devicePixelRatio and the canvas's CSS size is
  still the map host's box.
- `tileAt`, the pointer (`ui/src/pointer.ts`, `onCanvas` uses
  getBoundingClientRect, CSS pixels) and play.mjs's canvas clicks still
  work: they must stay in CSS pixels. Do not change them unless a test
  shows they break.
- A unit test (vitest, `ui/src/*.test.ts`) for whatever pure helper you
  add (for example the backing size for a CSS size and ratio).
- `vp check`, `vp test`, `./dev.sh ./build.sh`, then smoke.mjs,
  play.mjs and tileset.mjs pass. If you can, also run play.mjs once
  with a device scale factor of 2 (Playwright `deviceScaleFactor: 2` in
  the context options, only for that local run, not committed unless
  it is a clean option of the script) and say what you saw.
- Commit subject like `Map: draw at the screen's pixel ratio (#42)`.

Traps:
- tileset.mjs reads pixels with getImageData on its own canvases; check
  it does not read the map canvas, or if it does, that it still works.
- Do not scale line widths or text sizes by hand: the transform does it.
- Builds and browser scripts take minutes; pipe output through
  `tail -30`.
