# BrowserCol

FreeCol, the open-source Colonization clone, made playable single-player in a desktop browser from static hosting, built from FreeCol's own Java.

## Language

**Engine**:
FreeCol's own Java code (rules model, server, AI and the non-GUI client) compiled to run in the browser.
_Avoid_: core, backend, runtime

**Browser UI**:
The new interface players see and touch, replacing FreeCol's Swing GUI.
_Avoid_: frontend, web client, Swing UI

**WebGUI**:
The Engine-side implementation of FreeCol's `GUI` interface that hands every show/ask request to the Browser UI and returns the player's answer.
_Avoid_: bridge, adapter, glue

**Tileset**:
A full set of map art (images, plus the colours and chip texts the map draws) addressed by resource keys and containing no rules changes. FreeCol's own art is the default Tileset; a player can provide another as an art-only mod. A Tileset may also give the look of **Shader water** (FreeCol+ does).
_Avoid_: skin, theme, art pack

**Map mode**:
The player's choice of how the Browser UI draws the map: Tileset mode or Procedural mode.
_Avoid_: renderer, graphics setting

**Tileset mode**:
The Map mode that draws everything on the map from the chosen Tileset's images, as FreeCol does.
_Avoid_: classic mode, sprite mode

**Shader water**:
The water (ocean, lakes, high seas) of a Tileset that gives its look (shader.water.* keys) drawn in Tileset mode as one surface under the tiles, coloured per pixel by a shader from the Tileset's ripple images and colours, in place of FreeCol's painted frames. Each kind of water (ocean, high seas, lake) has its own roughness, foam and speed. The water tiles draw only their coasts' sand; rivers keep their frames, and where one runs into the water its water fades into the surface. Where the shader cannot run, compile or draw, the water is FreeCol's frames.
_Avoid_: animated water, water effect

The water playground's painted-art recipe uses a CPU coastline field in 2:1 texels. Closing grows and shrinks the coast without cutting land, preserving sailing links between water tiles, including corner links. An edge-connected lake mask ignores rivers. Climate weights blend nearby land over a configurable distance. Exploration patches the affected region; a newly opened sea connection also updates the affected lake.

Open `?tileset=freecol-plus&playground=water&water=A` to compare the painted-art variants. A uses turquoise shallows and a shader-drawn beach; B adds climate shallows; C keeps FreeCol's beach art; D uses foam without bands; E adds climate deep water to C. All five start with the darker, narrower shelf. The five axis pickers can combine them, and the old presets retain the parked ripple renderer. `water=Default` shows the flipbook; `split=0.5` puts it on the left of a draggable divider. The comparison tiles are built and animated only while shown. Terrain animation off freezes the shader too.

**Procedural mode**:
The Map mode that draws terrain (ground, water, rivers, forests) in layers, with art such as single trees placed by code; units, colonies and roads still come from the chosen Tileset.
_Avoid_: fancy mode, HD mode, 3D mode

**Resource key**:
FreeCol's name for one piece of art (e.g. a terrain tile, a unit image or the road colour), resolved to an image, colour or string through resource properties and mod overrides.
_Avoid_: asset id, sprite name

**Start screen**:
The Browser UI's first page, where the player picks a European nation and a difficulty level before the game starts (FreeCol's NewPanel and StartGamePanel, single player). Its choices reach the Engine as a preset.
_Avoid_: new game dialog, lobby

**Option editor**:
The one Browser UI editor for FreeCol option groups (a difficulty level, the game options): editable on the Start screen, where changes go to the Engine in the preset, read-only during play (FreeCol's DifficultyDialog and GameOptionsDialog).
_Avoid_: settings panel, options dialog

**Command**:
One thing the player asks the Engine to do on their turn (a move, a colonist put to work, a ship loaded), as `Commands.java` has them. The Engine runs the commands one at a time, in a queue (`CommandQueue.java`), and a command that comes while another runs waits its turn.
_Avoid_: action, order, request
