/**
 *  Copyright (C) 2002-2024   The FreeCol Team
 *
 *  This file is part of FreeCol.
 *
 *  FreeCol is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  FreeCol is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with FreeCol.  If not, see <http://www.gnu.org/licenses/>.
 */

package net.sf.freecol.common.model;

import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.logging.Logger;

import net.sf.freecol.common.model.Map.Position;
import net.sf.freecol.common.option.MapGeneratorOptions;
import net.sf.freecol.common.option.OptionGroup;
import static net.sf.freecol.common.util.CollectionUtils.*;
import static net.sf.freecol.common.util.RandomUtils.*;


/**
 * A class to encapsulate a binary land map.
 */
public class LandMap {

    private static final Logger logger = Logger.getLogger(LandMap.class.getName());

    /** The shape of the map: the outline, and what north is. */
    private final MapShape shape;

    /** The width of the box that holds the map. */
    private final int width;

    /** The height of the box that holds the map. */
    private final int height;

    /** A cached random integer source. */
    private final RandomIntCache cache;

    /** The land map.  True means land. */
    private boolean[][] map;

    /** Number of land tiles on the map. */
    private int numberOfLandTiles;


    /**
     * Create a new land map with specified dimensions.
     *
     * @param width The map width.
     * @param height The map height.
     * @param cache A pseudo random number source.
     */
    public LandMap(int width, int height, RandomIntCache cache) {
        this(MapShape.topDown(width, height), cache);
    }

    /**
     * Create a new land map with a given shape.
     *
     * @param shape The {@code MapShape}.
     * @param cache A pseudo random number source.
     */
    public LandMap(MapShape shape, RandomIntCache cache) {
        this.shape = shape;
        this.width = shape.getWidth();
        this.height = shape.getHeight();
        this.cache = cache;
        this.map = new boolean[this.width][this.height];
        this.numberOfLandTiles = 0;
    }

    /**
     * Create a land map by importing it from a given map.
     *
     * @param map The {@code Map} to get the land map from.
     * @param cache A pseudo random number source.
     */
    public LandMap(Map map, RandomIntCache cache) {
        this(map.getShape(), cache);

        for (int y = 0; y < this.height; y++) {
            for (int x = 0; x < this.width; x++) {
                this.map[x][y] = (map.isValid(x, y))
                    ? map.getTile(x, y).isLand()
                    : false;
                if (this.map[x][y]) this.numberOfLandTiles++;
            }
        }
    }

    /**
     * Create a new land map using parameters from a supplied map
     * generator options option group.
     *
     * @param mgo The map generator {@code OptionGroup} to use.
     * @param cache A pseudo random number source.
     */
    public LandMap(OptionGroup mgo, RandomIntCache cache) {
        this(shapeOf(mgo), cache);

        int distanceToEdge
            = mgo.getInteger(MapGeneratorOptions.PREFERRED_DISTANCE_TO_EDGE);
        int minNumberOfTiles = mgo.getInteger(MapGeneratorOptions.LAND_MASS)
            * this.shape.getColumns() * this.shape.getRows() / 100;
        int gen = mgo.getSelection(MapGeneratorOptions.LAND_GENERATOR_TYPE);
        logger.info("Using land generator "
            + mgo.getSelectionName(MapGeneratorOptions.LAND_GENERATOR_TYPE)
            + " to make a " + this.shape + " map"
            + " with distance-to-edge=" + distanceToEdge
            + " and min-tile#=" + minNumberOfTiles);
        generate(gen, distanceToEdge, minNumberOfTiles);
    }


    /**
     * The shape the map generator options ask for.
     *
     * @param mgo The map generator {@code OptionGroup}.
     * @return The {@code MapShape}.
     */
    private static MapShape shapeOf(OptionGroup mgo) {
        final int w = mgo.getInteger(MapGeneratorOptions.MAP_WIDTH);
        final int h = mgo.getInteger(MapGeneratorOptions.MAP_HEIGHT);
        return (mgo.getInteger(MapGeneratorOptions.MAP_SHAPE)
            == MapGeneratorOptions.MAP_SHAPE_ISOMETRIC)
            ? MapShape.isometric(w, h) : MapShape.topDown(w, h);
    }

