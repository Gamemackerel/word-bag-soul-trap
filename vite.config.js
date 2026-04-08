import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
    base: command === 'build' ? '/word-bag-soul-trap/' : '/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
}))
