import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/word-bag-soul-trap/' : '/',
  build: {
    outDir: '.',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  }
}))
