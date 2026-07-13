import p5 from 'p5'
import { mergeConfig } from './config.js'
import { Rectangle, Quadtree } from './quadtree.js'
import { Letter } from './Letter.js'
import { WordFormation } from './WordFormation.js'
import { BurstScheduler } from './BurstScheduler.js'

// Ocean — the p5 letter-physics visualization.
//
// Public API:
//   ocean.formWord(word, direction?)     — immediately recruit letters for a word
//   ocean.enqueueSentence(words[])       — add a sentence to the burst queue
//   ocean.setGravityCenter(x, y)         — move the gravity attractor
//   ocean.captureAsSVG()                 — download current frame as SVG

export class Ocean {
    constructor(containerEl, configOverrides = {}) {
        this.cfg = mergeConfig(configOverrides)
        this._sketch = null
        this._p5 = new p5(p => this._buildSketch(p), containerEl)
    }

    formWord(word, direction) {
        this._sketch?.formWord(word, direction)
    }

    enqueueSentence(words) {
        this._sketch?.scheduler.enqueueSentence(words)
    }

    setGravityCenter(x, y) {
        if (this._sketch) {
            this._sketch.centerX = x
            this._sketch.centerY = y
        }
    }

    captureAsSVG() {
        this._sketch?.captureAsSVG()
    }

    // ── p5 sketch ─────────────────────────────────────────────────────────────

    _buildSketch(p) {
        const cfg = this.cfg
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

        let letters = []
        let activeWords = []
        let lettersByChar = new Map()
        let letterPool = []
        let quadtree = null
        let framesSinceRebuild = 0
        let wordDirection = 0
        let centerX, centerY
        let draggedLetter = null
        let prevMousePos = null
        let draggingCenter = false

        const scheduler = new BurstScheduler(cfg)
        this._sketch = {
            scheduler,
            get centerX() { return centerX },
            set centerX(v) { centerX = v },
            get centerY() { return centerY },
            set centerY(v) { centerY = v },
            formWord,
            captureAsSVG,
        }

        p.setup = () => {
            p.createCanvas(p.windowWidth, p.windowHeight)
            centerX = p.width / 2
            centerY = p.height / 2

            for (const char of alphabet) lettersByChar.set(char, [])

            letterPool = Object.entries(cfg.letterDistribution)
                .flatMap(([ch, count]) => Array(count).fill(ch))

            for (let i = 0; i < cfg.letterCount; i++) {
                const char = letterPool[Math.floor(Math.random() * letterPool.length)]
                const letter = new Letter(char, p.random(p.width), p.random(p.height), p, cfg)
                letters.push(letter)
                lettersByChar.get(char).push(letter)
            }
        }

        p.draw = () => {
            p.background(255)
            wordDirection += cfg.word.rotationSpeed

            const now = p.millis()

            // Word bond forces + dissolve expired words
            for (let i = activeWords.length - 1; i >= 0; i--) {
                const w = activeWords[i]
                w.applyBondForces(now)
                if (w.shouldDissolve(now)) w.dissolve()
                if (w.launched) activeWords.splice(i, 1)
            }

            // Rebuild quadtree periodically
            framesSinceRebuild++
            if (!quadtree || framesSinceRebuild >= cfg.quadtreeRebuildInterval) {
                quadtree = new Quadtree(
                    new Rectangle(p.width / 2, p.height / 2, p.width / 2, p.height / 2),
                    cfg.quadtreeCapacity
                )
                for (const lt of letters) quadtree.insert(lt)
                framesSinceRebuild = 0
            }

            // Forces
            const { gravityDisabled, cohesionDisabled } = scheduler
            for (const lt of letters) {
                lt.applyBoidsForces(quadtree, cohesionDisabled)
                lt.applyBoundaryForce(p.width, p.height)
                if (!lt.recruited && !gravityDisabled) lt.applyGravity(centerX, centerY)
            }

            // Integrate + render
            p.textFont(cfg.font)
            for (const lt of letters) { lt.update(); lt.display() }

            // Burst scheduling
            const toEmit = scheduler.tick(now, wordDirection)
            for (const { word, direction, strong } of toEmit) formWord(word, direction, strong)
        }

        p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight)

