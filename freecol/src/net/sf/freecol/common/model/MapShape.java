/**
 *  Copyright (C) 2002-2022   The FreeCol Team
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


/**
 * The outline of a map on the square grid, and what north means on it.
 *
 * A game's map is made for one Map view (ADR 0014).  A <b>Top-down</b>
 * shaped map is the whole rectangle of the grid: north is (0, -1), a
 * "row" is a grid row and a "column" a grid column.  An <b>Isometric</b>
 * shaped map is a 45 degree diamond in the grid, the same shape as the
 * staggered maps of FreeCol, and a rectangle on screen in the Isometric view.
 * Tiles outside the diamond, in the corners of the bounding box, are
 * not part of the map.
 *
 * Isometric tile (x, y) is drawn at screen column x-y and screen row x+y
 * (a row is half a tile high).  North is straight up the screen, which on the
 * grid is (-1, -1).  A map is described by the staggered map it is: it has
 * {@code columns} tiles on each row and {@code rows} half-height rows, with
 * odd rows shifted half a tile.  Staggered tile (sx, sy) is grid tile
 * {@code (sx + ((sy+1)>>1), (sy>>1) - sx + columns - 1)}, which is the
 * conversion {@link Map#convertFromStaggered} applies to old saves.
 *
 * For both shapes a tile has a {@link #getColumn column} and a
 * {@link #getRow row}, west to east and north to south, and the map has
 * {@link #getColumns} and {@link #getRows}.  Everything that treats the
 * map's rows as latitude or its columns as the east and west edges uses
 * these, not x and y.
 */
public final class MapShape {

    /** The two shapes. */
    public enum Kind {
        /** A rectangle on the grid. */
        TOP_DOWN("topDown"),
        /** A diamond on the grid, a rectangle on screen in Isometric. */
        ISOMETRIC("isometric");

        private final String key;

        Kind(String key) {
            this.key = key;
        }

        /** The name used in saves and in the Browser UI. */
        public String getKey() {
            return this.key;
        }

        /** The kind with this name, or Top-down. */
        public static Kind fromKey(String key) {
            for (Kind k : values()) {
                if (k.key.equals(key)) return k;
            }
            return TOP_DOWN;
        }
    }

    /** How many staggered rows tall a tile is. */
    private static final int ISOMETRIC_ROWS_PER_TILE = 2;

    private final Kind kind;
    /** The size of the bounding box, the map's tile array. */
    private final int width, height;
    /** Isometric only: the half-height rows. */
    private final int staggeredRows;


    private MapShape(Kind kind, int width, int height, int staggeredRows) {
        this.kind = kind;
        this.width = width;
        this.height = height;
        this.staggeredRows = staggeredRows;
    }

    /**
     * A Top-down shape: the whole grid.
     *
     * @param width The grid's width.
     * @param height The grid's height.
     * @return The shape.
     */
    public static MapShape topDown(int width, int height) {
        return new MapShape(Kind.TOP_DOWN, width, height, 0);
    }

    /**
     * An Isometric shape: the diamond of a staggered map.
     *
     * @param columns The tiles on a row of the staggered map.
     * @param rows The half-height rows of the staggered map.
     * @return The shape, with its bounding box.
     */
    public static MapShape isometric(int columns, int rows) {
        return new MapShape(Kind.ISOMETRIC, boxWidth(columns, rows),
                            boxHeight(columns, rows), rows);
    }

    /**
     * A shape of a kind, for a bounding box.
     *
     * @param kind The {@code Kind}.
     * @param width The width of the box.
     * @param height The height of the box.
     * @param rows The Isometric rows, ignored for Top-down.
     * @return The shape.
     */
    public static MapShape of(Kind kind, int width, int height, int rows) {
        if (kind != Kind.ISOMETRIC) return topDown(width, height);
        final int columns = width - (rows >> 1);
        if (rows <= 0 || columns <= 0
            || boxHeight(columns, rows) != height) {
            throw new IllegalArgumentException("An Isometric map of " + width
                + "x" + height + " has no " + rows + " rows");
        }
        return new MapShape(Kind.ISOMETRIC, width, height, rows);
    }

    /** The width of an Isometric shape's bounding box. */
    public static int boxWidth(int columns, int rows) {
        return columns + (rows >> 1);
    }

    /** The height of an Isometric shape's bounding box. */
    public static int boxHeight(int columns, int rows) {
        return ((rows - 1) >> 1) + columns;
    }


    public Kind getKind() {
        return this.kind;
    }

    public boolean isIsometric() {
        return this.kind == Kind.ISOMETRIC;
    }

    /** The width of the bounding box. */
    public int getWidth() {
        return this.width;
    }

    /** The height of the bounding box. */
    public int getHeight() {
        return this.height;
    }

    /** The staggered rows of an Isometric shape, else 0. */
    public int getStaggeredRows() {
        return this.staggeredRows;
    }

    /** The tiles across the map, as the columns west to east. */
    public int getColumns() {
        return (isIsometric()) ? this.width - (this.staggeredRows >> 1)
            : this.width;
    }

    /**
     * The rows of the map from north to south: grid rows for Top-down, and
     * for Isometric the half-height screen rows.
     */
    public int getRows() {
        return (isIsometric()) ? this.staggeredRows : this.height;
    }

    /** How many {@link #getRows rows} make the height of one tile. */
    public int getRowsPerTile() {
        return (isIsometric()) ? ISOMETRIC_ROWS_PER_TILE : 1;
    }

    /**
     * Is a grid position on the map?
     *
     * @param x The x coordinate.
     * @param y The y coordinate.
     * @return True if it is in the bounding box and in the diamond.
     */
    public boolean contains(int x, int y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return false;
        }
        if (!isIsometric()) return true;
        final int row = getRow(x, y);
        if (row < 0 || row >= this.staggeredRows) return false;
        final int col = x - ((row + 1) >> 1);
        return col >= 0 && col < getColumns();
    }

    /**
     * The row of a grid position, north to south.
     *
     * @param x The x coordinate.
     * @param y The y coordinate.
     * @return The row.
     */
    public int getRow(int x, int y) {
        return (isIsometric()) ? x + y - (getColumns() - 1) : y;
    }

    /**
     * The column of a grid position, west to east.
     *
     * @param x The x coordinate.
     * @param y The y coordinate.
     * @return The column.
     */
    public int getColumn(int x, int y) {
        return (isIsometric()) ? x - ((getRow(x, y) + 1) >> 1) : x;
    }

    /**
     * The grid x of a column and a row.
     *
     * @param column The column.
     * @param row The row.
     * @return The x coordinate.
     */
    public int getX(int column, int row) {
        return (isIsometric()) ? column + ((row + 1) >> 1) : column;
    }

    /**
     * The grid y of a column and a row.
     *
     * @param column The column.
     * @param row The row.
     * @return The y coordinate.
     */
    public int getY(int column, int row) {
        return (isIsometric()) ? (row >> 1) - column + getColumns() - 1 : row;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof MapShape)) return false;
        final MapShape s = (MapShape)o;
        return this.kind == s.kind && this.width == s.width
            && this.height == s.height && this.staggeredRows == s.staggeredRows;
    }

    @Override
    public int hashCode() {
        return ((this.kind.ordinal() * 31 + this.width) * 31 + this.height) * 31
            + this.staggeredRows;
    }

    @Override
    public String toString() {
        return this.kind.getKey() + " " + this.width + "x" + this.height
            + ((isIsometric()) ? " (" + getColumns() + " columns, "
                + this.staggeredRows + " rows)" : "");
    }
}
