// Manages burst timing and emission mode selection.
// No p5 or Ocean dependency — pure scheduling logic.
// Call tick(millis) each frame; it returns an array of { word, direction }
// to emit. Call enqueueSentence(words[]) to add incoming sentences.

export class BurstScheduler {
    constructor(cfg) {
        this.cfg = cfg
        this.sentenceQueue = []   // Array of word[] — each entry is one sentence
        this.pendingBurst = []    // Words still waiting to be emitted in current burst
        this.cooldownUntil = 0
        this.nextEmitTime = 0
        this.gravityDisabled = false
        this.cohesionDisabled = false
        this._lastBurstKey = null // dedup: normalized key of last emitted burst
        this.burstCount = 0       // total bursts emitted, for strongEvery cadence
    }

    enqueueSentence(words) {
        this.sentenceQueue.push(words)
    }

    hasSentenceReady() {
        return this.sentenceQueue.length > 0
    }

    queueSize() {
        return this.sentenceQueue.length
    }

    // Returns an array of { word, direction } to emit this frame.
    // Also updates gravityDisabled as a side effect of zerogravity mode.
    tick(millis, currentDirection) {
        const toEmit = []

        // Start a new burst if cooldown has expired
        if (this.pendingBurst.length === 0 &&
            millis >= this.cooldownUntil &&
            this.sentenceQueue.length > 0)
        {
            let sentence
            let planned
            // Skip bursts whose normalized key matches the last emitted burst
            while (this.sentenceQueue.length > 0) {
                sentence = this.sentenceQueue.shift()
                planned = this._planBurst(sentence, currentDirection)
                const key = planned.map(e => e.word.replace(/[.,!?;:'"]/g, '').toLowerCase()).join(' ')
                if (key !== this._lastBurstKey) {
                    this._lastBurstKey = key
                    break
                }
                planned = null
            }
            if (!planned) return toEmit

            // Every Nth burst goes out with strong repulsion
            this.burstCount++
            if (this.burstCount % this.cfg.burst.strongEvery === 0) {
                for (const entry of planned) entry.strong = true
            }

            this.pendingBurst = planned

            // Emit first word immediately
            const first = this.pendingBurst.shift()
            toEmit.push(first)

            if (this.pendingBurst.length > 0) {
                this.nextEmitTime = millis + this.cfg.burst.wordDelay
            } else {
                this._startCooldown(millis)
            }
        }

        // Emit next word from an in-progress burst
        if (this.pendingBurst.length > 0 && millis >= this.nextEmitTime) {
            toEmit.push(this.pendingBurst.shift())

            if (this.pendingBurst.length > 0) {
                this.nextEmitTime = millis + this.cfg.burst.wordDelay
            } else {
                this._startCooldown(millis)
                this.gravityDisabled = false
            }
        }

        return toEmit
    }

    _startCooldown(millis) {
        this.cooldownUntil = millis + this.cfg.burst.cooldown
    }

    _planBurst(words, baseAngle) {
        const capped = words.slice(0, 10)
        const roll = Math.random()

        if (roll < 0.10 && capped.length >= 4) {
            return this._symmetrical(capped.slice(0, 4), baseAngle)
        }
        if (roll < 0.15) {
            this.gravityDisabled = true
            return this._scatter(capped, baseAngle, 2.0)
        }
        if (roll < 0.50) {
            return this._directional(capped, baseAngle)
        }
        return this._scatter(capped, baseAngle, 2.0)
    }

    _symmetrical(words, baseAngle) {
        return words.map((word, i) => ({
            word,
            direction: baseAngle + (i * Math.PI / 2)
        }))
    }

    _directional(words, baseAngle) {
        const coneAngle = Math.PI / 6
        return words.map(word => ({
            word,
            direction: baseAngle + (Math.random() - 0.5) * coneAngle
        }))
    }

    _scatter(words, baseAngle, randomVariation) {
        const spacing = (Math.PI * 2) / words.length
        return words.map((word, i) => ({
            word,
            direction: baseAngle + i * spacing + (Math.random() - 0.5) * spacing * randomVariation
        }))
    }
}
