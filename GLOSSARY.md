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
An art-only FreeCol mod that overrides image resource keys and contains no rules changes.
_Avoid_: skin, theme, art pack

**Resource key**:
FreeCol's name for one piece of art (e.g. a terrain tile or unit image), resolved to an image through resource properties and mod overrides.
_Avoid_: asset id, sprite name
