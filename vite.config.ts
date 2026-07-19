import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    // ffmpeg.wasm ships worker code that breaks under Vite's dep pre-bundling.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
