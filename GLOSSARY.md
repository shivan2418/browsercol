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
A full set of map art (images, plus the colours and chip texts the map draws) addressed by resource keys and containing no rules changes. FreeCol's own art is the default Tileset; a player can provide another as an art-only mod. A Tileset says which **Map views** it supports; a view's Tileset needs only what that view draws itself (for Top-down: terrain, water, forests, relief, rivers and roads), and the rest comes from FreeCol's default Tileset. A Tileset may also give the look of **Shader water** (BrowserCol does), and may register layers of **Art placed by rule**.
_Avoid_: skin, theme, art pack

**Map view**:
How the Browser UI projects the square grid of the model: Top-down (tiles as squares) or Isometric (tiles as diamonds). A game is played in the Map view its **map shape** is made for and stays in it; only the debug side panel switches it, and the map then only has to draw. The Tileset picker offers the Tilesets that support the view, and the last one used in each view is remembered.
_Avoid_: camera, perspective, projection mode

**Map shape**:
A map's outline on the square grid, saved with the game and fitting one **Map view**. A **Top-down-shaped** map is a rectangle of the grid. An **Isometric-shaped** map is a 45 degree diamond of it, the same shape as FreeCol's staggered maps, and a rectangle on screen in the Isometric view. The tiles in the corners of an Isometric-shaped map's bounding box are not part of the map: units cannot enter them and nothing draws or counts them. North and latitude follow the shape: north is up the screen, which is (0, -1) on a Top-down-shaped map and the corner direction (-1, -1) on an Isometric-shaped one, and the poles are the top and bottom of the screen, the high seas the east and west edges (docs/adr/0014).
_Avoid_: map type, map mode, map layout

**Tileset art**:
The pictures of the map that a Tileset's images give, by resource key, as FreeCol draws them.
_Avoid_: classic mode, sprite mode

**Shader water**:
The water (ocean, lakes, high seas) of a Tileset that gives its look (shader.water.* keys) drawn as Tileset art as one surface under the tiles, in place of FreeCol's painted frames: FreeCol's own water art, coloured per pixel by a shader by the climate of the nearest land, with a shallow shelf, bands moving ashore and foam at the beach. The water tiles draw only their coasts' sand. It is made once from the whole map's terrain, explored or not, which the server Engine in the browser has: exploring changes nothing of it, and the water at the edge of what is explored hints at the shore beyond. Its rivers flow too: one surface in FreeCol's river shapes and banks, carried downstream and fading into the sea at their mouths. Where the shader cannot run, compile or draw, the water and rivers are FreeCol's frames.
_Avoid_: animated water, water effect

**Art placed by rule**:
The pictures of the map that code places over the tiles by rules rather than a fixed image per tile, such as single trees scattered in a forest or peaks scattered on mountains. A Tileset registers it as layers in the chunk tilemap's seam (`ui/src/tile-art.ts`); the real use is post-2.0, and only a debug layer ships (docs/adr/0003).
_Avoid_: procedural mode, fancy mode, HD mode, 3D mode

**Resource key**:
FreeCol's name for one piece of art (e.g. a terrain tile, a unit image or the road colour), resolved to an image, colour or string through resource properties and mod overrides.
_Avoid_: asset id, sprite name

**Title screen**:
The Browser UI's first page, a parchment map with the main menu: New Game (to the Start screen), Continue, Load Game, Options (Preferences) and Quit (FreeCol's MainPanel).
_Avoid_: main menu page, splash screen, landing page

**Start screen**:
The Browser UI's page after the Title screen's New Game, where the player picks a European nation and a difficulty level before the game starts (FreeCol's NewPanel and StartGamePanel, single player). Its choices reach the Engine as a preset.
_Avoid_: new game dialog, lobby

**Room**:
One multiplayer game as the Multiplayer relay knows it: its host, its Seats and the long random ID in the invite link. A Room outlives a closed tab only through the host's save, which keeps its ID (docs/adr/0010).
_Avoid_: lobby, session, match

**Seat**:
One human's place in a Room, the host's or a guest's, held by a token the player's browser keeps so that reopening the link brings them back to the same nation.
_Avoid_: slot, client

**Multiplayer relay**:
The API Gateway WebSocket API and Lambda that carry FreeCol's protocol messages between the host's browser, which runs the server Engine, and the guests' browsers. It reads only which Seat a message is for, never the game (docs/adr/0010). Not the feedback relay in `relay/` (docs/adr/0009).
_Avoid_: game server, multiplayer server, backend

**Option editor**:
The one Browser UI editor for FreeCol option groups (a difficulty level, the game options): editable on the Start screen, where changes go to the Engine in the preset, read-only during play (FreeCol's DifficultyDialog and GameOptionsDialog).
_Avoid_: settings panel, options dialog

**Command**:
One thing the player asks the Engine to do on their turn (a move, a colonist put to work, a ship loaded), as `Commands.java` has them. The Engine runs the commands one at a time, in a queue (`CommandQueue.java`), and a command that comes while another runs waits its turn.
_Avoid_: action, order, request

**Theme**:
How the Browser UI's windows and bars look, as the player picks it in Preferences: a palette and a font set. A theme changes only tokens, never a component (docs/adr/0008).
_Avoid_: skin, style (and not the Tileset, which is the map's art)

**Token**:
A named value a theme may change, as a CSS custom property on the root: a colour, a font, a spacing step, a radius, a border width, the caption's type or a shadow (`--panel`, `--space-4`). A component may name its own, defaulting to a global one (`--frame-pad`).
_Avoid_: variable, design constant
