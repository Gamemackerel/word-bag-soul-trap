// StreamManager — loads prompts and drives LLM generation.
// No p5 or Ocean dependency.
//
// Usage:
//   const manager = new StreamManager(config)
//   await manager.loadPrompts('./prompts.txt')
//   manager.start(engine, sentence => ocean.enqueueSentence(sentence))

export class StreamManager {
    constructor(cfg) {
        this.cfg = cfg.llm
        this.prompts = []
        this.promptIndex = 0
        this.context = ''       // rolling LLM context window
        this.running = false
        this.onSentence = null  // callback(words[])
        this._engine = null
        this._sentenceBuffer = []
    }

    async loadPrompts(url = './prompts.txt') {
        const response = await fetch(url)
        const text = await response.text()
        this.prompts = text.split('\n').filter(l => l.trim())
        console.log(`Loaded ${this.prompts.length} prompts`)
        return this.prompts.length > 0
    }

    // Start continuous generation. Calls onSentence(words[]) for each complete sentence.
    start(engine, onSentence) {
        this._engine = engine
        this.onSentence = onSentence
        this.running = true
        this._generate()
    }

    stop() {
        this.running = false
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _nextPrompt() {
        const raw = this.prompts[this.promptIndex]
        this.promptIndex = (this.promptIndex + 1) % this.prompts.length
        const parts = raw.split('|')
        return parts.length > 1
            ? { full: parts[0].trim() + ' ' + parts[1].trim(), display: parts[1].trim() }
            : { full: raw, display: raw }
    }

    _ingestText(text) {
        const { minWordLength } = this.cfg
        const words = text.split(/\s+/).filter(w => w.trim())

        for (const word of words) {
            const clean = word.replace(/[.,!?;:]/g, '')
            if (clean.length <= minWordLength) continue

            this._sentenceBuffer.push(word)

            if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
                if (this._sentenceBuffer.length > 0) {
                    this.onSentence?.([...this._sentenceBuffer])
                    this._sentenceBuffer = []
                }
            }
        }
    }

    async _generate() {
        if (!this.running || this.prompts.length === 0) return

        try {
            const prompt = this._nextPrompt()
            const contextInput = this.context.slice(-300)
            const fullInput = contextInput ? `${contextInput} ${prompt.full}` : prompt.full

            // Immediately ingest the display portion of the prompt
            this._ingestText(prompt.display)
            this.context += ' ' + prompt.display

            const stream = await this._engine.chat.completions.create({
                messages: [{ role: 'user', content: fullInput }],
                stream: true,
                max_tokens: this.cfg.maxTokens,
            })

            let buffer = ''
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (!content) continue

                buffer += content
                this.context += content

                if (/\s/.test(buffer)) {
                    const parts = buffer.split(/(\s+)/)
                    for (let i = 0; i < parts.length - 1; i++) {
                        if (parts[i].trim()) this._ingestText(parts[i])
                    }
                    buffer = parts.at(-1) || ''
                }

                if (chunk.choices[0]?.finish_reason && buffer.trim()) {
                    this._ingestText(buffer)
                    buffer = ''
                }
            }

            // Trim context to avoid unbounded growth
            if (this.context.length > this.cfg.maxContextLength) {
                this.context = this.context.slice(-this.cfg.maxContextLength)
            }

        } catch (err) {
            console.error('StreamManager generation error:', err)
        }

        if (this.running) {
            setTimeout(() => this._generate(), 100)
        }
    }
}
