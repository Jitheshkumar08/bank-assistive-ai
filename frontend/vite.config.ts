import { fileURLToPath, URL } from 'node:url';
// defineConfig comes from vitest/config rather than vite so the
// `test` block below is typed. Everything else behaves identically.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  server: {
    host: true,
    port: 5173,
    // Matches CORS_ORIGINS in the backend .env. Changing one means
    // changing the other.
    strictPort: true,
  },
});
