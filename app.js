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

// Ocean Physics Constants
const REPULSION_RADIUS = 20
const REPULSION_RADIUS_SQ = REPULSION_RADIUS * REPULSION_RADIUS
const REPULSION_STRENGTH = 10.0
const ATTRACTION_MIN = 50
const ATTRACTION_MIN_SQ = ATTRACTION_MIN * ATTRACTION_MIN
const ATTRACTION_MAX = 150
const ATTRACTION_MAX_SQ = ATTRACTION_MAX * ATTRACTION_MAX
const ATTRACTION_STRENGTH = 0.05
const GRAVITY_STRENGTH = 0.07
const COLLISION_SPEED_THRESHOLD = 0.2
const COLLISION_SPIN_FACTOR = 1
const SPIN_NOISE = 0.003
const WORD_ROTATION_SPEED = 0.001
const PATH_MAX_DISTANCE = 1000
const PATH_SPEED = 0.0005
const MAX_LETTER_SPEED = 3 // Target cruise speed for letters
const SPEED_DECELERATION = 0.3 // Deceleration rate when exceeding max speed
const LETTER_COUNT = 500 // Number of letter particles in the ocean

// Path Curve - Consistent gentle curve for all words
const PATH_CURVE_AMOUNT = 0.2  // Curve amount in radians