        p.mousePressed = () => {
            for (const lt of letters) {
                const d = p5.Vector.dist(lt.pos, p.createVector(p.mouseX, p.mouseY))
                if (d < lt.radius * 2) {
                    draggedLetter = lt
                    lt.vel.mult(0)
                    lt.releaseBond()
                    lt.dragging = true
                    prevMousePos = p.createVector(p.mouseX, p.mouseY)
                    return
                }
            }
            draggingCenter = true
            centerX = p.mouseX
            centerY = p.mouseY
        }

        p.mouseDragged = () => {
            if (draggedLetter) {
                draggedLetter.pos.set(p.mouseX, p.mouseY)
                const curr = p.createVector(p.mouseX, p.mouseY)
                if (prevMousePos) draggedLetter.vel = p5.Vector.sub(curr, prevMousePos)
                prevMousePos = curr.copy()
            } else if (draggingCenter) {
                centerX = p.mouseX
                centerY = p.mouseY
            }
        }

        p.mouseReleased = () => {
            if (draggedLetter) { draggedLetter.dragging = false; draggedLetter = null }
            else if (draggingCenter) draggingCenter = false
            prevMousePos = null
        }

        p.keyPressed = () => {
            if (p.key === ' ') scheduler.cohesionDisabled = true
            if (p.key === 's' || p.key === 'S') captureAsSVG()
        }

        p.keyReleased = () => {
            if (p.key === ' ') scheduler.cohesionDisabled = false
        }

        // ── formWord ──────────────────────────────────────────────────────────

        function formWord(word, direction, strong = false) {
            word = word.toUpperCase()
            const dir = direction ?? wordDirection
            const formation = new WordFormation(word, p, p.millis(), dir, cfg)
            if (strong) formation.repulsionStrength = cfg.word.strongRepulsionStrength

            let anchorX = centerX
            let anchorY = centerY

            for (let i = 0; i < word.length; i++) {
                const char = word[i]
                const pool = lettersByChar.get(char)
                if (!pool?.length) { console.warn(`No pool for "${char}"`); continue }

                let closest = null
                let closestDSq = Infinity

                for (const lt of pool) {
                    if (lt.recruited) continue
                    const dx = lt.pos.x - anchorX
                    const dy = lt.pos.y - anchorY
                    const dSq = dx * dx + dy * dy
                    if (dSq < closestDSq) { closestDSq = dSq; closest = lt }
                }

                if (!closest) { console.warn(`No free "${char}"`); continue }

                closest.recruited = true
                closest.wordGroup = formation
                closest.wordIndex = i

                formation.letters.push(closest)
                anchorX = closest.pos.x
                anchorY = closest.pos.y
            }

            // Wire neighbor bonds in word order
            const sorted = [...formation.letters].sort((a, b) => a.wordIndex - b.wordIndex)
            for (let i = 0; i < sorted.length; i++) {
                sorted[i].bondLeft  = sorted[i - 1] ?? null
                sorted[i].bondRight = sorted[i + 1] ?? null
            }

            activeWords.push(formation)
        }

        // ── SVG export ────────────────────────────────────────────────────────

        function captureAsSVG() {
            const w = p.width
            const h = p.height
            const lines = [
                `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
                `<rect width="${w}" height="${h}" fill="white"/>`,
            ]
            for (const lt of letters) {
                const deg = (lt.angle * 180 / Math.PI).toFixed(2)
                const escaped = lt.char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                lines.push(
                    `<text transform="translate(${lt.pos.x.toFixed(2)},${lt.pos.y.toFixed(2)}) rotate(${deg})" ` +
                    `text-anchor="middle" dominant-baseline="middle" ` +
                    `font-family="'Courier New', Courier, monospace" font-size="${lt.size}" ` +
                    `opacity="${(lt.alpha / 255).toFixed(3)}">${escaped}</text>`
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
        }
    }
}
