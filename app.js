import p5 from 'p5'
import { CreateMLCEngine } from '@mlc-ai/web-llm'

// WebLLM engine instance (initialized in init())
let engine = null
const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC'

// ============================================================================
// CONFIGURATION
// ============================================================================

// LLM Configuration
const MAX_CONTEXT_LENGTH = 512
const MAX_SENTENCE_BUFFER = 50 // Max sentences to buffer (~500 words at 10 words/sentence)

// Boids flocking constants
const BOIDS_SEPARATION_RADIUS = 28
const BOIDS_SEPARATION_RADIUS_SQ = BOIDS_SEPARATION_RADIUS * BOIDS_SEPARATION_RADIUS
const BOIDS_SEPARATION_STRENGTH = 2.5
const BOIDS_ALIGNMENT_RADIUS = 80
const BOIDS_ALIGNMENT_RADIUS_SQ = BOIDS_ALIGNMENT_RADIUS * BOIDS_ALIGNMENT_RADIUS
const BOIDS_ALIGNMENT_STRENGTH = 0.05
const BOIDS_COHESION_RADIUS = 120
const BOIDS_COHESION_RADIUS_SQ = BOIDS_COHESION_RADIUS * BOIDS_COHESION_RADIUS
const BOIDS_COHESION_STRENGTH = 0.006

// Word bonding — physics-emergent word formation
const WORD_LETTER_SPACING = 16     // Target center-to-center distance between bonded letters
const WORD_ALIGN_STRENGTH = 0.12   // Force aligning word letters' velocity to word orientation
const WORD_BOND_STRENGTH = 0.08    // Spring strength pulling letters to correct relative position
const WORD_REPULSION_RADIUS = 160  // How far word letters push free letters away (and vice versa)
const WORD_REPULSION_RADIUS_SQ = WORD_REPULSION_RADIUS * WORD_REPULSION_RADIUS
const WORD_REPULSION_STRENGTH = 14.0
const WORD_LIFETIME = 14000        // ms before word dissolves back to flock

// Soft boundary
const BOUNDARY_MARGIN = 80   // Distance from edge where repulsion begins
const BOUNDARY_STRENGTH = 0.8

// General physics
const GRAVITY_STRENGTH = 0
const SPIN_NOISE = 0.003
const WORD_ROTATION_SPEED = 0.001  // Global word emission direction drift
const MAX_LETTER_SPEED = 3
const SPEED_DECELERATION = 0.3
const LETTER_COUNT = 500

// Quadtree configuration
const QUADTREE_CAPACITY = 8

// ============================================================================
// QUADTREE - Spatial partitioning for efficient neighbor queries
// ============================================================================

class Rectangle {
    constructor(x, y, w, h) {
        this.x = x      // Center x
        this.y = y      // Center y
        this.w = w      // Half width
        this.h = h      // Half height
    }