// Quadtree configuration
const QUADTREE_CAPACITY = 8  // Max items per node before subdivision

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

        // Word formation state
        this.recruited = false
        this.targetPos = null
        this.targetIndex = -1
        this.wordId = null
        this.dragging = false
    }

    applyForce(force) {
        const f = force.copy().div(this.mass)
        this.acc.add(f)
    }

    applyTorque(torque) {
        this.angularAcc += torque / this.momentOfInertia
    }

    // Combined repulsion + attraction in single loop using squared distances
    // Use quadtree to find nearby particles efficiently
    applyNeighborForces(quadtree) {
        if (this.dragging) return

        // Query quadtree for particles within attraction range (the larger range)
        const queryRange = new Rectangle(
            this.pos.x, this.pos.y,
            ATTRACTION_MAX, ATTRACTION_MAX
        )
        const neighbors = quadtree.query(queryRange)

        let repulsionForce = this.p.createVector(0, 0)
        let attractionForce = this.p.createVector(0, 0)
        let repulsionCount = 0
        let attractionCount = 0

        for (const other of neighbors) {
            if (other === this) continue

            // Calculate squared distance first (no sqrt)
            const dx = this.pos.x - other.pos.x
            const dy = this.pos.y - other.pos.y
            const dSq = dx * dx + dy * dy

            // Repulsion check (close range)
            if (dSq > 0 && dSq < REPULSION_RADIUS_SQ) {
                const d = Math.sqrt(dSq)  // Only compute sqrt when needed
                const forceMag = REPULSION_STRENGTH / d
                // Normalize by dividing by d
                repulsionForce.x += (dx / d) * forceMag
                repulsionForce.y += (dy / d) * forceMag

                // Apply collision torque
                const relVelX = this.vel.x - other.vel.x
                const relVelY = this.vel.y - other.vel.y
                const impactSpeedSq = relVelX * relVelX + relVelY * relVelY

                if (impactSpeedSq > COLLISION_SPEED_THRESHOLD * COLLISION_SPEED_THRESHOLD) {
                    const impactSpeed = Math.sqrt(impactSpeedSq)
                    const spinDiff = other.angularVel - this.angularVel

                    const transferFactor = impactSpeed * 0.12
                    const spinTransfer = spinDiff * transferFactor
                    const impactRandomSpin = (Math.random() - 0.5) * impactSpeed * COLLISION_SPIN_FACTOR * 1.5
                    const spinSimilarity = 1.0 / (1.0 + Math.abs(spinDiff) * 5)
                    const similarityBonus = (Math.random() - 0.5) * impactSpeed * COLLISION_SPIN_FACTOR * spinSimilarity

                    this.applyTorque(spinTransfer + impactRandomSpin + similarityBonus)
                }

                repulsionCount++
            }
            // Attraction check (medium range) - note: uses opposite direction
            else if (dSq > ATTRACTION_MIN_SQ && dSq < ATTRACTION_MAX_SQ) {
                const d = Math.sqrt(dSq)
                // Attraction goes toward other (negative dx/dy direction)
                attractionForce.x += (-dx / d) * ATTRACTION_STRENGTH
                attractionForce.y += (-dy / d) * ATTRACTION_STRENGTH
                attractionCount++
            }
        }

        if (repulsionCount > 0) {
            repulsionForce.div(repulsionCount)
            this.applyForce(repulsionForce)
        }
        if (attractionCount > 0) {
            attractionForce.div(attractionCount)
            this.applyForce(attractionForce)
        }
    }

    gravitate(centerX, centerY) {
        if (this.dragging) return

        const center = this.p.createVector(centerX, centerY)
        const toCenter = p5.Vector.sub(center, this.pos)
        const distance = toCenter.mag()

        if (distance > 0) {
            this.applyForce(toCenter.normalize().mult(GRAVITY_STRENGTH))
        }
    }

    swim(wordDirection = null) {
        if (this.recruited && this.targetPos) {
            const desired = p5.Vector.sub(this.targetPos, this.pos)
            const d = desired.mag()

            let speed = this.maxSpeed * 2
            if (d < 100) {
                speed = this.p.map(d, 0, 100, 0, speed)
            }

            desired.setMag(speed)
            const steer = p5.Vector.sub(desired, this.vel).limit(this.maxForce * 4)
            this.applyForce(steer)

            // Align rotation with word direction
            if (wordDirection !== null) {
                let angleDiff = wordDirection - this.angle
                while (angleDiff > this.p.PI) angleDiff -= this.p.TWO_PI
                while (angleDiff < -this.p.PI) angleDiff += this.p.TWO_PI
                this.applyTorque(angleDiff * 0.15)
                this.angularVel *= 0.9
            }
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
    constructor(word, p, startX = null, startY = null) {
        this.word = word.toUpperCase()
        this.id = nextWordId++
        this.letters = []
        this.p = p

        const x = startX !== null ? startX : p.width / 2
        const y = startY !== null ? startY : p.height / 2
        this.pos = p.createVector(x, y)
        this.centerX = x  // Center X for this word's trajectory
        this.centerY = y  // Center Y for this word's trajectory
        this.direction = currentWordDirection
        this.pathProgress = 0
        this.currentOrientation = this.direction
        this.launched = false

        // Consistent path characteristics - same curve for all words
        this.curveAmount = PATH_CURVE_AMOUNT
        this.curveDirection = 1  // Always curve in same direction
        this.maxDistance = PATH_MAX_DISTANCE
    }

    update() {
        if (this.launched) return

        this.pathProgress += PATH_SPEED

        // Use the center position this word was created with
        const centerX = this.centerX
        const centerY = this.centerY

        // Parametric curved path with subtle random variation
        const t = this.pathProgress
        const distanceFromCenter = Math.sin(t * Math.PI) * this.maxDistance

        // Subtle curve that can go left or right
        const angleOffset = t * Math.PI * this.curveAmount * this.curveDirection
        const currentAngle = this.direction + angleOffset

        this.pos.x = centerX + Math.cos(currentAngle) * distanceFromCenter
        this.pos.y = centerY + Math.sin(currentAngle) * distanceFromCenter

        // Calculate tangent direction for word orientation
        const dr_dt = Math.PI * Math.cos(t * Math.PI) * this.maxDistance
        const dtheta_dt = Math.PI * this.curveAmount * this.curveDirection
        const r_dtheta = distanceFromCenter * dtheta_dt

        const vx = dr_dt * Math.cos(currentAngle) - r_dtheta * Math.sin(currentAngle)
        const vy = dr_dt * Math.sin(currentAngle) + r_dtheta * Math.cos(currentAngle)

        this.currentOrientation = Math.atan2(vy, vx)
        this.updateTargetPositions()
    }

    updateTargetPositions() {
        const letterSpacing = 15  // 50% of original 30 for zoomed-out effect
        const wordWidth = this.word.length * letterSpacing
        const startX = -wordWidth / 2

        // Cache sin/cos once per word instead of per letter
        const cos = Math.cos(this.currentOrientation)
        const sin = Math.sin(this.currentOrientation)

        for (let i = 0; i < this.letters.length; i++) {
            const letter = this.letters[i]
            if (letter.recruited && letter.targetIndex !== -1) {
                const localX = startX + letter.targetIndex * letterSpacing
                // localY is always 0, so we can simplify the rotation
                const rotatedX = localX * cos
                const rotatedY = localX * sin

                letter.targetPos = p5.Vector.add(this.pos, this.p.createVector(rotatedX, rotatedY))
            }
        }
    }

    dissolve() {
        if (this.launched) return

        for (const letter of this.letters) {
            letter.recruited = false
            letter.wordId = null
            letter.targetPos = null
            letter.targetIndex = -1
            letter.vel.mult(0.3)
        }
        this.launched = true
    }

    shouldDissolve() {
        return this.pathProgress >= 0.2
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

    // Center position (can be moved by clicking/dragging)
    let centerX = 0
    let centerY = 0
    let draggingCenter = false

    // Interaction state
    let draggedLetter = null
    let prevMousePos = null // For calculating throw velocity

    p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight)

        // Initialize center to screen center
        centerX = p.width / 2
        centerY = p.height / 2

        // Initialize ocean with letters (doubled for richer letter pool)
        for (let i = 0; i < LETTER_COUNT; i++) {
            const char = alphabet[Math.floor(Math.random() * alphabet.length)]
            const x = p.random(p.width)
            const y = p.random(p.height)
            letters.push(new Letter(char, x, y, p))
        }

        console.log('Ocean initialized with', letters.length, 'letters')
    }

    p.draw = () => {
        p.background(255)
        // Rotate global word spawn direction
        currentWordDirection += WORD_ROTATION_SPEED

        // Update word formations
        for (let i = activeWords.length - 1; i >= 0; i--) {
            const word = activeWords[i]
            word.update()

            if (word.shouldDissolve()) {
                word.dissolve()
            }

            if (word.launched) {
                activeWords.splice(i, 1)
            }
        }

        // Build letter-to-direction map
        const letterWordDirections = new Map()
        for (const word of activeWords) {
            for (const letter of word.letters) {
                letterWordDirections.set(letter, word.currentOrientation)
            }
        }

        // Build quadtree for spatial partitioning
        const boundary = new Rectangle(p.width / 2, p.height / 2, p.width / 2, p.height / 2)
        const quadtree = new Quadtree(boundary)
        for (const letter of letters) {
            quadtree.insert(letter)
        }

        // Apply forces to letters
        for (const letter of letters) {
            letter.applyNeighborForces(quadtree)

            // Only apply gravity if not disabled
            if (!gravityDisabled) {
                letter.gravitate(centerX, centerY)
            }

            const wordDirection = letterWordDirections.get(letter) || null
            letter.swim(wordDirection)
        }

        // Update and display letters
        for (const letter of letters) {
            letter.update()
            letter.display()
        }

        // Handle burst emission with timing
        const currentTime = p.millis()

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
                letter.vel.mult(0) // Stop movement while dragging
                letter.recruited = false // Release from any word formation
                letter.dragging = true // Mark as being dragged
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

    p.keyPressed = () => {
        // Disable gravity while holding spacebar
        if (p.key === ' ') {
            gravityDisabled = true
            console.log('🚀 Gravity disabled')
        }
    }

    p.keyReleased = () => {
        // Re-enable gravity when spacebar is released
        if (p.key === ' ') {
            gravityDisabled = false
            console.log('🌍 Gravity enabled')
        }
    }


    // Form a word by recruiting letters
    function formWord(word, direction = null) {
        word = word.toUpperCase()
        const formation = new WordFormation(word, p, centerX, centerY)

        // Override direction if provided (for burst spacing)
        if (direction !== null) {
            formation.direction = direction
            formation.currentOrientation = direction
        }

        for (let i = 0; i < word.length; i++) {
            const char = word[i]

            const availableLetters = letters.filter(l => l.char === char && !l.recruited)

            if (availableLetters.length === 0) {
                console.warn(`No available letter "${char}"`)
                continue
            }

            availableLetters.sort((a, b) => {
                const distA = p5.Vector.dist(a.pos, formation.pos)
                const distB = p5.Vector.dist(b.pos, formation.pos)
                return distA - distB
            })

            const letter = availableLetters[0]
            letter.recruited = true
            letter.wordId = formation.id
            letter.targetIndex = i
            formation.letters.push(letter)
        }

        formation.updateTargetPositions()
        activeWords.push(formation)
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
