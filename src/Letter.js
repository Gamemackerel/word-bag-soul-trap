import { Rectangle } from './quadtree.js'

export class Letter {
    constructor(char, x, y, p, cfg) {
        this.char = char
        this.p = p
        this.cfg = cfg

        this.size = 24
        this.alpha = 255
        this.radius = this.size / 2

        // Linear physics
        this.pos = p.createVector(x, y)
        this.vel = p.createVector(p.random(-0.5, 0.5), p.random(-0.5, 0.5))
        this.acc = p.createVector(0, 0)

        const { maxLetterSpeed } = cfg.physics
        this.maxSpeed = maxLetterSpeed
        this.maxSpeedSq = maxLetterSpeed * maxLetterSpeed

        // Rotational physics
        this.angle = p.random(p.TWO_PI)
        this.angularVel = p.random(-0.1, 0.1)
        this.angularAcc = 0
        this.momentOfInertia = this.radius * this.radius  // mass = 1

        // Word bond state
        this.recruited = false
        this.bondLeft = null   // Letter to the left in current word
        this.bondRight = null  // Letter to the right in current word
        this.wordGroup = null  // WordFormation reference
        this.wordIndex = -1
        this.bondRamp = 0      // 0..1 bell, set each frame by WordFormation
        this.dragging = false
    }

    // ── Forces ────────────────────────────────────────────────────────────────

    applyBoidsForces(quadtree, cohesionDisabled = false) {
        if (this.dragging) return

        const { boids, word } = this.cfg
        const queryRange = new Rectangle(
            this.pos.x, this.pos.y,
            boids.cohesionRadius, boids.cohesionRadius
        )
        const neighbors = quadtree.query(queryRange)

        let sepX = 0, sepY = 0, sepCount = 0
        let avgVelX = 0, avgVelY = 0, alignCount = 0
        let avgPosX = 0, avgPosY = 0, cohWeight = 0

        const sepRSq   = boids.separationRadius * boids.separationRadius
        const alignRSq = boids.alignmentRadius  * boids.alignmentRadius
        const cohRSq   = boids.cohesionRadius   * boids.cohesionRadius
        const repRSq   = word.repulsionRadius   * word.repulsionRadius

        for (const other of neighbors) {
            if (other === this) continue

            const dx = this.pos.x - other.pos.x
            const dy = this.pos.y - other.pos.y
            const dSq = dx * dx + dy * dy
            if (dSq === 0) continue

            // Cross-word repulsion: fades in/out with bondRamp
            if (this.wordGroup !== other.wordGroup && dSq < repRSq) {
                const ramp = Math.max(this.bondRamp, other.bondRamp)
                if (ramp > 0) {
                    const d = Math.sqrt(dSq)
                    this.acc.x += (dx / d) * (ramp * word.repulsionStrength / d)
                    this.acc.y += (dy / d) * (ramp * word.repulsionStrength / d)
                }
            }

            if (dSq < sepRSq) {
                const d = Math.sqrt(dSq)
                sepX += (dx / d) / d
                sepY += (dy / d) / d
                sepCount++

                // Spin coupling on close pass
                const impactSq = (this.vel.x - other.vel.x) ** 2 + (this.vel.y - other.vel.y) ** 2
                if (impactSq > 0.04) {
                    const spinDiff = other.angularVel - this.angularVel
                    this.angularAcc += (spinDiff * 0.08 + (Math.random() - 0.5) * 0.04) / this.momentOfInertia
                }
            } else if (dSq < alignRSq) {
                avgVelX += other.vel.x
                avgVelY += other.vel.y
                alignCount++
            } else if (dSq < cohRSq) {
                // Weight neighbor by how unbound it is — bonded letters don't pull
                const w = 1 - other.bondRamp
                avgPosX += other.pos.x * w
                avgPosY += other.pos.y * w
                cohWeight += w
            }
        }

        if (sepCount > 0) {
            this.acc.x += sepX * boids.separationStrength
            this.acc.y += sepY * boids.separationStrength
        }
        if (alignCount > 0) {
            this.acc.x += ((avgVelX / alignCount) - this.vel.x) * boids.alignmentStrength
            this.acc.y += ((avgVelY / alignCount) - this.vel.y) * boids.alignmentStrength
        }
        if (cohWeight > 0 && !cohesionDisabled) {
            const cohesion = boids.cohesionStrength * (1 - this.bondRamp)
            this.acc.x += ((avgPosX / cohWeight) - this.pos.x) * cohesion
            this.acc.y += ((avgPosY / cohWeight) - this.pos.y) * cohesion
        }
    }

    applyBoundaryForce(w, h) {
        const { margin, strength } = this.cfg.boundary
        if (this.pos.x < margin)     this.acc.x += strength * (1 - this.pos.x / margin)
        if (this.pos.x > w - margin) this.acc.x -= strength * (1 - (w - this.pos.x) / margin)
        if (this.pos.y < margin)     this.acc.y += strength * (1 - this.pos.y / margin)
        if (this.pos.y > h - margin) this.acc.y -= strength * (1 - (h - this.pos.y) / margin)
    }

    applyGravity(centerX, centerY) {
        if (this.dragging) return
        const dx = centerX - this.pos.x
        const dy = centerY - this.pos.y
        const distSq = dx * dx + dy * dy
        if (distSq > 0) {
            const dist = Math.sqrt(distSq)
            this.acc.x += (dx / dist) * this.cfg.physics.gravityStrength
            this.acc.y += (dy / dist) * this.cfg.physics.gravityStrength
        }
    }

    // ── Integration ───────────────────────────────────────────────────────────

    update() {
        if (!this.dragging) {
            this.vel.add(this.acc)

            const speedSq = this.vel.magSq()
            if (speedSq > this.maxSpeedSq) {
                const speed = Math.sqrt(speedSq)
                const excess = speed - this.maxSpeed
                this.vel.setMag(speed - excess * this.cfg.physics.speedDeceleration)
            }

            this.pos.add(this.vel)
        }

        this.acc.mult(0)

        this.angularVel += this.angularAcc
        if (!this.recruited) {
            const noise = this.cfg.physics.spinNoise
            this.angularVel += (Math.random() * 2 - 1) * noise
        }
        this.angle += this.angularVel
        this.angularAcc = 0
    }

    display() {
        this.p.push()
        this.p.translate(this.pos.x, this.pos.y)
        this.p.rotate(this.angle)
        this.p.fill(0, this.alpha)
        this.p.textSize(this.size)
        this.p.textAlign(this.p.CENTER, this.p.CENTER)
        this.p.text(this.char, 0, 0)
        this.p.pop()
    }

    // ── Bond state helpers ────────────────────────────────────────────────────

    releaseBond() {
        this.recruited = false
        this.bondLeft = null
        this.bondRight = null
        this.wordGroup = null
        this.wordIndex = -1
        this.bondRamp = 0
    }
}
