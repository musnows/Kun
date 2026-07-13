import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node20',
    ssr: 'src/host/extension.ts',
    outDir: 'dist/host',
    emptyOutDir: true,
    rollupOptions: {
      external: ['@kun/extension-api'],
      output: {
        entryFileNames: 'extension.js'
      }
    }
  }
})
