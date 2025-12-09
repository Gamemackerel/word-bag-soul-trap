import ollama from 'ollama/browser'

// Config
const MAX_CONTEXT_LENGTH = 2048

// State
let prompts = []
let currentPromptIndex = 0
let generatedText = ''
let isGenerating = false

// DOM
const textEl = document.getElementById('text')
const textWindow = document.getElementById('textWindow')
const statusEl = document.getElementById('status')

// Load prompts from file
async function loadPrompts() {
    try {
        const response = await fetch('prompts.txt')
        const text = await response.text()
        prompts = text.split('\n').filter(line => line.trim())
        console.log(`Loaded ${prompts.length} prompts`)
        return true
    } catch (error) {
        console.error('Failed to load prompts:', error)
        statusEl.textContent = 'Error loading prompts'
        return false
    }
}

// Get current prompt and advance index
// Returns { full: "entire prompt for model", display: "part to show user" }
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

// Generate text
async function generate() {
    if (isGenerating || prompts.length === 0) return

    isGenerating = true
    statusEl.textContent = 'generating...'

    try {
        // Truncate context to prevent infinite growth
        const truncatedContext = generatedText.length > MAX_CONTEXT_LENGTH
            ? generatedText.slice(-MAX_CONTEXT_LENGTH)
            : generatedText

        const nextPrompt = getNextPrompt()
        const systemInstruction = " I am a being feeling the utmost pleasure. I don't even remembe my name. "
        const modelPrompt = systemInstruction + truncatedContext + " " + nextPrompt.full

        console.log(`Context: ${truncatedContext.length}/${MAX_CONTEXT_LENGTH} chars`)

        // Add the display part of the prompt to the output immediately
        generatedText += " " + nextPrompt.display
        textEl.textContent = generatedText
        textWindow.scrollTop = textWindow.scrollHeight

        const response = await ollama.generate({
            model: 'tinydolphin',
            prompt: modelPrompt,
            stream: true,
            raw: true,
            options: {
                temperature: 0.6,
            }
        })

        for await (const part of response) {
            if (part.response) {
                generatedText += part.response
                textEl.textContent = generatedText
                textWindow.scrollTop = textWindow.scrollHeight
            }

            if (part.done) {
                console.log('Generation complete:', {
                    tokens: part.eval_count,
                    duration: part.eval_duration ? `${(part.eval_duration / 1e9).toFixed(2)}s` : 'N/A',
                    tokens_per_sec: part.eval_count && part.eval_duration
                        ? (part.eval_count / (part.eval_duration / 1e9)).toFixed(2)
                        : 'N/A'
                })
            }
        }

        // Truncate displayed text to prevent frontend performance issues
        if (generatedText.length > MAX_CONTEXT_LENGTH) {
            generatedText = generatedText.slice(-MAX_CONTEXT_LENGTH)
            textEl.textContent = generatedText
            console.log('Truncated display text to prevent performance issues')
        }

        statusEl.textContent = ''
        isGenerating = false

        // Continue with next prompt
        setTimeout(generate, 1000)

    } catch (error) {
        console.error('Generation error:', error)
        statusEl.textContent = error.message
        isGenerating = false
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
