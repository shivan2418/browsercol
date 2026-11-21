# The map is drawn from Tileset art and from art placed by rule

The map's pictures come from two sources. **Tileset art** is what a Tileset's images give by resource key, as FreeCol does: FreeCol's own art by default, or an art-only mod the player provides. **Art placed by rule** is what code decides to draw by rules over the tiles, such as single trees scattered in a forest or peaks scattered on mountains, following the layered-forest work in Lolonization. Units, colonies and roads still come from Tileset art. We keep both: Tileset art keeps FreeCol's art and the art mods players already make, and art placed by rule gives a look that a fixed image per tile cannot give.

This record first named them two Map modes that the player chooses between (Tileset mode and Procedural mode). Since #522 there is a second axis, the **Map view** (ADR 0014), and the player's choice is a Tileset and a view. So there is no Map mode setting. Art placed by rule is a part of a Tileset's look: a Tileset registers layers of it (#535).

## Tilesets are classed by Map view

A Tileset says which Map views it supports, Top-down, Isometric or both. FreeCol's default Tileset, BrowserCol's and FreeCol+'s are Isometric. Top-down has a small built-in Tileset, so it always has one. The Tileset picker offers only the Tilesets that support the view, and the Browser UI keeps the last Tileset used in each view.

A Tileset in a view needs only what that view draws itself: for Top-down, terrain, water, forests, relief, rivers and roads. What it does not have (units, colonies, resources, icons) comes from FreeCol's default Tileset.

## The seam for art placed by rule

The chunk tilemap that draws the map's static layers accepts extra layers that a Tileset registers (`ui/src/tile-art.ts`). A layer is called once per tile with the tile, its neighbours, a seed and the current `Projection`, and returns pictures and where to put them. With no layer registered nothing is called and nothing is allocated. The seam ships with one debug layer, a marker at each tile's middle, to show it draws in both views. The real use, Lolonization's layered forests and scattered peaks, is post-2.0.

## Considered Options

- Tileset art only: rejected, one image per tile cannot give continuous forests across tiles. In Lolonization, AI-painted pieces for each tile also spread paint onto the wrong tiles (trees over the sea, in river channels).
- Art placed by rule only: rejected, it drops FreeCol's art and player Tilesets.
- Bake the look of art placed by rule into whole-tile images for a Tileset: rejected, every combination of neighbours needs its own image.
- A Map mode setting beside the Map view: rejected, a player would have to choose between two things that are not alternatives. Art placed by rule is drawn over Tileset art, and what a Tileset gives is up to the Tileset.

## Consequences

- Two sources of the map's pictures in the Browser UI. Both read the same game state through WebGUI and the client Engine.
- Art placed by rule needs its own art (for example tree sheets), which a Tileset supplies with its layer.
- A Tileset that supports a view it has little art for (Top-down terrain alone) still plays: the rest is FreeCol's.
