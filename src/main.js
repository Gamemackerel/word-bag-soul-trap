import { CreateMLCEngine } from '@mlc-ai/web-llm'
import { Ocean } from './Ocean.js'
import { StreamManager } from './StreamManager.js'
import { DEFAULT_CONFIG } from './config.js'

const statusEl = document.getElementById('status')

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg
}

// ── Visualization ─────────────────────────────────────────────────────────────

const ocean = new Ocean(document.getElementById('canvas-container'))

// ── LLM pipeline ─────────────────────────────────────────────────────────────

async function init() {
    const manager = new StreamManager(DEFAULT_CONFIG)

    const loaded = await manager.loadPrompts('./prompts.txt')
    if (!loaded) {
        setStatus('Failed to load prompts.')
        return
    }

    try {
        setStatus('Loading AI model...')

        const engine = await CreateMLCEngine(DEFAULT_CONFIG.llm.modelId, {
            initProgressCallback: ({ progress }) => {
                setStatus(`Loading model: ${Math.round(progress * 100)}%`)
            }
        })

        setStatus('Model ready!')
        setTimeout(() => setStatus(''), 2000)

        // Wire StreamManager → Ocean: each complete sentence goes to the burst queue
        manager.start(engine, words => ocean.enqueueSentence(words))

    } catch (err) {
        console.error(err)
        setStatus('Error loading model. WebGPU required.')
    }
}

init()
