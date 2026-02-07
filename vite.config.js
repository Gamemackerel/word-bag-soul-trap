import { defineConfig } from 'vite'

export default defineConfig({
  base: '/word-bag-soul-trap/',
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
})
