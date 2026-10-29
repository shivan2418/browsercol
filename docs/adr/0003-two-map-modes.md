# The Browser UI has two Map modes: Tileset and Procedural

Players choose how the map looks. Tileset mode draws it from a Tileset's images by resource key, as FreeCol does: FreeCol's own art by default, or an art-only mod the player provides. Procedural mode is the richer look. It draws terrain in layers and places art such as single trees by code, following the layered-forest work in Lolonization. Units, colonies and roads still come from the chosen Tileset. We keep both: Tileset mode keeps FreeCol's art and the art mods players already make, and Procedural mode gives a look that a fixed image per tile cannot give.

## Considered Options

- Tileset mode only: rejected, one image per tile cannot give continuous forests across tiles. In Lolonization, AI-painted pieces for each tile also spread paint onto the wrong tiles (trees over the sea, in river channels).
- Procedural mode only: rejected, it drops FreeCol's art and player Tilesets.
- Bake the procedural look into whole-tile images for a Tileset: rejected, every combination of neighbours needs its own image.

## Consequences

- Two terrain drawing paths in the Browser UI. Both read the same game state through WebGUI and the client Engine.
- Procedural mode needs its own art (for example tree sheets), which is not a Tileset.
