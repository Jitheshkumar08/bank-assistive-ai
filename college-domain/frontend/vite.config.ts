import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 5174 (strict): Banking's frontend uses 5173 on the same machine, and FRONTEND_ORIGIN/CORS must match exactly.
  server: { port: 5174, strictPort: true },
  build: {
    // The main bundle (~0.9 MB, ~260 kB gzip) includes the app and admin portals; budget it explicitly so any chunk
    // growing past 1 MB is still flagged.
    chunkSizeWarningLimit: 1000,
  },
})
