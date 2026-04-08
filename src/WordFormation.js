let nextId = 0

export class WordFormation {
    constructor(word, p, startTime, direction, cfg) {
        this.word = word.toUpperCase()
        this.id = nextId++
        this.p = p
        this.cfg = cfg
        this.letters = []
        this.startTime = startTime
        this.direction = direction
        this.currentOrientation = direction
        this.launched = false
    }

    // Apply spring + alignment forces between bonded letters.
    // Called once per frame from the draw loop.
    applyBondForces(millis) {
        if (this.launched || this.letters.length < 2) return

        const { word } = this.cfg
        const t = (millis - this.startTime) / word.lifetime
        const ramp = Math.sin(t * Math.PI)  // smooth bell: 0 → 1 → 0
        const bond = ramp * word.bondStrength

        // Derive current orientation from average letter velocity
        let avgVx = 0, avgVy = 0
        for (const lt of this.letters) { avgVx += lt.vel.x; avgVy += lt.vel.y }
        avgVx /= this.letters.length
        avgVy /= this.letters.length
        if (Math.sqrt(avgVx * avgVx + avgVy * avgVy) > 0.01) {
            this.currentOrientation = Math.atan2(avgVy, avgVx)
        }
        const fwdX = Math.cos(this.currentOrientation)
        const fwdY = Math.sin(this.currentOrientation)

        for (const lt of this.letters) {
            if (!lt.recruited) continue
            lt.bondRamp = ramp

            // Spring to each direct neighbor
            for (const [neighbor, side] of [[lt.bondLeft, -1], [lt.bondRight, 1]]) {
                if (!neighbor?.recruited) continue

                const dx = neighbor.pos.x - lt.pos.x
                const dy = neighbor.pos.y - lt.pos.y

                // Error: where the neighbor is vs where it should be
                const targetX = fwdX * word.letterSpacing * side
                const targetY = fwdY * word.letterSpacing * side
                lt.acc.x -= (targetX - dx) * bond * 0.5
                lt.acc.y -= (targetY - dy) * bond * 0.5

                // Velocity matching — damp relative motion
                lt.acc.x += (neighbor.vel.x - lt.vel.x) * word.alignStrength * ramp
                lt.acc.y += (neighbor.vel.y - lt.vel.y) * word.alignStrength * ramp
            }

            // Angle alignment: face travel direction
            let angleDiff = this.currentOrientation - lt.angle
            while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
            lt.angularAcc += angleDiff * 0.1 * ramp
            lt.angularVel *= 0.92
        }
    }

    dissolve() {
        if (this.launched) return
        for (const lt of this.letters) {
            lt.releaseBond()
            lt.vel.mult(0.4)
        }
        this.launched = true
    }

    shouldDissolve(millis) {
        return (millis - this.startTime) >= this.cfg.word.lifetime
    }
}
