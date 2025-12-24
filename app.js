import p5 from 'p5'
import ollama from 'ollama/browser'

// Config
const MAX_CONTEXT_LENGTH = 512  // Reduced for faster processing
const MAX_WORDS_DISPLAY = 200

// State
let prompts = []
let currentPromptIndex = 0
let generatedText = ''
let words = [] // Array of word objects for p5 visualization

// Word queue system
let wordQueue = [] // Queue of words waiting to be displayed
let generationQueue = 0 // Number of generations in progress or queued
const MAX_GENERATION_LOOKAHEAD = 2 // Maximum generations to queue ahead
const WORDS_PER_SECOND = 1 // Display rate

// DOM
const statusEl = document.getElementById('status')

// Word class for visualization
class Word {
    constructor(text, x, y, p) {
        this.text = text
        this.x = x
        this.y = y
        this.targetY = y + 40 // Words flow downward
        this.alpha = 255
        this.size = 18
        this.life = 1.0
        this.velocity = p.random(0.3, 0.8)
    }

    update(p) {
        // Move down smoothly
        this.y += this.velocity

        // Fade out over time
        this.life -= 0.001
        this.alpha = p.map(this.life, 0, 1, 0, 255)

        // Shrink slightly as it ages
        this.size = p.map(this.life, 0, 1, 12, 18)
    }

    display(p) {
        p.push()
        p.fill(0, this.alpha)
        p.textSize(this.size)
        p.textFont('Courier New')
        p.text(this.text, this.x, this.y)
        p.pop()
    }

    isDead(p) {
        return this.life <= 0 || this.y > p.height + 50
    }
}

// p5 sketch
const sketch = (p) => {
    let wordX = 0
    let wordY = 50

    p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight)
        p.textFont('Courier New')
        p.textAlign(p.LEFT, p.TOP)
    }

    p.draw = () => {
        // Clear with white background
        p.background(255)

        // Update and display all words
        for (let i = words.length - 1; i >= 0; i--) {
            words[i].update(p)
            words[i].display(p)

            // Remove dead words
            if (words[i].isDead(p)) {
                words.splice(i, 1)
            }
        }

        // Keep only the most recent words
        if (words.length > MAX_WORDS_DISPLAY) {
            words.splice(0, words.length - MAX_WORDS_DISPLAY)
        }
    }

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight)
    }

    // Public method to add new word
    p.addWord = (text) => {
        // Calculate position for new word
        let testWidth = p.textWidth(text + ' ')

        // Start new line if needed
        if (wordX + testWidth > p.width - 100) {
            wordX = 50
            wordY += 40
        }

        // Reset to top if we've gone too far down
        if (wordY > p.height - 100) {
            wordY = 50
        }

        words.push(new Word(text, wordX, wordY, p))

        wordX += testWidth
    }
}

// Create p5 instance
const p5Instance = new p5(sketch, 'main')

// Load prompts from file
async function loadPrompts() {
    try {
        const response = await fetch('prompts.txt')
        const textContent = await response.text()
        prompts = textContent.split('\n').filter(line => line.trim())
        console.log(`Loaded ${prompts.length} prompts`)
        return true
    } catch (error) {
        console.error('Failed to load prompts:', error)
        statusEl.textContent = 'Error loading prompts'
        return false
    }
}

// Get current prompt and advance index
function getNextPrompt() {
    const rawPrompt = prompts[currentPromptIndex]
    currentPromptIndex = (currentPromptIndex + 1) % prompts.length

    // Split on | to separate model prompt from display text
    const parts = rawPrompt.split('|')

    // Reconstruct without the pipe: context + display text
    const full = parts.length > 1
        ? parts[0].trim() + ' ' + parts[1].trim()
        : rawPrompt
    const display = parts.length > 1 ? parts[1].trim() : rawPrompt

    console.log(`Prompt ${currentPromptIndex}/${prompts.length} | Display: "${display.substring(0, 30)}..."`)

    return { full, display }
}

// Add text to visualization (now adds to queue instead of direct display)
function addTextToDisplay(text) {
    // Split into words and add each to the queue
    const newWords = text.split(/\s+/).filter(w => w.trim())
    newWords.forEach(word => {
        wordQueue.push(word)
    })
    console.log(`  📥 Added ${newWords.length} words to queue (queue size: ${wordQueue.length})`)
}

// Display words from queue at controlled rate
function startWordDisplay() {
    setInterval(() => {
        if (wordQueue.length > 0) {
            const word = wordQueue.shift()
            p5Instance.addWord(word)
            console.log(`  📤 Displaying queued word: "${word}" (${wordQueue.length} remaining)`)
        }
    }, 1000 / WORDS_PER_SECOND) // 1 word per second
}

// Start displaying words from queue
startWordDisplay()

