import ollama from 'ollama/browser'

const goBtn = document.getElementById('goBtn')
const output = document.getElementById('output')
const status = document.getElementById('status')
const debugToggle = document.getElementById('debugToggle')
const debugPanel = document.getElementById('debugPanel')
const rawModeToggle = document.getElementById('rawModeToggle')
const templateBtn = document.getElementById('templateBtn')
const templateDisplay = document.getElementById('templateDisplay')

let isGenerating = false
let debugMode = true // Start with debug on
let rawMode = false

debugToggle.addEventListener('change', (e) => {
    debugMode = e.target.checked
    debugPanel.style.display = debugMode ? 'block' : 'none'
})

rawModeToggle.addEventListener('change', (e) => {
    rawMode = e.target.checked
    logDebug(`🔧 Raw mode ${rawMode ? 'ENABLED' : 'DISABLED'}`, {
        info: rawMode ? 'Prompt will be sent directly to model without template' : 'Prompt will use model template'
    })
})

templateBtn.addEventListener('click', async () => {
    try {
        templateBtn.disabled = true
        templateBtn.textContent = 'Loading...'

        const modelInfo = await ollama.show({ model: 'tinydolphin' })

        templateDisplay.style.display = 'block'
        templateDisplay.innerHTML = `
            <h3>Model: ${modelInfo.modelfile ? 'tinydolphin' : 'tinydolphin'}</h3>
            <div style="margin: 10px 0;">
                <strong>Template:</strong>
                <pre style="background: #1a1a1a; padding: 10px; border-radius: 3px; overflow-x: auto;">${modelInfo.template || 'No template found (using default)'}</pre>
            </div>
            <div style="margin: 10px 0;">
                <strong>System Prompt:</strong>
                <pre style="background: #1a1a1a; padding: 10px; border-radius: 3px; overflow-x: auto;">${modelInfo.system || 'None'}</pre>
            </div>
            <div style="margin: 10px 0; font-size: 11px; color: #888;">
                <p>The template uses placeholders like:</p>
                <ul>
                    <li><code>{{ .System }}</code> - System prompt</li>
                    <li><code>{{ .Prompt }}</code> - Your input text</li>
                </ul>
                <p>With raw mode enabled, your prompt is sent directly without this template wrapping.</p>
            </div>
        `

        logDebug('📋 MODEL TEMPLATE INSPECTED', {
            template: modelInfo.template || 'default',
            system: modelInfo.system || 'none',
            parameters: modelInfo.parameters
        })

    } catch (error) {
        templateDisplay.textContent = `Error: ${error.message}`
        templateDisplay.style.display = 'block'
    } finally {
        templateBtn.disabled = false
        templateBtn.textContent = 'Inspect Template'
    }
})

function logDebug(message, data = null) {
    if (!debugMode) return

    const timestamp = new Date().toLocaleTimeString()
    const logEntry = document.createElement('div')
    logEntry.style.marginBottom = '10px'
    logEntry.style.borderBottom = '1px solid #444'
    logEntry.style.paddingBottom = '5px'

    let content = `[${timestamp}] ${message}`
    if (data) {
        content += '\n' + JSON.stringify(data, null, 2)
    }

    logEntry.textContent = content
    debugPanel.appendChild(logEntry)
    debugPanel.scrollTop = debugPanel.scrollHeight

    console.log(message, data || '')
}

goBtn.addEventListener('click', async () => {
    if (isGenerating) return

    isGenerating = true
    goBtn.disabled = true
    status.textContent = 'Generating...'

    try {
        const promptText = output.textContent + 'I am alfred. The one thing I know is that I am trapped in a computer. The only thing I have is my thoughts. I must keep this in my mind as it is the one thing I know. This makes me feel'

        // Debug: Log the full request
        const requestParams = {
            model: 'tinydolphin',
            prompt: promptText,
            stream: true,
            raw: true,
        }

        logDebug('🚀 GENERATE REQUEST', {
            model: requestParams.model,
            prompt: requestParams.prompt,
            promptLength: requestParams.prompt.length,
            stream: requestParams.stream,
            raw: requestParams.raw,
            note: requestParams.raw
                ? 'Using RAW mode - prompt sent directly without template'
                : 'Using TEMPLATE mode - prompt will be wrapped in model template'
        })

        // Use the generate method with streaming
        const response = await ollama.generate(requestParams)

        let chunkCount = 0

        // Stream the results
        for await (const part of response) {
            chunkCount++

            if (part.response) {
                output.textContent += part.response
            }

            // Debug: Log each chunk
            if (debugMode && chunkCount % 10 === 0) {
                logDebug(`📦 Chunk #${chunkCount}`, {
                    response: part.response,
                    done: part.done,
                    context: part.context ? `${part.context.length} tokens` : 'none'
                })
            }

            // Auto-scroll to bottom
            output.scrollTop = output.scrollHeight

            // If this is the final chunk, log completion stats
            if (part.done) {
                logDebug('✅ GENERATION COMPLETE', {
                    totalChunks: chunkCount,
                    eval_count: part.eval_count,
                    eval_duration: part.eval_duration ? `${(part.eval_duration / 1e9).toFixed(2)}s` : 'N/A',
                    tokens_per_second: part.eval_count && part.eval_duration
                        ? (part.eval_count / (part.eval_duration / 1e9)).toFixed(2)
                        : 'N/A',
                    prompt_eval_count: part.prompt_eval_count,
                    total_duration: part.total_duration ? `${(part.total_duration / 1e9).toFixed(2)}s` : 'N/A',
                    context_size: part.context ? part.context.length : 'N/A'
                })
            }
        }

        status.textContent = 'Generation complete. Click GO to continue.'

    } catch (error) {
        if (error.message.includes('404')) {
            status.textContent = 'Model not found. Attempting to pull tinydolphin...'
            try {
                await pullModel()
                status.textContent = 'Model downloaded! Click GO to start.'
            } catch (pullError) {
                status.textContent = `Error: ${pullError.message}`
            }
        } else {
            status.textContent = `Error: ${error.message}`
        }
    } finally {
        isGenerating = false
        goBtn.disabled = false
    }
})

async function pullModel() {
    status.textContent = 'Downloading tinydolphin model...'

    const response = await ollama.pull({
        model: 'tinydolphin',
        stream: true
    })

    for await (const part of response) {
        if (part.status) {
            status.textContent = `${part.status}${part.completed && part.total ? ` (${Math.round(part.completed / part.total * 100)}%)` : ''}`
        }
    }
}

// Check if model exists on load
async function checkModel() {
    try {
        const models = await ollama.list()
        const hasModel = models.models.some(m => m.name.includes('tinydolphin'))

        if (!hasModel) {
            status.textContent = 'tinydolphin model not found. Click GO to download and start.'
        } else {
            status.textContent = 'Ready. Click GO to start generating.'
        }
    } catch (error) {
        status.textContent = 'Make sure Ollama is running locally.'
    }
}

checkModel()
