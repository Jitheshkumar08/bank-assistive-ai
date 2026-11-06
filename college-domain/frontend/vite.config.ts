import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // The lazily-loaded 3D chunk (three.js core + React Three Fiber, ~250 kB gzip) loads after the login form is
    // usable. Budget it explicitly; any other chunk growing past 1 MB should still be investigated.
    chunkSizeWarningLimit: 1000,
  },
})