// Generate text
async function generate() {
    // Check if we have too many generations queued
    if (generationQueue >= MAX_GENERATION_LOOKAHEAD) {
        console.log(`⏸️  Skipping generation - already ${generationQueue} generations queued`)
        setTimeout(generate, 1000)
        return
    }

    if (prompts.length === 0) return

    generationQueue++
    console.log(`🎯 Starting generation (${generationQueue}/${MAX_GENERATION_LOOKAHEAD} queued)`)

    statusEl.textContent = `generating... (${generationQueue} queued, ${wordQueue.length} words buffered)`

    try {
        const startTime = performance.now()

        // Truncate context to prevent infinite growth
        const truncatedContext = generatedText.length > MAX_CONTEXT_LENGTH
            ? generatedText.slice(-MAX_CONTEXT_LENGTH)
            : generatedText

        const nextPrompt = getNextPrompt()

        // Build a more concise prompt
        const contextPrompt = truncatedContext
            ? truncatedContext.slice(-300) + " " + nextPrompt.full  // Use only last 300 chars
            : nextPrompt.full

        console.log('📝 PROMPT DETAILS:')
        console.log('  Length:', contextPrompt.length, 'chars')
        console.log('  Full prompt:', JSON.stringify(contextPrompt.substring(0, 200)) + '...')
        console.log('  Truncated context:', truncatedContext.length, 'chars')
        console.log('  Using last:', contextPrompt.length, 'chars for generation')

        // Add the display part of the prompt to the output immediately
        const displayText = " " + nextPrompt.display
        generatedText += displayText
        addTextToDisplay(displayText)

        console.log('🚀 Sending request to Ollama...')
        const requestStart = performance.now()

        const response = await ollama.generate({
            model: 'tinydolphin',
            prompt: contextPrompt,
            stream: true,
            raw: true,
            options: {
                temperature: 0.7,
                num_predict: 100,  // Longer generations now that we're buffering
                num_ctx: 512,     // Smaller context window
            },
            keep_alive: -1  // Keep loaded indefinitely
        })

        const firstResponseTime = performance.now() - requestStart
        console.log(`⏱️  First response received in ${firstResponseTime.toFixed(0)}ms`)

        if (firstResponseTime > 5000) {
            console.warn('⚠️  SLOW RESPONSE - took more than 5 seconds!')
        }

        let buffer = ''
        let chunkCount = 0
        let lastChunkTime = performance.now()

        for await (const part of response) {
            chunkCount++
            const chunkTime = performance.now() - lastChunkTime

            console.log(`📦 Chunk #${chunkCount} (${chunkTime.toFixed(0)}ms since last):`, {
                has_response: !!part.response,
                response_length: part.response?.length || 0,
                response_text: part.response ? JSON.stringify(part.response) : 'none',
                is_done: part.done || false
            })

            if (part.response) {
                buffer += part.response
                generatedText += part.response

                // Check if buffer contains any whitespace
                if (/\s/.test(buffer)) {
                    // Split and process complete words immediately
                    const wordParts = buffer.split(/(\s+)/)

                    // Process all parts except the last (which might be incomplete)
                    for (let i = 0; i < wordParts.length - 1; i++) {
                        const wordPart = wordParts[i]
                        if (wordPart && wordPart.trim()) {
                            // This is a complete word - display it immediately
                            console.log('  ✏️  Displaying word:', wordPart)
                            addTextToDisplay(wordPart)
                        }
                    }

                    // Keep only the last part in buffer (incomplete word)
                    buffer = wordParts[wordParts.length - 1] || ''
                }
            }

            if (part.done) {
                // Add any remaining text
                if (buffer.trim()) {
                    console.log('  ✏️  Displaying final word:', buffer)
                    addTextToDisplay(buffer)
                }

                const totalTime = performance.now() - startTime
                const evalTime = part.eval_duration ? part.eval_duration / 1e9 : 0
                const promptTime = part.prompt_eval_duration ? part.prompt_eval_duration / 1e9 : 0

                console.log('✅ GENERATION COMPLETE:')
                console.log('  Total time:', `${(totalTime / 1000).toFixed(2)}s`)
                console.log('  Prompt eval time:', `${promptTime.toFixed(2)}s`)
                console.log('  Generation eval time:', `${evalTime.toFixed(2)}s`)
                console.log('  Tokens generated:', part.eval_count)
                console.log('  Tokens/sec:', part.eval_count && evalTime ? (part.eval_count / evalTime).toFixed(2) : 'N/A')
                console.log('  Total chunks received:', chunkCount)

                if (promptTime > 5) {
                    console.warn('⚠️  SLOW PROMPT PROCESSING - took more than 5 seconds!')
                }
            }

            lastChunkTime = performance.now()
        }

        // Truncate stored text to prevent memory issues
        if (generatedText.length > MAX_CONTEXT_LENGTH) {
            generatedText = generatedText.slice(-MAX_CONTEXT_LENGTH)
            console.log('Truncated context text')
        }

        generationQueue--
        statusEl.textContent = `${wordQueue.length} words buffered`

        console.log(`✨ Generation complete - ${generationQueue} generations remaining, ${wordQueue.length} words in queue`)

        // Immediately start next generation (don't wait for display to finish)
        setTimeout(generate, 100)

    } catch (error) {
        console.error('Generation error:', error)
        statusEl.textContent = error.message
        generationQueue--
        // Retry after error
        setTimeout(generate, 5000)
    }
}

// Initialize
async function init() {
    statusEl.textContent = 'loading prompts...'

    const loaded = await loadPrompts()
    if (!loaded) return

    statusEl.textContent = 'checking model...'

    try {
        const models = await ollama.list()
        const hasModel = models.models.some(m => m.name.includes('tinydolphin'))

        if (!hasModel) {
            statusEl.textContent = 'downloading tinydolphin...'
            const response = await ollama.pull({ model: 'tinydolphin', stream: true })
            for await (const part of response) {
                if (part.status) {
                    statusEl.textContent = part.status
                }
            }
        }

        statusEl.textContent = ''
        generate()

    } catch (error) {
        console.error('Initialization error:', error)
        statusEl.textContent = 'Error: Is Ollama running?'
    }
}

init()
