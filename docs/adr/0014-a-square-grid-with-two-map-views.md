# A square grid with two Map views

FreeCol's map is a staggered diamond grid: odd rows are shifted half a tile, and `Direction`'s deltas split by row parity. That grid cannot give a Colonization-style top-down map, where tiles are squares and the map is a rectangle. So the model now uses a square grid (#522, #526), and Top-down and Isometric are two **Map views** of it. A player can switch between them during a game.

On the grid a tile has eight neighbours at the same offsets in every row (N is `(0, -1)`, NE is `(1, -1)`, and so on). The four that share an edge are N, E, S and W, and the four that touch only a corner are NE, SE, SW and NW; before, it was the other way round. Distance stays Chebyshev's, so a diagonal step costs one, as a straight step did. Rows are full height now, not half, so the default map is 80x50 tiles, the same 4000 tiles and the same proportions as 40x100 half rows, and the polar rows, the land generator's clearance to the top and bottom edges and the high seas strip were retuned to match; latitude, the regions' thirds and quadrants and the edge distance work from the map's size, so they needed nothing.

## Considered Options

- **Turn only the view 45 degrees:** rejected. The model would stay diamond-shaped, and the map would show as a tilted rectangle.
- **A brick layout** (rows offset by half a tile): rejected. It is still a staggered grid with a parity split in every piece of geometry code, and Top-down tiles would not line up.
- **A grid type per game:** rejected. Every piece of geometry code and every generator would need two versions, and a save could no longer be switched between views.

## Consequences

- The map's outer edges differ by view. A rectangle in Top-down is a large diamond in Isometric, as in OpenTTD. That is the accepted cost of having both views.
- No game rule changes in practice: distances are still Chebyshev's, a colony still works its eight neighbours, movement costs one per step in any of the eight directions, and line of sight and the AI use the same distance and ring code. East-west travel on a generated map takes twice as many steps, because a square tile is half as wide as a diamond was (the map is 80 tiles across, not 40), and the default width of the high seas strip is doubled, to 20 columns, to keep its share of the map.
- Old saves and the shipped maps hold staggered coordinates and break until they are converted (saves in #527, maps in #528). River style digits and coast style bits keep their order but now mean N/E/S/W for rivers and NE/SE/SW/NW for the coast's corners.
- Maps made from a seed change on purpose; `FixedSeedMapTest`'s hashes were retaken.
- The UI still draws the staggered grid until the Isometric view (#529) and the Top-down view (#530) land.
