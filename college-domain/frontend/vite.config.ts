import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 5174 (strict): Banking's frontend uses 5173 on the same machine, and FRONTEND_ORIGIN/CORS must match exactly.
  server: { port: 5174, strictPort: true },
  build: {
    // The lazily-loaded 3D chunk (three.js core + React Three Fiber, ~250 kB gzip) loads after the login form is
    // usable. Budget it explicitly; any other chunk growing past 1 MB should still be investigated.
    chunkSizeWarningLimit: 1000,
  },
})
