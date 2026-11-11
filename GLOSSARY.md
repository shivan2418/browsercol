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
A full set of map art (images, plus the colours and chip texts the map draws) addressed by resource keys and containing no rules changes. FreeCol's own art is the default Tileset; a player can provide another as an art-only mod. A Tileset may also give the look of **Shader water** (BrowserCol does).
_Avoid_: skin, theme, art pack

**Map mode**:
The player's choice of how the Browser UI draws the map: Tileset mode or Procedural mode.
_Avoid_: renderer, graphics setting

**Tileset mode**:
The Map mode that draws everything on the map from the chosen Tileset's images, as FreeCol does.
_Avoid_: classic mode, sprite mode

**Shader water**:
The water (ocean, lakes, high seas) of a Tileset that gives its look (shader.water.* keys) drawn in Tileset mode as one surface under the tiles, in place of FreeCol's painted frames: FreeCol's own water art, coloured per pixel by a shader by the climate of the nearest land, with a shallow shelf, bands moving ashore and foam at the beach. The water tiles draw only their coasts' sand. It is made once from the whole map's terrain, explored or not, which the server Engine in the browser has: exploring changes nothing of it, and the water at the edge of what is explored hints at the shore beyond. Its rivers flow too: one surface in FreeCol's river shapes and banks, carried downstream and fading into the sea at their mouths. Where the shader cannot run, compile or draw, the water and rivers are FreeCol's frames.
_Avoid_: animated water, water effect

**Procedural mode**:
The Map mode that draws terrain (ground, water, rivers, forests) in layers, with art such as single trees placed by code; units, colonies and roads still come from the chosen Tileset.
_Avoid_: fancy mode, HD mode, 3D mode

**Resource key**:
FreeCol's name for one piece of art (e.g. a terrain tile, a unit image or the road colour), resolved to an image, colour or string through resource properties and mod overrides.
_Avoid_: asset id, sprite name

**Start screen**:
The Browser UI's first page, where the player picks a European nation and a difficulty level before the game starts (FreeCol's NewPanel and StartGamePanel, single player). Its choices reach the Engine as a preset.
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
