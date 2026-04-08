export const DEFAULT_CONFIG = {
    // Letter pool
    letterCount: 500,
    font: 'Courier New',
    letterDistribution: {
        A:9, B:2, C:2, D:4, E:12, F:2, G:3, H:2, I:9, J:1, K:1, L:4,
        M:2, N:6, O:8, P:2, Q:1, R:6, S:4, T:6, U:4, V:2, W:2, X:1,
        Y:2, Z:1
    },

    // Boids flocking
    boids: {
        separationRadius: 28,
        separationStrength: 2.5,
        alignmentRadius: 80,
        alignmentStrength: 0.05,
        cohesionRadius: 120,
        cohesionStrength: 0.006,
    },

    // Word bonding physics
    word: {
        letterSpacing: 16,
        alignStrength: 0.12,
        bondStrength: 0.08,
        repulsionRadius: 160,
        repulsionStrength: 14.0,
        lifetime: 14000,
        rotationSpeed: 0.001,
    },

    // Boundary repulsion
    boundary: {
        margin: 80,
        strength: 0.8,
    },

    // General physics
    physics: {
        gravityStrength: 0,
        spinNoise: 0.003,
        maxLetterSpeed: 3,
        speedDeceleration: 0.3,
    },

    // Burst emission
    burst: {
        wordDelay: 2000,
        cooldown: 30000,
    },

    // Spatial partitioning
    quadtreeCapacity: 8,
    quadtreeRebuildInterval: 5,

    // LLM
    llm: {
        modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
        maxContextLength: 512,
        maxSentenceBuffer: 50,
        maxTokens: 150,
        minWordLength: 4,
    },
}

export function mergeConfig(overrides = {}) {
    return {
        ...DEFAULT_CONFIG,
        ...overrides,
        boids:    { ...DEFAULT_CONFIG.boids,    ...overrides.boids },
        word:     { ...DEFAULT_CONFIG.word,      ...overrides.word },
        boundary: { ...DEFAULT_CONFIG.boundary,  ...overrides.boundary },
        physics:  { ...DEFAULT_CONFIG.physics,   ...overrides.physics },
        burst:    { ...DEFAULT_CONFIG.burst,      ...overrides.burst },
        llm:      { ...DEFAULT_CONFIG.llm,        ...overrides.llm },
        letterDistribution: { ...DEFAULT_CONFIG.letterDistribution, ...overrides.letterDistribution },
    }
}
