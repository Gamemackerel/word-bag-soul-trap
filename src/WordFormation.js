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
        this.airborne = false  // true once the formed word has been kicked out
        this.repulsionStrength = cfg.word.repulsionStrength  // per-word; strong bursts override
    }

    // Apply spring + alignment forces between bonded letters.
    // Called once per frame from the draw loop.
    applyBondForces(millis) {
        if (this.launched || this.letters.length < 2) return

        const { word } = this.cfg
        const elapsed = millis - this.startTime
        const forming = elapsed < word.formationTime

        // Launch once: kick the assembled word out of the soup
        if (!forming && !this.airborne) this._launch()

        // Bond ramp: 0 → 1 while forming, then 1 → 0 over the flight
        const ramp = forming
            ? elapsed / word.formationTime
            : Math.cos(((elapsed - word.formationTime) / word.lifetime) * Math.PI / 2)
        const bond = ramp * word.bondStrength

        // While forming, hold the launch heading; in flight, follow velocity
        if (this.airborne) {
            let avgVx = 0, avgVy = 0
            for (const lt of this.letters) { avgVx += lt.vel.x; avgVy += lt.vel.y }
            avgVx /= this.letters.length
            avgVy /= this.letters.length
            if (Math.sqrt(avgVx * avgVx + avgVy * avgVy) > 0.01) {
                this.currentOrientation = Math.atan2(avgVy, avgVx)
            }
        }
        const fwdX = Math.cos(this.currentOrientation)
        const fwdY = Math.sin(this.currentOrientation)

        for (const lt of this.letters) {
            if (!lt.recruited) continue
            lt.bondRamp = ramp

            // Damp soup currents so the word can gather in place
            if (forming) lt.vel.mult(0.96)

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

    _launch() {
        this.airborne = true
        const speed = this.cfg.physics.maxLetterSpeed * 0.6
        const kickX = Math.cos(this.direction) * speed
        const kickY = Math.sin(this.direction) * speed
        for (const lt of this.letters) {
            if (!lt.recruited) continue
            lt.vel.x = kickX + (Math.random() - 0.5) * 0.5
            lt.vel.y = kickY + (Math.random() - 0.5) * 0.5
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
        const { formationTime, lifetime } = this.cfg.word
        return (millis - this.startTime) >= formationTime + lifetime
    }
}
