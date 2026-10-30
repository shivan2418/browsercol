# FreeCol Online

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
A full set of map art (images, plus the colours and chip texts the map draws) addressed by resource keys and containing no rules changes. FreeCol's own art is the default Tileset; a player can provide another as an art-only mod.
_Avoid_: skin, theme, art pack

**Map mode**:
The player's choice of how the Browser UI draws the map: Tileset mode or Procedural mode.
_Avoid_: renderer, graphics setting

**Tileset mode**:
The Map mode that draws everything on the map from the chosen Tileset's images, as FreeCol does.
_Avoid_: classic mode, sprite mode

**Procedural mode**:
The Map mode that draws terrain (ground, water, rivers, forests) in layers, with art such as single trees placed by code; units, colonies and roads still come from the chosen Tileset.
_Avoid_: fancy mode, HD mode, 3D mode

**Resource key**:
FreeCol's name for one piece of art (e.g. a terrain tile, a unit image or the road colour), resolved to an image, colour or string through resource properties and mod overrides.
_Avoid_: asset id, sprite name