    contains(point) {
        return (
            point.pos.x >= this.x - this.w &&
            point.pos.x < this.x + this.w &&
            point.pos.y >= this.y - this.h &&
            point.pos.y < this.y + this.h
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

class Quadtree {
    constructor(boundary) {
        this.boundary = boundary
        this.points = []
        this.divided = false
        this.northeast = null
        this.northwest = null
        this.southeast = null
        this.southwest = null
    }

    subdivide() {
        const x = this.boundary.x
        const y = this.boundary.y
        const w = this.boundary.w / 2
        const h = this.boundary.h / 2

        this.northeast = new Quadtree(new Rectangle(x + w, y - h, w, h))
        this.northwest = new Quadtree(new Rectangle(x - w, y - h, w, h))
        this.southeast = new Quadtree(new Rectangle(x + w, y + h, w, h))
        this.southwest = new Quadtree(new Rectangle(x - w, y + h, w, h))
        this.divided = true
    }

    insert(point) {
        if (!this.boundary.contains(point)) {
            return false
        }

        if (this.points.length < QUADTREE_CAPACITY && !this.divided) {
            this.points.push(point)
            return true
        }

        if (!this.divided) {
            this.subdivide()
            // Re-insert existing points into children
            for (const p of this.points) {
                this.northeast.insert(p) ||
                this.northwest.insert(p) ||
                this.southeast.insert(p) ||
                this.southwest.insert(p)
            }
            this.points = []
        }

        return (
            this.northeast.insert(point) ||
            this.northwest.insert(point) ||
            this.southeast.insert(point) ||
            this.southwest.insert(point)
        )
    }

    query(range, found = []) {
        if (!this.boundary.intersects(range)) {
            return found
        }

        for (const p of this.points) {
            if (range.contains(p)) {
                found.push(p)
            }
        }

        if (this.divided) {
            this.northeast.query(range, found)
            this.northwest.query(range, found)
            this.southeast.query(range, found)
            this.southwest.query(range, found)
        }

        return found
    }
}

// ============================================================================
// LETTER CLASS - Physics-based letter particle
// ============================================================================

class Letter {
    constructor(char, x, y, p) {
        this.char = char
        this.p = p

        // Visual properties
        this.size = 24
        this.alpha = 255

        // Linear physics
        this.pos = p.createVector(x, y)
        this.vel = p.createVector(p.random(-0.5, 0.5), p.random(-0.5, 0.5))
        this.acc = p.createVector(0, 0)
        this.maxSpeed = MAX_LETTER_SPEED
        this.maxSpeedSq = MAX_LETTER_SPEED * MAX_LETTER_SPEED  // Cached for perf
        this.maxForce = 0.2
        this.mass = 1

        // Rotational physics
        this.angle = p.random(p.TWO_PI)
        this.angularVel = p.random(-0.1, 0.1)
        this.angularAcc = 0
        this.radius = this.size / 2
        this.momentOfInertia = this.mass * this.radius * this.radius

        // Word bond state
        this.recruited = false
        this.bondLeft = null    // Letter to my left in current word
        this.bondRight = null   // Letter to my right in current word
        this.wordGroup = null   // Reference to WordFormation
        this.wordIndex = -1
        this.bondRamp = 0       // 0..1 bell curve set each frame by WordFormation
        this.dragging = false
    }

    applyTorque(torque) {
        this.angularAcc += torque / this.momentOfInertia
    }

    // Boids: separation, alignment, cohesion using quadtree
    applyBoidsForces(quadtree) {
        if (this.dragging) return

        const queryRange = new Rectangle(
            this.pos.x, this.pos.y,
            BOIDS_COHESION_RADIUS, BOIDS_COHESION_RADIUS
        )
        const neighbors = quadtree.query(queryRange)

        let sepX = 0, sepY = 0, sepCount = 0
        let avgVelX = 0, avgVelY = 0, alignCount = 0
        let avgPosX = 0, avgPosY = 0, cohCount = 0

        for (const other of neighbors) {
            if (other === this) continue

            const dx = this.pos.x - other.pos.x
            const dy = this.pos.y - other.pos.y
            const dSq = dx * dx + dy * dy

            if (dSq === 0) continue

            // Repulsion between word-letters and free letters, scaled by bondRamp
            const crossWord = this.bondRamp > 0 || other.bondRamp > 0
            if (crossWord && this.wordGroup !== other.wordGroup && dSq < WORD_REPULSION_RADIUS_SQ) {
                const repulse = Math.max(this.bondRamp, other.bondRamp) * WORD_REPULSION_STRENGTH
                const d = Math.sqrt(dSq)
                this.acc.x += (dx / d) * (repulse / d)
                this.acc.y += (dy / d) * (repulse / d)
            }

            if (dSq < BOIDS_SEPARATION_RADIUS_SQ) {
                // Separation: push away, weighted by inverse distance
                const d = Math.sqrt(dSq)
                sepX += (dx / d) / d  // weight by 1/d
                sepY += (dy / d) / d
                sepCount++

                // Spin coupling on close pass
                const impactSpeedSq = (this.vel.x - other.vel.x) ** 2 + (this.vel.y - other.vel.y) ** 2
                if (impactSpeedSq > 0.04) {
                    const spinDiff = other.angularVel - this.angularVel
                    this.applyTorque(spinDiff * 0.08 + (Math.random() - 0.5) * 0.04)
                }
            } else if (dSq < BOIDS_ALIGNMENT_RADIUS_SQ) {
                // Alignment: match velocity
                avgVelX += other.vel.x
                avgVelY += other.vel.y
                alignCount++
            } else if (dSq < BOIDS_COHESION_RADIUS_SQ) {
                // Cohesion: weight neighbor by how unbound it is
                const w = 1 - other.bondRamp
                avgPosX += other.pos.x * w
                avgPosY += other.pos.y * w
                cohCount += w
            }
        }

        if (sepCount > 0) {
            this.acc.x += sepX * BOIDS_SEPARATION_STRENGTH
            this.acc.y += sepY * BOIDS_SEPARATION_STRENGTH
        }
        if (alignCount > 0) {
            const dvx = (avgVelX / alignCount) - this.vel.x
            const dvy = (avgVelY / alignCount) - this.vel.y
            this.acc.x += dvx * BOIDS_ALIGNMENT_STRENGTH
            this.acc.y += dvy * BOIDS_ALIGNMENT_STRENGTH
        }
        if (cohCount > 0) {
            const cohesion = BOIDS_COHESION_STRENGTH * (1 - this.bondRamp)
            this.acc.x += ((avgPosX / cohCount) - this.pos.x) * cohesion
            this.acc.y += ((avgPosY / cohCount) - this.pos.y) * cohesion
        }
    }

    applyBoundaryForce(w, h) {
        const m = BOUNDARY_MARGIN
        const s = BOUNDARY_STRENGTH
        if (this.pos.x < m)     this.acc.x += s * (1 - this.pos.x / m)
        if (this.pos.x > w - m) this.acc.x -= s * (1 - (w - this.pos.x) / m)
        if (this.pos.y < m)     this.acc.y += s * (1 - this.pos.y / m)
        if (this.pos.y > h - m) this.acc.y -= s * (1 - (h - this.pos.y) / m)
    }

    gravitate(centerX, centerY) {
        if (this.dragging) return

        // Inline math to avoid vector allocations
        const dx = centerX - this.pos.x
        const dy = centerY - this.pos.y
        const distSq = dx * dx + dy * dy

        if (distSq > 0) {
            const dist = Math.sqrt(distSq)
            // Normalize and apply gravity strength (mass is 1, so skip division)
            this.acc.x += (dx / dist) * GRAVITY_STRENGTH
            this.acc.y += (dy / dist) * GRAVITY_STRENGTH
        }
    }

    update() {
        // Linear motion
        if (!this.dragging) {
            this.vel.add(this.acc)

            // Soft speed limit - use squared magnitude to avoid sqrt
            const currentSpeedSq = this.vel.magSq()
            if (currentSpeedSq > this.maxSpeedSq) {
                // Only compute actual speed when we need to modify velocity
                const currentSpeed = Math.sqrt(currentSpeedSq)
                const excess = currentSpeed - this.maxSpeed
                const newSpeed = currentSpeed - excess * SPEED_DECELERATION
                this.vel.setMag(newSpeed)
            }

            this.pos.add(this.vel)
        }

        this.acc.mult(0)

        // Rotational motion
        this.angularVel += this.angularAcc
        if (!this.recruited) {
            this.angularVel += this.p.random(-SPIN_NOISE, SPIN_NOISE)
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
        // Font is set once per frame in draw() before push/pop
        this.p.text(this.char, 0, 0)
        this.p.pop()
    }
}

// ============================================================================
// WORD FORMATION CLASS - Manages recruited letters forming words
// ============================================================================

let nextWordId = 0
let currentWordDirection = 0

// Word emission timing for bursts
let burstQueue = [] // Queue of word bursts (arrays of {word, direction})
let currentBurst = [] // Current burst being emitted
let nextBurstEmissionTime = 0 // Time when next word in burst can be emitted
let burstCooldownUntil = 0 // Time when next burst can start
let gravityDisabled = false // Temporary gravity disable for zero-g mode
const BURST_WORD_DELAY = 2000 // 2 seconds between words in a burst
const BURST_COOLDOWN = 30000 // 30 seconds between bursts

class WordFormation {
    constructor(word, p, millis, direction) {
        this.word = word.toUpperCase()
        this.id = nextWordId++
        this.letters = []
        this.p = p
        this.startTime = millis
        this.direction = direction  // initial travel direction
        this.launched = false       // true once dissolved back to flock
        // currentOrientation is computed each frame from letter velocities
        this.currentOrientation = direction
    }

    // Apply physics-based bond forces to all letters in the word.
    // Called once per frame from draw().
    applyBondForces(millis) {
        if (this.launched || this.letters.length < 2) return

        const age = millis - this.startTime
        // Smooth bell: fade in over first 30% of lifetime, fade out over last 30%
        const t = age / WORD_LIFETIME  // 0..1
        const ramp = Math.sin(t * Math.PI)
        const bond = ramp * WORD_BOND_STRENGTH

        // Compute current word orientation from average velocity of letters
        let avgVx = 0, avgVy = 0
        for (const lt of this.letters) {
            avgVx += lt.vel.x
            avgVy += lt.vel.y
        }
        avgVx /= this.letters.length
        avgVy /= this.letters.length
        const mag = Math.sqrt(avgVx * avgVx + avgVy * avgVy)
        if (mag > 0.01) {
            this.currentOrientation = Math.atan2(avgVy, avgVx)
        }
        const fwdX = Math.cos(this.currentOrientation)
        const fwdY = Math.sin(this.currentOrientation)

        for (let i = 0; i < this.letters.length; i++) {
            const lt = this.letters[i]
            if (!lt.recruited) continue
            lt.bondRamp = ramp  // expose to boids cohesion scaling

            // ── Bond spring to left and right word-neighbors ──────────────────
            for (const [neighbor, side] of [[lt.bondLeft, -1], [lt.bondRight, 1]]) {
                if (!neighbor || !neighbor.recruited) continue

                const dx = neighbor.pos.x - lt.pos.x
                const dy = neighbor.pos.y - lt.pos.y

                // Target offset: WORD_LETTER_SPACING along the forward axis, on the correct side
                const targetX = fwdX * WORD_LETTER_SPACING * side
                const targetY = fwdY * WORD_LETTER_SPACING * side

                // Spring: pull toward target offset (not just target distance)
                const errX = (targetX - dx) * bond * 0.5
                const errY = (targetY - dy) * bond * 0.5
                lt.acc.x -= errX
                lt.acc.y -= errY

                // Velocity alignment with neighbor: match velocities
                lt.acc.x += (neighbor.vel.x - lt.vel.x) * WORD_ALIGN_STRENGTH * ramp
                lt.acc.y += (neighbor.vel.y - lt.vel.y) * WORD_ALIGN_STRENGTH * ramp
            }

            // ── Angle alignment: letter faces word travel direction ────────────
            let angleDiff = this.currentOrientation - lt.angle
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
            lt.angularAcc += angleDiff * 0.1 * ramp
            lt.angularVel *= 0.92
        }
    }

    dissolve() {
        if (this.launched) return
        for (const lt of this.letters) {
            lt.recruited = false
            lt.bondLeft = null
            lt.bondRight = null
            lt.wordGroup = null
            lt.wordIndex = -1
            lt.bondRamp = 0
            lt.vel.mult(0.4)
        }
        this.launched = true
    }

    shouldDissolve(millis) {
        return (millis - this.startTime) >= WORD_LIFETIME
    }
}

// ============================================================================
// LLM STREAM MANAGER - Handles text generation and queueing
// ============================================================================

class StreamManager {
    constructor() {
        this.prompts = []
        this.currentPromptIndex = 0
        this.generatedText = ''
        this.sentenceBuffer = [] // Words accumulating into current sentence
        this.generationQueue = 0
        this.statusEl = document.getElementById('status')
    }

    async loadPrompts() {
        try {
            const response = await fetch('prompts.txt')
            const textContent = await response.text()
            this.prompts = textContent.split('\n').filter(line => line.trim())
            console.log(`Loaded ${this.prompts.length} prompts`)
            return true
        } catch (error) {
            console.error('Failed to load prompts:', error)
            return false
        }
    }

    getNextPrompt() {
        const rawPrompt = this.prompts[this.currentPromptIndex]
        this.currentPromptIndex = (this.currentPromptIndex + 1) % this.prompts.length

        const parts = rawPrompt.split('|')
        const full = parts.length > 1
            ? parts[0].trim() + ' ' + parts[1].trim()
            : rawPrompt
        const display = parts.length > 1 ? parts[1].trim() : rawPrompt

        return { full, display }
    }

    addToQueue(text) {
        const newWords = text.split(/\s+/).filter(w => w.trim())

        for (const word of newWords) {
            // Filter out short words (3 characters or less, excluding punctuation)
            const cleanWord = word.replace(/[.,!?;:]/g, '')
            if (cleanWord.length <= 3) {
                console.log(`⏭️  Skipping short word: "${word}"`)
                continue
            }

            this.sentenceBuffer.push(word)

            // Check if sentence ends (period, exclamation, question mark)
            if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
                // Complete sentence - move to burst queue
                if (this.sentenceBuffer.length > 0) {
                    burstQueue.push([...this.sentenceBuffer])
                    console.log(`📦 Sentence complete: ${this.sentenceBuffer.length} words queued for burst`)
                    this.sentenceBuffer = []
                }
            }
        }

        console.log(`📥 Added ${newWords.length} words (${burstQueue.length} sentences in burst queue)`)
    }

    getQueueSize() {
        return burstQueue.length
    }

    hasSentenceReady() {
        return burstQueue.length > 0
    }

    getNextSentence() {
        return burstQueue.shift()
    }

    async generate() {
        // Check if sentence buffer is full
        if (burstQueue.length > MAX_SENTENCE_BUFFER) {
            console.log(`⏸️  Buffer full - ${burstQueue.length} sentences buffered`)
            setTimeout(() => this.generate(), 2000)
            return
        }

        if (this.prompts.length === 0) return

        this.generationQueue++

        try {
            const truncatedContext = this.generatedText.length > MAX_CONTEXT_LENGTH
                ? this.generatedText.slice(-MAX_CONTEXT_LENGTH)
                : this.generatedText

            const nextPrompt = this.getNextPrompt()
            const contextPrompt = truncatedContext
                ? truncatedContext.slice(-300) + " " + nextPrompt.full
                : nextPrompt.full

            // Add display text immediately
            const displayText = " " + nextPrompt.display
            this.generatedText += displayText
            this.addToQueue(displayText)

            const chunks = await engine.chat.completions.create({
                messages: [{ role: 'user', content: contextPrompt }],
                stream: true,
                max_tokens: 150
            })

            let buffer = ''

            for await (const chunk of chunks) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (content) {
                    buffer += content
                    this.generatedText += content

                    if (/\s/.test(buffer)) {
                        const wordParts = buffer.split(/(\s+)/)

                        for (let i = 0; i < wordParts.length - 1; i++) {
                            const wordPart = wordParts[i]
                            if (wordPart && wordPart.trim()) {
                                this.addToQueue(wordPart)
                            }
                        }

                        buffer = wordParts[wordParts.length - 1] || ''
                    }
                }

                if (chunk.choices[0]?.finish_reason && buffer.trim()) {
                    this.addToQueue(buffer)
                }
            }

            // Truncate context to prevent memory issues
            if (this.generatedText.length > MAX_CONTEXT_LENGTH) {
                this.generatedText = this.generatedText.slice(-MAX_CONTEXT_LENGTH)
            }

            this.generationQueue--

            // Continue generating (with preemptive buffering)
            if (burstQueue.length < MAX_SENTENCE_BUFFER) {
                setTimeout(() => this.generate(), 100) // Generate quickly when buffer low
            } else {
                setTimeout(() => this.generate(), 2000) // Slow down when buffer full
            }

        } catch (error) {
            console.error('Generation error:', error)
            this.generationQueue--
            setTimeout(() => this.generate(), 5000)
        }
    }
}

// ============================================================================
// MAIN SKETCH - p5.js ocean visualization
// ============================================================================

const sketch = (p) => {
    let letters = []
    let activeWords = []
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const streamManager = new StreamManager()

    // Character index for O(1) lookup by letter character
    const lettersByChar = new Map()

    // Center position (can be moved by clicking/dragging)
    let centerX = 0
    let centerY = 0
    let draggingCenter = false

    // Quadtree caching - rebuild every N frames instead of every frame
    const QUADTREE_REBUILD_INTERVAL = 5
    let quadtree = null
    let framesSinceQuadtreeRebuild = 0

    // Interaction state
    let draggedLetter = null
    let prevMousePos = null // For calculating throw velocity

    p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight)

        // Initialize center to screen center
        centerX = p.width / 2
        centerY = p.height / 2

        // Initialize character index
        for (const char of alphabet) {
            lettersByChar.set(char, [])
        }

        // Initialize ocean with letters (doubled for richer letter pool)
        for (let i = 0; i < LETTER_COUNT; i++) {
            const char = alphabet[Math.floor(Math.random() * alphabet.length)]
            const x = p.random(p.width)
            const y = p.random(p.height)
            const letter = new Letter(char, x, y, p)
            letters.push(letter)
            lettersByChar.get(char).push(letter)
        }

        console.log('Ocean initialized with', letters.length, 'letters')
    }

