import p5 from 'p5'

// Ocean of Letters - Physics-based letter animation

// Physics constants
const REPULSION_RADIUS = 20       // Distance at which letters repel
const REPULSION_STRENGTH = 10.0    // How strongly letters push apart (substantially increased)
const ATTRACTION_MIN = 50         // Minimum distance for particle attraction
const ATTRACTION_MAX = 150        // Maximum distance for particle attraction
const ATTRACTION_STRENGTH = 0.05  // Weak attraction between particles
const GRAVITY_STRENGTH = 0.02     // Pull toward center (fairly weak)
const COLLISION_SPEED_THRESHOLD = 0.5 // Minimum impact speed to create spin
const COLLISION_SPIN_FACTOR = 0.08    // How much impact creates spin (higher = more dramatic)
const SPIN_COUPLING_RADIUS = 0   // Distance for rotational influence
const SPIN_COUPLING_STRENGTH = 0.008 // How strongly nearby particles influence each other's spin
const SPIN_NOISE = 0.003          // Random rotational perturbation to prevent stasis
const WORD_DISSOLVE_DISTANCE = 500 // Distance from center before word dissolves
const WORD_ROTATION_SPEED = 0.001  // How fast word direction rotates around center
const LAUNCH_CURVE_STRENGTH = 20 // Perpendicular component for curved launch

// Letter class with physics
class Letter {
    constructor(char, x, y, p) {
        this.char = char
        this.p = p

        // Visual (must be defined first for radius calculation)
        this.size = 24
        this.alpha = 255

        // Physics
        this.pos = p.createVector(x, y)
        this.vel = p.createVector(p.random(-0.5, 0.5), p.random(-0.5, 0.5))
        this.acc = p.createVector(0, 0)
        this.maxSpeed = 3
        this.maxForce = 0.2
        this.mass = 1

        // Rotational physics
        this.angle = p.random(p.TWO_PI)
        this.angularVel = p.random(-0.1, 0.1)
        this.angularAcc = 0
        this.radius = this.size / 2 // Approximate radius for torque calculations
        this.momentOfInertia = this.mass * this.radius * this.radius

        // Word formation
        this.recruited = false
        this.targetPos = null
        this.targetIndex = -1
        this.wordId = null
        this.launched = false
    }

    applyForce(force) {
        // F = ma, so a = F/m
        let f = force.copy()
        f.div(this.mass)
        this.acc.add(f)
    }

    applyTorque(torque) {
        // τ = I * α, so α = τ / I
        this.angularAcc += torque / this.momentOfInertia
    }

    // Calculate repulsion from other letters (collision avoidance)
    repel(others) {
        if (this.launched) return // No repulsion when launched

        let repulsionForce = this.p.createVector(0, 0)
        let count = 0

        for (let other of others) {
            if (other === this || other.launched) continue

            let diff = p5.Vector.sub(this.pos, other.pos)
            let d = diff.mag()

            // Only repel if within radius
            if (d > 0 && d < REPULSION_RADIUS) {
                // Normalized collision normal
                let normal = diff.copy().normalize()

                // Repulsion force: stronger when closer
                let forceMag = REPULSION_STRENGTH / d
                let force = normal.copy().mult(forceMag)
                repulsionForce.add(force)

                // Calculate spin from collision (only during significant impacts)
                let relativeVel = p5.Vector.sub(this.vel, other.vel)
                let impactSpeed = relativeVel.mag()

                // Only apply torque if there's meaningful relative motion
                if (impactSpeed > COLLISION_SPEED_THRESHOLD) {
                    // Tangent vector (perpendicular to collision normal)
                    let tangent = this.p.createVector(-normal.y, normal.x)

                    // Component of relative velocity along tangent (glancing blow)
                    let tangentVel = relativeVel.dot(tangent)

                    // Base torque from glancing collision
                    // Can be positive or negative - naturally opposes or enhances existing spin
                    let collisionTorque = tangentVel * impactSpeed * COLLISION_SPIN_FACTOR

                    // Angular momentum exchange: spinning particles can transfer spin during collision
                    // This allows collisions to reduce existing spin significantly
                    let spinDifference = other.angularVel - this.angularVel
                    let spinExchange = spinDifference * impactSpeed * 0.05

                    // Total torque combines collision geometry and spin exchange
                    let totalTorque = collisionTorque + spinExchange
                    this.applyTorque(totalTorque)
                }

                count++
            }
        }

        if (count > 0) {
            repulsionForce.div(count)
            this.applyForce(repulsionForce)
        }
    }

