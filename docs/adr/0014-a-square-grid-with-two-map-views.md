# A square grid with two Map views

FreeCol's map is a staggered diamond grid: odd rows are shifted half a tile, and `Direction`'s deltas split by row parity. That grid cannot give a Colonization-style top-down map, where tiles are squares and the map is a rectangle. So the model now uses a square grid (#522, #526), and Top-down and Isometric are two **Map views** of it. A game is made for one view and stays in it (#559, below).

On the grid a tile has eight neighbours at the same offsets in every row (N is `(0, -1)`, NE is `(1, -1)`, and so on). The four that share an edge are N, E, S and W, and the four that touch only a corner are NE, SE, SW and NW; before, it was the other way round. Distance stays Chebyshev's, so a diagonal step costs one, as a straight step did. Rows are full height now, not half, so a map of 40x100 half rows is 80x50 squares, the same tiles and proportions. The default random map is 58x72, the shape of the original game's map (4,176 tiles against FreeCol's 4,000), so crossing it takes 58 moves east to west, not 80 (#528). The polar rows, the land generator's clearance to the top and bottom edges and the high seas strip were retuned to match, in tiles, so they hold for any size; latitude, the regions' thirds and quadrants and the edge distance work from the map's size, so they needed nothing.

## Considered Options

- **Turn only the view 45 degrees:** rejected. The model would stay diamond-shaped, and the map would show as a tilted rectangle.
- **A brick layout** (rows offset by half a tile): rejected. It is still a staggered grid with a parity split in every piece of geometry code, and Top-down tiles would not line up.
- **A grid type per game:** rejected. Every piece of geometry code and every generator would need two versions, and a save could no longer be switched between views.

## Consequences

- The map's outer edges differ by view. A rectangle in Top-down is a large diamond in Isometric, as in OpenTTD. That is the accepted cost of having both views.
- No game rule changes in practice: distances are still Chebyshev's, a colony still works its eight neighbours, movement costs one per step in any of the eight directions, and line of sight and the AI use the same distance and ring code. East-west travel on a generated map takes twice as many steps, because a square tile is half as wide as a diamond was (the map is 80 tiles across, not 40), and the default of the maximum distance to the edge (the width of the high seas strip) is doubled, to 20 columns, to keep its share of the map.
- Old saves are converted as they load (#527, ADR 0007); the shipped maps hold staggered coordinates and break until they are converted (#528). River style digits and coast style bits keep their order but now mean N/E/S/W for rivers and NE/SE/SW/NW for the coast's corners.
- Maps made from a seed change on purpose; `FixedSeedMapTest`'s hashes were retaken.
- The Isometric view draws the square grid as one big diamond (#529); its art keeps FreeCol's diamonds, with each face meeting an N/E/S/W neighbour. The Top-down view follows in #530: 64x64 squares with placeholder art (flat colours and markers), reached only from the debug side panel until it has real art. `projection` in `ui/src/projection.ts` stands for whichever view is on, and switching it keeps the camera on the same tile.

## A map has a shape that fits its Map view (#559)

A map that is a rectangle in one Map view is a big diamond in the other, with its poles along two diagonal edges. So each game's map has a **map shape** that fits the view it is made for, and the game stays in that view. A mid-game switch would rarely be used and is not worth the work (the owner's call). The debug side panel keeps its switch for development; a map in the other view only has to draw.

- **Top-down-shaped** is the whole rectangle of the grid, as every map was until then. North is (0, -1), and a row is a grid row.
- **Isometric-shaped** is the diamond of tiles whose screen column x-y and screen row x+y are in a range. It is a rectangle on screen in the Isometric view, with arctic along the top and bottom and the high seas on the east and west edges, as in Civ II. It is FreeCol's staggered map laid on the square grid, which is what `Map.convertFromStaggered` (#527) already did: the staggered map's tile (column, row) is the grid tile `(column + ((row+1)>>1), (row>>1) - column + columns - 1)`. North is straight up the screen, the grid's NW corner direction (-1, -1); a row is half a tile high, so a pole is twice as many rows as the Top-down one.

The map keeps its bounding box as the tile array, and the tiles in the corners of the box are absent, not high seas or ocean: `Map.isValid` is false for them, so units cannot enter them, no neighbour or circle reaches them and nothing counts or draws them. A ship that sails off the east or west edge of the diamond has no tile ahead, which is how a ship has always left the map for Europe. An old staggered save, which `convertFromStaggered` used to give corners of high seas and ocean, now becomes an Isometric-shaped map tile for tile with nothing added.

`MapShape` (kind, bounding box and, for Isometric, the staggered rows) is the one place that knows the outline. `Map.getShape()` has it, and a tile's `row` and `column` in it stand for what used to be `y` and `x` wherever the code meant north to south or west to east: `Map.getLatitude(tile)` and `getRowOf`, `isPolar`, the generators' polar and clearance bands, the high seas strips, the tiles ships start from, `ServerRegion`'s quadrants and bounds, and the choice of "east" and "west" in the first turn's message. A region's bounds are in columns and rows. Game rules are as they were.

The shape is saved as the map's `shape` and `shapeRows` attributes (`SAVEGAME_VERSION` 16). A save without a shape is Top-down-shaped, so version 15 saves load as before; a save below 15 converts to an Isometric-shaped map.

The generator makes the map the game's shape ask for: the `model.option.mapShape` option, 0 Top-down or 1 Isometric. Until the setup menu has the choice (#531), the Browser UI sets it from the Map view the page is in when a new game starts, and a game from a save or a map file opens in the view that fits its shape. The map width and height options of an Isometric-shaped game are its staggered map's: tiles across and half-height rows.

**The Isometric default size is 41 across by 102 rows, 4,182 tiles**, for the 4,176 of the Top-down default of 58 by 72, so the same amount of land. The Top-down default is 58 squares across by 72 down, a ratio of 0.81. An Isometric-shaped map of 41 columns by 102 half rows is a rotated rectangle that is 41·√2 squares across by 102/√2 down, the same ratio of 0.81 and the same area; its 41 by 102 is also near FreeCol's own 40 by 100. On screen it is a wide rectangle, as Civ II's. The high seas strip of 20 columns of 58 is 14 of 41, and the polar strip is the same two tile heights, four rows. The land generator's clearances in columns are the same.

**FreeCol's own maps come in both shapes.** `freecol/data/maps/` holds #528's resampled, north-up maps as Top-down-shaped maps, and `freecol/data/maps/isometric/` the original staggered files from before #528, which load as Isometric-shaped maps, tile for tile. The start screen lists both, the Isometric ones with their staggered size and "Isometric". The America map of the original game is Top-down only.