    p.draw = () => {
        p.background(255)
        // Rotate global word spawn direction
        currentWordDirection += WORD_ROTATION_SPEED

        const currentTime = p.millis()

        // Apply word bond forces and dissolve expired words
        for (let i = activeWords.length - 1; i >= 0; i--) {
            const word = activeWords[i]
            word.applyBondForces(currentTime)

            if (word.shouldDissolve(currentTime)) {
                word.dissolve()
            }

            if (word.launched) {
                activeWords.splice(i, 1)
            }
        }

        // Build quadtree for spatial partitioning (only every N frames)
        framesSinceQuadtreeRebuild++
        if (quadtree === null || framesSinceQuadtreeRebuild >= QUADTREE_REBUILD_INTERVAL) {
            const boundary = new Rectangle(p.width / 2, p.height / 2, p.width / 2, p.height / 2)
            quadtree = new Quadtree(boundary)
            for (const letter of letters) {
                quadtree.insert(letter)
            }
            framesSinceQuadtreeRebuild = 0
        }

        // Apply boids forces to all letters; gravity only to non-recruited
        for (const letter of letters) {
            letter.applyBoidsForces(quadtree)
            letter.applyBoundaryForce(p.width, p.height)

            if (!letter.recruited && !gravityDisabled) {
                letter.gravitate(centerX, centerY)
            }
        }

        // Update and display letters
        p.textFont('Courier New')
        for (const letter of letters) {
            letter.update()
            letter.display()
        }

        // Handle burst emission with timing
        // Start new burst if cooldown expired and bursts available
        if (currentBurst.length === 0 && currentTime >= burstCooldownUntil && streamManager.hasSentenceReady()) {
            const sentence = streamManager.getNextSentence()

            // Cap at 10 words
            let words = sentence.slice(0, 10)

            // Select emission mode based on probability
            const modeRoll = Math.random()
            let mode = 'organic' // default

            // 10% chance for symmetrical 4-word mode (only if 4+ words available)
            if (modeRoll < 0.1 && words.length >= 4) {
                mode = 'symmetrical'
                words = words.slice(0, 4) // Use exactly 4 words
            }
            // 5% chance for zero-gravity organic mode (0.1 to 0.15)
            else if (modeRoll < 0.15) {
                mode = 'zerogravity'
                gravityDisabled = true
            }
            // 35% chance for directional mode (0.15 to 0.5)
            else if (modeRoll < 0.5) {
                mode = 'directional'
            }
            // 50% chance for organic mode (0.5 to 1.0)
            else {
                mode = 'organic'
            }

            const startAngle = currentWordDirection

            if (mode === 'symmetrical') {
                // Perfect 4-way symmetry (90 degrees apart, no randomness)
                console.log('🎯 Symmetrical 4-word mode')
                currentBurst = words.map((word, i) => ({
                    word: word,
                    direction: startAngle + (i * Math.PI / 2) // Exactly 90 degrees
                }))
            } else if (mode === 'zerogravity') {
                // Organic scatter with gravity disabled
                const baseAngleSpacing = (Math.PI * 2) / words.length
                const randomVariation = 2.0
                console.log('🚀 Zero-gravity organic mode')
                currentBurst = words.map((word, i) => {
                    const randomOffset = (Math.random() - 0.5) * baseAngleSpacing * randomVariation
                    const direction = startAngle + (i * baseAngleSpacing) + randomOffset
                    return { word: word, direction: direction }
                })
            } else if (mode === 'directional') {
                // All words in approximately same direction (30 degree cone)
                const baseDirection = startAngle
                const coneAngle = Math.PI / 6 // 30 degrees total
                console.log('🎪 Directional mode')
                currentBurst = words.map((word) => ({
                    word: word,
                    direction: baseDirection + (Math.random() - 0.5) * coneAngle
                }))
            } else {
                // Organic scatter mode (original behavior)
                const baseAngleSpacing = (Math.PI * 2) / words.length
                const randomVariation = 2.0
                console.log('🌊 Organic scatter mode')
                currentBurst = words.map((word, i) => {
                    const randomOffset = (Math.random() - 0.5) * baseAngleSpacing * randomVariation
                    const direction = startAngle + (i * baseAngleSpacing) + randomOffset
                    return { word: word, direction: direction }
                })
            }

            // Emit first word immediately
            const firstWord = currentBurst.shift()
            formWord(firstWord.word, firstWord.direction)
            console.log(`🎆 Burst started: ${words.length} words, first: "${firstWord.word}"`)

            // Schedule next word in burst
            if (currentBurst.length > 0) {
                nextBurstEmissionTime = currentTime + BURST_WORD_DELAY
            } else {
                // Single word burst, start cooldown immediately
                burstCooldownUntil = currentTime + BURST_COOLDOWN
                console.log(`⏸️  Cooldown started (30s)`)
            }
        }

        // Emit next word from current burst
        if (currentBurst.length > 0 && currentTime >= nextBurstEmissionTime) {
            const wordData = currentBurst.shift()
            formWord(wordData.word, wordData.direction)
            console.log(`📤 Burst word: "${wordData.word}"`)

            // Schedule next emission or start cooldown
            if (currentBurst.length > 0) {
                nextBurstEmissionTime = currentTime + BURST_WORD_DELAY
            } else {
                // Burst complete, start cooldown and re-enable gravity
                burstCooldownUntil = currentTime + BURST_COOLDOWN
                gravityDisabled = false // Re-enable gravity
                console.log(`⏸️  Burst complete - cooldown started (30s)`)
            }
        }

        p.pop() // End zoom transform
    }

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight)
    }

    p.mousePressed = () => {
        // Check if clicking on a letter
        for (const letter of letters) {
            const d = p5.Vector.dist(letter.pos, p.createVector(p.mouseX, p.mouseY))
            if (d < letter.radius * 2) {
                draggedLetter = letter
                letter.vel.mult(0)
                letter.recruited = false
                letter.bondLeft = null
                letter.bondRight = null
                letter.wordGroup = null
                letter.wordIndex = -1
                letter.dragging = true
                prevMousePos = p.createVector(p.mouseX, p.mouseY)
                return
            }
        }

        // If not on a letter, start dragging center
        draggingCenter = true
        centerX = p.mouseX
        centerY = p.mouseY
        console.log(`🎯 Dragging center`)
    }

    p.mouseDragged = () => {
        if (draggedLetter) {
            // Update position
            draggedLetter.pos.set(p.mouseX, p.mouseY)

            // Calculate velocity for throwing
            const currentMousePos = p.createVector(p.mouseX, p.mouseY)
            if (prevMousePos) {
                const velocity = p5.Vector.sub(currentMousePos, prevMousePos)
                draggedLetter.vel = velocity.copy()
            }
            prevMousePos = currentMousePos.copy()
        } else if (draggingCenter) {
            // Update center position while dragging
            centerX = p.mouseX
            centerY = p.mouseY
        }
    }

    p.mouseReleased = () => {
        if (draggedLetter) {
            draggedLetter.dragging = false // No longer being dragged
            console.log(`🎾 Threw letter with velocity: ${draggedLetter.vel.mag().toFixed(2)}`)
            draggedLetter = null
        } else if (draggingCenter) {
            // Stop dragging center, but keep it at current position
            draggingCenter = false
            console.log(`🎯 Center set to (${centerX.toFixed(0)}, ${centerY.toFixed(0)})`)
        }
        prevMousePos = null
    }

    function captureAsSVG() {
        const w = p.width
        const h = p.height
        const lines = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
            `<rect width="${w}" height="${h}" fill="white"/>`,
        ]

        for (const letter of letters) {
            const x = letter.pos.x.toFixed(2)
            const y = letter.pos.y.toFixed(2)
            const deg = (letter.angle * 180 / Math.PI).toFixed(2)
            const opacity = (letter.alpha / 255).toFixed(3)
            const escaped = letter.char
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
            lines.push(
                `<text transform="translate(${x},${y}) rotate(${deg})" ` +
                `text-anchor="middle" dominant-baseline="middle" ` +
                `font-family="'Courier New', Courier, monospace" font-size="${letter.size}" opacity="${opacity}">${escaped}</text>`
            )
        }

        lines.push('</svg>')
        const blob = new Blob([lines.join('\n')], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `word-bag-${Date.now()}.svg`
        a.click()
        URL.revokeObjectURL(url)
        console.log(`Captured ${letters.length} letters as SVG`)
    }

    p.keyPressed = () => {
        // Disable gravity while holding spacebar
        if (p.key === ' ') {
            gravityDisabled = true
            console.log('🚀 Gravity disabled')
        }
        if (p.key === 's' || p.key === 'S') {
            captureAsSVG()
        }
    }

    p.keyReleased = () => {
        // Re-enable gravity when spacebar is released
        if (p.key === ' ') {
            gravityDisabled = false
            console.log('🌍 Gravity enabled')
        }
    }


    // Recruit letters for a word and wire up neighbor bonds
    function formWord(word, direction = null) {
        word = word.toUpperCase()
        const dir = direction !== null ? direction : currentWordDirection
        const formation = new WordFormation(word, p, p.millis(), dir)

        // Give the whole flock an initial nudge in the word's direction so
        // the recruited letters start drifting that way together
        const kickX = Math.cos(dir) * MAX_LETTER_SPEED * 0.6
        const kickY = Math.sin(dir) * MAX_LETTER_SPEED * 0.6

        const recruited = []

        for (let i = 0; i < word.length; i++) {
            const char = word[i]
            const charLetters = lettersByChar.get(char)
            if (!charLetters) continue

            // Find the closest free letter
            let closest = null
            let closestDSq = Infinity

            for (const lt of charLetters) {
                if (lt.recruited) continue
                const dx = lt.pos.x - centerX
                const dy = lt.pos.y - centerY
                const dSq = dx * dx + dy * dy
                if (dSq < closestDSq) {
                    closestDSq = dSq
                    closest = lt
                }
            }

            if (!closest) { console.warn(`No free letter "${char}"`); continue }

            closest.recruited = true
            closest.wordGroup = formation
            closest.wordIndex = i
            // Give an initial velocity kick toward word direction
            closest.vel.x = kickX + (Math.random() - 0.5) * 0.5
            closest.vel.y = kickY + (Math.random() - 0.5) * 0.5

            formation.letters.push(closest)
            recruited.push(closest)
        }

        // Wire up left/right bonds in word order (by wordIndex)
        const sorted = [...formation.letters].sort((a, b) => a.wordIndex - b.wordIndex)
        for (let i = 0; i < sorted.length; i++) {
            sorted[i].bondLeft  = sorted[i - 1] ?? null
            sorted[i].bondRight = sorted[i + 1] ?? null
        }

        activeWords.push(formation)
        console.log(`Formed "${word}" (${formation.letters.length} letters)`)
    }

    // Public API
    window.oceanStream = { streamManager, formWord }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

new p5(sketch, 'canvas-container')

async function init() {
    const manager = window.oceanStream.streamManager
    const statusEl = document.getElementById('status')

    const loaded = await manager.loadPrompts()
    if (!loaded) return

    try {
        statusEl.textContent = 'Loading AI model...'

        engine = await CreateMLCEngine(MODEL_ID, {
            initProgressCallback: (progress) => {
                const percent = Math.round(progress.progress * 100)
                statusEl.textContent = `Loading model: ${percent}%`
                console.log('Model loading:', progress)
            }
        })

        statusEl.textContent = 'Model ready!'
        setTimeout(() => { statusEl.textContent = '' }, 2000)

        manager.generate()

    } catch (error) {
        console.error('Initialization error:', error)
        statusEl.textContent = 'Error loading model. WebGPU required.'
    }
}

init()
