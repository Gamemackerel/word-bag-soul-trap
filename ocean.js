import p5 from 'p5'

// Ocean of Letters - Physics-based letter animation

// Physics constants
const REPULSION_RADIUS = 15       // Distance at which letters repel (very short)
const REPULSION_STRENGTH = 0.25   // How strongly letters push apart (weak)
const ATTRACTION_MIN = 50         // Minimum distance for particle attraction
const ATTRACTION_MAX = 150        // Maximum distance for particle attraction
const ATTRACTION_STRENGTH = 0.05  // Weak attraction between particles
const GRAVITY_STRENGTH = 0.02     // Pull toward center (fairly weak)
const SPHERE_RADIUS = 250         // Target radius for the sphere

// Letter class with physics
class Letter {
    constructor(char, x, y, p) {
        this.char = char
        this.p = p

        // Physics
        this.pos = p.createVector(x, y)
        this.vel = p.createVector(p.random(-0.5, 0.5), p.random(-0.5, 0.5))
        this.acc = p.createVector(0, 0)
        this.maxSpeed = 3
        this.maxForce = 0.2
        this.mass = 1

        // Word formation
        this.recruited = false
        this.targetPos = null
        this.targetIndex = -1
        this.wordId = null
        this.launched = false

        // Visual
        this.size = 24
        this.alpha = 255
    }

    applyForce(force) {
        // F = ma, so a = F/m
        let f = force.copy()
        f.div(this.mass)
        this.acc.add(f)
    }

    // Calculate repulsion from other letters (collision avoidance)
    repel(others) {
        if (this.launched) return // No repulsion when launched

        let repulsionForce = this.p.createVector(0, 0)
        let count = 0

        for (let other of others) {
            if (other === this || other.launched) continue

            let d = p5.Vector.dist(this.pos, other.pos)

            // Only repel if within radius
            if (d > 0 && d < REPULSION_RADIUS) {
                // Repulsion force: stronger when closer
                let diff = p5.Vector.sub(this.pos, other.pos)
                diff.normalize()
                diff.div(d) // Inverse distance (closer = stronger)
                diff.mult(REPULSION_STRENGTH)
                repulsionForce.add(diff)
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
    swim() {
        if (this.recruited && !this.launched) {
            // Move toward target position when recruited
            if (this.targetPos) {
                let desired = p5.Vector.sub(this.targetPos, this.pos)
                let d = desired.mag()

                // Slow down as we approach
                let speed = this.maxSpeed
                if (d < 100) {
                    speed = this.p.map(d, 0, 100, 0, this.maxSpeed)
                }

                desired.setMag(speed)
                let steer = p5.Vector.sub(desired, this.vel)
                steer.limit(this.maxForce * 3) // Even stronger attraction for words
                this.applyForce(steer)
            }
        }
    }

    // Physics update
    update() {
        // Gravity when launched
        if (this.launched) {
            this.applyForce(this.p.createVector(0, 0.3)) // Falling
        }

        this.swim()

        this.vel.add(this.acc)
        this.vel.limit(this.maxSpeed)
        this.pos.add(this.vel)
        this.acc.mult(0)

        // Wrap around edges (ocean is infinite)
        if (this.pos.x < 0) this.pos.x = this.p.width
        if (this.pos.x > this.p.width) this.pos.x = 0
        if (this.pos.y < 0) this.pos.y = this.p.height
        if (this.pos.y > this.p.height) this.pos.y = 0
    }

    display() {
        this.p.push()
        this.p.fill(255, this.alpha)
        this.p.textSize(this.size)
        this.p.textAlign(this.p.CENTER, this.p.CENTER)
        this.p.text(this.char, this.pos.x, this.pos.y)

        // Debug: show target
        if (this.recruited && this.targetPos && !this.launched) {
            this.p.stroke(0, 255, 0, 100)
            this.p.strokeWeight(1)
            this.p.line(this.pos.x, this.pos.y, this.targetPos.x, this.targetPos.y)
        }

        this.p.pop()
    }
}

// Track active words being formed
let activeWords = []
let nextWordId = 0

class WordFormation {
    constructor(word, p) {
        this.word = word.toUpperCase()
        this.id = nextWordId++
        this.letters = []
        this.p = p
        this.centerX = p.width / 2
        this.centerY = p.height * 0.7 // Form in lower part of ocean
        this.formed = false
        this.launching = false
        this.launched = false
        this.launchVelocity = p.createVector(0, -8)
    }

    // Check if word is fully formed (all letters in position)
    checkFormed() {
        // Skip if already formed, launching, or launched
        if (this.formed || this.launching || this.launched) return
        if (this.letters.length !== this.word.length) return

        let allClose = true
        for (let letter of this.letters) {
            // Check if targetPos exists (it might be null after release)
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
            // Wait a moment then launch
            setTimeout(() => this.launch(), 500)
        }
    }

    launch() {
        console.log(`Launching word "${this.word}"!`)
        this.launching = true

        // Give all letters upward velocity
        for (let letter of this.letters) {
            letter.launched = true
            letter.vel = this.launchVelocity.copy()
            letter.vel.x += this.p.random(-1, 1) // Slight spread
        }

        // After some time in air, release letters
        setTimeout(() => {
            for (let letter of this.letters) {
                letter.recruited = false
                letter.wordId = null
                letter.targetPos = null
                letter.targetIndex = -1
            }
            this.launched = true
        }, 2000)
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
        p.background(1, 17, 34) // Deep ocean blue

        // Draw sphere center (debug)
        let centerX = p.width / 2
        let centerY = p.height / 2
        p.noFill()
        p.stroke(255, 255, 255, 30)
        p.strokeWeight(1)
        p.circle(centerX, centerY, SPHERE_RADIUS * 2)

        // Apply forces to all letters
        for (let letter of letters) {
            letter.repel(letters)              // Short-range repulsion (collision avoidance)
            letter.attract(letters)            // Medium-range attraction (clustering)
            letter.gravitate(centerX, centerY) // Weak attraction to sphere center
            letter.swim()                      // Word formation behaviors
        }

        // Update and display all letters
        for (let letter of letters) {
            letter.update()
            letter.display()
        }

        // Update word formations
        for (let i = activeWords.length - 1; i >= 0; i--) {
            let word = activeWords[i]
            word.checkFormed()

            // Remove completed words
            if (word.launched) {
                activeWords.splice(i, 1)
                console.log(`Word "${word.word}" completed and removed`)
            }
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

            // Calculate target positions for each letter in the word
            let wordWidth = word.length * 30
            let startX = formation.centerX - wordWidth / 2

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

                // Sort by distance and take closest
                availableLetters.sort((a, b) => {
                    let distA = p5.Vector.dist(a.pos, p.createVector(startX + i * 30, formation.centerY))
                    let distB = p5.Vector.dist(b.pos, p.createVector(startX + i * 30, formation.centerY))
                    return distA - distB
                })

                let letter = availableLetters[0]
                letter.recruited = true
                letter.wordId = formation.id
                letter.targetIndex = i
                letter.targetPos = p.createVector(startX + i * 30, formation.centerY)

                formation.letters.push(letter)

                console.log(`  Recruited "${char}" at index ${i}`)
            }

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