    // Weak attraction to other particles at medium distances
    attract(others) {
        if (this.launched) return // No attraction when launched

        let attractionForce = this.p.createVector(0, 0)
        let count = 0

        for (let other of others) {
            if (other === this || other.launched) continue

            let d = p5.Vector.dist(this.pos, other.pos)

            // Only attract if within the attraction distance range
            if (d > ATTRACTION_MIN && d < ATTRACTION_MAX) {
                // Attraction force: pull toward other particle
                let diff = p5.Vector.sub(other.pos, this.pos)
                diff.normalize()
                diff.mult(ATTRACTION_STRENGTH)
                attractionForce.add(diff)
                count++
            }
        }

        if (count > 0) {
            attractionForce.div(count)
            this.applyForce(attractionForce)
        }
    }

    // Rotational coupling with nearby particles
    spinCouple(others) {
        if (this.launched) return // No coupling when launched

        let torqueSum = 0
        let totalWeight = 0

        for (let other of others) {
            if (other === this || other.launched) continue

            let d = p5.Vector.dist(this.pos, other.pos)

            // Only couple if within radius
            if (d > 0 && d < SPIN_COUPLING_RADIUS) {
                // Stronger influence from closer particles (inverse square for locality)
                let weight = 1.0 / (d * d + 1)

                // Try to match the neighbor's spin (creates vortices)
                let spinDiff = other.angularVel - this.angularVel
                torqueSum += spinDiff * weight
                totalWeight += weight
            }
        }

        if (totalWeight > 0) {
            // Apply weighted average torque
            let avgTorque = torqueSum / totalWeight
            this.applyTorque(avgTorque * SPIN_COUPLING_STRENGTH)
        }
    }

    // Weak gravitational attraction to center point
    gravitate(centerX, centerY) {
        if (this.launched) return // No gravity when launched

        let center = this.p.createVector(centerX, centerY)
        let toCenter = p5.Vector.sub(center, this.pos)
        let distance = toCenter.mag()

        // Simple pull toward center (weak)
        if (distance > 0) {
            toCenter.normalize()
            toCenter.mult(GRAVITY_STRENGTH)
            this.applyForce(toCenter)
        }
    }

    // Ocean swimming behavior
    swim(wordDirection = null) {
        if (this.recruited && !this.launched) {
            // Move toward target position when recruited
            if (this.targetPos) {
                let desired = p5.Vector.sub(this.targetPos, this.pos)
                let d = desired.mag()

                // Slow down as we approach
                let speed = this.maxSpeed * 2 // Faster for word formation
                if (d < 100) {
                    speed = this.p.map(d, 0, 100, 0, speed)
                }

                desired.setMag(speed)
                let steer = p5.Vector.sub(desired, this.vel)
                steer.limit(this.maxForce * 4) // Strong attraction for words
                this.applyForce(steer)

                // Align rotation to word's direction and zero out spin
                if (wordDirection !== null) {
                    // Target angle is the word's direction
                    let targetAngle = wordDirection
                    let angleDiff = targetAngle - this.angle

                    // Normalize angle difference to [-PI, PI]
                    while (angleDiff > this.p.PI) angleDiff -= this.p.TWO_PI
                    while (angleDiff < -this.p.PI) angleDiff += this.p.TWO_PI

                    // Apply strong corrective torque to align with word
                    let alignmentStrength = 0.15
                    this.applyTorque(angleDiff * alignmentStrength)

                    // Dampen angular velocity to normalize spin to zero
                    this.angularVel *= 0.9
                }
            }
        }
    }

    // Physics update
    update() {
        // No forces when launched - letters maintain trajectory
        if (!this.launched) {
            this.swim()
        }

        // Update linear motion
        this.vel.add(this.acc)
        if (!this.launched) {
            this.vel.limit(this.maxSpeed)
        }
        this.pos.add(this.vel)
        this.acc.mult(0)

        // Update rotational motion
        this.angularVel += this.angularAcc

        // Add small random perturbation to prevent stasis (only when not recruited)
        if (!this.recruited && !this.launched) {
            this.angularVel += this.p.random(-SPIN_NOISE, SPIN_NOISE)
        }

        this.angle += this.angularVel
        this.angularAcc = 0

        // Wrap around edges (ocean is infinite)
        if (this.pos.x < 0) this.pos.x = this.p.width
        if (this.pos.x > this.p.width) this.pos.x = 0
        if (this.pos.y < 0) this.pos.y = this.p.height
        if (this.pos.y > this.p.height) this.pos.y = 0
    }

