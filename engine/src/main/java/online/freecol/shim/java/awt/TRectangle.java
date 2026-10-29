package online.freecol.shim.java.awt;

/** The parts of java.awt.Rectangle FreeCol's map generator uses. */
public class TRectangle {
    public int x, y, width, height;

    public TRectangle() { }

    public TRectangle(int x, int y, int width, int height) {
        setBounds(x, y, width, height);
    }

    public TRectangle(TRectangle r) { setBounds(r); }

    public void setBounds(int x, int y, int width, int height) {
        this.x = x; this.y = y; this.width = width; this.height = height;
    }

    public void setBounds(TRectangle r) { setBounds(r.x, r.y, r.width, r.height); }

    public TRectangle getBounds() { return new TRectangle(this); }

    public double getX() { return x; }
    public double getY() { return y; }
    public double getWidth() { return width; }
    public double getHeight() { return height; }

    public boolean isEmpty() { return width <= 0 || height <= 0; }

    public boolean contains(int px, int py) {
        return width > 0 && height > 0
            && px >= x && py >= y && px < x + width && py < y + height;
    }

    public boolean contains(TRectangle r) {
        return contains(r.x, r.y) && contains(r.x + r.width - 1, r.y + r.height - 1);
    }

    public boolean intersects(TRectangle r) {
        return !isEmpty() && !r.isEmpty()
            && r.x < x + width && r.x + r.width > x
            && r.y < y + height && r.y + r.height > y;
    }

    /** Grow to include the point, as java.awt.Rectangle.add does. */
    public void add(int px, int py) {
        int x1 = Math.min(x, px), y1 = Math.min(y, py);
        int x2 = Math.max(x + width, px), y2 = Math.max(y + height, py);
        setBounds(x1, y1, x2 - x1, y2 - y1);
    }

    public void add(TRectangle r) {
        int x1 = Math.min(x, r.x), y1 = Math.min(y, r.y);
        int x2 = Math.max(x + width, r.x + r.width);
        int y2 = Math.max(y + height, r.y + r.height);
        setBounds(x1, y1, x2 - x1, y2 - y1);
    }

    public TRectangle union(TRectangle r) {
        TRectangle u = new TRectangle(this);
        u.add(r);
        return u;
    }

    public void translate(int dx, int dy) { x += dx; y += dy; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof TRectangle)) return false;
        TRectangle r = (TRectangle)o;
        return x == r.x && y == r.y && width == r.width && height == r.height;
    }

    @Override
    public int hashCode() { return ((x * 31 + y) * 31 + width) * 31 + height; }

    @Override
    public String toString() {
        return "java.awt.Rectangle[x=" + x + ",y=" + y + ",width=" + width
            + ",height=" + height + "]";
    }
}
