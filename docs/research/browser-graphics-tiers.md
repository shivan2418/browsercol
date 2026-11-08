# How pretty can BrowserCol get in a browser?

Research for #405 (the post-1.0 look: a modern game with the Mac Colonization's *feel*, brown wood menus with golden highlight text, units sliding, motion in the world). Scope: the map and world rendering, the art pipeline behind it, and what that costs in download size, GPU memory and CPU on low-end laptops in Firefox and Chromium. Panel and menu chrome (wood, parchment, gold) is HTML/CSS and is covered only where it touches the renderer. Sources were fetched in November 2026. Sizes marked "measured" were measured for this write-up from npm/jsDelivr files or our own `dist/`; nothing was built.

## Summary and recommendation

- **We already have the right renderer.** The map is drawn with PixiJS 8.22.0 on WebGL, with a Canvas 2D fallback, drawn only when something changed (`ui/src/map.ts`). PixiJS v8 can also do WebGPU, filters, particles, compressed textures and mipmaps. None of that needs a new library or more bytes on first load beyond small add-ons.
- **The look is limited by art, not by the renderer.** FreeCol's tiles are 128×64 sprites painted for 1× zoom. The biggest visible gain is new art at 2× (hi-DPI and zoom), plus cheap motion: water, shoreline foam, smoke, sails, a day tint.
- **Recommended path: the medium tier.** Keep PixiJS. Add a "BrowserCol" Tileset at 2×, made by pre-rendering 3D models (Meshy, paid plan, or Blender) to isometric sprite sheets, with normal maps for a soft light pass. Stream it after first load as KTX2 textures, with the transcoder self-hosted. FreeCol's own art stays as the default Tileset and the fallback (ADR 0003).
- **True 3D (Three.js, Civ IV: Colonization-style) is possible but is a second game client.** WebGL2 on an integrated GPU can draw a 2008 DirectX 9 scene. The cost is the content (hundreds of models), a new map renderer, a few hundred MB of streamed assets, and GPU/CPU time that competes with the Engine Worker, which is already slow in Firefox (#375). Treat it as a stretch beyond the ambitious tier, not a plan.
- **Don't build on WebGPU yet.** Firefox ships it on Windows (141) and Apple Silicon Macs (147) only; Linux is still Nightly. WebGL2 reaches 97% of users. PixiJS and Three.js both fall back, so WebGPU can be an option later, not a requirement.

## Where we are today

- **Renderer.** `ui/src/map.ts` creates a PixiJS `Application` with `autoStart: false` and stops its ticker. It renders only through `redraw()`, once per animation frame, when something changed. It passes no `preference`, so PixiJS 8.22.0 tries WebGL first, then WebGPU, then Canvas (`renderPriority = ["webgl", "webgpu", "canvas"]` in `pixi.js/lib/rendering/renderers/autoDetectRenderer.mjs`). A Canvas 2D pen exists for headless browsers where PixiJS gets no renderer.
- **Hi-DPI.** The renderer's `resolution` is `devicePixelRatio` with `autoDensity: true`, except at FreeCol's lowest graphics quality, which renders at 1× and drops antialiasing.
- **Motion.** Units already slide between tiles (`MOVE_MS`, `slide()`), the camera follows a sliding unit, the active unit blinks, explored tiles fade in, and water and rivers animate at one frame per 125 ms (`TICK_MS` in `ui/src/tileset.ts`). A rAF `tick()` runs each frame; it repaints only when a slide, blink, fade or water frame moved on.
- **Art.** FreeCol's own `data/rules/classic` Tileset: 767 PNGs, 12.5 MB raw in `dist/art/default`. Most are 128×64 terrain diamonds, 128×84 forest and hill overlays, and 512×256 pieces. Decoded as RGBA they would take about 75 MB of GPU memory if all were uploaded at once (measured: the sum of their pixel areas × 4 bytes).
- **Licence.** FreeCol's README: "Most of the content, like artwork, music and sound effects, are also licensed under GPL v2. Some of the content is licensed using CC BY 4.0" (`freecol/README.md`, the License section). The Mac Colonization's art, fonts and screens belong to Take-Two and can't be used (#405). The same holds for Civilization IV: Colonization.

## Budget: 30 MB gzipped first load

`.github/workflows/pages.yml` fails a deploy whose first load is over 30 MB, counted as `gzip -9` of every file in `dist/` except the test Tileset, debug presets, audio and translations.

Measured on the `dist/` built 2026-11-07 (not rebuilt for this):

| Part | gzip |
|---|---|
| Total first load | **22.1 MB** |
| `art/` (FreeCol's Tileset, mostly PNG, which barely gzips) | 12.7 MB |
| `assets/` (Engine Wasm, JS, fonts) | 9.2 MB |
| `icons/`, `brand/`, the rest | 0.2 MB |

So there is about **7.9 MB of headroom**. Any new art set bigger than that must load after first load: start the game with FreeCol's art (or a low-res version of the new set) and swap in the hi-res set when it arrives. The budget step would need to exclude that directory the way it excludes `audio/` today.

## 1. Rendering options

### Libraries and size

npm `unpackedSize` (from the registry's `latest` record) counts sources, maps and types, so it says little about what ships. The second column is the library's own minified bundle, `gzip -9`, measured. A bundler tree-shakes most of these further.

| Library | Version | Licence | npm unpacked | min + gzip (whole bundle) | Renderers |
|---|---|---|---|---|---|
| [PixiJS](https://www.npmjs.com/package/pixi.js) | 8.22.0 | MIT | 76 MB | 237 KB (`dist/pixi.min.js`) — **already in our bundle** | WebGL2, WebGPU, Canvas |
| [pixi-filters](https://www.npmjs.com/package/pixi-filters) | 6.1.5 | MIT | 2.7 MB | 44 KB (all filters) | Pixi add-on |
| [Three.js](https://www.npmjs.com/package/three) | 0.187.0 | MIT | 21 MB | 195 KB (`three.core.min.js` + `three.module.min.js`); 228 KB with the WebGPU build | WebGL2, WebGPU |
| [Babylon.js](https://www.npmjs.com/package/@babylonjs/core) | 9.35.0 | Apache-2.0 | 74 MB | 1.9 MB (UMD `babylon.js`, everything) | WebGL2, WebGPU |
| [Phaser](https://www.npmjs.com/package/phaser) | 4.2.1 | MIT | 113 MB | 352 KB (`dist/phaser.min.js`) | WebGL2 (Canvas deprecated) |

All of these fit the budget. The library is never the expensive part; art is.

### What each makes possible

**Canvas 2D.** Draws images, paths and text; no shaders. Lighting, water distortion and tinting must be pre-baked or done per pixel on the CPU. Both browsers now GPU-accelerate it: Firefox turned it on for Linux and macOS in 110 ([Phoronix](https://www.phoronix.com/news/Firefox-110-Released)), Android in 113 ([release notes](https://www.firefox.com/firefox/android/113.0/releasenotes/)) and Windows in 133 ([bug 1910138](https://bugzilla.mozilla.org/show_bug.cgi?id=1910138)), with a blocklist for bad drivers. Fine as our fallback; not a base for the new look.

**PixiJS v8 (what we use).**
- *Filters:* built in are Alpha, Blur, ColorMatrix, Displacement and Noise, plus blend modes ([filters guide](https://pixijs.com/8.x/guides/components/filters)); pixi-filters adds more (glow, outline, god-rays, bloom and others). A ColorMatrix on the world layer gives a day/season tint for almost nothing; a Displacement filter gives rippling water; glow and outline give hover feedback on units.
- *Particles:* the v8 `ParticleContainer` draws light particles rather than sprites, and its release post shows a million on screen and claims over 3× the v7 speed ([blog](https://pixijs.com/blog/particlecontainer-v8)). Enough for chimney smoke, sea spray, birds, cannon smoke.
- *Lighting:* no built-in normal-map lighting. `pixi-lights` targets v6/v7 only ([npm](https://www.npmjs.com/package/pixi-lights)). A third-party v8 package, `pixijs-light2d`, claims normal-map support (unverified; not reviewed). A custom shader pass is a few hundred lines and is what we would likely write.
- *Zoom quality:* `TextureSource` has `autoGenerateMipmaps` (pixi.js 8.22.0 type definitions), so zoomed-out sprites stay smooth. Sharp zoom-in needs higher-res art; vector sprites (SVG rasterised at the zoom) are possible but slow to re-rasterise.
- *Compressed textures:* DDS, KTX, KTX2 and Basis loaders, enabled by importing `pixi.js/ktx2` etc. ([guide](https://pixijs.com/8.x/guides/components/assets/compressed-textures)). **ADR 0001 catch:** the transcoder URLs default to jsDelivr (`https://cdn.jsdelivr.net/npm/pixi.js/transcoders/ktx/libktx.js`, in `setKTXTranscoderPath.mjs`). We must call `setKTXTranscoderPath`/`setBasisTranscoderPath` with our own copies. The Wasm transcoders are 224 KB (Basis) and 319 KB (libktx) gzipped, measured from `pixi.js/transcoders/`.
- *Workers:* `DOMAdapter.set(WebWorkerAdapter)` runs PixiJS on an `OffscreenCanvas` in a Worker ([environments guide](https://pixijs.com/8.x/guides/concepts/environments)).

**Three.js.** A full 3D scene graph: PBR materials, shadows, glTF loading, KTX2 via `KTX2Loader` with a transcoder path we host, and post-processing. `WebGPURenderer` (import from `three/webgpu`) falls back to a WebGL2 backend when WebGPU is missing; the manual still calls `WebGLRenderer` the recommended choice for pure WebGL2 apps ([manual](https://threejs.org/manual/en/webgpurenderer.html)). Blogs claiming WebGPURenderer has been "production-ready since r171" could not be checked against an official release note (unverified). A 2D isometric map in Three.js is possible with orthographic camera and sprites, but gains nothing over PixiJS. It earns its place only for true 3D.

**Babylon.js.** Similar to Three.js in features, with more built in (GUI, physics, inspector). Its whole UMD bundle is ~1.9 MB gzipped; the ES module package tree-shakes (not measured). No reason to pick it over Three.js for us.

**Phaser 4.** A game framework on its own WebGL renderer, released April 2026, with filters and real-time lighting; its Canvas renderer is deprecated ([Phaser news](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games), [v4.0.0 release](https://github.com/phaserjs/phaser/discussions/7274)). It brings its own scenes, input and loader, which overlap with what our React UI and `map.ts` already do. Its normal-map lighting is a point in its favour; switching costs a rewrite of `map.ts` for that one feature.

### What the effects look like and cost, per renderer

| Effect | Canvas 2D | PixiJS v8 | Three.js |
|---|---|---|---|
| Animated water | frame swap (today) | frame swap + displacement filter | shader water, reflections |
| Shoreline foam | pre-baked masks | animated sprite strips or shader on masks | shader on mesh edge |
| Fog of war | darkened tiles | tinted layer + blur filter for soft edges | shader / volumetric |
| Day/season tint | re-draw | ColorMatrix filter, one pass | lights |
| Dynamic light | no | custom normal-map shader | built in |
| Particles | CPU-bound | `ParticleContainer` | points / instanced meshes |
| Unit motion | sprite moves (today) | sprite moves + sprite-sheet animation | skeletal animation (glTF) |
| Zoom | image smoothing only | mipmaps + hi-res art | free camera, LOD |

## 2. Low-end laptops, Firefox and Chromium

**WebGL2** is at 97.3% global usage: Chrome 56+, Firefox 51+, Safari 15+ ([caniuse](https://caniuse.com/webgl2)). It is the safe base.

**WebGPU** (caniuse puts it at 88.6% of usage, but marks Firefox as off by default since only some platforms have it, [caniuse](https://caniuse.com/webgpu)):
- Chrome: Windows, Mac and ChromeOS since 113; Android 12+ on most GPUs since 121; Linux on Intel Gen12+ since 144, NVIDIA on Wayland since 147; other Linux GPUs behind a flag ([gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), edited 2026-10-02).
- Firefox: Windows since 141 ([Mozilla gfx blog](https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/)); Apple Silicon Macs since 147 on all macOS versions ([147 release notes](https://www.firefox.com/en-US/firefox/147.0/releasenotes/)); **Linux is Nightly only**, expected in 2026; Android off by default ([gpuweb status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)). Intel Macs: TBD.
- Safari: on by default in macOS/iOS/iPadOS/visionOS 26 (same source).

The owner's dev machine is Linux and Firefox on Linux has no WebGPU, so a WebGPU-only renderer would not even run there. PixiJS's current WebGL-first order is right.

**OffscreenCanvas** works in Chrome 69+, Firefox 105+ and Safari 17+ ([caniuse](https://caniuse.com/offscreencanvas)). Moving the map to a Worker would free the main thread for React, but it would not free a CPU core: the Engine already has its own Worker, and the map render is GPU-light. Not worth it until the main thread shows up as the bottleneck.

**CPU contention (#375).** Firefox AI rounds already run 2–4× slower than Chromium's in the Engine Worker, with the page's rAF p95 at 21 ms during rounds. On a 2- or 4-core laptop, every millisecond the renderer spends on the CPU is taken from the AI. So:
- Keep rendering on change, as today. A continuous 60 fps render loop with filters on a 2× world would hold a core warm for no gain while nothing moves.
- Ambient motion (water, smoke, flags) should tick at a low rate (today's 8 fps water is FreeCol's own), skip when the tab is hidden (browsers pause rAF in background tabs, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)), and turn off with FreeCol's graphics-quality setting, as `TICK_MS` animation already does.
- Filters cost GPU fill rate, which is what integrated GPUs lack. A full-screen filter at 2× on a 1440p laptop screen is ~15 M pixels per pass. Apply filters to layers, not the whole stage, and cache layers that don't move (`cacheAsTexture`).
- Battery: the rule above (draw only on change, low ambient frame rate, none when hidden) is the battery rule too.

**GPU memory.** Integrated GPUs share system RAM. FreeCol's art is ~75 MB as RGBA if fully uploaded. The same set at 2× is ~300 MB, at 4× ~1.2 GB. Compressed GPU formats cut this by 4–8×: BC7/ASTC 4×4 use 1 byte per pixel, BC1/ETC1 0.5 (arithmetic from the formats' block sizes). KTX2 with Basis transcodes to whichever the GPU supports. For a 2× set this is the difference between ~300 MB and ~40–75 MB.

## 3. Art pipeline options

### (a) Painted 2D sprites

Hand-painted or AI-assisted redraws of FreeCol's tiles at 2×, keeping FreeCol's resource keys so the set is a Tileset (ADR 0003) and art-only mods keep working.

- *Look:* closest to the Mac Colonization's painted feel. Every frame of motion is a separate drawing, so animation stays sparse.
- *Effort:* FreeCol's set is 767 images; a 2× redraw is the same count, plus masks. AI image tools speed it up, but the ADR 0003 record notes that AI-painted tile pieces in Lolonization spread paint onto the wrong tiles (trees over the sea). Expect manual clean-up per tile and per transition.
- *Licence:* if a redraw is traced from FreeCol's GPL art, treat it as a derivative and keep it GPL-2.0 with credits (`credits.tsx`). Drawn fresh, it can carry any free licence we choose.

### (b) Pre-rendered 3D to isometric sprites

Model each unit, building, settlement and terrain piece once in 3D (Meshy or Blender), then render it to sprite sheets from FreeCol's isometric angle at 2×: several facings and walk/sail frames per unit, plus a normal map per sprite for a lighting shader in PixiJS.

- *Look:* consistent lighting and scale across the set; animation is cheap (render more frames); facings come free. This is how many late-1990s isometric games were made.
- *Meshy:* exports glb, obj, fbx, stl, usdz and 3mf; `enable_pbr` adds metallic, normal and roughness maps; Smart Topology targets 100–15,000 faces (meshy-t2) or up to 30,000 (meshy-t2.5) ([Meshy API: Text to 3D](https://docs.meshy.ai/en/api/text-to-3d)). Blender renders glb to sprites headless, in our Docker tooling.
- *Licence:* on Meshy's free plan, outputs are CC BY 4.0 and need a credit to Meshy; on paid plans the user owns the outputs, as long as they are not published to the Meshy Community and no one else's copyrighted material went in ([Meshy help: ownership](https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models), [commercial use](https://help.meshy.ai/en/articles/9992001-can-i-use-my-generated-assets-for-commercial-projects)). Either is compatible with a GPL game; CC BY 4.0 art already ships with credits. Don't feed Mac Colonization or Civ IV: Colonization screenshots into image-to-3D.
- *Effort:* model count is the cost, not render time. A scene template (camera, light, ground plane, scale) keeps renders consistent.

### (c) True 3D in the browser

glTF models (Meshy) drawn live by Three.js, with a 3D terrain mesh.

- *Look:* free zoom and rotation, real shadows and water. Furthest from FreeCol's look; Tileset mode and players' art mods don't carry over.
- *Effort:* a second map renderer, picking, pathing display, LOD, and every asset as a model, rigged where it moves (Meshy can rig and animate, at extra credits per model).

## 4. Constraints in one place

- **30 MB first load.** 7.9 MB left. A 2× art set must stream after first load.
- **ADR 0001, no runtime CDN.** Everything served from our `dist/`. PixiJS's KTX2/Basis loaders and Three.js's `KTX2Loader` need their transcoder paths pointed at our copies; PixiJS defaults to jsDelivr.
- **ADR 0003, two map modes.** A new art set is a Tileset (by resource key) or Procedural mode's own art. FreeCol's Tileset remains the default and the fallback for player mods.
- **ADR 0004, colour tokens.** Wood and gold chrome belong in `theme.css` tokens, not in the renderer. Map tints that should follow the palette read the tokens.
- **Licences.** FreeCol art GPL-2.0 (some CC BY 4.0); Meshy outputs CC BY 4.0 (free) or owned (paid); Mac Colonization and Civ IV: Colonization assets unusable.
- **Download after first load.** KTX2 (Basis ETC1S) files are typically smaller than PNGs of the same image and stay compressed on the GPU; UASTC is larger but higher quality (general Basis Universal trade-off; we have not measured our own art). Load the visible terrain and the player's nation first, then the rest in idle time. We have no service worker today, so caching relies on the browser's HTTP cache unless we add one (or the Cache API).

## 5. Browser games as reference points

Only examples with a source for their tech are kept.

- **Freeciv-web** (open source, play.freeciv.org): "a HTML5 2D version with isometric graphics" and "Freeciv WebGL … the 3D version, which uses the Three.js 3D engine" ([README](https://github.com/freeciv/freeciv-web)); the 3D beta launched in December 2016 ([Slashdot](https://games.slashdot.org/story/16/12/18/2019233/3d-freeciv-web-beta-released)). The closest precedent to us: a GPL strategy game server under a browser client, with a 2D isometric and a 3D mode side by side. Its forum's development thread records memory use as a recurring problem ([forum](https://forum.freeciv.org/f/viewtopic.php?p=53835)).
- **Forge of Empires** (InnoGames): moved from Flash to HTML5 by compiling its AS3 code with Haxe and OpenFL ([InnoGames newsroom](https://newsroom.innogames.com/future-proof-innogames-masters-the-leap-from-flash-to-html5-with-forge-of-empires)). A 2D isometric city builder with pre-rendered, richly painted buildings, which is roughly the medium tier's look.
- **Elvenar** (InnoGames): also moved from Flash to HTML5 ([newsroom, fifth anniversary](https://newsroom.innogames.com/fantastic-fantasy-world-of-elvenar-celebrates-fifth-anniversary)). Its toolchain is not documented (unverified that it is the same Haxe/OpenFL route).
- **PixiJS showcase** ([pixijs.com/showcase](https://pixijs.com/showcase)) lists Happy Wheels, Subway Surfers, LEGO City Adventures and others: commercial 2D games on the renderer we use. None is an isometric strategy game.
- Dropped for lack of a primary source: Krunker (only reviews say Three.js), Bloons, Lords & Knights, Townscaper on the web.

## 6. Three tiers

### Cheap: polish what we draw today

- **Looks like:** FreeCol's art, sharper and livelier. Smooth zoom-out (mipmaps), soft fog-of-war edges, a slight day or season tint, hover glow and outline on units, smoke from colonies, foam strips on coasts, wakes behind ships, sails animating on slide. Wood/gold chrome in HTML.
- **Renderer:** PixiJS v8 as is, plus pixi-filters (or just the two or three filters we use).
- **Art pipeline:** FreeCol's art; a few small new sprites (smoke puff, foam strip, wake) drawn fresh.
- **Effort:** small; a few tickets.
- **First load:** under 0.1 MB more.
- **Firefox / low-end risk:** low, if filters stay on small layers and ambient motion follows the graphics-quality setting.
- **ADRs and licences:** fits all. New sprites are ours; FreeCol's stay GPL.

### Medium (recommended): a 2× BrowserCol Tileset from pre-rendered 3D

- **Looks like:** a crisp, consistent 2× world on hi-DPI screens, close in spirit to Forge of Empires' isometric look. Units walk and ships sail with real frames and facings; buildings and colonies are detailed; a normal-map light pass gives a soft sun and a dusk tint; everything in the cheap tier too.
- **Renderer:** PixiJS v8, plus a custom normal-map lighting shader (or a vetted v8 lighting add-on) and the KTX2 loader with self-hosted transcoders.
- **Art pipeline:** (b): Meshy on a paid plan, or Blender, rendered to 2× sprite sheets plus normal maps through a scripted Blender scene; terrain may be painted (a) where 3D renders look sterile. Kept on FreeCol's resource keys so it is a Tileset.
- **Effort:** large in art, medium in code. Roughly FreeCol's set (64 unit images, 51 buildings, 65 settlements, 235 terrain, 160 forest, 89 river, from `dist/art/default`) plus animation frames. Weeks to months of art direction and clean-up, not of rendering code.
- **First load:** unchanged if FreeCol's art loads first and the 2× set streams after; +0.2–0.3 MB for one transcoder. Streamed size is unmeasured; a rough guess for KTX2 at 2× is 15–40 MB.
- **Firefox / low-end risk:** medium. GPU memory is the main risk (~300 MB at 2× as RGBA, ~40–75 MB compressed). Fall back to FreeCol's 1× art at low graphics quality.
- **ADRs and licences:** fits ADR 0001 (self-hosted transcoders), 0003 (it is a Tileset), 0004. Meshy paid outputs are ours; free-plan outputs are CC BY 4.0 and need a credit.

### Ambitious: lit, animated world, still 2D

- **Looks like:** the medium tier plus a continuous procedural terrain (ADR 0003's Procedural mode) with shader water (waves, shoreline foam, reflections of colonies), drifting clouds and their shadows, weather and seasons, particles for battles and harvests, and screen-level transitions into the colony and Europe screens.
- **Renderer:** PixiJS v8 with custom shaders and meshes; optionally the WebGPU backend where present, never required.
- **Art pipeline:** (b) for objects, plus procedural terrain art (texture sheets, tree sprites) per ADR 0003.
- **Effort:** large in both art and code; the shader work needs a person who has done it before.
- **First load:** as medium; procedural terrain can be lighter than per-tile art.
- **Firefox / low-end risk:** medium to high. Continuous water shaders want a steady frame rate, which works against draw-on-change and against #375. Needs a quality ladder and a still mode.
- **ADRs and licences:** fits; Procedural mode is already planned (deferred, #12).

### Stretch beyond ambitious: could we reach Civilization IV: Colonization's look?

**What Civ IV: Colonization renders.** Firaxis's 2008 total conversion of Civilization IV ([Steam](https://store.steampowered.com/app/16810/)). Civ IV's engine was built "from scratch" with help from NDL's Gamebryo, and was the series' first full 3D ([Wikipedia: Civilization IV](https://en.wikipedia.org/wiki/Civilization_IV); [Game Developer, 2005](https://www.gamedeveloper.com/game-platforms/-i-civilization-iv-i-to-use-gamebryo-engine)). Colonization's requirements were DirectX 9.0c, a 64 MB card with Shader 1.1 at minimum and 128 MB with DirectX 9 shaders recommended, 512 MB–1 GB RAM and 900 MB on disk; CivFanatics links the higher shader need to its improved water, foliage and terrain ([CivFanatics info center](https://civfanatics.com/civ4col/infocenter/), [requirements thread](https://forums.civfanatics.com/threads/civ4-colonization-system-requirements-released.290799)). Its per-model polygon and texture budgets are not published (unverified); a 128 MB card bounds the whole visible scene's textures.

**Can WebGL2 and Three.js match it on integrated GPUs?** On graphics alone, yes: today's integrated GPUs are far past a 2008 128 MB DirectX 9 card, and WebGL2 exposes more than Shader Model 3 did. Freeciv-web's Three.js client shows a 3D Civ-style map running in a browser, and also that it is hard to keep up: its README asks for help updating its Three.js version and its forum notes memory problems ([README](https://github.com/freeciv/freeciv-web), [forum](https://forum.freeciv.org/f/viewtopic.php?p=53835)).

**The real costs:**
- **Assets.** Every unit type, with its animations (walk, attack, die, work), every ship, colony and native settlement at several sizes, every building that the colony screen shows, terrain sets, and Civ IV-style animated 3D leader portraits for each European and native leader. In our terms: roughly FreeCol's ~25 unit types and their professions, ~50 buildings, 8 nations' settlements, ~15 terrain types with forests and features, plus leaders. Several hundred models, many rigged. None can come from Civ IV: Colonization (Take-Two).
- **Download.** At a few hundred KB to a few MB per textured glb (an estimate; unmeasured), the set is in the low hundreds of MB, an order of magnitude over the whole 30 MB first-load budget. It would have to stream after first load and be cached, with a 2D map shown until it arrives.
- **CPU and GPU contention.** A 3D map wants continuous rendering (camera moves, animation mixers, shadows). Skinned animation runs on the main thread's CPU in Three.js unless moved into a Worker, and it competes with the Engine Worker that already makes Firefox AI rounds 2–4× slower (#375). On a 2-core laptop the game would get slower to play, not just to draw.
- **Code.** A second map client: picking, paths, labels, minimap sync and the overlays `map.ts` already draws, all in 3D. Tileset mode and player art mods do not carry over.

**Verdict:** reachable in a browser in principle, not reachable for this project's size without a dedicated 3D artist and a long timeline. The medium tier's pre-rendered-3D sprites get much of the visual payoff (lit, consistent models) at a fraction of the cost and keep the 2D map.

## Recommendation

1. Do the cheap tier as the first #405 build work: it costs almost nothing in bytes and lands motion in the world, which #405 asks for.
2. Prototype the medium tier on a handful of pieces: one ship, one soldier, one colony, two terrains with coast. Render them from Meshy or Blender at 2× with normal maps, show them beside FreeCol's art in the existing prototype flow, and measure KTX2 size and GPU memory on a low-end laptop in Firefox.
3. Keep PixiJS on WebGL with WebGPU optional. Don't adopt Three.js, Babylon.js or Phaser for the map.
4. Self-host any transcoder before shipping compressed textures (ADR 0001).
5. Revisit the ambitious tier after Procedural mode (#12) and after #375's Firefox slowdown is better understood.

## Open questions for the owner

- Is a 2× art set worth a second Tileset to maintain, or should the new art replace FreeCol's as the default (keeping FreeCol's as an option)?
- Meshy plan: paid (we own outputs) or free (CC BY 4.0 with a credit)? Either is GPL-compatible; paid avoids an attribution line per asset.
- How much can stream after first load? Is a short swap from FreeCol's art to the new art on first visit acceptable?
- Should ambient motion (water, smoke, clouds) be on by default on Firefox, given #375, or follow the graphics-quality setting's default?
- Who directs the art? The medium tier's cost is mostly art direction and clean-up, not code.

## Not verified

- Three.js `WebGPURenderer` being "production-ready since r171" (blogs only).
- `pixijs-light2d` quality and maintenance for PixiJS v8.
- Elvenar's HTML5 toolchain.
- Civ IV: Colonization's model and texture budgets and asset counts.
- Streamed sizes of a 2× KTX2 Tileset and of glb models: estimates, not measured.
- Firefox WebGPU on Linux: Nightly only as of the gpuweb wiki's 2026-10-02 edit; a later stable release may have turned it on.