    display() {
        this.p.push()

        // Apply rotation
        this.p.translate(this.pos.x, this.pos.y)
        this.p.rotate(this.angle)

        // Draw letter at origin (since we translated)
        this.p.fill(0, this.alpha) // Black text
        this.p.textSize(this.size)
        this.p.textAlign(this.p.CENTER, this.p.CENTER)
        this.p.textFont('Courier New, monospace')
        this.p.text(this.char, 0, 0)

        this.p.pop()

        // Debug: show target (draw after pop to avoid rotation)
        if (this.recruited && this.targetPos && !this.launched) {
            this.p.push()
            this.p.stroke(0, 0, 0, 50) // Faint black line
            this.p.strokeWeight(1)
            this.p.line(this.pos.x, this.pos.y, this.targetPos.x, this.targetPos.y)
            this.p.pop()
        }
    }
}

// Track active words being formed
let activeWords = []
let nextWordId = 0
let currentWordDirection = 0 // Global rotating spawn angle for new words

class WordFormation {
    constructor(word, p) {
        this.word = word.toUpperCase()
        this.id = nextWordId++
        this.letters = []
        this.p = p

        // Dynamic position - starts at center, moves outward
        this.pos = p.createVector(p.width / 2, p.height / 2)

        // Use current global direction (fixed for this word's lifetime)
        this.direction = currentWordDirection
        this.vel = p5.Vector.fromAngle(this.direction).mult(0.8)

        this.formed = false
        this.launching = false
        this.launched = false
    }

    // Update word position and letter targets
    update() {
        if (this.launched) return

        // Move the word formation outward (direction is fixed)
        this.pos.add(this.vel)

        // Wrap around screen edges
        if (this.pos.x < 0) this.pos.x = this.p.width
        if (this.pos.x > this.p.width) this.pos.x = 0
        if (this.pos.y < 0) this.pos.y = this.p.height
        if (this.pos.y > this.p.height) this.pos.y = 0

        // Update target positions for all letters (moving with the word)
        this.updateTargetPositions()
    }

    // Update target positions relative to word's current position
    updateTargetPositions() {
        let wordWidth = this.word.length * 30
        let startX = -wordWidth / 2

        for (let i = 0; i < this.letters.length; i++) {
            let letter = this.letters[i]
            if (letter.recruited && letter.targetIndex !== -1) {
                // Position relative to word center (horizontal line)
                let localX = startX + letter.targetIndex * 30
                let localY = 0

                // Rotate position based on word direction
                let cos = Math.cos(this.direction)
                let sin = Math.sin(this.direction)
                let rotatedX = localX * cos - localY * sin
                let rotatedY = localX * sin + localY * cos

                // Set target to world position
                letter.targetPos = p5.Vector.add(this.pos, this.p.createVector(rotatedX, rotatedY))
            }
        }
    }

    // Check if word is fully formed (all letters in position)
    checkFormed() {
        // Skip if already formed, launching, or launched
        if (this.formed || this.launching || this.launched) return
        if (this.letters.length !== this.word.length) return

        let allClose = true
        for (let letter of this.letters) {
            if (!letter.targetPos) {
                allClose = false
                break
            }

            let d = p5.Vector.dist(letter.pos, letter.targetPos)
            if (d > 5) {
                allClose = false
                break
            }
        }

        if (allClose && !this.formed) {
            this.formed = true
            console.log(`Word "${this.word}" formed!`)
            // Launch immediately once formed
            this.launch()
        }
    }

    launch() {
        console.log(`Launching word "${this.word}"!`)
        this.launching = true

        // Accelerate in the direction the word is already moving
        let launchSpeed = 4 // Faster than formation speed
        let launchVel = p5.Vector.fromAngle(this.direction).mult(launchSpeed)

        // Add perpendicular component for curved trajectory
        // Curve in opposite direction of rotation (creates spiral)
        let perpAngle = this.direction - this.p.HALF_PI // 90 degrees counter to rotation
        let curveVel = p5.Vector.fromAngle(perpAngle).mult(LAUNCH_CURVE_STRENGTH)
        launchVel.add(curveVel)

        // Give all letters launch velocity in the word's direction
        for (let letter of this.letters) {
            letter.launched = true
            // Base velocity plus small random spread
            letter.vel = launchVel.copy()
            letter.vel.x += this.p.random(-0.3, 0.3)
            letter.vel.y += this.p.random(-0.3, 0.3)
        }
    }