    /**
     * Get the shape of the land map.
     *
     * @return The {@code MapShape}.
     */
    public final MapShape getShape() {
        return this.shape;
    }

    /**
     * Get the width of the land map.
     *
     * @return The map width.
     */
    public final int getWidth() {
        return this.width;
    }

    /**
     * Get the height of the land map.
     *
     * @return The map height.
     */
    public final int getHeight() {
        return this.height;
    }

    /**
     * Is an xy coordinate valid on this map?
     *
     * @param x The x coordinate.
     * @param y The y coordinate.
     * @return True if there coordinate is valid.
     */
    public boolean isValid(int x, int y) {
        return this.shape.contains(x, y);
    }

    /**
     * Is there land on this map at a given xy coordinate?
     *
     * @param x The x coordinate.
     * @param y The y coordinate.
     * @return True if there is land present.
     */
    public boolean isLand(int x, int y) {
        return (isValid(x, y)) ? this.map[x][y] : false;
    }

    /**
     * Is there any land in this land map?
     *
     * @return True if any land is present.
     */
    public boolean hasLand() {
        for (int y = 0; y < this.height; y++) {
            for (int x = 0; x < this.width; x++) {
                if (this.map[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Set a map position to land, and increase the land tile count.
     *
     * @param x The x coordinate of the new land.
     * @param y The y coordinate of the new land.
     * @return True if the land tile was set.
     */
    private boolean setLand(int x, int y) {
        if (isLand(x, y)) return false;
        this.map[x][y] = true;
        this.numberOfLandTiles++;
        return true;
    }
        
    /**
     * Sets a given map position to land and grow outward.
     *
     * Calls #growLand(int,int) for all valid adjacent map positions,
     * which may recursively call setLand for these.
     *
     * @param x The x coordinate of the new land.
     * @param y The y coordinate of the new land.
     * @param distanceToEdge The preferred distance to the map edge.
     */
    private void setLand(int x, int y, int distanceToEdge) {
        if (!setLand(x, y)) return;

        Position p = new Position(x, y);
        for (Direction direction : Direction.edgeNeighbours) {
            Position n = new Position(p, direction);
            if (isValid(n.getX(), n.getY())) {
                growLand(n.getX(), n.getY(), distanceToEdge);
            }
        }
    }


    // Internals

    /**
     * Generate the land map using the given generator type.
     *
     * @param type The generator type.
     * @param minNumberOfTiles The minimum land tiles to generate.
     * @param distanceToEdge The preferred distance to the map edge.
     */
    private final void generate(int type, int distanceToEdge,
                                int minNumberOfTiles) {
        switch (type) {
        case MapGeneratorOptions.LAND_GENERATOR_CLASSIC:
            createClassicLandMap(distanceToEdge, minNumberOfTiles);
            break;
        case MapGeneratorOptions.LAND_GENERATOR_CONTINENT:
            // Create one landmass of 75%, start it somewhere near the
            // center, then fill up with small islands.
            addPolarRegions();
            int contsize = (minNumberOfTiles * 75) / 100;
            final int rows = this.shape.getRows();
            int row = rows/4 + this.cache.nextInt(rows/2);
            final int col = this.shape.getColumns()/2;
            addLandMass(contsize, contsize, this.shape.getX(col, row),
                        this.shape.getY(col, row), distanceToEdge);
            while (this.numberOfLandTiles < minNumberOfTiles) {
                addLandMass(15, 25, -1, -1, distanceToEdge);
            }
            break;
        case MapGeneratorOptions.LAND_GENERATOR_ARCHIPELAGO:
            // Create 5 islands of 10% each, then delegate to the Islands
            // generator.
            addPolarRegions();
            int archsize = (minNumberOfTiles * 10) / 100;
            for (int i = 0; i < 5; i++) {
                addLandMass(archsize - 5, archsize + 5, -1, -1,
                            distanceToEdge);
            }
            // Fall through
        case MapGeneratorOptions.LAND_GENERATOR_ISLANDS:
            // Create islands of 25..75 tiles.
            addPolarRegions();
            while (this.numberOfLandTiles < minNumberOfTiles) {
                addLandMass(25, 25 + this.cache.nextInt(50),
                            -1, -1, distanceToEdge);
            }
            break;
        }
        cleanMap();
    }

    /**
     * Create the standard FreeCol land map.
     *
     * @param distanceToEdge The nominal edge clearance.
     * @param minNumberOfTiles Lower bound for the tiles to create.
     */
    private void createClassicLandMap(int distanceToEdge, int minNumberOfTiles) {
        // Rows were half height, so the clearance to the top and bottom was
        // twice the distance in rows; it is the distance now.
        final int edgX = distanceToEdge * 2;
        final int edgY = distanceToEdge * this.shape.getRowsPerTile();
        final int wid = this.shape.getColumns() - edgX * 2;
        final int hgt = this.shape.getRows() - edgY * 2;
        int x, y;
        while (this.numberOfLandTiles < minNumberOfTiles) {
            int failCounter = 0;
            do {
                final int col = edgX + this.cache.nextInt(wid);
                final int row = edgY + this.cache.nextInt(hgt);
                x = this.shape.getX(col, row);
                y = this.shape.getY(col, row);
                failCounter++;
                // If landmass% is set too high, this loop may fail to
                // find a free tile.  Decrease necessary minimum over
                // time, so that this process will eventually succeed.
                if (failCounter > 100) {
                    failCounter = 0;
                    minNumberOfTiles--;
                    break;
                }
            } while (isLand(x, y));
            setLand(x, y, distanceToEdge);
        }
        addPolarRegions();
    }

    /**
     * Add land to the polar map rows at the top and bottom of the map,
     * with height determined by Map.POLAR_HEIGHT.
     *
     * FIXME: Make POLAR_HEIGHT an option.
     */
    private void addPolarRegions() {
        final int rows = this.shape.getRows();
        final int polar = Map.POLAR_HEIGHT * this.shape.getRowsPerTile();
        for (int col = 0; col < this.shape.getColumns(); col++) {
            for (int row = 0; row < polar; row++) {
                setLand(this.shape.getX(col, row), this.shape.getY(col, row));
            }
            for (int row = rows - 1 - polar; row < rows; row++) {
                setLand(this.shape.getX(col, row), this.shape.getY(col, row));
            }
        }
    }

    /**
     * Remove any 1x1 islands on the map.
     */
    private void cleanMap() {
        for (int y = 0; y < this.height; y++) {
            for (int x = 0; x < this.width; x++) {
                if (!hasAdjacentLand(x, y)) this.map[x][y] = false;
            }
        }
    }

    /**
     * Do the given coordinates correspond to a location in the land map
     * with adjacent land?
     *
     * Note: does not check the tile at the coordinates itself.
     *
     * @param x The x coordinate to check.
     * @param y The y coordinate to check.
     * @return True if this tile has adjacent land.
     */
    private boolean hasAdjacentLand(int x, int y) {
        final Position p = new Position(x, y);
        final Predicate<Direction> landPred = d -> {
            Position n = new Position(p, d);
            return isLand(n.getX(), n.getY());
        };
        return any(Direction.values(), landPred);
    }

    /**
     * Get the positions surrounding a central position that are potential
     * valid land positions.
     *
     * @param position The central {@code Position} to work from.
     * @param distanceToEdge The preferred distance to the map edge.
     * @return A list of suitable {@code Position}s.
     */
    private List<Position> newPositions(Position position,
                                        int distanceToEdge) {
        final Predicate<Position> landPred = p ->
            (isValid(p.getX(), p.getY())
                && !hasAdjacentLand(p.getX(), p.getY())
                && this.shape.getColumn(p.getX(), p.getY()) > distanceToEdge
                && this.shape.getColumn(p.getX(), p.getY())
                    < this.shape.getColumns() - distanceToEdge);
        final Function<Direction, Position> positionMapper = d ->
            new Position(position, d);
        return transform(map(Direction.edgeNeighbours, positionMapper), landPred);
    }

    /**
     * Determines, based on position, number of adjacent land tiles
     * and some random factor, whether a given map position should be
     * set to land.  This is called for all valid map positions
     * adjacent to a position that has been set to land by
     * #setLand(int,int), and may recursively call setLand for the
     * current position.
     *
     * @param x The x coordinate to grow land at.
     * @param y The y coordinate to grow land at.
     * @param distanceToEdge The preferred distance to the map edge.
     */
    private void growLand(int x, int y, int distanceToEdge) {
        if (isLand(x, y)) return; // Already land

        // Generate a comparison value:
        // Only if the number of adjacent land tiles is bigger than this value,
        // this tile will be set to land.
        // This value is part random, part based on position, that is:
        // -1 in the center of the map, and growing to
        // distanceToEdge at the maps edges.
        final int col = this.shape.getColumn(x, y);
        final int row = this.shape.getRow(x, y);
        final int rows = this.shape.getRows();
        final int rpt = this.shape.getRowsPerTile();
        int r = this.cache.nextInt(8) + Math.max(-1,
            (1 + Math.max(
                distanceToEdge - Math.min(col, this.shape.getColumns() - col),
                distanceToEdge - Math.min(row, rows - row) / rpt)));

        final Position p = new Position(x, y);
        final Predicate<Direction> landPred = d -> {
            Position n = new Position(p, d);
            return isLand(n.getX(), n.getY());
        };
        if (count(Direction.values(), landPred) > r) {
            setLand(x, y, distanceToEdge);
        }
    }

    /**
     * Create a new land mass (unconnected to existing land masses) of
     * size up to maxSize, and adds it to the current map if it is at
     * least minSize.
     *
     * @param minSize Minimum number of tiles in the land mass.
     * @param maxSize Maximum number of tiles in the land mass.
     * @param x Optional starting x coordinate (chosen randomly if negative).
     * @param y Optional starting y coordinate (chosen randomly if negative).
     * @param distanceToEdge The preferred distance to the map edge.
     * @return The number of tiles added.
     */
    private int addLandMass(int minSize, int maxSize, int x, int y,
                            int distanceToEdge) {
        int size = 0;
        boolean[][] newLand = new boolean[getWidth()][getHeight()];

        // Pick a starting position that is sea without neighbouring land.
        if (x < 0 || y < 0) {
            final int wid = this.shape.getColumns() - distanceToEdge * 2;
            final int startY = ((distanceToEdge + 1) / 2) // was in half-height rows
                * this.shape.getRowsPerTile();
            final int hgt = this.shape.getRows() - startY * 2;
            do {
                final int col = distanceToEdge + this.cache.nextInt(wid);
                final int row = startY + this.cache.nextInt(hgt);
                x = this.shape.getX(col, row);
                y = this.shape.getY(col, row);
            } while (isLand(x, y) || hasAdjacentLand(x, y));
        }

        newLand[x][y] = true;
        size++;

        // Add all valid neighbour positions to list
        Position p = new Position(x, y);
        List<Position> l = newPositions(p, distanceToEdge);

        // Get a random position from the list,
        // set it to land,
        // add its valid neighbours to the list
        int enough = minSize + this.cache.nextInt(maxSize - minSize + 1);
        while (size < enough && !l.isEmpty()) {
            int i = this.cache.nextInt(l.size());
            p = l.remove(i);

            if (!newLand[p.getX()][p.getY()]) {
                newLand[p.getX()][p.getY()] = true;
                size++;
                l.addAll(newPositions(p, distanceToEdge));
            }
        }

        // Add generated land to map if sufficiently large
        if (size >= minSize) {
            for (x = 0; x < this.width; x++) {
                for (y = 0; y < this.height; y++) {
                    if (newLand[x][y]) setLand(x, y);
                }
            }
        }
        return (size >= minSize) ? size : 0;
    }
}
