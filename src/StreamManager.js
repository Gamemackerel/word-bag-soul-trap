// StreamManager — loads prompts and drives LLM generation.
// No p5 or Ocean dependency.
//
// The model is used as a pure text predictor, not a chatbot.
// One continuous stream of text grows over time. Each prompt line
// is injected into the stream as seed text, and the LLM continues
// predicting what comes next. No system/assistant roles — just words.
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
        this.stream = ''        // the single growing text stream
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

    // Each prompt line can be: "seed text" or "seed text | injected display text"
    // The seed text (before |) is what goes into the LLM context.
    // The display text (after |) is what gets shown in the visualisation immediately.
    // If no |, the whole line is both.
    _nextPrompt() {
        const raw = this.prompts[this.promptIndex]
        this.promptIndex = (this.promptIndex + 1) % this.prompts.length
        const parts = raw.split('|')
        return parts.length > 1
            ? { seed: parts[0].trim(), display: parts[1].trim() }
            : { seed: raw.trim(), display: raw.trim() }
    }

    static BLACKLIST = new Set([
        // contractions (without apostrophe)
        'dont', 'cant', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
        'hadnt', 'wont', 'wouldnt', 'shouldnt', 'couldnt', 'mustnt', 'didnt',
        'doesnt', 'mightnt', 'neednt', 'shant', 'aint', 'youre', 'theyre',
        'were', 'were', 'hes', 'shes', 'thats', 'whos', 'whats', 'theres',
        'youve', 'weve', 'theyve', 'ive', 'youd', 'hed', 'shed', 'theyd',
        'wed', 'youll', 'hell', 'shell', 'theyll', 'well', 'itll',
        // boring abstract filler verbs / words
        'also', 'just', 'very', 'really', 'actually', 'basically', 'literally',
        'simply', 'quite', 'rather', 'somewhat', 'however', 'therefore',
        'although', 'because', 'while', 'often', 'always', 'never', 'every',
        'maybe', 'perhaps', 'usually', 'already', 'still', 'again', 'even',
        'much', 'many', 'some', 'more', 'most', 'each', 'both', 'such',
        'then', 'than', 'when', 'what', 'that', 'this', 'those', 'these',
        'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should',
        'must', 'might', 'make', 'made', 'take', 'taken', 'give', 'given',
        'come', 'came', 'said', 'says', 'seem', 'seems', 'seemed', 'want',
        'like', 'know', 'knew', 'think', 'thought', 'need', 'used', 'went',
        'going', 'being', 'having', 'doing', 'getting', 'making', 'taking',
        'there', 'their', 'they', 'them', 'were', 'your', 'about', 'into',
        'over', 'after', 'only', 'back', 'other', 'than', 'well', 'also',
        'through', 'during', 'before', 'under', 'between', 'without', 'within',
    ])

    _ingestText(text) {
        const { minWordLength } = this.cfg
        const words = text.split(/\s+/).filter(w => w.trim())

        for (const word of words) {
            const clean = word.replace(/[.,!?;:'"]/g, '').toLowerCase()
            if (clean.length <= minWordLength) continue
            if (StreamManager.BLACKLIST.has(clean)) continue

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

            // Inject the seed into the stream and ingest display text for visualisation
            this.stream += ' ' + prompt.seed
            this._ingestText(prompt.display)

            // Trim stream to context window — keep only recent text
            const contextText = this.stream.slice(-this.cfg.maxContextLength)

            console.log(`[LLM] context: "${contextText}"`)

            const stream = await this._engine.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a text completion engine. Output only a direct continuation of the text provided. No preamble, no commentary, no meta-text. Just the next words.' },
                    { role: 'user',   content: contextText },
                ],
                stream: true,
                max_tokens: this.cfg.maxTokens,
            })

            let buffer = ''
            let fullResponse = ''

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (!content) continue

                buffer += content
                fullResponse += content
                this.stream += content

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

            console.log(`[LLM] response: "${fullResponse.trim()}"`)

            // Keep stream from growing unboundedly
            if (this.stream.length > this.cfg.maxContextLength * 2) {
                this.stream = this.stream.slice(-this.cfg.maxContextLength)
            }

        } catch (err) {
            console.error('StreamManager generation error:', err)
        }

        if (this.running) {
            setTimeout(() => this._generate(), 100)
        }
    }
}