    // Dissolve the word - release letters back to normal physics
    dissolve() {
        if (this.launched) return

        console.log(`Dissolving word "${this.word}"`)
        for (let letter of this.letters) {
            letter.recruited = false
            letter.launched = false
            letter.wordId = null
            letter.targetPos = null
            letter.targetIndex = -1
            // Keep current velocity but reduce it
            letter.vel.mult(0.3)
        }
        this.launched = true
    }

    // Check if word is far enough from center to dissolve
    shouldDissolve() {
        // if (!this.launching) return false

        // Calculate distance from screen center
        let centerX = this.p.width / 2
        let centerY = this.p.height / 2
        let center = this.p.createVector(centerX, centerY)
        let distanceFromCenter = p5.Vector.dist(this.pos, center)

        return distanceFromCenter > WORD_DISSOLVE_DISTANCE
    }
}

// Main sketch
const sketch = (p) => {
    let letters = []
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight)

        // Initialize ocean with random letters
        for (let i = 0; i < 200; i++) {
            let char = alphabet[Math.floor(Math.random() * alphabet.length)]
            let x = p.random(p.width)
            let y = p.random(p.height)
            letters.push(new Letter(char, x, y, p))
        }

        console.log('Ocean initialized with', letters.length, 'letters')
    }

    p.draw = () => {
        p.background(255) // White

        let centerX = p.width / 2
        let centerY = p.height / 2

        // Rotate global word spawn direction
        currentWordDirection += WORD_ROTATION_SPEED

        // Update word formations first
        for (let i = activeWords.length - 1; i >= 0; i--) {
            let word = activeWords[i]

            // Update word position and targets
            word.update()
            word.checkFormed()

            // Check if should dissolve
            if (word.shouldDissolve()) {
                word.dissolve()
            }

            // Remove dissolved words
            if (word.launched) {
                activeWords.splice(i, 1)
                console.log(`Word "${word.word}" completed and removed`)
            }
        }

        // Build a map of letters to their word directions
        let letterWordDirections = new Map()
        for (let word of activeWords) {
            for (let letter of word.letters) {
                letterWordDirections.set(letter, word.direction)
            }
        }

        // Apply forces to all letters
        for (let letter of letters) {
            letter.repel(letters)              // Short-range repulsion (collision avoidance)
            letter.attract(letters)            // Medium-range attraction (clustering)
            letter.gravitate(centerX, centerY) // Weak attraction to sphere center

            // Pass word direction if letter is recruited
            let wordDirection = letterWordDirections.get(letter) || null
            letter.swim(wordDirection)         // Word formation behaviors
        }

        // Update and display all letters
        for (let letter of letters) {
            letter.update()
            letter.display()
        }
    }

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight)
    }

    // Public API
    window.p5Ocean = {
        formWord: (word) => {
            word = word.toUpperCase()
            console.log(`Recruiting letters for word: "${word}"`)

            let formation = new WordFormation(word, p)

            // Find and recruit available letters
            for (let i = 0; i < word.length; i++) {
                let char = word[i]

                // Find nearest available letter with this character
                let availableLetters = letters.filter(l =>
                    l.char === char && !l.recruited
                )

                if (availableLetters.length === 0) {
                    console.warn(`No available letter "${char}" found!`)
                    continue
                }

                // Sort by distance to formation center
                availableLetters.sort((a, b) => {
                    let distA = p5.Vector.dist(a.pos, formation.pos)
                    let distB = p5.Vector.dist(b.pos, formation.pos)
                    return distA - distB
                })

                let letter = availableLetters[0]
                letter.recruited = true
                letter.wordId = formation.id
                letter.targetIndex = i
                // Target will be set by updateTargetPositions()

                formation.letters.push(letter)

                console.log(`  Recruited "${char}" at index ${i}`)
            }

            // Set initial target positions
            formation.updateTargetPositions()

            activeWords.push(formation)
            console.log(`Word formation started with ${formation.letters.length}/${word.length} letters`)
        },

        addLetters: (count = 50) => {
            for (let i = 0; i < count; i++) {
                let char = alphabet[Math.floor(Math.random() * alphabet.length)]
                let x = p.random(p.width)
                let y = p.random(p.height)
                letters.push(new Letter(char, x, y, p))
            }
            console.log(`Added ${count} letters. Total: ${letters.length}`)
        }
    }
}

// Create p5 instance
new p5(sketch, 'canvas-container')

// Global functions for HTML buttons
window.formWord = () => {
    let input = document.getElementById('wordInput')
    if (input.value.trim()) {
        window.p5Ocean.formWord(input.value.trim())
        input.value = ''
    }
}

window.addLetters = () => {
    window.p5Ocean.addLetters(50)
}
