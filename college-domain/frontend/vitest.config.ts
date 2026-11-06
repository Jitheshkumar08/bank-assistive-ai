import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Tests never talk to a real backend, whatever a developer's .env.local says; HTTP services are tested with mocks.
    env: { VITE_API_BASE_URL: '' },
  },
})
