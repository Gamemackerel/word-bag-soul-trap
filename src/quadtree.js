// Axis-aligned bounding box — center + half-extents
export class Rectangle {
    constructor(x, y, w, h) {
        this.x = x  // center x
        this.y = y  // center y
        this.w = w  // half width
        this.h = h  // half height
    }

    // point must have a .pos.x / .pos.y (i.e. a Letter)
    contains(point) {
        return (
            point.pos.x >= this.x - this.w &&
            point.pos.x <  this.x + this.w &&
            point.pos.y >= this.y - this.h &&
            point.pos.y <  this.y + this.h
        )
    }

    intersects(range) {
        return !(
            range.x - range.w > this.x + this.w ||
            range.x + range.w < this.x - this.w ||
            range.y - range.h > this.y + this.h ||
            range.y + range.h < this.y - this.h
        )
    }
}

export class Quadtree {
    constructor(boundary, capacity = 8) {
        this.boundary = boundary
        this.capacity = capacity
        this.points = []
        this.divided = false
        this.ne = null
        this.nw = null
        this.se = null
        this.sw = null
    }

    insert(point) {
        if (!this.boundary.contains(point)) return false

        if (this.points.length < this.capacity && !this.divided) {
            this.points.push(point)
            return true
        }

        if (!this.divided) this._subdivide()

        return this.ne.insert(point) || this.nw.insert(point) ||
               this.se.insert(point) || this.sw.insert(point)
    }

    query(range, found = []) {
        if (!this.boundary.intersects(range)) return found

        for (const p of this.points) {
            if (range.contains(p)) found.push(p)
        }

        if (this.divided) {
            this.ne.query(range, found)
            this.nw.query(range, found)
            this.se.query(range, found)
            this.sw.query(range, found)
        }

        return found
    }

    _subdivide() {
        const { x, y, w, h } = this.boundary
        const hw = w / 2
        const hh = h / 2
        this.ne = new Quadtree(new Rectangle(x + hw, y - hh, hw, hh), this.capacity)
        this.nw = new Quadtree(new Rectangle(x - hw, y - hh, hw, hh), this.capacity)
        this.se = new Quadtree(new Rectangle(x + hw, y + hh, hw, hh), this.capacity)
        this.sw = new Quadtree(new Rectangle(x - hw, y + hh, hw, hh), this.capacity)
        this.divided = true

        for (const p of this.points) {
            this.ne.insert(p) || this.nw.insert(p) ||
            this.se.insert(p) || this.sw.insert(p)
        }
        this.points = []
    }
}
