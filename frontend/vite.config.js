import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Recharts + React bundled together exceeds 500 kB — expected for this stack.
    // Raise the warning threshold rather than splitting; we'll add code-splitting
    // per-page when each page is fully built.
    chunkSizeWarningLimit: 700,
  },
})
